import type { GitFileStatus } from '../../shared/git.js'

export type ParsedGitStatus = {
  branch: string | null
  detached: boolean
  headOid: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export function parsePorcelainV2Z(output: string): ParsedGitStatus {
  const records = output.split('\0')
  const files: GitFileStatus[] = []
  let branch: string | null = null
  let detached = false
  let headOid: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.startsWith('# branch.oid ')) headOid = normalizeOid(record.slice(13))
    else if (record.startsWith('# branch.head ')) {
      const value = record.slice(14)
      detached = value === '(detached)'
      branch = detached || value === '(unknown)' ? null : value
    } else if (record.startsWith('# branch.upstream ')) upstream = record.slice(18) || null
    else if (record.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/.exec(record.slice(12))
      ahead = Number(match?.[1] ?? 0)
      behind = Number(match?.[2] ?? 0)
    } else if (record.startsWith('1 ')) {
      files.push(parseTracked(record, 'ordinary', 8))
    } else if (record.startsWith('2 ')) {
      const file = parseTracked(record, 'renamed', 9)
      const originalPath = records[index + 1]
      files.push({ ...file, originalPath: originalPath === undefined || originalPath === '' ? null : originalPath })
      index += 1
    } else if (record.startsWith('u ')) {
      files.push(parseTracked(record, 'unmerged', 10))
    } else if (record.startsWith('? ')) {
      files.push({ path: record.slice(2), originalPath: null, indexStatus: '?', worktreeStatus: '?', kind: 'untracked' })
    } else if (record.startsWith('! ')) {
      files.push({ path: record.slice(2), originalPath: null, indexStatus: '!', worktreeStatus: '!', kind: 'ignored' })
    }
  }
  return { branch, detached, headOid, upstream, ahead, behind, files }
}

function parseTracked(record: string, kind: GitFileStatus['kind'], fixedFields: number): GitFileStatus {
  const fields = record.split(' ', fixedFields + 1)
  const xy = fields[1] ?? '..'
  return {
    path: tailAfterSpaces(record, fixedFields),
    originalPath: null,
    indexStatus: xy[0] ?? '.',
    worktreeStatus: xy[1] ?? '.',
    kind,
  }
}

function tailAfterSpaces(value: string, count: number): string {
  let position = -1
  for (let found = 0; found < count; found += 1) {
    position = value.indexOf(' ', position + 1)
    if (position < 0) return ''
  }
  return value.slice(position + 1)
}

function normalizeOid(value: string): string | null {
  return value === '(initial)' || !value ? null : value
}
