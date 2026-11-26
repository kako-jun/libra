/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_OPENWEATHER_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** vite.config.ts の define で埋め込む(Issue #118)。package.json の version */
declare const __APP_VERSION__: string | undefined
/** vite.config.ts の define で埋め込む(Issue #118)。ビルド日(日本時間の YYYY-MM-DD) */
declare const __BUILD_DATE__: string | undefined
