import { execFile } from 'node:child_process'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { requireSecureUpdateUrl } from './update-release-config.mjs'

const execute = promisify(execFile)
const applicationRoot = process.platform === 'darwin'
  ? await findMacApplicationRoot()
  : null
const unpackedRoot = applicationRoot
  ? join(applicationRoot, 'Contents', 'Resources', 'app.asar.unpacked')
  : process.platform === 'win32'
    ? resolve('release/win-unpacked/resources/app.asar.unpacked')
    : null
const resourcesRoot = applicationRoot
  ? join(applicationRoot, 'Contents', 'Resources')
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
const version = await readCodexVersion(binary, unpackedRoot)
if (!/^codex(?:-cli)?\s+0\.147\.0$/iu.test(version)) {
  throw new Error(`Packaged Codex version does not match 0.147.0: ${version || '<empty>'}`)
}
console.log(`Packaged Codex: ${version} (${binary})`)
await verifySecurityPlugin(unpackedRoot)
await verifyCanvasRuntime(unpackedRoot, binary)
await verifyProtocolRegistration()
console.log('Packaged deep-link protocol: norevinq')
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

async function readCodexVersion(binary, directory) {
  const target = process.platform === 'darwin'
    ? binary.includes('aarch64-apple-darwin') ? { arch: 'arm64', packageName: 'codex-darwin-arm64' } : { arch: 'x86_64', packageName: 'codex-darwin-x64' }
    : null
  const hostArch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : process.arch
  if (!target || target.arch === hostArch) {
    const { stdout, stderr } = await execute(binary, ['--version'], { timeout: 15_000, windowsHide: true })
    return `${stdout}\n${stderr}`.trim()
  }

  const { stdout } = await execute('/usr/bin/lipo', ['-archs', binary], { timeout: 15_000 })
  if (stdout.trim() !== target.arch) throw new Error(`Packaged Codex has unexpected architecture: ${stdout.trim()}`)
  const packagePath = join(directory, 'node_modules', '@openai', target.packageName, 'package.json')
  const packageDocument = JSON.parse(await readFile(packagePath, 'utf8'))
  if (packageDocument?.version !== `0.147.0-darwin-${target.arch === 'arm64' ? 'arm64' : 'x64'}`) {
    throw new Error(`Packaged Codex package has unexpected version: ${String(packageDocument?.version)}`)
  }
  console.log(`Packaged Codex cross-architecture check: ${target.arch}`)
  return 'codex-cli 0.147.0'
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

async function verifyCanvasRuntime(directory, codexBinary) {
  const napiRoot = join(directory, 'node_modules', '@napi-rs')
  const packages = (await readdir(napiRoot, { withFileTypes: true }))
    .filter(({ name }) => name.startsWith('canvas-'))
  const targetArch = process.platform === 'darwin' && codexBinary.includes('aarch64-apple-darwin')
    ? 'arm64'
    : process.arch
  const expected = process.platform === 'darwin'
    ? `canvas-darwin-${targetArch}`
    : `canvas-win32-${targetArch}-msvc`
  if (packages.length !== 1 || packages[0]?.name !== expected || !packages[0].isDirectory()) {
    throw new Error(`Expected only packaged Canvas runtime ${expected}, found: ${packages.map(({ name }) => name).join(', ')}`)
  }
  console.log(`Packaged Canvas runtime: ${expected}`)
}

async function verifyProtocolRegistration() {
  const packageDocument = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const protocols = packageDocument?.build?.protocols
  const configured = Array.isArray(protocols) && protocols.some((protocol) =>
    Array.isArray(protocol?.schemes) && protocol.schemes.includes('norevinq'))
  if (!configured) throw new Error('electron-builder is missing the norevinq protocol registration.')

  if (process.platform !== 'darwin') return
  const infoPath = join(applicationRoot, 'Contents', 'Info.plist')
  const info = await readFile(infoPath, 'utf8')
  if (!/<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>norevinq<\/string>/u.test(info)) {
    throw new Error(`Packaged Info.plist is missing the norevinq URL scheme: ${infoPath}`)
  }
}

async function findMacApplicationRoot() {
  const candidates = [
    resolve('release/mac/Norevinq.app'),
    resolve('release/mac-arm64/Norevinq.app'),
  ]
  const existing = []
  for (const candidate of candidates) {
    const metadata = await lstat(candidate).catch(() => null)
    if (metadata?.isDirectory() && !metadata.isSymbolicLink()) existing.push(candidate)
  }
  if (existing.length !== 1) {
    throw new Error(`Expected exactly one packaged macOS application, found ${String(existing.length)}: ${existing.join(', ')}`)
  }
  return existing[0]
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
