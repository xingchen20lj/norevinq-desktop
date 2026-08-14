import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(nodeExecFile)

export type CodexBinarySource = 'explicit' | 'environment' | 'bundled' | 'path' | 'chatgpt-bundle'

export type CodexBinaryCandidate = {
  path: string
  source: CodexBinarySource
}

export type DiscoveredCodexBinary = CodexBinaryCandidate & {
  version: string
}

export type CodexDiscoveryOptions = {
  explicitBinary?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  resourcesPath?: string
  knownBundlePaths?: readonly string[]
  probe?: (binaryPath: string) => Promise<string>
}

export const KNOWN_CHATGPT_MACOS_CODEX_PATHS = [
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/MacOS/codex',
] as const

const BUNDLED_CODEX_TARGETS: Partial<Record<NodeJS.Platform, Partial<Record<NodeJS.Architecture, {
  packageName: string
  triple: string
  executable: string
}>>>> = {
  darwin: {
    x64: { packageName: 'codex-darwin-x64', triple: 'x86_64-apple-darwin', executable: 'codex' },
    arm64: { packageName: 'codex-darwin-arm64', triple: 'aarch64-apple-darwin', executable: 'codex' },
  },
  win32: {
    x64: { packageName: 'codex-win32-x64', triple: 'x86_64-pc-windows-msvc', executable: 'codex.exe' },
    arm64: { packageName: 'codex-win32-arm64', triple: 'aarch64-pc-windows-msvc', executable: 'codex.exe' },
  },
}

export function getBundledCodexPath(
  resourcesPath: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | null {
  const target = BUNDLED_CODEX_TARGETS[platform]?.[arch]
  if (!target) return null
  return pathApi(platform).join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@openai',
    target.packageName,
    'vendor',
    target.triple,
    'bin',
    target.executable,
  )
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

function commandNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex'] : ['codex']
}

function hasPathSeparator(value: string, platform: NodeJS.Platform): boolean {
  return value.includes('/') || value.includes('\\') || (platform === 'win32' && /^[a-z]:/i.test(value))
}

function configuredCandidate(
  value: string,
  source: CodexBinarySource,
  platform: NodeJS.Platform,
  pathValue: string,
): CodexBinaryCandidate[] {
  const paths = pathApi(platform)
  const trimmed = value.trim()
  if (!trimmed) return []
  if (paths.isAbsolute(trimmed)) return [{ path: paths.normalize(trimmed), source }]
  if (hasPathSeparator(trimmed, platform)) return [{ path: paths.resolve(trimmed), source }]

  const names = platform === 'win32' && !/\.[a-z0-9]+$/i.test(trimmed)
    ? [`${trimmed}.exe`, `${trimmed}.cmd`, `${trimmed}.bat`, trimmed]
    : [trimmed]
  return pathValue.split(paths.delimiter)
    .filter(Boolean)
    .flatMap((entry) => names.map((name) => ({ path: paths.join(entry, name), source })))
}

/** Returns candidates in strict precedence order without probing or invoking a shell. */
export function getCodexBinaryCandidates(options: CodexDiscoveryOptions = {}): CodexBinaryCandidate[] {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const resourcesPath = options.resourcesPath ?? runtimeResourcesPath()
  const pathValue = env.PATH ?? ''
  const paths = pathApi(platform)
  const candidates: CodexBinaryCandidate[] = []

  if (options.explicitBinary) {
    candidates.push(...configuredCandidate(options.explicitBinary, 'explicit', platform, pathValue))
  }
  const environmentBinary = env.ASTER_AGENT_BINARY ?? env.CODEX_BINARY
  if (environmentBinary) {
    candidates.push(...configuredCandidate(environmentBinary, 'environment', platform, pathValue))
  }
  if (resourcesPath) {
    const bundledPath = getBundledCodexPath(resourcesPath, platform, arch)
    if (bundledPath) candidates.push({ path: bundledPath, source: 'bundled' })
  }
  for (const entry of pathValue.split(paths.delimiter).filter(Boolean)) {
    for (const name of commandNames(platform)) candidates.push({ path: paths.join(entry, name), source: 'path' })
  }
  if (platform === 'darwin') {
    for (const bundlePath of options.knownBundlePaths ?? KNOWN_CHATGPT_MACOS_CODEX_PATHS) {
      candidates.push({ path: bundlePath, source: 'chatgpt-bundle' })
    }
  }

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = platform === 'win32' ? candidate.path.toLowerCase() : candidate.path
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function runtimeResourcesPath(): string | undefined {
  const value = Reflect.get(process, 'resourcesPath') as unknown
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export async function probeCodexVersion(binaryPath: string): Promise<string> {
  const { stdout, stderr } = await execFile(binaryPath, ['--version'], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
  const output = `${stdout}\n${stderr}`.trim()
  const version = output.split(/\r?\n/).map((line) => line.trim())
    .find((line) => /\bcodex(?:-cli)?\b/i.test(line))
  if (!version) throw new Error(`unexpected codex --version output: ${output || '<empty>'}`)
  return version
}

async function isExecutable(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(filePath, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function discoverCodexBinary(
  options: CodexDiscoveryOptions = {},
): Promise<DiscoveredCodexBinary> {
  const platform = options.platform ?? process.platform
  const probe = options.probe ?? probeCodexVersion
  const failures: string[] = []

  for (const candidate of getCodexBinaryCandidates(options)) {
    if (!(await isExecutable(candidate.path, platform))) continue
    try {
      return { ...candidate, version: await probe(candidate.path) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${candidate.path}: ${message}`)
    }
  }

  const detail = failures.length > 0 ? ` Probe failures: ${failures.join('; ')}` : ''
  throw new Error(
    `Unable to find Aster's agent runtime. Configure one explicitly, set ASTER_AGENT_BINARY, reinstall the bundled runtime, or add the compatible runtime to PATH.${detail}`,
  )
}
