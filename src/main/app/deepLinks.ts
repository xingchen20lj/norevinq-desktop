import type { DeepLinkTarget } from '../../shared/contracts.js'

const DEEP_LINK_SCHEME = 'aster-code:'
const MAX_DEEP_LINK_LENGTH = 2_048
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type DeepLinkRegistry = {
  getProject: (projectId: string) => object | null
  hasProjectThread: (projectId: string, threadId: string) => boolean
}

export function parseAsterDeepLink(raw: string, registry: DeepLinkRegistry): DeepLinkTarget | null {
  if (raw.length === 0 || raw.length > MAX_DEEP_LINK_LENGTH) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== DEEP_LINK_SCHEME || url.username || url.password || url.port || url.hash) return null

  const id = decodeSinglePathSegment(url.pathname)
  if (!id) return null
  if (url.hostname === 'project') {
    if ([...url.searchParams].length !== 0 || !registry.getProject(id)) return null
    return { kind: 'project', projectId: id }
  }
  if (url.hostname === 'thread') {
    const projectValues = url.searchParams.getAll('project')
    if ([...url.searchParams.keys()].some((key) => key !== 'project') || projectValues.length !== 1) return null
    const projectId = projectValues[0]
    if (!projectId || !UUID_PATTERN.test(projectId) || !registry.getProject(projectId)) return null
    if (!registry.hasProjectThread(projectId, id)) return null
    return { kind: 'thread', projectId, threadId: id }
  }
  return null
}

export function extractAsterDeepLinks(argv: readonly string[]): string[] {
  return argv.filter((argument) => argument.toLowerCase().startsWith(DEEP_LINK_SCHEME)).slice(0, 8)
}

function decodeSinglePathSegment(pathname: string): string | null {
  const encoded = pathname.startsWith('/') ? pathname.slice(1) : pathname
  if (!encoded || encoded.includes('/')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    return null
  }
  return UUID_PATTERN.test(decoded) ? decoded : null
}
