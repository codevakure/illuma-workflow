/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_SESSION_MANAGER_URL: string
  readonly VITE_SOCKET_URL: string
  readonly VITE_APP_URL: string
  readonly VITE_BRAND_NAME: string
  readonly VITE_BILLING_ENABLED: string
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
