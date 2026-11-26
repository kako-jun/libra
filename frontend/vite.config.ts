import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'
// @ts-expect-error 型定義の無い .mjs
import { releaseDate } from './scripts/release-date.mjs'

// Issue #146: 介助者用メニュー「このアプリ」に出す日付(公開版の最後の変更日。日本時間)を埋め込む
const lastChangeDate: string = releaseDate(fileURLToPath(new URL('.', import.meta.url)))

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
    __RELEASE_DATE__: JSON.stringify(lastChangeDate),
  },
  build: {
    target: 'esnext',
  },
})
