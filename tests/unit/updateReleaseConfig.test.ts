import { describe, expect, it } from 'vitest'
import { requireSecureUpdateUrl } from '../../scripts/update-release-config.mjs'

describe('update release configuration', () => {
  it('normalizes a public HTTPS base URL', () => {
    expect(requireSecureUpdateUrl('https://downloads.example.com/aster-code'))
      .toBe('https://downloads.example.com/aster-code/')
  })

  it.each([
    '',
    'http://downloads.example.com/aster-code',
    'https://user:secret@downloads.example.com/aster-code',
    'https://downloads.example.com/aster-code?channel=latest',
    'https://downloads.example.com/aster-code#latest',
    'https://localhost/aster-code',
    'https://updates.localhost/aster-code',
  ])('rejects unsafe update URL %s', (value) => {
    expect(() => requireSecureUpdateUrl(value)).toThrow()
  })
})
