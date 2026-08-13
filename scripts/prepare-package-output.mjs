import { lstat, mkdir, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function preparePackageOutput(projectRoot = process.cwd()) {
  const normalizedProjectRoot = resolve(projectRoot)
  const outputRoot = resolve(normalizedProjectRoot, 'release')
  if (basename(outputRoot) !== 'release' || dirname(outputRoot) !== normalizedProjectRoot) {
    throw new Error(`Refusing to clean an unexpected package output path: ${outputRoot}`)
  }

  const metadata = await lstat(outputRoot).catch((error) => {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  })
  if (metadata) await rm(outputRoot, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 })
  await mkdir(outputRoot, { mode: 0o700, recursive: false })
  return outputRoot
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  const outputRoot = await preparePackageOutput()
  console.log(`Prepared clean package output: ${outputRoot}`)
}
