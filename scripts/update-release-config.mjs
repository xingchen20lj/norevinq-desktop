export function requireSecureUpdateUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new Error('NOREVINQ_UPDATE_URL must be a non-empty HTTPS base URL no longer than 2048 characters.')
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('NOREVINQ_UPDATE_URL is not a valid URL.')
  }
  if (url.protocol !== 'https:') throw new Error('NOREVINQ_UPDATE_URL must use HTTPS.')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('NOREVINQ_UPDATE_URL cannot contain credentials, query parameters, or a fragment.')
  }
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('NOREVINQ_UPDATE_URL must name a release host, not localhost.')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}
