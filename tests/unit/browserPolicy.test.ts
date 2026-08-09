import { describe, expect, it } from 'vitest'
import { isAllowedBrowserRequest, normalizeLocalPreviewUrl } from '../../src/main/browser/browserPolicy.js'

describe('browser preview policy', () => {
  it('normalizes only loopback and localhost HTTP(S) addresses', () => {
    expect(normalizeLocalPreviewUrl('localhost:3000/path')).toBe('http://localhost:3000/path')
    expect(normalizeLocalPreviewUrl('https://app.localhost:4443/')).toBe('https://app.localhost:4443/')
    expect(normalizeLocalPreviewUrl('http://127.1.2.3:8080')).toBe('http://127.1.2.3:8080/')
    expect(normalizeLocalPreviewUrl('http://[::1]:5173')).toBe('http://[::1]:5173/')
  })

  it('rejects public, credentialed, non-web, and ambiguous addresses', () => {
    for (const value of [
      'https://example.com', 'http://0.0.0.0:3000', 'http://user:pass@localhost:3000',
      'file:///etc/passwd', 'javascript:alert(1)', 'http://localhost.evil.example', 'http://128.0.0.1',
      'http://127.0.0.999', 'http://localhost:3000\nhttps://example.com',
    ]) expect(() => normalizeLocalPreviewUrl(value)).toThrow()
  })

  it('allows local page resources and blocks external network subresources', () => {
    expect(isAllowedBrowserRequest('http://localhost:3000/app.js')).toBe(true)
    expect(isAllowedBrowserRequest('ws://127.0.0.1:5173/hmr')).toBe(true)
    expect(isAllowedBrowserRequest('data:text/plain,ok')).toBe(true)
    expect(isAllowedBrowserRequest('blob:http://localhost:3000/abc')).toBe(true)
    expect(isAllowedBrowserRequest('https://cdn.example.com/app.js')).toBe(false)
    expect(isAllowedBrowserRequest('file:///tmp/index.html')).toBe(false)
  })
})
