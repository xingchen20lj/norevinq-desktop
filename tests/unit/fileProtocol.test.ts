import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseByteRange, serveFilePreview } from '../../src/main/files/fileProtocol.js'

const temporaryPaths: string[] = []
const token = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('file preview protocol', () => {
  it('parses complete, open-ended, and suffix byte ranges', () => {
    expect(parseByteRange(null, 10)).toBeNull()
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=20-30', 10)).toBe(false)
    expect(parseByteRange('bytes=5-2', 10)).toBe(false)
    expect(parseByteRange('items=0-1', 10)).toBe(false)
  })

  it('streams only the requested bytes with restrictive response headers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-file-protocol-'))
    temporaryPaths.push(root)
    const path = join(root, 'media.bin')
    writeFileSync(path, '0123456789')
    const metadata = lstatSync(path)
    const response = serveFilePreview(new Request(`norevinq-file://preview/${token}`, {
      headers: { Range: 'bytes=2-5' },
    }), {
      resolvePreviewToken: () => ({
        path,
        mimeType: 'video/mp4',
        size: 10,
        device: metadata.dev,
        inode: metadata.ino,
        expiresAt: Date.now() + 1_000,
      }),
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('2345')
  })

  it('rejects expired tokens, unsupported methods, and unsatisfiable ranges', () => {
    const missing = { resolvePreviewToken: () => null }
    expect(serveFilePreview(new Request(`norevinq-file://preview/${token}`), missing).status).toBe(404)
    expect(serveFilePreview(new Request(`norevinq-file://preview/${token}`, { method: 'POST' }), missing).status).toBe(404)
    const root = mkdtempSync(join(tmpdir(), 'norevinq-file-protocol-'))
    temporaryPaths.push(root)
    const path = join(root, 'audio.bin')
    writeFileSync(path, '12345')
    const metadata = lstatSync(path)
    const resolver = {
      resolvePreviewToken: () => ({
        path,
        mimeType: 'audio/mpeg',
        size: 5,
        device: metadata.dev,
        inode: metadata.ino,
        expiresAt: Date.now() + 1_000,
      }),
    }
    const response = serveFilePreview(new Request(`norevinq-file://preview/${token}`, { headers: { Range: 'bytes=9-10' } }), resolver)
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */5')
  })
})
