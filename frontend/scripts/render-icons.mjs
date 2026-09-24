#!/usr/bin/env node
// Issue #5: public/icon.svg から PWA アイコン(192/512 PNG)を生成する。
//
// このアプリは軽量さを保つため sharp 等の画像ライブラリを依存に入れず、Playwright の
// ヘッドレスブラウザで SVG を指定サイズにレンダリングしてスクリーンショットする。
// icon.svg のデザインは既に maskable の安全域(中心80%の円)に収まっているため、
// any/maskable どちらの purpose でも同じ 512px 画像を使い回す(manifest.webmanifest 参照)。
//
// 実行には Playwright(chromium)が要る。このリポジトリ自体には devDependency として
// 入れていない(アイコンはデザインが変わるまで再生成しないビルド時ツールのため)。
// 手元やCIで再生成する場合は `npm i -D playwright && npx playwright install chromium`
// するか、PLAYWRIGHT_CHROMIUM_PATH で既存の chromium 実行体を指すこと。
//
// 使い方: node scripts/render-icons.mjs [出力先ディレクトリ(既定 public)]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGETS = [
  { file: 'pwa-icon-192.png', size: 192 },
  { file: 'pwa-icon-512.png', size: 512 },
]

async function main() {
  const outDir = process.argv[2] ?? 'public'
  const svgPath = join('public', 'icon.svg')
  const svg = readFileSync(svgPath, 'utf-8')

  const { chromium } = await import('playwright')
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)

  try {
    for (const { file, size } of TARGETS) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      })
      await page.setContent(
        `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px">${svg}</body></html>`,
      )
      const outPath = join(outDir, file)
      await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: size, height: size } })
      console.log(`wrote ${outPath}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
