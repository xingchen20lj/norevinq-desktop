const LOCAL_HOST_PATTERN = /^127(?:\.\d{1,3}){3}$/u

export function normalizeLocalPreviewUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 2_048 || /[\r\n\0]/u.test(trimmed)) throw new Error('本地预览地址无效。')
  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`
  let url: URL
  try { url = new URL(withScheme) } catch { throw new Error('本地预览地址无效。') }
  if (!isLocalPreviewUrl(url) || url.username || url.password) {
    throw new Error('内嵌预览仅允许 localhost、*.localhost、127.0.0.0/8 或 ::1。')
  }
  url.hash = url.hash.slice(0, 1_000)
  return url.toString()
}

export function isAllowedBrowserRequest(input: string): boolean {
  let url: URL
  try { url = new URL(input) } catch { return false }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return isLocalHostname(url.hostname)
  }
  return false
}

function isLocalPreviewUrl(url: URL): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:') && isLocalHostname(url.hostname)
}

function isLocalHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (value === 'localhost' || value === '::1' || value.endsWith('.localhost')) return true
  if (!LOCAL_HOST_PATTERN.test(value)) return false
  return value.split('.').slice(1).every((part) => Number(part) <= 255)
}
