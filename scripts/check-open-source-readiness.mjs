#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const requiredFiles = [
  'LICENSE',
  'NOTICE',
  'README.md',
  'README.en.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  'TRADEMARKS.md',
  'AUTHORS.md',
  'CITATION.cff',
  '.mailmap',
  '.gitleaks.toml',
  '.node-version',
  '.github/CODEOWNERS',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  'docs/BUILDING.md',
  'docs/BRANDING.md',
  'docs/OPEN_SOURCE_RELEASE_CHECKLIST.md',
  'docs/assets/screenshots/command-palette.png',
  'docs/assets/screenshots/workspace-overview.png',
  'docs/assets/screenshots/provider-settings.png',
  'docs/assets/screenshots/scheduled-task-editor.png',
  'docs/assets/screenshots/security-workbench.png',
]

const errors = []

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8'))
}

for (const relativePath of requiredFiles) {
  try {
    await readFile(resolve(projectRoot, relativePath))
  } catch {
    errors.push(`missing required public file: ${relativePath}`)
  }
}

const packageJson = await readJson('package.json')
const manifest = await readJson('src/generated/codex/manifest.json')
const codexVersion = packageJson.dependencies?.['@openai/codex']

if (packageJson.license !== 'Apache-2.0') errors.push('package.json license must be Apache-2.0')
if (packageJson.packageManager !== 'pnpm@11.16.0') errors.push('packageManager must remain pinned')
if (packageJson.repository?.url !== 'git+https://github.com/xingchen20lj/norevinq-desktop.git') {
  errors.push('package.json repository metadata is missing or unexpected')
}
if (manifest.binary?.source !== 'project-dependency') {
  errors.push('Codex schema must be generated from the locked project dependency')
}
if (manifest.binary?.version !== `codex-cli ${codexVersion}`) {
  errors.push('Codex schema version does not match package.json')
}
if ('path' in (manifest.binary ?? {}) || 'generatedAt' in manifest) {
  errors.push('Codex schema manifest must not contain a local path or nondeterministic timestamp')
}

const extraResourceTargets = new Set(
  (packageJson.build?.extraResources ?? []).map((entry) => entry?.to),
)
for (const target of ['LICENSE.txt', 'NOTICE.txt', 'THIRD_PARTY_NOTICES.md']) {
  if (!extraResourceTargets.has(target)) errors.push(`packaged legal resource missing: ${target}`)
}

const { stdout } = await runFile('git', [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
], { cwd: projectRoot, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })

const files = []
for (const relativePath of stdout.toString('utf8').split('\0').filter(Boolean)) {
  try {
    await stat(resolve(projectRoot, relativePath))
    files.push(relativePath)
  } catch {
    // A tracked file deleted in the working tree remains visible to git ls-files
    // until it is staged; readiness checks should evaluate the proposed tree.
  }
}
const localPathPatterns = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/var\/folders\//,
  /[A-Za-z]:\\Users\\[^\\]+\\/,
]
const credentialPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
]

for (const relativePath of files) {
  const buffer = await readFile(resolve(projectRoot, relativePath))
  if (buffer.includes(0)) continue
  const text = buffer.toString('utf8')
  if (localPathPatterns.some((pattern) => pattern.test(text))) {
    errors.push(`local absolute path found in public text: ${relativePath}`)
  }
  if (!relativePath.startsWith('tests/') && credentialPatterns.some((pattern) => pattern.test(text))) {
    errors.push(`credential-shaped value found outside tests: ${relativePath}`)
  }
}

for (const relativePath of files.filter((path) => path.endsWith('.md'))) {
  const sourcePath = resolve(projectRoot, relativePath)
  const markdown = await readFile(sourcePath, 'utf8')
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/gu, '') ?? ''
    if (!rawTarget || /^(?:[a-z]+:|#)/iu.test(rawTarget)) continue
    const pathText = rawTarget.split('#', 1)[0]?.split(/\s+['"]/u, 1)[0] ?? ''
    if (!pathText) continue
    try {
      await stat(resolve(dirname(sourcePath), decodeURIComponent(pathText)))
    } catch {
      errors.push(`broken local Markdown link in ${relativePath}: ${rawTarget}`)
    }
  }
}

if (errors.length > 0) {
  console.error(`Open-source readiness check failed:\n- ${errors.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`Open-source readiness verified (${requiredFiles.length} required files, ${files.length} public files checked).`)
}
