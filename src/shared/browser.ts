export type BrowserLogLevel = 'debug' | 'info' | 'warning' | 'error'

export type BrowserLogEntry = {
  id: string
  level: BrowserLogLevel
  message: string
  source: string | null
  line: number | null
  createdAt: string
}

export type BrowserSnapshot = {
  open: boolean
  url: string | null
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  logs: BrowserLogEntry[]
}

export type BrowserBounds = { x: number; y: number; width: number; height: number }
export type BrowserNavigateInput = { url: string }
export type BrowserOpenInput = { url?: string }
export type BrowserExternalInput = { url: string; confirmed: true }
export type BrowserSubscription = (snapshot: BrowserSnapshot) => void
