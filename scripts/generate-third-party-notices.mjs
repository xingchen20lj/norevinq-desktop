import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const outputPath = resolve('THIRD_PARTY_NOTICES.md')
const checkOnly = process.argv.includes('--check')
const packageManagerPath = process.env.npm_execpath
if (!packageManagerPath || !isAbsolute(packageManagerPath)) {
  throw new Error('Run this generator through the pinned pnpm package script; npm_execpath must be absolute.')
}
const { stdout } = await execute(process.execPath, [packageManagerPath, 'licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
})

const report = JSON.parse(stdout)
const packages = Object.values(report)
  .flatMap((entries) => entries)
  .flatMap((entry) => entry.versions.map((version) => ({
    name: normalizeName(entry.name),
    version: normalizeVersion(entry.name, version),
    license: entry.license,
    homepage: entry.homepage ?? '',
  })))
  .filter((entry, index, all) => all.findIndex((candidate) =>
    candidate.name === entry.name && candidate.version === entry.version && candidate.license === entry.license,
  ) === index)
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))

const lines = [
  '# Third-Party Notices',
  '',
  'Aster Code includes the production dependencies listed below. This file is generated from the locked pnpm dependency graph; package license files remain included with their distributed packages.',
  '',
  'Run `pnpm notices:generate` after changing production dependencies. CI runs `pnpm notices:check` to detect drift.',
  '',
  '| Package | Version | License | Project |',
  '| --- | --- | --- | --- |',
  ...packages.map((entry) => {
    const name = escapeCell(entry.name)
    const version = escapeCell(entry.version)
    const license = escapeCell(entry.license)
    const project = formatProjectLink(entry.homepage)
    return `| ${name} | ${version} | ${license} | ${project} |`
  }),
  '',
]
const expected = `${lines.join('\n')}`

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8').catch(() => '')
  if (current !== expected) {
    throw new Error('THIRD_PARTY_NOTICES.md is stale. Run pnpm notices:generate.')
  }
  console.log(`Third-party notices are current (${String(packages.length)} packages).`)
} else {
  await replaceRegularFile(outputPath, expected)
  console.log(`Wrote ${outputPath} (${String(packages.length)} packages).`)
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replace(/[\r\n]+/gu, ' ')
}

function normalizeVersion(name, version) {
  // pnpm reports the platform package aliases used by Codex as the package
  // name "@openai/codex" with an OS/CPU suffix in the version. The selected
  // alias varies by runner, while all variants are the same licensed Codex
  // release. Collapse that transport suffix so notices are deterministic on
  // macOS and Windows and still identify the exact upstream release.
  if (name !== '@openai/codex') return version
  return String(version).replace(/-(?:darwin|linux|win32)-(?:arm64|x64)$/u, '')
}

function normalizeName(name) {
  // @napi-rs/canvas uses one native package name per OS/CPU. The generic
  // package is already listed and carries the same version and MIT license.
  // Reporting the wrapper keeps the notice complete without making it depend
  // on the architecture that happened to run the generator.
  if (/^@napi-rs\/canvas-(?:android|darwin|linux|win32)-/u.test(name)) return '@napi-rs/canvas'
  return name
}

function formatProjectLink(value) {
  if (!value) return ''
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return `[link](${url.href.replaceAll(')', '%29')})`
  } catch {
    return ''
  }
}

async function replaceRegularFile(path, contents) {
  const existing = await lstat(path).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  })
  if (existing && !existing.isFile()) throw new Error(`${path} must be a regular file.`)

  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
  try {
    if (existing) await unlink(path)
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}
