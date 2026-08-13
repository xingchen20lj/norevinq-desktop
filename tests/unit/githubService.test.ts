/* eslint-disable @typescript-eslint/require-await -- async mocks implement the production Promise interface. */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GitHubService,
  discoverGitHubCli,
  runGitHubCommand,
  type GitHubCommandRunner,
} from '../../src/main/git/githubService.js'
import { StateDatabase } from '../../src/main/state/database.js'
import type { GitRepositorySnapshot } from '../../src/shared/git.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('GitHubService', () => {
  it('preflights auth and repositories, pushes explicitly, creates once, and verifies structured output', async () => {
    const fixture = createFixture()
    let created = false
    const calls: { args: readonly string[]; stdin?: string }[] = []
    const runner: GitHubCommandRunner = async (_executable, args, options) => {
      calls.push({ args, ...(options.stdin === undefined ? {} : { stdin: options.stdin }) })
      if (args[0] === '--version') return ok('gh version 2.97.0 (fixture)\n')
      if (args[0] === 'auth') return ok('')
      if (args[0] === 'repo') {
        return ok(JSON.stringify({
          nameWithOwner: 'aster-fixture/project',
          url: 'https://github.com/aster-fixture/project',
          defaultBranchRef: { name: 'main' },
        }))
      }
      if (args[0] === 'pr' && args[1] === 'list') {
        return ok(JSON.stringify(created ? [pullRequestJson()] : []))
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        created = true
        return ok('https://github.com/aster-fixture/project/pull/42\n')
      }
      throw new Error(`Unexpected gh invocation: ${args.join(' ')}`)
    }
    const pushes: unknown[] = []
    const git = {
      getStatus: async () => fixture.snapshot,
      push: async (input: unknown) => {
        pushes.push(input)
        return fixture.snapshot
      },
    }
    const service = new GitHubService(fixture.database, git, { runCommand: runner })

    const status = await service.getStatus({ projectId: fixture.projectId })
    expect(status).toMatchObject({
      available: true,
      authenticated: true,
      version: '2.97.0',
      host: 'github.com',
      pushRemote: 'origin',
      baseRemote: 'origin',
      pushRepository: 'aster-fixture/project',
      baseRepository: 'aster-fixture/project',
      defaultBranch: 'main',
      dirtyFileCount: 1,
      existingPullRequest: null,
      error: null,
    })

    const result = await service.createPullRequest({
      projectId: fixture.projectId,
      title: 'feat: verified PR',
      body: 'Body with spaces and `code`.',
      baseBranch: 'main',
      draft: true,
      confirmed: true,
    })
    expect(pushes).toEqual([{
      projectId: fixture.projectId,
      remote: 'origin',
      branch: 'feature/pr',
      setUpstream: true,
    }])
    expect(result).toMatchObject({ created: true, pushed: true, pullRequest: { number: 42, draft: true } })
    const create = calls.find(({ args }) => args[0] === 'pr' && args[1] === 'create')
    expect(create?.args).toEqual([
      'pr', 'create', '--repo', 'aster-fixture/project', '--base', 'main',
      '--head', 'aster-fixture:feature/pr', '--title', 'feat: verified PR', '--body-file', '-', '--draft',
    ])
    expect(create?.stdin).toBe('Body with spaces and `code`.')
    expect(create?.args).not.toContain('Body with spaces and `code`.')

    const repeated = await service.createPullRequest({
      projectId: fixture.projectId,
      title: 'ignored because open PR exists',
      body: '',
      draft: false,
      confirmed: true,
    })
    expect(repeated).toMatchObject({ created: false, pushed: false, pullRequest: { number: 42 } })
    expect(pushes).toHaveLength(1)
    expect(calls.filter(({ args }) => args[0] === 'pr' && args[1] === 'create')).toHaveLength(1)
    fixture.database.close()
  })

  it('models fork head and upstream base separately', async () => {
    const fixture = createFixture({
      upstream: 'origin/feature/pr',
      remotes: [
        { name: 'origin', fetchUrl: 'git@github.com:contributor/project.git', pushUrl: 'git@github.com:contributor/project.git' },
        { name: 'upstream', fetchUrl: 'https://github.com/aster-fixture/project.git', pushUrl: 'https://github.com/aster-fixture/project.git' },
      ],
    })
    const calls: readonly string[][] = []
    const mutableCalls = calls as string[][]
    const runner: GitHubCommandRunner = async (_executable, args) => {
      mutableCalls.push([...args])
      if (args[0] === '--version') return ok('gh version 2.97.0\n')
      if (args[0] === 'auth') return ok('')
      if (args[0] === 'repo') return ok(JSON.stringify({
        nameWithOwner: 'aster-fixture/project',
        url: 'https://github.com/aster-fixture/project',
        defaultBranchRef: { name: 'main' },
      }))
      if (args[0] === 'pr') return ok('[]')
      throw new Error('unexpected')
    }
    const service = new GitHubService(fixture.database, {
      getStatus: async () => fixture.snapshot,
      push: async () => fixture.snapshot,
    }, { runCommand: runner })
    const status = await service.getStatus({ projectId: fixture.projectId })
    expect(status).toMatchObject({
      pushRemote: 'origin',
      baseRemote: 'upstream',
      pushRepository: 'contributor/project',
      baseRepository: 'aster-fixture/project',
    })
    expect(mutableCalls.find((args) => args[0] === 'pr')).toEqual(expect.arrayContaining([
      '--head', 'feature/pr', '--limit', '100',
    ]))
    fixture.database.close()
  })

  it('fails closed on missing CLI, detached HEAD, and mismatched PR URLs', async () => {
    const fixture = createFixture()
    const unavailable = new GitHubService(fixture.database, {
      getStatus: async () => fixture.snapshot,
      push: async () => fixture.snapshot,
    }, { runCommand: async () => { throw new Error('spawn gh ENOENT') } })
    const unavailableStatus = await unavailable.getStatus({ projectId: fixture.projectId })
    expect(unavailableStatus.available).toBe(false)
    expect(unavailableStatus.authenticated).toBe(false)
    expect(unavailableStatus.error).toContain('ENOENT')

    const detachedSnapshot = { ...fixture.snapshot, branch: null, detached: true }
    const detached = new GitHubService(fixture.database, {
      getStatus: async () => detachedSnapshot,
      push: async () => detachedSnapshot,
    }, { runCommand: async () => { throw new Error('must not run') } })
    const detachedStatus = await detached.getStatus({ projectId: fixture.projectId })
    expect(detachedStatus.error).toContain('Detached HEAD')

    const hostile = new GitHubService(fixture.database, {
      getStatus: async () => fixture.snapshot,
      push: async () => fixture.snapshot,
    }, { runCommand: createHostileRunner() })
    const hostileStatus = await hostile.getStatus({ projectId: fixture.projectId })
    expect(hostileStatus.existingPullRequest).toBeNull()
    expect(hostileStatus.error).toContain('did not match')
    fixture.database.close()
  })

  it('redacts credentials from authentication failures', async () => {
    const fixture = createFixture()
    const runner: GitHubCommandRunner = async (_executable, args) => {
      if (args[0] === '--version') return ok('gh version 2.97.0\n')
      throw new Error('Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz1234567890')
    }
    const service = new GitHubService(fixture.database, {
      getStatus: async () => fixture.snapshot,
      push: async () => fixture.snapshot,
    }, { runCommand: runner })
    const status = await service.getStatus({ projectId: fixture.projectId })
    expect(status.error).toContain('[REDACTED]')
    expect(status.error).not.toContain('ghp_')
    fixture.database.close()
  })

  it('runs the real bounded CLI transport with stdin, timeout, and a minimal environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-github-runner-'))
    temporaryPaths.push(root)
    const previousUnrelated = process.env.ASTER_UNRELATED_SECRET
    const previousGitHubToken = process.env.GH_TOKEN
    process.env.ASTER_UNRELATED_SECRET = 'must-not-leak'
    process.env.GH_TOKEN = 'ghp_fixture_token_for_environment_test'
    try {
      const result = await runGitHubCommand(process.execPath, ['-e', [
        "let input='';",
        "process.stdin.on('data', chunk => input += chunk);",
        "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ input, unrelated: process.env.ASTER_UNRELATED_SECRET ?? null, token: Boolean(process.env.GH_TOKEN) })));",
      ].join('')], { cwd: root, timeoutMs: 5_000, stdin: 'body through stdin' })
      expect(JSON.parse(result.stdout)).toEqual({ input: 'body through stdin', unrelated: null, token: true })

      await expect(runGitHubCommand(process.execPath, [
        '-e', "process.stdout.write('x'.repeat(1024 * 1024 + 1))",
      ], { cwd: root, timeoutMs: 5_000 })).rejects.toThrow('exceeded 1 MiB')
      await expect(runGitHubCommand(process.execPath, [
        '-e', 'setInterval(() => undefined, 1000)',
      ], { cwd: root, timeoutMs: 25 })).rejects.toThrow('timed out')
      await expect(runGitHubCommand(process.execPath, [
        '-e', "process.stderr.write('fixture failure'); process.exit(7)",
      ], { cwd: root, timeoutMs: 5_000 })).rejects.toThrow('fixture failure')
    } finally {
      restoreEnvironment('ASTER_UNRELATED_SECRET', previousUnrelated)
      restoreEnvironment('GH_TOKEN', previousGitHubToken)
    }
  })

  it('discovers an executable from explicit, PATH, and desktop user-bin locations without hardcoding a host path', () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'aster-gh-discovery-'))
    temporaryPaths.push(root)
    const pathDirectory = join(root, 'path-bin')
    const homeDirectory = join(root, 'home')
    const homeBinary = join(homeDirectory, 'bin', 'gh')
    const pathBinary = join(pathDirectory, 'gh')
    const explicitBinary = join(root, 'explicit-gh')
    mkdirSync(pathDirectory)
    mkdirSync(join(homeDirectory, 'bin'), { recursive: true })
    for (const binary of [homeBinary, pathBinary, explicitBinary]) {
      writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755, flag: 'w' })
      chmodSync(binary, 0o755)
    }
    expect(discoverGitHubCli({ GH_BINARY: explicitBinary, PATH: pathDirectory }, process.platform, homeDirectory)).toBe(explicitBinary)
    expect(discoverGitHubCli({ PATH: pathDirectory }, process.platform, homeDirectory)).toBe(pathBinary)
    expect(discoverGitHubCli({ PATH: '/missing' }, process.platform, homeDirectory)).toBe(homeBinary)
  })
})

function createFixture(overrides: Partial<GitRepositorySnapshot> = {}): {
  database: StateDatabase
  projectId: string
  snapshot: GitRepositorySnapshot
} {
  const root = mkdtempSync(join(tmpdir(), 'aster-github-service-'))
  temporaryPaths.push(root)
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  const project = database.upsertProject(root)
  return {
    database,
    projectId: project.id,
    snapshot: {
      projectId: project.id,
      initialized: true,
      root,
      branch: 'feature/pr',
      detached: false,
      headOid: '0123456789abcdef',
      upstream: null,
      ahead: 1,
      behind: 0,
      files: [{ path: 'draft.txt', originalPath: null, indexStatus: '.', worktreeStatus: 'M', kind: 'ordinary' }],
      discards: [],
      remotes: [{
        name: 'origin',
        fetchUrl: 'https://github.com/aster-fixture/project.git',
        pushUrl: 'git@github.com:aster-fixture/project.git',
      }],
      error: null,
      ...overrides,
    },
  }
}

function createHostileRunner(): GitHubCommandRunner {
  return async (_executable, args) => {
    if (args[0] === '--version') return ok('gh version 2.97.0\n')
    if (args[0] === 'auth') return ok('')
    if (args[0] === 'repo') return ok(JSON.stringify({
      nameWithOwner: 'aster-fixture/project',
      url: 'https://github.com/aster-fixture/project',
      defaultBranchRef: { name: 'main' },
    }))
    return ok(JSON.stringify([{ ...pullRequestJson(), url: 'https://attacker.invalid/steal' }]))
  }
}

function pullRequestJson(): Record<string, unknown> {
  return {
    number: 42,
    title: 'feat: verified PR',
    url: 'https://github.com/aster-fixture/project/pull/42',
    state: 'OPEN',
    isDraft: true,
    baseRefName: 'main',
    headRefName: 'feature/pr',
    headRepositoryOwner: { login: 'aster-fixture' },
  }
}

function ok(stdout: string): { stdout: string; stderr: string } {
  return { stdout, stderr: '' }
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = value
}
