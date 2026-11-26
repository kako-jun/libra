import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'

// Issue #118: 介助者用メニュー「このアプリ」に出す版とビルド日(日本時間)を埋め込む
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
const buildDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

// Issue #156: 同梱フォントを配るので、ライセンス(OFL 1.1)の全文も配信物に入れる。原本は1つだけにして
// ビルド時にそのまま写す(dist/ に入るので Service Worker の precache にも含まれる)
const FONT_LICENSE_FILE = 'licenses/BIZUDGothic-OFL.txt'
const fontLicensePlugin: Plugin = {
  name: 'libra-font-license',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: FONT_LICENSE_FILE,
      source: readFileSync(new URL('./src/assets/fonts/OFL.txt', import.meta.url)),
    })
  },
}

export default defineConfig({
  plugins: [solidPlugin(), fontLicensePlugin],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  build: {
    target: 'esnext',
  },
})
