import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const statePath = process.env.GH_CONFIG_DIR ? join(process.env.GH_CONFIG_DIR, 'fake-gh-state.json') : undefined
if (!statePath) fail('GH_CONFIG_DIR is required.')

if (args[0] === '--version') {
  process.stdout.write('gh version 2.97.0 (2026-07-31)\n')
  process.exit(0)
}

if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('Logged in to github.com as aster-fixture\n')
  process.exit(0)
}

if (args[0] === 'repo' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    nameWithOwner: 'aster-fixture/project',
    url: 'https://github.com/aster-fixture/project',
    defaultBranchRef: { name: 'main' },
  }))
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'list') {
  if (!existsSync(statePath)) {
    process.stdout.write('[]')
  } else {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    process.stdout.write(JSON.stringify([{
      number: 42,
      title: state.title,
      url: 'https://github.com/aster-fixture/project/pull/42',
      state: 'OPEN',
      isDraft: state.draft,
      baseRefName: state.base,
      headRefName: state.head.split(':').slice(1).join(':'),
      headRepositoryOwner: { login: state.head.split(':')[0] },
    }]))
  }
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'create') {
  const body = await readStandardInput()
  const value = {
    args,
    title: option('--title'),
    body,
    base: option('--base'),
    head: option('--head'),
    draft: args.includes('--draft'),
    unrelatedSecretPresent: typeof process.env.ASTER_UNRELATED_SECRET === 'string',
    deepSeekKeyPresent: typeof process.env.DEEPSEEK_API_KEY === 'string',
    openAiKeyPresent: typeof process.env.OPENAI_API_KEY === 'string',
  }
  writeFileSync(statePath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  process.stdout.write('https://github.com/aster-fixture/project/pull/42\n')
  process.exit(0)
}

fail(`Unexpected fake gh invocation: ${args.join(' ')}`)

function option(name) {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value) fail(`Missing ${name}.`)
  return value
}

async function readStandardInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}
