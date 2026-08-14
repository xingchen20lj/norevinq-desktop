#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { delimiter, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const knownMacBundlePaths = [
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/MacOS/codex',
]

function parseArguments(argv) {
  const result = { out: join(projectRoot, 'src/generated/codex') }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--binary' || argument === '--out') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${argument} requires a value`)
      result[argument.slice(2)] = value
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/sync-codex-schema.mjs [--binary PATH] [--out DIR]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  result.out = resolve(result.out)
  return result
}

function configuredCandidates(value, source, pathValue) {
  if (!value?.trim()) return []
  const trimmed = value.trim()
  if (isAbsolute(trimmed)) return [{ path: normalize(trimmed), source }]
  if (trimmed.includes('/') || trimmed.includes('\\')) return [{ path: resolve(trimmed), source }]
  const names = process.platform === 'win32' && !/\.[a-z0-9]+$/i.test(trimmed)
    ? [`${trimmed}.exe`, `${trimmed}.cmd`, `${trimmed}.bat`, trimmed]
    : [trimmed]
  return pathValue.split(delimiter).filter(Boolean)
    .flatMap((entry) => names.map((name) => ({ path: join(entry, name), source })))
}

function binaryCandidates(explicitBinary) {
  const pathValue = process.env.PATH ?? ''
  const candidates = [
    ...configuredCandidates(explicitBinary, 'explicit', pathValue),
    ...configuredCandidates(process.env.CODEX_BINARY, 'environment', pathValue),
    {
      path: join(projectRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      source: 'project-dependency',
    },
  ]
  const commandNames = process.platform === 'win32'
    ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex']
    : ['codex']
  for (const entry of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of commandNames) candidates.push({ path: join(entry, name), source: 'path' })
  }
  if (process.platform === 'darwin') {
    for (const path of knownMacBundlePaths) candidates.push({ path, source: 'chatgpt-bundle' })
  }
  const seen = new Set()
  return candidates.filter((candidate) => {
    const key = process.platform === 'win32' ? candidate.path.toLowerCase() : candidate.path
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function discoverBinary(explicitBinary) {
  const failures = []
  for (const candidate of binaryCandidates(explicitBinary)) {
    try {
      await access(candidate.path, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
      const { stdout, stderr } = await runFile(candidate.path, ['--version'], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      })
      const output = `${stdout}\n${stderr}`.trim()
      const version = output.split(/\r?\n/).map((line) => line.trim())
        .find((line) => /\bcodex(?:-cli)?\b/i.test(line))
      if (!version) throw new Error(`unexpected version output: ${output || '<empty>'}`)
      return { ...candidate, version }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EACCES') {
        failures.push(`${candidate.path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const detail = failures.length ? ` Probe failures: ${failures.join('; ')}` : ''
  throw new Error(`No working Codex binary found. Use --binary, CODEX_BINARY, or PATH.${detail}`)
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function listFiles(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await visit(root)
  return files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)))
}

async function hashDirectory(root) {
  const files = await listFiles(root)
  const hash = createHash('sha256')
  for (const path of files) {
    const name = relative(root, path).replaceAll('\\', '/')
    const contents = await readFile(path)
    hash.update(`${name}\0${contents.length}\0`)
    hash.update(contents)
  }
  return { sha256: hash.digest('hex'), files: files.map((path) => relative(root, path).replaceAll('\\', '/')) }
}

async function generate(binary, outputDirectory) {
  const parent = dirname(outputDirectory)
  await mkdir(parent, { recursive: true })
  const temporary = await mkdtemp(join(parent, '.codex-schema-'))
  const typescriptDirectory = join(temporary, 'typescript')
  const jsonSchemaDirectory = join(temporary, 'json-schema')
  try {
    await mkdir(typescriptDirectory)
    await mkdir(jsonSchemaDirectory)
    const commonOptions = { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    await runFile(binary.path, ['app-server', 'generate-ts', '--out', typescriptDirectory], commonOptions)
    await runFile(binary.path, ['app-server', 'generate-json-schema', '--out', jsonSchemaDirectory], commonOptions)

    const typescript = await hashDirectory(typescriptDirectory)
    const jsonSchema = await hashDirectory(jsonSchemaDirectory)
    if (typescript.files.length === 0 || jsonSchema.files.length === 0) {
      throw new Error('Codex completed without generating both TypeScript and JSON Schema files')
    }
    const manifest = {
      manifestVersion: 1,
      protocolSurface: 'stable',
      binary: {
        source: binary.source,
        version: binary.version,
        sha256: await sha256File(binary.path),
      },
      schemaSha256: jsonSchema.sha256,
      outputs: {
        typescript,
        jsonSchema,
      },
    }
    await writeFile(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const previous = `${outputDirectory}.previous-${process.pid}`
    await rm(previous, { recursive: true, force: true })
    try {
      await stat(outputDirectory)
      await rename(outputDirectory, previous)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    try {
      await rename(temporary, outputDirectory)
      await rm(previous, { recursive: true, force: true })
    } catch (error) {
      try {
        await rename(previous, outputDirectory)
      } catch {
        // Preserve the original error; rollback is best effort.
      }
      throw error
    }
    return manifest
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

const arguments_ = parseArguments(process.argv.slice(2))
const binary = await discoverBinary(arguments_.binary)
const manifest = await generate(binary, arguments_.out)
console.log(`Generated stable Codex app-server protocol from ${manifest.binary.version}`)
console.log(`Output: ${arguments_.out}`)
console.log(`Schema SHA-256: ${manifest.schemaSha256}`)
