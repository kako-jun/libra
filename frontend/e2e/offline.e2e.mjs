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
// 加えて2つの追加検証(PR#11 再レビュー must-B/must-C、3巡目 must-E):
// - install-5xx: install 時に precache 対象の1件(manifest.webmanifest)が5xxを返す場合、
//   その版のSWは有効化されず、既存の(直前まで正常だった)SWとキャッシュがそのまま残って
//   動き続けることを確認する。加えて sw.js の CACHE_NAME を v1 と全く同じ文字列に書き換えた
//   "collision" フェーズ(must-Eが本来防ぐ「新旧で同じCACHE_NAMEになる」状況そのもの)でも
//   install失敗が稼働中の同名キャッシュを消さないことを確認する
// - letters-scroll: 横向き小画面(844x390/667x375/320x568)で文字盤のスキャン対象が下段に
//   来ても、document自体はスクロールせず(window.scrollY===0)、メッセージパネル(h1)と
//   スキャン対象タイルの両方がビューポート内にあることを確認する
// - no-overlap(4巡目 nit): 固定配置の「介助」ボタン・「警告音停止中」表示が、ホーム・
//   文字盤のタイル領域と重なっていないことを844x390/390x844/1024x768で確認する

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

    const filePath = path.join(distDir, pathname)
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
    await page.waitForTimeout(1500)

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

/**
 * PR#11 再レビュー must-C: orientation:any(縦横両対応)の横向き小画面で、文字盤画面の
 * スキャン対象が下段に来ても、document 自体はスクロールせず(window.scrollY===0)、
 * メッセージパネル(h1、緊急表示を含む)がビューポート内にあり続け、かつスキャン対象の
 * タイル自体もビューポート内にあることを確認する。
 */
async function checkLettersScrollLayout(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer(DIST_DIR, 'plain', port)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []
  const viewports = [
    ['844x390', 844, 390],
    ['667x375', 667, 375],
    ['320x568', 320, 568],
  ]

  try {
    for (const [name, width, height] of viewports) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      await page.goto(base)
      await page.waitForTimeout(300)

      // home: index5 = 文字盤(先頭待機3000ms、以降intervalMs=1500ごとに進む)
      await page.waitForTimeout(3000 + 4 * 1500 + 150)
      await page.keyboard.press('Space')
      await page.waitForTimeout(200)

      // letters screen: 確定 が最後の項目(緊急,戻る,10文字,1字消す,確定)
      const itemCount = await page.evaluate(
        () => document.querySelectorAll('.grid-board .tile').length,
      )
      const commitIndex = itemCount - 1
      await page.waitForTimeout(3000 + (commitIndex - 1) * 1500 + 150)

      const info = await page.evaluate(() => {
        // kako-jun 追加指示で app-shell の余白を0にし、グリッドが端から端まで隙間なく
        // 埋まるようになった結果、fr/minmax の分割計算にサブピクセルの端数が出ることがある
        // (実測で 0.3px 程度)。ビューポート境界判定に 1px の許容誤差を持たせる
        const EPSILON = 1
        const scanning = document.querySelector('.tile.scanning')
        const h1 = document.querySelector('h1')
        const board = document.querySelector('.grid-board')
        // 緊急タイルは常に .grid-board 内の1番目(menus.ts の homeScreen/subScreen)
        const emergencyTile = board?.querySelector('.tile:first-child')
        const scanningRect = scanning?.getBoundingClientRect()
        const h1Rect = h1?.getBoundingClientRect()
        const emergencyRect = emergencyTile?.getBoundingClientRect()
        const boardRect = board?.getBoundingClientRect()
        return {
          scrollY: window.scrollY,
          scanningLabel: scanning?.querySelector('.tile-label')?.textContent,
          scanningInViewport: scanningRect
            ? scanningRect.top >= -EPSILON &&
              scanningRect.bottom <= window.innerHeight + EPSILON &&
              scanningRect.left >= -EPSILON &&
              scanningRect.right <= window.innerWidth + EPSILON
            : false,
          h1InViewport: h1Rect
            ? h1Rect.top >= -EPSILON &&
              h1Rect.bottom <= window.innerHeight + EPSILON &&
              h1Rect.left >= -EPSILON &&
              h1Rect.right <= window.innerWidth + EPSILON
            : false,
          emergencyLabel: emergencyTile?.querySelector('.tile-label')?.textContent,
          // PR#16 再レビュー must-A/B: 9項目以上(文字盤)のスクロールモードでも、
          // 緊急タイルは position:sticky で .grid-board の可視範囲内に留まり続ける想定
          emergencyInBoardViewport:
            emergencyRect && boardRect
              ? emergencyRect.bottom > boardRect.top + EPSILON &&
                emergencyRect.top < boardRect.bottom - EPSILON
              : false,
        }
      })

      if (info.scrollY !== 0) {
        failures.push(`[letters-scroll ${name}] window.scrollY が 0 ではない(${info.scrollY})`)
      }
      if (!info.h1InViewport) {
        failures.push(`[letters-scroll ${name}] メッセージパネル(h1)がビューポート外`)
      }
      if (info.scanningLabel !== '確定') {
        failures.push(
          `[letters-scroll ${name}] タイミング計算がずれ、確定にカーソルが無い(${info.scanningLabel})`,
        )
      } else if (!info.scanningInViewport) {
        failures.push(`[letters-scroll ${name}] スキャン対象(確定)がビューポート外`)
      }
      if (info.emergencyLabel !== '緊急') {
        failures.push(
          `[letters-scroll ${name}] 1番目のタイルが緊急ではない(${info.emergencyLabel})`,
        )
      } else if (!info.emergencyInBoardViewport) {
        failures.push(
          `[letters-scroll ${name}] スキャンが下の方(確定)まで進んだ際、緊急タイルが` +
            `grid-board の可視範囲外に出ている(sticky が効いていない)`,
        )
      }

      await context.close()
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  return failures
}

/**
 * kako-jun 追加指示: 「介助」ボタンと「警告音停止中」表示は position:fixed をやめ、
 * メッセージ欄右上(.message-panel-controls)へ移した。下部の帯(約130px)は廃止し、
 * タイル領域は画面下端まで使う。このチェックは新配置で以下を確認する:
 * - メッセージ文字(h1)と介助ボタン・警告音停止中表示が重ならない
 * - タイル領域(grid-board)が介助ボタン・警告音停止中表示と重ならない
 *   (overflow:auto でスクロールアウトしている、実際には描画されていないタイルは対象外)
 */
async function checkNoOverlapWithFixedControls(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer(DIST_DIR, 'plain', port)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []
  const viewports = [
    ['844x390', 844, 390],
    ['390x844', 390, 844],
    ['1024x768', 1024, 768],
  ]

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  }

  async function checkScreen(page, name, screenLabel) {
    const info = await page.evaluate(() => {
      const board = document.querySelector('.grid-board')
      const h1 = document.querySelector('h1')
      const button = document.querySelector('.caregiver-button')
      const hint = document.querySelector('.audio-status-hint')
      const rectOf = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
      return {
        board: rectOf(board),
        h1: rectOf(h1),
        button: rectOf(button),
        hint: rectOf(hint),
        tiles: [...document.querySelectorAll('.grid-board .tile')].map((t) => rectOf(t)),
      }
    })
    if (info.h1 && info.button && rectsOverlap(info.h1, info.button)) {
      failures.push(`[overlap ${name} ${screenLabel}] メッセージ文字(h1)が「介助」ボタンと重なっている`)
    }
    if (info.h1 && info.hint && rectsOverlap(info.h1, info.hint)) {
      failures.push(`[overlap ${name} ${screenLabel}] メッセージ文字(h1)が「警告音停止中」表示と重なっている`)
    }
    for (const tile of info.tiles) {
      if (info.board && !rectsOverlap(tile, info.board)) continue // スクロールアウトしている
      if (info.button && rectsOverlap(tile, info.button)) {
        failures.push(`[overlap ${name} ${screenLabel}] タイルが「介助」ボタンと重なっている`)
      }
      if (info.hint && rectsOverlap(tile, info.hint)) {
        failures.push(`[overlap ${name} ${screenLabel}] タイルが「警告音停止中」表示と重なっている`)
      }
    }
  }

  try {
    for (const [name, width, height] of viewports) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      await page.goto(base)
      await page.waitForTimeout(300)
      await checkScreen(page, name, 'home')

      // home: index5 = 文字盤(先頭待機3000ms、以降intervalMs=1500ごとに進む)
      await page.waitForTimeout(3000 + 4 * 1500 + 150)
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      await checkScreen(page, name, 'letters')

      await context.close()
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  return failures
}

/**
 * PR#16 Opus レビュー must-3: 文字サイズ「特大」× 390x844 × 不快画面(8項目)で、
 * タイルのラベルがタイル自身の矩形からはみ出さない(隣セルへ食い込まない)ことを確認する。
 * gridLayout への最小セル寸法連動・container-type:size + cqb clamp・overflow:hiddenの
 * 3段構えの対策がすべて外れた場合にここで検知する。
 */
async function checkLabelsFitAtXlarge(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer(DIST_DIR, 'plain', port)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []

  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await page.addInitScript(
        (settings) => window.localStorage.setItem('libra', JSON.stringify(settings)),
        { intervalMs: 5000, fontSize: 'xlarge', theme },
      )
      await page.goto(base)
      await page.waitForTimeout(300)
      // home: index3 = 不快(先頭待機5000ms、以降intervalMs=5000msごとに進む。addInitScriptで
      // intervalMsを伸ばし、タイミングのブレでずれないようにしている)
      await page.waitForTimeout(5000 + 2 * 5000 + 200)
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)

      const { tiles: info, board: boardInfo } = await page.evaluate(() => {
        const rectOf = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
        const board = document.querySelector('.grid-board')
        const boardRect = rectOf(board)
        return {
          board: {
            isFill: board?.classList.contains('grid-fill') ?? false,
            scrollHeight: board?.scrollHeight ?? 0,
            clientHeight: board?.clientHeight ?? 0,
          },
          tiles: [...document.querySelectorAll('.grid-board .tile')].map((tile) => {
            const tileRect = rectOf(tile)
            const label = tile.querySelector('.tile-label')
            return {
              label: label?.textContent,
              tileRect,
              labelRect: rectOf(label),
              visible: tileRect.bottom > boardRect.top + 1 && tileRect.top < boardRect.bottom - 1,
            }
          }),
        }
      })
      // PR#16 再レビュー must-A/B: 8項目以下(この画面=不快、6項目)の画面は、文字サイズが
      // 特大でも常に全面充填(fill)されスクロールが発生しないことを確認する。
      // これが崩れると、巡回中に先頭(緊急)タイルが画面外へ出る恐れがある
      if (!boardInfo.isFill) {
        failures.push(
          `[xlarge-fit 390x844 ${theme} discomfort] 8項目以下の画面なのに grid-fill でない(スクロールモードに落ちている)`,
        )
      }
      if (boardInfo.scrollHeight > boardInfo.clientHeight + 1) {
        failures.push(
          `[xlarge-fit 390x844 ${theme} discomfort] 8項目以下の画面なのにスクロールが発生している ` +
            `(scrollHeight=${boardInfo.scrollHeight} clientHeight=${boardInfo.clientHeight})`,
        )
      }
      for (const t of info) {
        if (!t.visible || !t.labelRect) continue
        const fits =
          t.labelRect.left >= t.tileRect.left - 0.5 &&
          t.labelRect.right <= t.tileRect.right + 0.5 &&
          t.labelRect.top >= t.tileRect.top - 0.5 &&
          t.labelRect.bottom <= t.tileRect.bottom + 0.5
        if (!fits) {
          failures.push(
            `[xlarge-fit 390x844 ${theme} discomfort] ラベル"${t.label}"がタイルからはみ出している ` +
              `(label ${JSON.stringify(t.labelRect)} / tile ${JSON.stringify(t.tileRect)})`,
          )
        }
      }
      await context.close()
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

  console.log(`--- checking: letters-scroll (port ${port}) ---`)
  const scrollFailures = await checkLettersScrollLayout(chromium, port)
  if (scrollFailures.length === 0) {
    console.log('[letters-scroll] OK')
  } else {
    scrollFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...scrollFailures)
  port += 1

  console.log(`--- checking: no-overlap (port ${port}) ---`)
  const overlapFailures = await checkNoOverlapWithFixedControls(chromium, port)
  if (overlapFailures.length === 0) {
    console.log('[no-overlap] OK')
  } else {
    overlapFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...overlapFailures)
  port += 1

  console.log(`--- checking: xlarge-fit (port ${port}) ---`)
  const xlargeFitFailures = await checkLabelsFitAtXlarge(chromium, port)
  if (xlargeFitFailures.length === 0) {
    console.log('[xlarge-fit] OK')
  } else {
    xlargeFitFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...xlargeFitFailures)

  if (allFailures.length > 0) {
    console.error(`\n${allFailures.length} 件失敗した`)
    process.exitCode = 1
  } else {
    console.log('\nすべてのモードでオフライン起動(reload・ディープリンク)を確認した')
  }
}

main()
