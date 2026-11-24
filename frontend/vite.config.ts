import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

// Issue #118: 介助者用メニュー「このアプリ」に出す版とビルド日(日本時間)を埋め込む
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
const buildDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

export default defineConfig({
  plugins: [solidPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  build: {
    target: 'esnext',
  },
})
