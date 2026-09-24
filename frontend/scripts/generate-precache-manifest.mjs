#!/usr/bin/env node
// Issue #5 / PR #11 レビュー対応: ビルド成果物(dist/)を走査して Service Worker の
// precache 対象URL一覧とキャッシュバージョンを作り、dist/sw.js 内のプレースホルダを
// 置き換える。package.json の "build" スクリプトから
// `node scripts/generate-precache-manifest.mjs dist` で呼ぶ(旧: build スクリプト内の
// インライン node -e による日付置換は撤去し、この1本に統合した)。

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * dist ディレクトリを再帰的に走査し、Service Worker が precache すべき URL 一覧を返す。
 * - sw.js 自身は対象外(SW が自分自身をキャッシュする必要はない)
 * - ドットファイル(`.nojekyll` 等)、`_headers`/`_redirects`(Cloudflare Pages 等の配信設定
 *   ファイルで、アプリのコードから参照されることは無い)は対象外
 * - `/index.html` は `/` として precache する。Cloudflare Pages 等は `/index.html` への
 *   直接アクセスを `/` へ 308 リダイレクトすることがあり、リダイレクト後のレスポンスを
 *   そのまま precache すると壊れたエントリになる(PR #11 must-1)。`/` へのリクエストは
 *   通常リダイレクトされないため、これを precache キー・ナビゲーションのフォールバック
 *   先の両方に使う
 * - `.woff2` が1つでもあれば `.woff` は全て対象外にする。ビルドツール(@fontsource/vite)は
 *   フォント1つにつき `.woff2` と、非対応ブラウザ用の `.woff` フォールバックの両方を出力
 *   するが、ファイル名のハッシュ部分が形式ごとに異なり同名判定はできない。evergreen
 *   ブラウザは `.woff2` に対応しているため、フォールバック用の `.woff` は precache しない
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
      if (entry.startsWith('.')) continue
      if (stat.isDirectory()) {
        walk(fullPath, `${prefix}${entry}/`)
        continue
      }
      if (entry === 'sw.js') continue
      if (entry === '_headers' || entry === '_redirects') continue
      urls.push(`${prefix}${entry}`)
    }
  }

  walk(distDir, '/')

  const hasWoff2 = urls.some((url) => url.endsWith('.woff2'))
  const filtered = urls.filter((url) => !(hasWoff2 && url.endsWith('.woff')))
  const withRootKey = filtered.map((url) => (url === '/index.html' ? '/' : url))
  return withRootKey.sort()
}

/**
 * precache 対象ファイルの内容と sw.js 自身のテンプレート本文(置換前のロジック部分)から
 * 短いバージョン文字列を作る。ファイル内容が変わらないビルド(日付だけ違う等)では同じ値に
 * なり、内容が変わったビルドでは必ず違う値になるため、ビルド日付ベースだった従来の
 * CACHE_NAME より正確にキャッシュの世代を分けられる。
 *
 * PR#11 3巡目 must-E: 以前は precache 対象ファイル(index.html/JS/CSS等)の内容だけを
 * 見ていたため、アセットは一切変えず SW 自身のフェッチ/キャッシュ戦略だけを直したデプロイ
 * (このファイルの過去の改修そのものが正にそれだった)では新旧で同じ CACHE_NAME になって
 * しまい、install 失敗時の `caches.delete(CACHE_NAME)` が稼働中の(旧SWが使っている)
 * キャッシュを消してしまう事故があった。sw.js のプレースホルダ置換前の本文
 * (`__CACHE_VERSION__`/`__PRECACHE_URLS__` を含む、ロジック部分そのもの)もハッシュに含め、
 * ロジックだけの変更でも CACHE_NAME が変わるようにする。
 * @param {string} distDir
 * @param {string[]} urls precache 対象の URL 一覧(`/` は index.html を指す)
 * @returns {string} 16進12文字のハッシュ
 */
export function computeCacheVersion(distDir, urls) {
  const hash = createHash('sha256')
  // sw.js はこの時点ではまだプレースホルダ未置換(このファイルの後段で置換される前)
  hash.update(readFileSync(join(distDir, 'sw.js')))
  for (const url of [...urls].sort()) {
    const relPath = url === '/' ? '/index.html' : url
    hash.update(relPath)
    hash.update(readFileSync(join(distDir, relPath)))
  }
  return hash.digest('hex').slice(0, 12)
}

/**
 * distDir/sw.js のプレースホルダ(`__PRECACHE_URLS__`/`__CACHE_VERSION__`)を、実際の
 * precache URL 一覧とその内容ハッシュへ書き換える。どちらかが sw.js に見つからない場合は
 * (テンプレートの変更漏れ等)例外を投げる。
 * @param {string} distDir
 * @returns {{ urls: string[], cacheVersion: string, swPath: string }}
 */
export function applyPrecacheManifest(distDir) {
  const swPath = join(distDir, 'sw.js')
  const urls = collectPrecacheUrls(distDir)
  const cacheVersion = computeCacheVersion(distDir, urls)

  let source = readFileSync(swPath, 'utf-8')
  if (!source.includes('__PRECACHE_URLS__')) {
    throw new Error(`${swPath} に __PRECACHE_URLS__ が見つからない`)
  }
  if (!source.includes('__CACHE_VERSION__')) {
    throw new Error(`${swPath} に __CACHE_VERSION__ が見つからない`)
  }
  source = source.replace('__PRECACHE_URLS__', JSON.stringify(urls))
  source = source.replace('__CACHE_VERSION__', cacheVersion)
  writeFileSync(swPath, source)

  return { urls, cacheVersion, swPath }
}

function main() {
  const distDir = process.argv[2] ?? 'dist'
  const { urls, cacheVersion, swPath } = applyPrecacheManifest(distDir)
  console.log(
    `precache: ${urls.length} 件・cache version ${cacheVersion} を ${basename(swPath)} へ埋め込んだ`,
  )
}

// このファイルが直接実行された(import ではない)ときだけ main() を呼ぶ
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
