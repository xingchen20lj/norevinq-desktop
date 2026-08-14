import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const workflowDirectory = join(process.cwd(), '.github', 'workflows')
const workflowNames = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()

if (workflowNames.length === 0) throw new Error('No GitHub Actions workflows were found.')

for (const name of workflowNames) {
  const source = await readFile(join(workflowDirectory, name), 'utf8')
  const forbiddenDistributionControls = [
    'electron-builder',
    'package:mac',
    'package:win',
    'package:update',
    'path: release/',
  ]
  for (const control of forbiddenDistributionControls) {
    if (source.includes(control)) {
      throw new Error(`${name} must not build or upload ready-made desktop packages: ${control}`)
    }
  }
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const match = /^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/u.exec(line)
    if (!match) continue
    const reference = match[1]
    if (!reference || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u.test(reference)) {
      throw new Error(`${name}:${String(index + 1)} must pin a remote Action to a full 40-hex commit SHA: ${reference ?? '<missing>'}`)
    }
  }
}

console.log(`Workflow controls verified (${String(workflowNames.length)} files).`)
