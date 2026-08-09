import { describe, expect, it } from 'vitest'
import { parsePorcelainV2Z } from '../../src/main/git/statusParser.js'

describe('parsePorcelainV2Z', () => {
  it('parses branch metadata and every path record without splitting spaces', () => {
    const output = [
      '# branch.oid abc123',
      '# branch.head feature/test',
      '# branch.upstream origin/feature/test',
      '# branch.ab +2 -3',
      '1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb file with spaces.ts',
      '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 renamed file.ts',
      'old file.ts',
      'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.ts',
      '? new file.txt',
      '',
    ].join('\0')

    expect(parsePorcelainV2Z(output)).toEqual({
      branch: 'feature/test',
      detached: false,
      headOid: 'abc123',
      upstream: 'origin/feature/test',
      ahead: 2,
      behind: 3,
      files: [
        expect.objectContaining({ path: 'file with spaces.ts', indexStatus: 'M', worktreeStatus: '.', kind: 'ordinary' }),
        expect.objectContaining({ path: 'renamed file.ts', originalPath: 'old file.ts', kind: 'renamed' }),
        expect.objectContaining({ path: 'conflict.ts', kind: 'unmerged' }),
        expect.objectContaining({ path: 'new file.txt', kind: 'untracked' }),
      ],
    })
  })

  it('recognizes unborn and detached heads', () => {
    expect(parsePorcelainV2Z('# branch.oid (initial)\0# branch.head (detached)\0')).toMatchObject({
      branch: null,
      detached: true,
      headOid: null,
    })
  })
})
