import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const rendererRoot = resolve('out/renderer')
const htmlPath = join(rendererRoot, 'index.html')
const budgets = {
  initialJavaScript: 700 * 1024,
  initialStyles: 80 * 1024,
  totalRenderer: Math.floor(1.4 * 1024 * 1024),
}

const html = await readFile(htmlPath, 'utf8').catch((reason) => {
  throw new Error(`Renderer build is missing. Run pnpm build first. ${String(reason)}`)
})
const initialAssets = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)(?:[?#][^"]*)?"/gu)]
  .map((match) => match[1])
  .filter((value) => typeof value === 'string')

if (initialAssets.length === 0) throw new Error('Renderer HTML does not reference any initial assets.')

const initialSizes = await Promise.all(initialAssets.map(async (relativePath) => ({
  relativePath,
  size: (await stat(join(rendererRoot, relativePath))).size,
})))
const initialJavaScript = sum(initialSizes.filter(({ relativePath }) => relativePath.endsWith('.js')))
const initialStyles = sum(initialSizes.filter(({ relativePath }) => relativePath.endsWith('.css')))
const totalRenderer = await directorySize(rendererRoot)

const measurements = { initialJavaScript, initialStyles, totalRenderer }
for (const [name, limit] of Object.entries(budgets)) {
  const measured = measurements[name]
  if (measured > limit) {
    throw new Error(`${name} is ${formatBytes(measured)}, exceeding the ${formatBytes(limit)} budget.`)
  }
}

console.log([
  `Initial JavaScript: ${formatBytes(initialJavaScript)} / ${formatBytes(budgets.initialJavaScript)}`,
  `Initial styles: ${formatBytes(initialStyles)} / ${formatBytes(budgets.initialStyles)}`,
  `Total renderer: ${formatBytes(totalRenderer)} / ${formatBytes(budgets.totalRenderer)}`,
].join('\n'))

function sum(items) {
  return items.reduce((total, { size }) => total + size, 0)
}

async function directorySize(path) {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name)
    total += entry.isDirectory() ? await directorySize(entryPath) : (await stat(entryPath)).size
  }
  return total
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`
}
