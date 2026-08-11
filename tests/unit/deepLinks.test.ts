import { describe, expect, it } from 'vitest'
import { extractAsterDeepLinks, parseAsterDeepLink } from '../../src/main/app/deepLinks.js'

const projectId = '11111111-1111-4111-8111-111111111111'
const threadId = '22222222-2222-7222-8222-222222222222'

const registry = {
  getProject: (id: string): object | null => id === projectId ? {} : null,
  hasProjectThread: (project: string, thread: string): boolean => project === projectId && thread === threadId,
}

describe('Aster deep links', () => {
  it('accepts only registered project and project-thread targets', () => {
    expect(parseAsterDeepLink(`aster-code://project/${projectId}`, registry))
      .toEqual({ kind: 'project', projectId })
    expect(parseAsterDeepLink(`aster-code://thread/${threadId}?project=${projectId}`, registry))
      .toEqual({ kind: 'thread', projectId, threadId })
    expect(parseAsterDeepLink('aster-code://project/33333333-3333-4333-8333-333333333333', registry)).toBeNull()
    expect(parseAsterDeepLink(`aster-code://thread/${threadId}?project=33333333-3333-4333-8333-333333333333`, registry)).toBeNull()
  })

  it('rejects credentials, fragments, unknown input, extra query keys, and encoded path escape', () => {
    expect(parseAsterDeepLink(`aster-code://user:secret@project/${projectId}`, registry)).toBeNull()
    expect(parseAsterDeepLink(`aster-code://project/${projectId}#fragment`, registry)).toBeNull()
    expect(parseAsterDeepLink(`aster-code://project/${projectId}?path=/tmp`, registry)).toBeNull()
    expect(parseAsterDeepLink(`aster-code://thread/${threadId}?project=${projectId}&extra=1`, registry)).toBeNull()
    expect(parseAsterDeepLink(`aster-code://thread/${encodeURIComponent(`${threadId}/escape`)}?project=${projectId}`, registry)).toBeNull()
    expect(parseAsterDeepLink('https://example.com', registry)).toBeNull()
    expect(parseAsterDeepLink(`aster-code://project/${'a'.repeat(2_100)}`, registry)).toBeNull()
  })

  it('extracts at most eight protocol arguments without trusting argument order', () => {
    const links = Array.from({ length: 10 }, () => `aster-code://project/${projectId}`)
    expect(extractAsterDeepLinks(['--flag', ...links, 'file.txt'])).toHaveLength(8)
    expect(extractAsterDeepLinks(['ASTER-CODE://project/value'])).toEqual(['ASTER-CODE://project/value'])
  })
})
