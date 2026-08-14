/// <reference types="vite/client" />

import type { NorevinqDesktopApi } from '../../shared/contracts'

declare global {
  interface Window {
    norevinq: NorevinqDesktopApi
  }
}

export {}
