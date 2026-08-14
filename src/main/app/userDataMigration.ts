import {
  existsSync,
  lstatSync,
  readdirSync,
  renameSync,
  rmdirSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const LEGACY_PRODUCT_DIRECTORY = 'aster-code'
const LEGACY_DATABASE_NAME = 'aster-code.sqlite3'
const CURRENT_DATABASE_NAME = 'norevinq.sqlite3'

export function prepareNorevinqUserData(currentPath: string): string {
  const current = resolve(currentPath)
  if (basename(current) === LEGACY_PRODUCT_DIRECTORY) return current
  const legacy = join(dirname(current), LEGACY_PRODUCT_DIRECTORY)

  if (isRealDirectory(legacy) && canReplaceCurrentDirectory(current)) {
    if (existsSync(current)) rmdirSync(current)
    renameSync(legacy, current)
  }
  migrateDatabaseName(current)
  return current
}

function canReplaceCurrentDirectory(path: string): boolean {
  if (!existsSync(path)) return true
  if (!isRealDirectory(path)) return false
  return readdirSync(path).length === 0
}

function isRealDirectory(path: string): boolean {
  if (!existsSync(path)) return false
  const metadata = lstatSync(path)
  return metadata.isDirectory() && !metadata.isSymbolicLink()
}

function migrateDatabaseName(userData: string): void {
  if (!isRealDirectory(userData)) return
  const legacy = join(userData, LEGACY_DATABASE_NAME)
  const current = join(userData, CURRENT_DATABASE_NAME)
  if (existsSync(current) || !existsSync(legacy)) return
  const metadata = lstatSync(legacy)
  if (!metadata.isFile() || metadata.isSymbolicLink()) return
  renameSync(legacy, current)
}
