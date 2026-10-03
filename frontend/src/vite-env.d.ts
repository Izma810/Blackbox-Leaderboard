/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Worker URL for production builds; empty in local dev */
  readonly VITE_BACKEND_URL?: string
}
