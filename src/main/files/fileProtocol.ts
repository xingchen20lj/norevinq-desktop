import { closeSync, constants, createReadStream, fstatSync, openSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { FileService } from './fileService.js'

type PreviewResolver = Pick<FileService, 'resolvePreviewToken'>

export function serveFilePreview(request: Request, files: PreviewResolver): Response {
  const url = new URL(request.url)
  if (url.hostname !== 'preview' || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return new Response('Not found', { status: 404 })
  }
  const token = url.pathname.slice(1)
  const file = /^[0-9a-f-]{36}$/iu.test(token) ? files.resolvePreviewToken(token) : null
  if (!file) return new Response('Preview expired', { status: 404 })
  let opened: { descriptor: number; size: number }
  try {
    const descriptor = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = fstatSync(descriptor)
      if (!metadata.isFile() || metadata.dev !== file.device || metadata.ino !== file.inode) {
        throw new Error('Preview file identity changed.')
      }
      opened = { descriptor, size: metadata.size }
    } catch (error) {
      closeSync(descriptor)
      throw error
    }
  } catch {
    return new Response('Preview expired', { status: 404 })
  }
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': file.mimeType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  })
  const range = parseByteRange(request.headers.get('range'), opened.size)
  if (range === false) {
    closeSync(opened.descriptor)
    headers.set('Content-Range', `bytes */${String(opened.size)}`)
    return new Response(null, { status: 416, headers })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, opened.size - 1)
  const length = opened.size === 0 ? 0 : end - start + 1
  headers.set('Content-Length', String(length))
  if (range) headers.set('Content-Range', `bytes ${String(start)}-${String(end)}/${String(opened.size)}`)
  if (request.method === 'HEAD' || opened.size === 0) {
    closeSync(opened.descriptor)
    return new Response(null, { status: range ? 206 : 200, headers })
  }
  const body = Readable.toWeb(createReadStream(file.path, {
    autoClose: true,
    fd: opened.descriptor,
    start,
    end,
  })) as ReadableStream
  return new Response(body, { status: range ? 206 : 200, headers })
}

export function parseByteRange(value: string | null, size: number): { start: number; end: number } | null | false {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value)
  if (!match || size === 0) return false
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (!startText && !endText) return false
  let start: number
  let end: number
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText ? Number(endText) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return false
    end = Math.min(end, size - 1)
  }
  return start >= size ? false : { start, end }
}
