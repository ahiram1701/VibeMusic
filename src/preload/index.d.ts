import type { VibeApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    vibe: VibeApi
  }
}
