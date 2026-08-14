import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

const deepSeekConfigured = typeof process.env.DEEPSEEK_API_KEY === 'string'
  && process.env.DEEPSEEK_API_KEY.trim().length > 0
const identityPrompt = 'What desktop product are you working inside? Reply with the product name only.'

test.skip(!deepSeekConfigured, 'DEEPSEEK_API_KEY is required for the real Norevinq identity test.')

test('DeepSeek identifies the desktop product as Norevinq in an ordinary reply', async () => {
  test.setTimeout(120_000)
  const profile = mkdtempSync(join(tmpdir(), 'norevinq-identity-e2e-'))
  const projectPath = join(profile, 'project')
  mkdirSync(projectPath)
  const database = new StateDatabase(join(profile, 'norevinq.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.close()

  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, NOREVINQ_AGENT_HOME: join(profile, 'agent-home') },
  })
  try {
    const window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Norevinq 已就绪', { timeout: 20_000 })
    await window.evaluate(async ({ projectId, prompt }) => {
      const bridge = Reflect.get(window, 'norevinq') as {
        startConversation: (input: unknown) => Promise<unknown>
      }
      await bridge.startConversation({
        projectId,
        model: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        reasoningEffort: 'low',
        text: prompt,
      })
    }, { projectId: project.id, prompt: identityPrompt })
    await window.getByRole('button', { name: identityPrompt, exact: true }).click()

    const answer = window.locator('.activity-card.agentMessage .activity-body > p').last()
    await expect(answer).toBeVisible({ timeout: 90_000 })
    await expect(answer).toContainText(/Norevinq(?: Code)?/iu)
    await expect(answer).not.toContainText(/Codex/iu)
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
  } finally {
    await application.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
