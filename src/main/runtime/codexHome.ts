import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const AGENT_HOME_DIRECTORY = 'agent-home'
const LEGACY_AGENT_HOME_DIRECTORY = 'codex-home'

export function prepareNorevinqAgentHome(userData: string, explicitPath?: string): string {
  const resolvedUserData = resolve(userData)
  if (explicitPath === undefined) migrateLegacyAgentHome(resolvedUserData)
  const candidate = explicitPath === undefined
    ? join(resolvedUserData, AGENT_HOME_DIRECTORY)
    : requireAbsolutePath(explicitPath)
  mkdirSync(candidate, { mode: 0o700, recursive: true })
  const metadata = lstatSync(candidate)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Norevinq agent home must be a real directory, not a symbolic link.')
  }
  if (process.platform !== 'win32') chmodSync(candidate, 0o700)
  return realpathSync(candidate)
}

function migrateLegacyAgentHome(userData: string): void {
  const current = join(userData, AGENT_HOME_DIRECTORY)
  const legacy = join(userData, LEGACY_AGENT_HOME_DIRECTORY)
  if (existsSync(current) || !existsSync(legacy)) return
  const metadata = lstatSync(legacy)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return
  renameSync(legacy, current)
}

function requireAbsolutePath(path: string): string {
  if (path.includes('\0') || !isAbsolute(path)) {
    throw new Error('NOREVINQ_AGENT_HOME must be an absolute directory path.')
  }
  return resolve(path)
}
