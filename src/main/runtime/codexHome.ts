import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export function prepareAsterCodexHome(userData: string, explicitPath?: string): string {
  const candidate = explicitPath === undefined
    ? join(resolve(userData), 'codex-home')
    : requireAbsolutePath(explicitPath)
  mkdirSync(candidate, { mode: 0o700, recursive: true })
  const metadata = lstatSync(candidate)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Aster Codex home must be a real directory, not a symbolic link.')
  }
  if (process.platform !== 'win32') chmodSync(candidate, 0o700)
  return realpathSync(candidate)
}

function requireAbsolutePath(path: string): string {
  if (path.includes('\0') || !isAbsolute(path)) {
    throw new Error('ASTER_CODEX_HOME must be an absolute directory path.')
  }
  return resolve(path)
}
