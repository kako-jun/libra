#!/usr/bin/env node
// オフライン起動の e2e(Service Worker)。PR #11 レビュー対応(must-1/B/C/E)。
//
// 事前に `npm run build` で dist/ を作っておくこと。実行方法は docs/development.md 参照。
//
// - plain / cf / 404dot: 3つの配信モード(plain=素の静的サーバー・cf=Cloudflare Pages 相当で
//   `/index.html` を 308 で `/` へ・404dot=ドットファイルが 404)で、オフライン化した状態の
//   reload とディープリンク直接アクセスが、アプリのシェルまで表示できる(白画面・net::ERR_FAILED にならない)
// - install-5xx: install 時に precache 対象の1件が 5xx を返しても、既存の SW とキャッシュが生き残る。
//   CACHE_NAME が新旧で衝突する場合(collision)でも稼働中の同名キャッシュを消さない

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { CONTENT_TYPES, DIST_DIR, launchBrowser, runChecks, startServer } from './lib.mjs'

const MODES = ['plain', 'cf', '404dot']

async function checkMode(chromium, mode, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer(mode, port)
  const browser = await launchBrowser(chromium)
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
function startInstallFailureServer(port) {
  // state.phase: 'v1'(正常) / 'v2'(sw.jsのCACHE_NAMEを別名に書き換え+manifestを500) /
  // 'v3-collision'(sw.jsのCACHE_NAMEをstate.collisionNameに書き換え+manifestを500。
  // must-Eが本来防ぐ「新旧で同じCACHE_NAMEになってしまう」状況そのものを再現する)
  const state = { phase: 'v1', collisionName: undefined }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'

    if (state.phase !== 'v1' && pathname === '/manifest.webmanifest') {
      res.writeHead(500)
      res.end('injected failure')
      return
    }

    const filePath = path.join(DIST_DIR, pathname)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404)
      res.end('not found')
      return
    }

    if (pathname === '/sw.js' && state.phase !== 'v1') {
      const newName = state.phase === 'v3-collision' ? state.collisionName : 'libra-e2e-v2-broken'
      const source = fs.readFileSync(filePath, 'utf-8')
      const rewritten = source.replace(
        /const CACHE_NAME = '[^']*'/,
        `const CACHE_NAME = '${newName}'`,
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

/**
 * 更新チェック~install失敗までの非同期処理を待つ。固定待ちだと遅い環境(CI・負荷時)で install の
 * 途中(一時キャッシュ "-installing" がまだ残っている最中)を測ってしまうため、最低 1.5 秒待った後、
 * 一時キャッシュが消えるまで最大 10 秒ポーリングする。10 秒たっても残っていれば残骸として検査が失敗する。
 */
async function waitForInstallToSettle(page) {
  await page.waitForTimeout(1500)
  await page
    .waitForFunction(
      async () => !(await caches.keys()).some((name) => name.endsWith('-installing')),
      undefined,
      { timeout: 10000 },
    )
    .catch(() => {})
}

async function checkInstallFailureKeepsOldVersion(chromium, port) {
  const base = `http://localhost:${port}/`
  const { state, ready } = startInstallFailureServer(port)
  const server = await ready
  const browser = await launchBrowser(chromium)
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
    await waitForInstallToSettle(page)

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
    await context.setOffline(false)

    // v3-collision: must-Eが本来防ぐべき状況そのもの(新旧で同じCACHE_NAMEになる)を
    // 直接再現する。sw.jsのCACHE_NAMEをv1のものと完全に同じ文字列に書き換えつつ
    // installを失敗させ、それでも稼働中のv1キャッシュ(同名)が消えず内容も無事なことを
    // 確認する(install が本名ではなく一時名("-installing")で作業するため、失敗時に
    // caches.delete()するのは一時名だけであり、同名であっても本名を巻き込まない)
    state.phase = 'v3-collision'
    state.collisionName = v1CacheName
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      await registration.update()
    })
    await waitForInstallToSettle(page)

    const cacheNamesAfterCollision = await page.evaluate(() => caches.keys())
    if (!cacheNamesAfterCollision.includes(v1CacheName)) {
      failures.push(`[${label}] collision: v1のキャッシュ(${v1CacheName})が消えている`)
    }
    const v1StillHasIndex = await page.evaluate(async (name) => {
      const cache = await caches.open(name)
      return (await cache.match('/')) !== undefined
    }, v1CacheName)
    if (!v1StillHasIndex) {
      failures.push(`[${label}] collision: 同名キャッシュの内容(/)が消えている`)
    }

    await context.setOffline(true)
    try {
      await page.reload({ timeout: 10000 })
      await page.waitForTimeout(400)
      const h1 = await page.locator('h1').first().textContent()
      if (!h1 || !h1.trim()) {
        failures.push(`[${label}] collision: install失敗後もv1でオフライン起動できるはず`)
      }
    } catch (error) {
      failures.push(
        `[${label}] collision: install失敗後のオフラインreloadが失敗: ${error.message.split('\n')[0]}`,
      )
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  return failures
}

await runChecks(
  [
    ...MODES.map((mode) => ({
      name: mode,
      run: (chromium, port) => checkMode(chromium, mode, port),
    })),
    { name: 'install-5xx', run: checkInstallFailureKeepsOldVersion },
  ],
  { basePort: 4700 },
)
