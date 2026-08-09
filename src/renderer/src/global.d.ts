/// <reference types="vite/client" />

import type { AsterDesktopApi } from '../../shared/contracts'

declare global {
  interface Window {
    aster: AsterDesktopApi
  }
}

export {}
