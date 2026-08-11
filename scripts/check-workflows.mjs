import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const workflowDirectory = join(process.cwd(), '.github', 'workflows')
const workflowNames = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()

if (workflowNames.length === 0) throw new Error('No GitHub Actions workflows were found.')

for (const name of workflowNames) {
  const source = await readFile(join(workflowDirectory, name), 'utf8')
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const match = /^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/u.exec(line)
    if (!match) continue
    const reference = match[1]
    if (!reference || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u.test(reference)) {
      throw new Error(`${name}:${String(index + 1)} must pin a remote Action to a full 40-hex commit SHA: ${reference ?? '<missing>'}`)
    }
  }
}

const release = await readFile(join(workflowDirectory, 'release.yml'), 'utf8')
const requiredReleaseControls = [
  "if: github.ref == 'refs/heads/main'",
  'environment: release',
  'ref: ${{ github.sha }}',
  'persist-credentials: false',
  "CSC_LINK: ${{ inputs.require_signing && secrets.MAC_CSC_LINK || '' }}",
  "CSC_LINK: ${{ inputs.require_signing && secrets.WIN_CSC_LINK || '' }}",
  'Get-AuthenticodeSignature',
  'codesign --verify --deep --strict',
  'ASTER_UPDATE_URL: ${{ inputs.update_url }}',
  'release/latest*.yml',
  "if: runner.os == 'macOS' && inputs.require_signing",
  "if: runner.os == 'macOS' && !inputs.require_signing",
  "if: runner.os == 'Windows' && inputs.require_signing",
  "if: runner.os == 'Windows' && !inputs.require_signing",
]

for (const control of requiredReleaseControls) {
  if (!release.includes(control)) throw new Error(`Release workflow is missing required control: ${control}`)
}

console.log(`Workflow controls verified (${String(workflowNames.length)} files).`)
