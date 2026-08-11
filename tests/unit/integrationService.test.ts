import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IntegrationService } from '../../src/main/integrations/integrationService.js'
import type {
  JsonRpcNotificationHandler,
  JsonRpcRequestHandler,
  JsonValue,
} from '../../src/main/runtime/jsonlRpc.js'
import { StateDatabase } from '../../src/main/state/database.js'

class FakeRuntime {
  readonly requests: { method: string; params: JsonValue | undefined }[] = []
  readonly requestHandlers = new Map<string, JsonRpcRequestHandler>()
  readonly notificationHandlers = new Map<string, Set<JsonRpcNotificationHandler>>()
  oauthUrl = 'https://example.com/oauth'

  start(): Promise<unknown> {
    return Promise.resolve({})
  }

  request<T extends JsonValue = JsonValue>(method: string, params?: JsonValue): Promise<T> {
    this.requests.push({ method, params })
    return Promise.resolve(this.response(method) as T)
  }

  onNotification(method: string, handler: JsonRpcNotificationHandler): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set()
    handlers.add(handler)
    this.notificationHandlers.set(method, handlers)
    return () => handlers.delete(handler)
  }

  registerRequestHandler(method: string, handler: JsonRpcRequestHandler): () => void {
    this.requestHandlers.set(method, handler)
    return () => this.requestHandlers.delete(method)
  }

  response(method: string): JsonValue {
    if (method === 'mcpServerStatus/list') {
      return {
        data: [{
          name: 'docs',
          serverInfo: { name: 'docs', title: 'Docs MCP', version: '1.0.0' },
          authStatus: 'notLoggedIn',
          tools: {
            search: {
              name: 'search',
              title: 'Search',
              description: 'Search docs',
              inputSchema: { type: 'object' },
            },
          },
          resources: [{ uri: 'docs://readme', name: 'Readme', mimeType: 'text/plain' }],
          resourceTemplates: [],
        }],
        nextCursor: null,
      }
    }
    if (method === 'skills/list') {
      const cwd = String((this.requests.at(-1)?.params as { cwds?: string[] } | undefined)?.cwds?.[0])
      return {
        data: [{
          cwd,
          skills: [{
            name: 'quality',
            description: 'Run quality checks',
            path: `${cwd}/.agents/skills/quality/SKILL.md`,
            scope: 'repo',
            enabled: true,
            interface: { displayName: 'Quality', shortDescription: 'Quality checks' },
            dependencies: { tools: [{ type: 'mcp', value: 'docs' }] },
          }],
          errors: [],
        }],
      }
    }
    if (method === 'config/read') {
      return {
        config: {
          model: 'gpt-5.6-codex',
          model_provider: 'openai',
          model_reasoning_effort: 'high',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          web_search: 'live',
        },
        origins: {
          sandbox_mode: { name: { type: 'user', file: '/tmp/config.toml', profile: null }, version: 'v1' },
        },
        layers: [{
          name: { type: 'project', dotCodexFolder: '/tmp/project/.codex' },
          version: 'v2',
          config: { sandbox_mode: 'workspace-write' },
          disabledReason: null,
        }],
      }
    }
    if (method === 'configRequirements/read') return { requirements: { allowedSandboxModes: ['workspace-write'] } }
    if (method === 'permissionProfile/list') {
      return { data: [{ id: ':workspace', description: 'Workspace read/write', allowed: true }], nextCursor: null }
    }
    if (method === 'mcpServer/resource/read') {
      return { contents: [{ uri: 'docs://readme', mimeType: 'text/plain', text: 'RESOURCE_OK' }] }
    }
    if (method === 'mcpServer/tool/call') {
      return { content: [{ type: 'text', text: 'TOOL_OK' }], structuredContent: { ok: true }, isError: false }
    }
    if (method === 'mcpServer/oauth/login') return { authorizationUrl: this.oauthUrl }
    if (method === 'skills/config/write') return { effectiveEnabled: false }
    if (method === 'skills/extraRoots/set') return {}
    if (method === 'config/value/write') return { status: 'ok', version: '2', filePath: '/tmp/config.toml' }
    if (method === 'config/mcpServer/reload') return {}
    throw new Error(`Unexpected request ${method}`)
  }
}

const databases: StateDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function createHarness(): {
  database: StateDatabase
  projectId: string
  projectPath: string
  runtime: FakeRuntime
  service: IntegrationService
} {
  const root = mkdtempSync(join(tmpdir(), 'aster-integrations-'))
  const selectedPath = join(root, 'project')
  mkdirSync(selectedPath)
  writeFileSync(join(selectedPath, 'AGENTS.md'), 'Always reply with INSTRUCTIONS_OK.\n')
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  databases.push(database)
  const project = database.upsertProject(selectedPath)
  const projectId = project.id
  database.associateThread(projectId, 'thread-1')
  const projectPath = project.path
  const runtime = new FakeRuntime()
  const service = new IntegrationService(runtime, database)
  return { database, projectId, projectPath, runtime, service }
}

describe('IntegrationService', () => {
  it('normalizes MCP, skills, config layers, requirements and project instructions', async () => {
    const { projectId, projectPath, service } = createHarness()
    const snapshot = await service.load(projectId, 'thread-1')

    expect(snapshot.cwd).toBe(projectPath)
    expect(snapshot.mcpServers[0]).toMatchObject({ name: 'docs', authStatus: 'notLoggedIn' })
    expect(snapshot.mcpServers[0]?.tools[0]?.name).toBe('search')
    expect(snapshot.skills[0]).toMatchObject({ name: 'quality', scope: 'repo', enabled: true })
    expect(snapshot.config).toMatchObject({
      model: 'gpt-5.6-codex',
      sandboxMode: 'workspace-write',
      requirements: { allowedSandboxModes: ['workspace-write'] },
    })
    expect(snapshot.instructions[0]?.preview).toContain('INSTRUCTIONS_OK')
    service.dispose()
  })

  it('guards extra roots and direct tools while completing real service requests', async () => {
    const { projectId, projectPath, runtime, service } = createHarness()
    const root = join(projectPath, 'shared-skills')
    mkdirSync(root)
    await service.load(projectId, 'thread-1')

    await expect(service.addExtraSkillRoot(projectId, root)).rejects.toThrow('Trust this project')
    service.setProjectTrust(projectId, true)
    await service.addExtraSkillRoot(projectId, root)
    await service.setSkillEnabled(projectId, `${projectPath}/.agents/skills/quality/SKILL.md`, false)
    await service.writeSafeConfig({ projectId, key: 'web_search', value: 'cached' })
    runtime.oauthUrl = 'http://example.com/insecure'
    await expect(service.startMcpOAuth({ projectId, name: 'docs', threadId: 'thread-1' }))
      .rejects.toThrow('unsupported authorization URL')
    runtime.oauthUrl = 'https://example.com/oauth'
    await expect(service.startMcpOAuth({ projectId, name: 'docs', threadId: 'thread-1' }))
      .resolves.toEqual({ authorizationUrl: 'https://example.com/oauth' })

    const resource = await service.readMcpResource({ projectId, name: 'docs', uri: 'docs://readme' })
    expect(resource.contents[0]?.text).toBe('RESOURCE_OK')
    await expect(service.callMcpTool({
      projectId,
      threadId: 'thread-1',
      server: 'docs',
      tool: 'search',
      arguments: { query: 'Codex' },
      confirmed: false,
    })).rejects.toThrow('explicit confirmation')
    await expect(service.callMcpTool({
      projectId,
      threadId: 'foreign-thread',
      server: 'docs',
      tool: 'search',
      arguments: {},
      confirmed: true,
    })).rejects.toThrow('not associated')
    await expect(service.callMcpTool({
      projectId,
      threadId: 'thread-1',
      server: 'docs',
      tool: 'search',
      arguments: { payload: 'x'.repeat(300_000) },
      confirmed: true,
    })).rejects.toThrow('exceeds')
    const tool = await service.callMcpTool({
      projectId,
      threadId: 'thread-1',
      server: 'docs',
      tool: 'search',
      arguments: { query: 'Codex' },
      confirmed: true,
    })
    expect(tool).toMatchObject({ structuredContent: { ok: true }, isError: false })
    expect(runtime.requests.map(({ method }) => method)).toContain('skills/extraRoots/set')
    service.dispose()
  })

  it('holds MCP elicitation and user input until an explicit client decision', async () => {
    const { projectId, runtime, service } = createHarness()
    await service.load(projectId, 'thread-1')

    const elicitationHandler = runtime.requestHandlers.get('mcpServer/elicitation/request')
    const elicitation = elicitationHandler?.({
      threadId: 'thread-1',
      turnId: 'turn-1',
      serverName: 'docs',
      mode: 'form',
      message: 'Choose a repository',
      requestedSchema: { type: 'object' },
      _meta: null,
    }, { id: 41, method: 'mcpServer/elicitation/request' })
    const requestId = service.getSnapshot().pendingRequests[0]?.id
    expect(requestId).toBeTruthy()
    service.resolveRequest({ requestId: requestId ?? '', action: 'accept', content: { repository: 'aster' } })
    await expect(elicitation).resolves.toEqual({
      action: 'accept',
      content: { repository: 'aster' },
      _meta: null,
    })

    const userInputHandler = runtime.requestHandlers.get('item/tool/requestUserInput')
    const userInput = userInputHandler?.({
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      isBlocking: true,
      autoResolutionMs: null,
      questions: [{
        id: 'choice',
        header: 'Mode',
        question: 'Which mode?',
        isOther: false,
        isSecret: false,
        options: [{ label: 'Safe', description: 'Read only' }],
      }],
    }, { id: 'ask-1', method: 'item/tool/requestUserInput' })
    const userRequestId = service.getSnapshot().pendingRequests[0]?.id
    service.resolveRequest({
      requestId: userRequestId ?? '',
      action: 'accept',
      answers: { choice: ['Safe'] },
    })
    await expect(userInput).resolves.toEqual({ answers: { choice: { answers: ['Safe'] } } })
    service.dispose()
  })
})
