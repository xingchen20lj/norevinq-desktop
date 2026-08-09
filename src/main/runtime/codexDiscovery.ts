import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, isAbsolute, join, normalize, resolve } from 'node:path'
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(nodeExecFile)

export type CodexBinarySource = 'explicit' | 'environment' | 'path' | 'chatgpt-bundle'

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
  knownBundlePaths?: readonly string[]
  probe?: (binaryPath: string) => Promise<string>
}

export const KNOWN_CHATGPT_MACOS_CODEX_PATHS = [
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/MacOS/codex',
] as const

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
  const trimmed = value.trim()
  if (!trimmed) return []
  if (isAbsolute(trimmed)) return [{ path: normalize(trimmed), source }]
  if (hasPathSeparator(trimmed, platform)) return [{ path: resolve(trimmed), source }]

  const names = platform === 'win32' && !/\.[a-z0-9]+$/i.test(trimmed)
    ? [`${trimmed}.exe`, `${trimmed}.cmd`, `${trimmed}.bat`, trimmed]
    : [trimmed]
  return pathValue.split(platform === 'win32' ? ';' : delimiter)
    .filter(Boolean)
    .flatMap((entry) => names.map((name) => ({ path: join(entry, name), source })))
}

/** Returns candidates in strict precedence order without probing or invoking a shell. */
export function getCodexBinaryCandidates(options: CodexDiscoveryOptions = {}): CodexBinaryCandidate[] {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathValue = env.PATH ?? ''
  const candidates: CodexBinaryCandidate[] = []

  if (options.explicitBinary) {
    candidates.push(...configuredCandidate(options.explicitBinary, 'explicit', platform, pathValue))
  }
  if (env.CODEX_BINARY) {
    candidates.push(...configuredCandidate(env.CODEX_BINARY, 'environment', platform, pathValue))
  }
  for (const entry of pathValue.split(platform === 'win32' ? ';' : delimiter).filter(Boolean)) {
    for (const name of commandNames(platform)) candidates.push({ path: join(entry, name), source: 'path' })
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
    `Unable to find a working Codex binary. Configure one explicitly, set CODEX_BINARY, or add codex to PATH.${detail}`,
  )
}
