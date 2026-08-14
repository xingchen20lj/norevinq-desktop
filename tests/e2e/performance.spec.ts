import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance as nodePerformance } from 'node:perf_hooks'

test('records bounded cold-start and process-memory baselines', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'norevinq-performance-e2e-'))
  const startedAt = nodePerformance.now()
  const application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] })
  try {
    const window = await application.firstWindow()
    await expect(window.locator('.app-shell')).toBeVisible()
    const coldStartMs = nodePerformance.now() - startedAt
    const renderer = await window.evaluate(() => {
      const webPerformance = globalThis.performance as unknown as {
        getEntriesByType: (type: string) => { domContentLoadedEventEnd?: number }[]
        now: () => number
      }
      const navigation = webPerformance.getEntriesByType('navigation')[0]
      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? webPerformance.now(),
        loadedResources: webPerformance.getEntriesByType('resource').length,
      }
    })
    const processes = await application.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
      type: metric.type,
      workingSetKiB: metric.memory.workingSetSize,
      privateKiB: metric.memory.privateBytes,
    })))
    const totalWorkingSetKiB = processes.reduce((total, metric) => total + metric.workingSetKiB, 0)

    console.info(JSON.stringify({
      coldStartMs: Number(coldStartMs.toFixed(1)),
      renderer,
      processCount: processes.length,
      totalWorkingSetMiB: Number((totalWorkingSetKiB / 1024).toFixed(1)),
    }))
    expect(coldStartMs).toBeLessThan(15_000)
    expect(renderer.domContentLoadedMs).toBeLessThan(5_000)
    expect(totalWorkingSetKiB).toBeLessThan(1_500 * 1024)
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})
