import { describe, expect, it } from 'vitest'
import { requireSecureUpdateUrl } from '../../scripts/update-release-config.mjs'

describe('update release configuration', () => {
  it('normalizes a public HTTPS base URL', () => {
    expect(requireSecureUpdateUrl('https://downloads.example.com/norevinq'))
      .toBe('https://downloads.example.com/norevinq/')
  })

  it.each([
    '',
    'http://downloads.example.com/norevinq',
    'https://user:secret@downloads.example.com/norevinq',
    'https://downloads.example.com/norevinq?channel=latest',
    'https://downloads.example.com/norevinq#latest',
    'https://localhost/norevinq',
    'https://updates.localhost/norevinq',
  ])('rejects unsafe update URL %s', (value) => {
    expect(() => requireSecureUpdateUrl(value)).toThrow()
  })
})
