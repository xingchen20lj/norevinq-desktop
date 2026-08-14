export type AgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'localImage'; alt: string; path: string }

const MARKDOWN_LOCAL_MEDIA = /!?\[([^\]\r\n]{0,200})\]\((?:<([^>\r\n]{1,4096})>|([^\s)\r\n]{1,4096}))\)/gu
const INLINE_CODE = /`([^`\r\n]{1,4096})`/gu
const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)$/iu

type LocalImageCandidate = {
  alt: string
  end: number
  path: string
  start: number
}

export function parseAgentMessage(text: string): AgentMessagePart[] {
  const candidates = collectLocalImages(text)
  const parts: AgentMessagePart[] = []
  let cursor = 0
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue
    pushText(parts, text.slice(cursor, candidate.start))
    parts.push({ type: 'localImage', alt: candidate.alt, path: candidate.path })
    cursor = candidate.end
  }
  pushText(parts, text.slice(cursor))
  return parts.length > 0 ? parts : [{ type: 'text', text }]
}

function collectLocalImages(text: string): LocalImageCandidate[] {
  const candidates: LocalImageCandidate[] = []
  for (const match of text.matchAll(MARKDOWN_LOCAL_MEDIA)) {
    const path = match[2] ?? match[3] ?? ''
    if (!isRenderableLocalImagePath(path)) continue
    const label = match[1] ?? ''
    candidates.push({
      alt: label.length > 0 ? label : imageFileName(path),
      end: match.index + match[0].length,
      path,
      start: match.index,
    })
  }
  for (const match of text.matchAll(INLINE_CODE)) {
    const path = match[1] ?? ''
    if (!isRenderableLocalImagePath(path)) continue
    candidates.push({
      alt: imageFileName(path),
      end: match.index + match[0].length,
      path,
      start: match.index,
    })
  }
  return candidates.sort((left, right) => left.start - right.start || right.end - left.end)
}

function pushText(parts: AgentMessagePart[], text: string): void {
  if (text) parts.push({ type: 'text', text })
}

function isRenderableLocalImagePath(path: string): boolean {
  return (path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)) && IMAGE_EXTENSION.test(path)
}

function imageFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? '生成图片'
}
