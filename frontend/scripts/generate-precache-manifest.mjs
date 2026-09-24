#!/usr/bin/env node
// Issue #5: ビルド成果物(dist/)を走査して Service Worker の precache 対象URL一覧を作り、
// dist/sw.js 内の __PRECACHE_URLS__ を置き換える。
// package.json の "build" スクリプトから `node scripts/generate-precache-manifest.mjs dist` で呼ぶ。

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * dist ディレクトリを再帰的に走査し、Service Worker が precache すべき URL 一覧を返す。
 * - sw.js 自身は対象外(SW が自分自身をキャッシュする必要はない)
 * - .woff2 が1つでもあれば .woff は全て対象外にする。ビルドツール(@fontsource/vite)は
 *   フォント1つにつき .woff2 と、非対応ブラウザ用の .woff フォールバックの両方を出力するが
 *   ファイル名のハッシュ部分が形式ごとに異なり同名判定はできない。evergreen ブラウザは
 *   .woff2 に対応しているため、フォールバック用の .woff は precache しない
 *   (含めるとサイズが倍近くに膨らむ)。
 * @param {string} distDir
 * @returns {string[]}
 */
export function collectPrecacheUrls(distDir) {
  const urls = []

  function walk(dir, prefix) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath, `${prefix}${entry}/`)
        continue
      }
      if (entry === 'sw.js') continue
      urls.push(`${prefix}${entry}`)
    }
  }

  walk(distDir, '/')

  const hasWoff2 = urls.some((url) => url.endsWith('.woff2'))
  return urls.filter((url) => !(hasWoff2 && url.endsWith('.woff'))).sort()
}

function main() {
  const distDir = process.argv[2] ?? 'dist'
  const swPath = join(distDir, 'sw.js')
  const urls = collectPrecacheUrls(distDir)
  const source = readFileSync(swPath, 'utf-8')
  if (!source.includes('__PRECACHE_URLS__')) {
    throw new Error(`${swPath} に __PRECACHE_URLS__ が見つからない`)
  }
  writeFileSync(swPath, source.replace('__PRECACHE_URLS__', JSON.stringify(urls)))
  console.log(`precache: ${urls.length} 件を ${swPath} へ埋め込んだ`)
}

// このファイルが直接実行された(import ではない)ときだけ main() を呼ぶ
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
