export type AgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'localImage'; alt: string; path: string }

const MARKDOWN_IMAGE = /!\[([^\]\r\n]{0,200})\]\((?:<([^>\r\n]{1,4096})>|([^\s)\r\n]{1,4096}))\)/gu

export function parseAgentMessage(text: string): AgentMessagePart[] {
  const parts: AgentMessagePart[] = []
  let cursor = 0
  for (const match of text.matchAll(MARKDOWN_IMAGE)) {
    const index = match.index
    const path = match[2] ?? match[3] ?? ''
    if (!isAbsoluteLocalPath(path)) continue
    pushText(parts, text.slice(cursor, index))
    parts.push({ type: 'localImage', alt: match[1] ?? '', path })
    cursor = index + match[0].length
  }
  pushText(parts, text.slice(cursor))
  return parts.length > 0 ? parts : [{ type: 'text', text }]
}

function pushText(parts: AgentMessagePart[], text: string): void {
  if (text) parts.push({ type: 'text', text })
}

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)
}
