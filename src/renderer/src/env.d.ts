/// <reference types="vite/client" />
import type { BcApi } from '../../preload/index'

declare global {
  interface Window {
    bc: BcApi
    DjVu?: any
  }
}

export {}
