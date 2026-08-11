import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const unpackedRoot = process.platform === 'darwin'
  ? resolve('release/mac/Aster Code.app/Contents/Resources/app.asar.unpacked')
  : process.platform === 'win32'
    ? resolve('release/win-unpacked/resources/app.asar.unpacked')
    : null

if (!unpackedRoot) throw new Error(`Packaged runtime verification is not configured for ${process.platform}.`)

const binaries = await findCodexBinaries(join(unpackedRoot, 'node_modules', '@openai'))
if (binaries.length !== 1) {
  throw new Error(`Expected exactly one packaged Codex binary, found ${String(binaries.length)}: ${binaries.join(', ')}`)
}

const binary = binaries[0]
if (!binary) throw new Error('Packaged Codex binary is missing.')
const { stdout, stderr } = await execute(binary, ['--version'], { timeout: 15_000, windowsHide: true })
const version = `${stdout}\n${stderr}`.trim()
if (!/^codex(?:-cli)?\s+0\.147\.0$/iu.test(version)) {
  throw new Error(`Packaged Codex version does not match 0.147.0: ${version || '<empty>'}`)
}
console.log(`Packaged Codex: ${version} (${binary})`)
await verifyProtocolRegistration()
console.log('Packaged deep-link protocol: aster-code')

async function findCodexBinaries(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...await findCodexBinaries(path))
    } else if (entry.isFile() && entry.name === (process.platform === 'win32' ? 'codex.exe' : 'codex')) {
      found.push(path)
    }
  }
  return found
}

async function verifyProtocolRegistration() {
  const packageDocument = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const protocols = packageDocument?.build?.protocols
  const configured = Array.isArray(protocols) && protocols.some((protocol) =>
    Array.isArray(protocol?.schemes) && protocol.schemes.includes('aster-code'))
  if (!configured) throw new Error('electron-builder is missing the aster-code protocol registration.')

  if (process.platform !== 'darwin') return
  const infoPath = resolve('release/mac/Aster Code.app/Contents/Info.plist')
  const info = await readFile(infoPath, 'utf8')
  if (!/<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>aster-code<\/string>/u.test(info)) {
    throw new Error(`Packaged Info.plist is missing the aster-code URL scheme: ${infoPath}`)
  }
}
