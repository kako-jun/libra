#!/usr/bin/env node
// PR #11 レビュー対応(must-1): Service Worker のオフライン起動を、Cloudflare Pages 等の
// 実配信環境に近い条件で検証する e2e スクリプト。
//
// 事前に `npm run build` で dist/ を作っておくこと。実行方法は docs/development.md 参照。
//
// 検証する配信モード:
// - plain:    ふつうの静的サーバー。深いパス(/foo/bar 等)は index.html を返す(SPA fallback)
// - cf:       Cloudflare Pages 相当。`/index.html` への直接アクセスは `/` へ 308 リダイレクト
//             する(これが PR #11 must-1 で precache に壊れたレスポンスが入る原因だった)
// - 404dot:   ドットファイル(.nojekyll 等)へのアクセスが 404 になる配信環境
//
// 各モードについて、オフライン化した状態での reload とディープリンクへの直接アクセスが
// 両方とも(白画面や net::ERR_FAILED にならず)アプリのシェルまで表示できることを確認する。
//
// 加えて1つの追加検証(PR#11 再レビュー must-B):
// - install-5xx: install 時に precache 対象の1件(manifest.webmanifest)が5xxを返す場合、
//   その版のSWは有効化されず、既存の(直前まで正常だった)SWとキャッシュがそのまま残って
//   動き続けることを確認する

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url))
const MODES = ['plain', 'cf', '404dot']
const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

function startServer(distDir, mode, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)

    if (mode === 'cf' && pathname.endsWith('/index.html')) {
      // Cloudflare Pages 相当: /index.html への直接アクセスは / へ308リダイレクトする
      res.writeHead(308, { Location: pathname.slice(0, -'index.html'.length) || '/' })
      res.end()
      return
    }
    if (mode === '404dot' && path.basename(pathname).startsWith('.')) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    if (pathname.endsWith('/')) pathname += 'index.html'

    let filePath = path.join(distDir, pathname)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA フォールバック: 深いパス(ディープリンク)は index.html を返す
      filePath = path.join(distDir, 'index.html')
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

async function checkMode(chromium, mode, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer(DIST_DIR, mode, port)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []

  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto(base)
    const swReady = await page
      .evaluate(async () => {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('sw ready timeout')), 8000)),
        ])
        return true
      })
      .catch((error) => {
        failures.push(`[${mode}] service worker did not become ready: ${error.message}`)
        return false
      })
    if (!swReady) return failures

    // 初回ロードはまだ SW に制御されていないため、一度リロードして controller を付ける
    await page.reload()
    await page.waitForTimeout(300)
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller)
    if (!controlled) failures.push(`[${mode}] navigator.serviceWorker.controller is not set`)

    await context.setOffline(true)

    try {
      await page.reload({ timeout: 10000 })
      await page.waitForTimeout(400)
      const h1 = await page.locator('h1').first().textContent()
      if (!h1 || !h1.trim()) failures.push(`[${mode}] offline reload: h1 is empty`)
    } catch (error) {
      failures.push(`[${mode}] offline reload failed: ${error.message.split('\n')[0]}`)
    }

    try {
      await page.goto(base + 'foo/bar', { timeout: 10000 })
      await page.waitForTimeout(400)
      const h1 = await page.locator('h1').first().textContent()
      if (!h1 || !h1.trim()) failures.push(`[${mode}] offline deep link: h1 is empty`)
    } catch (error) {
      failures.push(`[${mode}] offline deep link failed: ${error.message.split('\n')[0]}`)
    }

    const relevantConsoleErrors = consoleErrors.filter((text) => !text.includes('favicon'))
    if (relevantConsoleErrors.length > 0) {
      failures.push(`[${mode}] console errors: ${relevantConsoleErrors.join(' | ')}`)
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  return failures
}

/**
 * PR#11 再レビュー must-B: install 時に precache 対象の一部が 5xx を返した場合、
 * その版の SW は有効化されず、既存の(直前まで正常だった)SW とそのキャッシュが
 * そのまま残って動き続けることを確認する。
 *
 * サーバーは `state.phase` で振る舞いを切り替える:
 * - 'v1'(既定): 全ファイルを普通に返す
 * - 'v2': /sw.js の CACHE_NAME を別の値に書き換えて返す(バイト差分で SW の更新チェックを
 *   誘発する)。かつ manifest.webmanifest だけ 500 を返す(install 中の precache 取得の
 *   1件が失敗する状況を模す)
 */
function startInstallFailureServer(distDir, port) {
  const state = { phase: 'v1' }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'

    if (state.phase === 'v2' && pathname === '/manifest.webmanifest') {
      res.writeHead(500)
      res.end('injected failure')
      return
    }

    const filePath = path.join(distDir, pathname)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404)
      res.end('not found')
      return
    }

    if (pathname === '/sw.js' && state.phase === 'v2') {
      const source = fs.readFileSync(filePath, 'utf-8')
      const rewritten = source.replace(
        /const CACHE_NAME = '[^']*'/,
        "const CACHE_NAME = 'libra-e2e-v2-broken'",
      )
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' })
      res.end(rewritten)
      return
    }

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  })
  return { state, ready: new Promise((resolve) => server.listen(port, () => resolve(server))) }
}

async function checkInstallFailureKeepsOldVersion(chromium, port) {
  const base = `http://localhost:${port}/`
  const { state, ready } = startInstallFailureServer(DIST_DIR, port)
  const server = await ready
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []
  const label = 'install-5xx'

  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } })
    const page = await context.newPage()

    // v1: 正常に install・activate させ、controller を付ける
    await page.goto(base)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await page.waitForTimeout(300)
    const v1CacheNames = await page.evaluate(() => caches.keys())
    if (v1CacheNames.length !== 1) {
      failures.push(`[${label}] v1 install 後のキャッシュ数が想定外: ${v1CacheNames.join(',')}`)
      return failures
    }
    const v1CacheName = v1CacheNames[0]

    // v2: sw.js のバイト内容を変えて更新チェックを誘発し、precache対象の1件(manifest)を
    // 500にする。install が失敗し、v1 の SW・キャッシュがそのまま残ることを期待する
    state.phase = 'v2'
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      await registration.update()
    })
    // 更新チェック~install失敗までの非同期処理を待つ
    await page.waitForTimeout(1500)

    const cacheNamesAfter = await page.evaluate(() => caches.keys())
    if (!cacheNamesAfter.includes(v1CacheName)) {
      failures.push(`[${label}] install失敗後にv1のキャッシュ(${v1CacheName})が消えている`)
    }
    if (cacheNamesAfter.includes('libra-e2e-v2-broken')) {
      failures.push(`[${label}] 失敗したはずのv2キャッシュが残っている`)
    }
    if (cacheNamesAfter.length !== 1) {
      failures.push(
        `[${label}] install失敗後もキャッシュは1つだけであるべき: ${cacheNamesAfter.join(',')}`,
      )
    }

    // v1のSW・キャッシュのままオフラインでも動き続けることを確認する
    await context.setOffline(true)
    try {
      await page.reload({ timeout: 10000 })
      await page.waitForTimeout(400)
      const h1 = await page.locator('h1').first().textContent()
      if (!h1 || !h1.trim()) failures.push(`[${label}] install失敗後もv1でオフライン起動できるはず`)
    } catch (error) {
      failures.push(
        `[${label}] install失敗後のオフラインreloadが失敗: ${error.message.split('\n')[0]}`,
      )
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  return failures
}

async function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`dist/ が無い。先に \`npm run build\` を実行すること: ${DIST_DIR}`)
    process.exitCode = 1
    return
  }

  const { chromium } = await import('playwright')
  const allFailures = []
  let port = 4700
  for (const mode of MODES) {
    console.log(`--- checking mode: ${mode} (port ${port}) ---`)
    const failures = await checkMode(chromium, mode, port)
    if (failures.length === 0) {
      console.log(`[${mode}] OK`)
    } else {
      failures.forEach((f) => console.error(f))
    }
    allFailures.push(...failures)
    port += 1
  }

  console.log(`--- checking: install-5xx (port ${port}) ---`)
  const installFailures = await checkInstallFailureKeepsOldVersion(chromium, port)
  if (installFailures.length === 0) {
    console.log('[install-5xx] OK')
  } else {
    installFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...installFailures)
  port += 1

  if (allFailures.length > 0) {
    console.error(`\n${allFailures.length} 件失敗した`)
    process.exitCode = 1
  } else {
    console.log('\nすべてのモードでオフライン起動(reload・ディープリンク)を確認した')
  }
}

main()
