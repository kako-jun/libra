/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_OPENWEATHER_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** vite.config.ts の define で埋め込む(Issue #146)。公開版の最後の変更日(日本時間の YYYY-MM-DD) */
declare const __RELEASE_DATE__: string | undefined
