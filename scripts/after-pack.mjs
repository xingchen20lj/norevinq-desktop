import { cp, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ARCH_NAMES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
])

export default async function afterPack(context) {
  const arch = ARCH_NAMES.get(context.arch)
  if (!arch) throw new Error(`Unsupported packaged architecture: ${String(context.arch)}`)
  if (arch === 'universal') return

  const resourcesRoot = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const openaiRoot = join(resourcesRoot, 'app.asar.unpacked', 'node_modules', '@openai')
  const expectedPackage = `codex-${context.electronPlatformName}-${arch}`
  const entries = await readdir(openaiRoot, { withFileTypes: true })
  const codexPackages = entries.filter(({ name }) => name.startsWith('codex-'))
  if (!codexPackages.some(({ name }) => name === expectedPackage)) {
    throw new Error(`Packaged Codex runtime is missing ${expectedPackage}.`)
  }

  for (const entry of codexPackages) {
    if (entry.name === expectedPackage) continue
    const path = join(openaiRoot, entry.name)
    const metadata = await lstat(path)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Refusing to prune an unexpected packaged Codex path: ${path}`)
    }
    await rm(path, { recursive: true })
  }

  await pruneCanvasPackages(resourcesRoot, context.electronPlatformName, arch)

  const securityPluginSource = await realpath(join(
    process.cwd(),
    'node_modules',
    '@openai',
    'codex-security',
    '_bundled_plugin',
  ))
  const sourceMetadata = await lstat(securityPluginSource)
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
    throw new Error(`Codex Security plugin source is not a real directory: ${securityPluginSource}`)
  }
  const securityPackageRoot = join(openaiRoot, 'codex-security')
  const securityPluginDestination = join(securityPackageRoot, '_bundled_plugin')
  await mkdir(securityPackageRoot, { recursive: true })
  await cp(securityPluginSource, securityPluginDestination, {
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    recursive: true,
  })
}

async function pruneCanvasPackages(resourcesRoot, platform, arch) {
  const napiRoot = join(resourcesRoot, 'app.asar.unpacked', 'node_modules', '@napi-rs')
  const expectedPackage = canvasPackageName(platform, arch)
  const entries = await readdir(napiRoot, { withFileTypes: true })
  const canvasPackages = entries.filter(({ name }) => name.startsWith('canvas-'))
  if (!canvasPackages.some(({ name }) => name === expectedPackage)) {
    throw new Error(`Packaged Canvas runtime is missing ${expectedPackage}.`)
  }

  for (const entry of canvasPackages) {
    if (entry.name === expectedPackage) continue
    const path = join(napiRoot, entry.name)
    const metadata = await lstat(path)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Refusing to prune an unexpected packaged Canvas path: ${path}`)
    }
    await rm(path, { recursive: true })
  }
}

function canvasPackageName(platform, arch) {
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) return `canvas-darwin-${arch}`
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) return `canvas-win32-${arch}-msvc`
  throw new Error(`Unsupported Canvas package target: ${platform}-${arch}`)
}
