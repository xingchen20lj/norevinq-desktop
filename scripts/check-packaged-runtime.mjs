import { execFile } from 'node:child_process'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { requireSecureUpdateUrl } from './update-release-config.mjs'

const execute = promisify(execFile)
const unpackedRoot = process.platform === 'darwin'
  ? resolve('release/mac/Aster Code.app/Contents/Resources/app.asar.unpacked')
  : process.platform === 'win32'
    ? resolve('release/win-unpacked/resources/app.asar.unpacked')
    : null
const resourcesRoot = process.platform === 'darwin'
  ? resolve('release/mac/Aster Code.app/Contents/Resources')
  : process.platform === 'win32'
    ? resolve('release/win-unpacked/resources')
    : null

if (!unpackedRoot || !resourcesRoot) throw new Error(`Packaged runtime verification is not configured for ${process.platform}.`)

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
await verifySecurityPlugin(unpackedRoot)
await verifyProtocolRegistration()
console.log('Packaged deep-link protocol: aster-code')
await verifyUpdateConfiguration(resourcesRoot)

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

async function verifySecurityPlugin(directory) {
  const pluginRoot = join(directory, 'node_modules', '@openai', 'codex-security', '_bundled_plugin')
  const pluginMetadata = await lstat(pluginRoot).catch(() => null)
  if (!pluginMetadata?.isDirectory() || pluginMetadata.isSymbolicLink()) {
    throw new Error(`Packaged Codex Security plugin is not a real unpacked directory: ${pluginRoot}`)
  }
  const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json')
  const manifestMetadata = await lstat(manifestPath).catch(() => null)
  if (!manifestMetadata?.isFile() || manifestMetadata.isSymbolicLink() || manifestMetadata.size > 64 * 1024) {
    throw new Error(`Packaged Codex Security manifest is missing or invalid: ${manifestPath}`)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest?.name !== 'codex-security' || typeof manifest?.version !== 'string') {
    throw new Error(`Packaged Codex Security manifest has invalid identity: ${manifestPath}`)
  }
  console.log(`Packaged Codex Security plugin: ${manifest.version} (${pluginRoot})`)
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

async function verifyUpdateConfiguration(directory) {
  const path = join(directory, 'app-update.yml')
  const metadata = await lstat(path).catch((error) => {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  })
  if (!metadata) {
    console.log('Packaged update channel: not configured')
    return
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 64 * 1024) {
    throw new Error(`Packaged update metadata is not a bounded regular file: ${path}`)
  }
  const source = await readFile(path, 'utf8')
  if (!/^provider:\s*generic\s*$/mu.test(source)) throw new Error('Packaged updater must use the generic provider.')
  const url = /^url:\s*([^\s]+)\s*$/mu.exec(source)?.[1]
  const normalized = requireSecureUpdateUrl(url)
  console.log(`Packaged update channel: ${normalized}`)
}
