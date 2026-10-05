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
// - no-overlap: 狭い横向き/縦向き/タブレット幅で、警告音停止中ヒント表示時にも
//   案内領域・「介助者用」ボタン・ヒントがホーム/文字盤のタイルと重ならないことを確認する

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

      // letters screen(2 段階文字盤の行段階): 戻る,緊急,あ〜わ行,確定,1字消す,はい・いいえ。
      // 確定は末尾ではないので、ラベルから位置を引く
      const commitIndex = await page.evaluate(() =>
        [...document.querySelectorAll('.grid-board .tile')].findIndex(
          (tile) => tile.querySelector('.tile-label')?.textContent === '確定',
        ),
      )
      await page.waitForTimeout(3000 + (commitIndex - 1) * 1500 + 150)

      const info = await page.evaluate(() => {
        // kako-jun 追加指示で app-shell の余白を0にし、グリッドが端から端まで隙間なく
        // 埋まるようになった結果、fr/minmax の分割計算にサブピクセルの端数が出ることがある
        // (実測で 0.3px 程度)。ビューポート境界判定に 1px の許容誤差を持たせる
        const EPSILON = 1
        const scanning = document.querySelector('.tile.scanning')
        const h1 = document.querySelector('h1')
        const board = document.querySelector('.grid-board')
        // #40: 緊急タイルは通常下位画面で2番目になるため、DOM順ではなく意味クラスで参照する
        const emergencyTile = board?.querySelector('.tile-emergency')
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
          // 9項目以上(文字盤)のスクロールモードでも、緊急タイルは sticky で可視範囲内に残る
          emergencyInBoardViewport:
            emergencyRect && boardRect
              ? emergencyRect.bottom > boardRect.top + EPSILON &&
                emergencyRect.top < boardRect.bottom - EPSILON
              : false,
          scanningOverlapsEmergency:
            scanningRect && emergencyRect && scanning !== emergencyTile
              ? scanningRect.left < emergencyRect.right &&
                scanningRect.right > emergencyRect.left &&
                scanningRect.top < emergencyRect.bottom &&
                scanningRect.bottom > emergencyRect.top
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
        failures.push(`[letters-scroll ${name}] 緊急タイルが見つからない(${info.emergencyLabel})`)
      } else if (!info.emergencyInBoardViewport) {
        failures.push(
          `[letters-scroll ${name}] スキャンが下の方(確定)まで進んだ際、緊急タイルが` +
            `grid-board の可視範囲外に出ている(sticky が効いていない)`,
        )
      }
      if (info.scanningOverlapsEmergency) {
        failures.push(`[letters-scroll ${name}] 緊急タイルがスキャン対象(確定)を覆っている`)
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
 * kako-jun 追加指示: 「介助者用」ボタンと「警告音停止中」表示は position:fixed をやめ、
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
    if (!info.hint) failures.push(`[missing hint ${name} ${screenLabel}] 警告音停止中表示が出ていない`)
    if (info.h1 && info.button && rectsOverlap(info.h1, info.button)) {
      failures.push(
        `[overlap ${name} ${screenLabel}] メッセージ文字(h1)が「介助者用」ボタンと重なっている`,
      )
    }
    if (info.h1 && info.hint && rectsOverlap(info.h1, info.hint)) {
      failures.push(
        `[overlap ${name} ${screenLabel}] メッセージ文字(h1)が「警告音停止中」表示と重なっている`,
      )
    }
    for (const tile of info.tiles) {
      if (info.board && !rectsOverlap(tile, info.board)) continue // スクロールアウトしている
      if (info.button && rectsOverlap(tile, info.button)) {
        failures.push(`[overlap ${name} ${screenLabel}] タイルが「介助者用」ボタンと重なっている`)
      }
      if (info.hint && rectsOverlap(tile, info.hint)) {
        failures.push(
          `[overlap ${name} ${screenLabel}] タイルが「警告音停止中」表示と重なっている`,
        )
      }
    }
  }

  try {
    for (const [name, width, height] of viewports) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      // AudioContext非対応状態に固定し、全ビューポートでヒント表示中の配置を検査する。
      await page.addInitScript(() => {
        window.AudioContext = undefined
        window.webkitAudioContext = undefined
      })
      await page.goto(base)
      await page.waitForTimeout(700)
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
 * Issue #22 (PR#23 レビュー S1/M1): 上部メッセージ(h1)が 1 行に収まる最大サイズで表示されることを、
 * 実ブラウザの計算済みスタイル・描画行数・はみ出しで確認する。
 * - 通常の伝達結果・やや長い文言: 1 行にできるときは data-fit="single" + white-space:nowrap +
 *   描画行数 1、いずれの場合も .message-panel が横にはみ出さない(scrollWidth <= clientWidth)
 *   (Chromium は字送りを実サイズで整数 px に丸めるため、100px 測定の線形縮尺だけだと
 *   数 px はみ出す。候補サイズでの測り直し(M1 修正)が外れるとここで落ちる)
 * - 短い通常伝達は全 viewport で必ず data-fit="single"
 * - 長文(DOM で h1 を直接長くして resize で再計算させる): data-fit が付かず従来の折り返し
 * - Issue #44: 未解除の緊急主文は h1 へ混ぜず、専用 .emergency-status 内に表示する
 */
async function checkHeadingFit(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer(DIST_DIR, 'plain', port)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []
  const viewports = [
    ['1024x768', 1024, 768],
    ['844x390', 844, 390],
    ['1920x1080', 1920, 1080],
  ]
  const MEDIUM = '選んだ内容がここに大きく出ますよ、これは少し長めの文です'
  const LONG =
    'とても長いメッセージが入った場合は小さくしても一行に収まらないので折り返す。'.repeat(3)

  const probe = (page) =>
    page.evaluate(() => {
      const h1 = document.querySelector('h1')
      const panel = document.querySelector('.message-panel')
      const range = document.createRange()
      range.selectNodeContents(h1)
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
      return {
        text: h1.textContent,
        fit: h1.getAttribute('data-fit'),
        whiteSpace: getComputedStyle(h1).whiteSpace,
        lines: tops.size,
        fontSize: getComputedStyle(h1).fontSize,
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
      }
    })

  const settle = async (page) => {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
  }

  try {
    for (const [name, width, height] of viewports) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      await page.goto(`${base}?dev`)
      await page.waitForTimeout(300)
      await page.keyboard.press('2') // 「はい」を伝達し、結果パネルを表示する
      await settle(page)

      const checkNoOverflow = (label, info) => {
        if (info.scrollWidth > info.clientWidth) {
          failures.push(
            `[heading-fit ${name} ${label}] .message-panel が横にはみ出している ` +
              `(scrollWidth=${info.scrollWidth} clientWidth=${info.clientWidth} font=${info.fontSize})`,
          )
        }
      }
      const checkSingle = (label, info, required) => {
        if (info.fit !== 'single') {
          if (required)
            failures.push(`[heading-fit ${name} ${label}] data-fit="single" が付いていない`)
          return
        }
        if (info.whiteSpace !== 'nowrap') {
          failures.push(
            `[heading-fit ${name} ${label}] white-space が nowrap ではない(${info.whiteSpace})`,
          )
        }
        if (info.lines !== 1) {
          failures.push(
            `[heading-fit ${name} ${label}] 1 行ではなく ${info.lines} 行で描画されている`,
          )
        }
      }

      // 短い通常伝達
      const initial = await probe(page)
      checkSingle('transmission', initial, true)
      checkNoOverflow('transmission', initial)

      // やや長い文言(DOM で直接差し替え、resize で再計算させる)
      await page.evaluate((text) => {
        document.querySelector('h1').textContent = text
        window.dispatchEvent(new Event('resize'))
      }, MEDIUM)
      await settle(page)
      const medium = await probe(page)
      checkSingle('medium', medium, false)
      checkNoOverflow('medium', medium)

      // 長文: 下限サイズでも 1 行に収まらないので data-fit は付かない
      await page.evaluate((text) => {
        document.querySelector('h1').textContent = text
        window.dispatchEvent(new Event('resize'))
      }, LONG)
      await settle(page)
      const long = await probe(page)
      if (long.fit !== null) {
        failures.push(`[heading-fit ${name} long] 長文なのに data-fit="${long.fit}" が付いている`)
      }
      if (long.whiteSpace === 'nowrap') {
        failures.push(`[heading-fit ${name} long] 長文なのに white-space: nowrap になっている`)
      }
      checkNoOverflow('long', long)
      await context.close()

      // Issue #44: 緊急主文は通常伝達の h1 ではなく専用状態領域に出る
      const emergencyContext = await browser.newContext({ viewport: { width, height } })
      const emergencyPage = await emergencyContext.newPage()
      await emergencyPage.goto(base)
      await emergencyPage.waitForTimeout(300)
      await emergencyPage.keyboard.press('Space')
      await settle(emergencyPage)
      const emergency = await emergencyPage.evaluate(() => {
        const status = document.querySelector('.emergency-status')
        const message = status?.querySelector('.emergency-status-message')
        return {
          text: message?.textContent,
          scrollWidth: status?.scrollWidth ?? 0,
          clientWidth: status?.clientWidth ?? 0,
          ordinaryMessageVisible: getComputedStyle(document.querySelector('.message-panel'))
            .display,
        }
      })
      if (emergency.text !== '緊急です。来てください') {
        failures.push(`[heading-fit ${name} emergency] 専用緊急状態に主文がない(${emergency.text})`)
      }
      if (emergency.scrollWidth > emergency.clientWidth) {
        failures.push(`[heading-fit ${name} emergency] 専用緊急状態が横にはみ出している`)
      }
      if (emergency.ordinaryMessageVisible !== 'none') {
        failures.push(`[heading-fit ${name} emergency] 未伝達の通常結果パネルが表示されている`)
      }
      await emergencyContext.close()
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

async function checkBackNavigationAndEmergencyRetention(chromium, port) {
  const server = await startServer(DIST_DIR, 'plain', port)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []

  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    await page.addInitScript(() => {
      localStorage.setItem(
        'libra',
        JSON.stringify({ intervalMs: 500, headHoldMultiplier: 1, morseEnabled: true }),
      )
    })
    await page.goto(`http://localhost:${port}/`)
    const labels = () => page.locator('.grid-board .tile-label').allTextContents()
    const press = async () => {
      await page.keyboard.press('Space')
      await page.waitForTimeout(550)
    }
    const waitForCursor = async (label) => {
      await page.waitForFunction(
        (expected) => document.querySelector('.tile.scanning .tile-label')?.textContent === expected,
        label,
        { timeout: 8000 },
      )
    }
    const select = async (label) => {
      await waitForCursor(label)
      await press()
    }

    await select('緊急')
    const urgentLabels = await labels()
    if (urgentLabels[0] !== '戻る' || urgentLabels.includes('緊急') || urgentLabels.length < 2) {
      failures.push(
        '[navigation] urgentDetail must start with Back and contain details without a duplicate Emergency tile',
      )
    }
    await page.waitForFunction(
      () => document.querySelector('.emergency-status-message')?.textContent?.includes('緊急です'),
      null,
      { timeout: 5000 },
    )
    await select('戻る')
    if ((await labels())[0] !== '緊急')
      failures.push('[navigation] urgentDetail Back did not return to home')
    if (!(await page.locator('.emergency-status-message').count())) {
      failures.push('[navigation] emergency state was cleared when returning from urgentDetail')
    }
    await select('緊急')
    await select('苦しい')
    if (!((await page.locator('.emergency-details').textContent()) ?? '').includes('苦しい')) {
      failures.push('[navigation] selected emergency detail was not retained')
    }

    // 通常下位 ScreenId は、スキャン選択で実際に入り、戻るを選んで直前の親メニューへ戻る。
    // 親のタイル構成を遷移前に保存し、見出しが同じ画面(discomfort / discomfortOther等)も区別する。
    const routes = [
      ['discomfort', ['不快']],
      ['discomfortOther', ['不快', 'その他']],
      ['painLocation', ['不快', '痛い']],
      ['painIntensity', ['不快', '痛い', '頭']],
      ['moodRequest', ['快・要望']],
      ['requests', ['快・要望', '要望']],
      ['feelings', ['快・要望', '気分']],
      ['letters', ['文字盤']],
      ['lettersRow', ['文字盤', 'あ行']],
      ['lettersYesNo', ['文字盤', 'はい・いいえ']],
      ['morse', ['モールス']],
    ]
    for (const [screen, path] of routes) {
      let parentLabels = []
      for (let index = 0; index < path.length; index += 1) {
        if (index === path.length - 1) parentLabels = await labels()
        await select(path[index])
      }
      if (screen === 'morse') {
        // モールスは入力画面に戻るタイルを表示しない専用入力モード。定義済みの
        // 「・を5回 → 待つ」復帰操作が親(home)へ戻ることを確認する。
        for (let dot = 0; dot < 5; dot += 1) {
          await page.keyboard.down('Space')
          await page.waitForTimeout(100)
          await page.keyboard.up('Space')
          await page.waitForTimeout(150)
        }
        await page.waitForTimeout(1600)
        if (await page.locator('.morse-panel').count()) {
          failures.push('[navigation] morse return operation did not leave morse screen')
        }
        if (!(await page.locator('.emergency-status-message').count())) {
          failures.push('[navigation] emergency state was cleared while returning from morse')
        }
        if (!((await page.locator('.emergency-details').textContent()) ?? '').includes('苦しい')) {
          failures.push('[navigation] emergency detail was cleared while returning from morse')
        }
        continue
      }

      const childLabels = await labels()
      if (childLabels[0] !== '戻る') {
        failures.push(`[navigation] ${screen} does not expose Back as its first item`)
        continue
      }
      if (screen !== 'urgentDetail' && childLabels[1] !== '緊急') {
        failures.push(`[navigation] ${screen} does not expose Emergency as its second item`)
      }
      await select('戻る')
      const actualParentLabels = await labels()
      if (JSON.stringify(actualParentLabels) !== JSON.stringify(parentLabels)) {
        failures.push(
          `[navigation] ${screen} Back did not return to its immediate parent: ${JSON.stringify(actualParentLabels)}`,
        )
      }
      if (!(await page.locator('.emergency-status-message').count())) {
        failures.push(`[navigation] emergency state was cleared after backing out of ${screen}`)
      }
      if (!((await page.locator('.emergency-details').textContent()) ?? '').includes('苦しい')) {
        failures.push(`[navigation] emergency detail was cleared after backing out of ${screen}`)
      }

      // 各ケースの開始位置をhomeへ戻す。親から戻る操作も同じ実入力で行う。
      while ((await labels())[0] !== '緊急') await select('戻る')
    }
  } catch (error) {
    failures.push(`[navigation] ${error.message.split('\n')[0]}`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return failures
}

/**
 * PR#16 3巡目 must-3: 文字サイズ設定(標準/大/特大)を上げたときに、タイルのラベル文字が
 * 逆に縮むことがないか(単調性: 標準 ≤ 大 ≤ 特大)を、6画面サイズ × 6画面で確認する。
 * 「見出しの拡大→メッセージ欄が伸びる→格子が縮む→列数反転→タイルの文字が逆に縮む」
 * という連鎖(3巡目で発覚した新規must)の再発を防ぐための回帰チェック。
 * ?dev の数字キー直接ジャンプ(App.tsx: showDevNumbers時のみ有効)で画面へ移動する。
 */
async function checkFontSizeMonotonicity(chromium, port) {
  const base = `http://localhost:${port}/?dev`
  const server = await startServer(DIST_DIR, 'plain', port)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const failures = []

  // ホーム(緊急/はい/いいえ/不快/快要望/文字盤)から数字キーで各画面へ直接ジャンプする。
  // インデックスは menus.ts の並び(先頭は常に緊急)に対応する
  const VPS = [
    [320, 568],
    [390, 844],
    [844, 390],
    [768, 1024],
    [1024, 768],
    [1280, 720],
  ]
  const FONTS = ['standard', 'large', 'xlarge']
  // PR#16 4巡目 should-b: ホーム＋取り消し(伝達直後の1周だけ出る取り消しボタン)・
  // 痛い(不快→痛い、部位選択画面)・緊急中ホーム(緊急詳細を5件積んでホームへ戻った
  // 状態、emergencyActive のまま)を追加
  const SCREENS = [
    ['home', []],
    ['home+undo', ['3']],
    ['discomfort', ['4']],
    ['discomfortOther', ['4', '8']],
    ['moodRequest', ['5']],
    ['requests', ['5', '7']],
    ['feelings', ['5', '8']],
    ['pain', ['4', '3']],
    ['painIntensity', ['4', '3', '4']],
    ['urgentDetail', ['1']],
    ['emerg5(緊急中ホーム)', ['1', '3', '1', '4', '1', '5', '1', '6', '1', '7']],
    ['letters', ['6']],
    ['letters-a', ['6', '2']],
  ]
  // PR#16 4巡目 must-F: --tile-label-font の絶対下限(clamp() の最小値、1.05rem)。
  // セルが小さすぎて label-ratio を上げても既にこの下限に張り付いている場合、
  // 「特大 ≥ 標準×1.15」の判定は意味を持たない(除外する)
  const LABEL_FLOOR_PX = 1.05 * 16

  try {
    for (const [vw, vh] of VPS) {
      for (const [screenName, keys] of SCREENS) {
        let prevSize = null
        let prevFont = ''
        let standardSize = null
        for (const font of FONTS) {
          const context = await browser.newContext({ viewport: { width: vw, height: vh } })
          const page = await context.newPage()
          await page.addInitScript(
            (settings) => window.localStorage.setItem('libra', JSON.stringify(settings)),
            { fontSize: font, intervalMs: 5000 },
          )
          await page.goto(base)
          await page.waitForTimeout(200)
          for (const key of keys) {
            await page.keyboard.press(key)
            await page.waitForTimeout(80)
          }
          await page.waitForTimeout(150)
          // BIZ UDPGothic(日本語, 数百KB〜1.7MB)の読み込み前はフォールバックフォントで
          // 描画され、行送り・折返しが変わってラベル/見出しの高さが一時的にずれることが
          // ある。document.fonts.ready を待たないと、この読み込みタイミングのブレだけで
          // 誤って「文字サイズを上げたら縮んだ」と判定してしまう(実際のUIロジックの
          // バグではない)
          await page.evaluate(() => document.fonts.ready)
          // .audio-status-hint(警告音停止中表示)は AudioContext が resume 完了する
          // (最大500msごとのポーリングで検知)までの間だけ一時的に出る。PR#16 4巡目
          // nit-b でこの表示枠の幅を常に確保するようにしたため、表示の有無で
          // レイアウトが変わることは無くなったが、念のため待機も残しておく
          await page
            .waitForSelector('.audio-status-hint', { state: 'detached', timeout: 1200 })
            .catch(() => {})
          // PR#16 4巡目 should-b: 1つのラベルだけでなく、画面上の全 .tile-label の
          // 最小値で比較する(should-cのラベルサイズ統一が崩れた場合も検知できるように)
          const size = await page.evaluate(() => {
            const labels = [...document.querySelectorAll('.tile-label')].map((el) =>
              parseFloat(getComputedStyle(el).fontSize),
            )
            return labels.length > 0 ? Math.min(...labels) : null
          })
          if (font === 'standard') standardSize = size
          if (size != null && prevSize != null && size < prevSize - 0.1) {
            failures.push(
              `[monotonic ${vw}x${vh} ${screenName}] ${prevFont}=${prevSize.toFixed(1)}px > ${font}=${size.toFixed(1)}px(文字サイズを上げたのにラベルが縮んだ)`,
            )
          }
          // PR#16 4巡目 should-b: セルの上限(絶対下限floor)に張り付いていない限り、
          // 特大は標準の1.15倍以上になるべき(--label-ratio は標準0.8→特大1.0で
          // 1.25倍差になる設計。1.15はその下に余裕を持たせた下限値)
          if (font === 'xlarge' && size != null && standardSize != null) {
            const atFloor = standardSize <= LABEL_FLOOR_PX + 0.5
            if (!atFloor && size < standardSize * 1.15 - 0.1) {
              failures.push(
                `[ratio ${vw}x${vh} ${screenName}] 標準=${standardSize.toFixed(1)}px 特大=${size.toFixed(1)}px(1.15倍未満、セル上限張り付きでもない)`,
              )
            }
          }
          prevSize = size
          prevFont = font
          await context.close()
        }
      }
    }

    // 見出し(h1)のサイズが、文字サイズ設定の影響を受けないことを確認する
    // (3巡目 must-1: h1 は --font-scale の対象外に戻した)。基準値は旧来の式(clamp の上限側)で、
    // Issue #22 の 1 行フィットは「収まらないときだけ」これより縮めるので、
    // 基準値の 0.9〜1.0 倍に収まり、かつ標準/大/特大で同じサイズであることを見る
    const oldH1Expected = [
      { vw: 1024, vh: 768, px: 53.76 },
      { vw: 768, vh: 1024, px: 71.68 },
      { vw: 390, vh: 844, px: 38.4 },
    ]
    for (const { vw, vh, px } of oldH1Expected) {
      const sizes = []
      for (const font of FONTS) {
        const context = await browser.newContext({ viewport: { width: vw, height: vh } })
        const page = await context.newPage()
        await page.addInitScript(
          (settings) => window.localStorage.setItem('libra', JSON.stringify(settings)),
          { fontSize: font, intervalMs: 5000 },
        )
        await page.goto(base)
        await page.waitForTimeout(200)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(250)
        sizes.push(
          await page.evaluate(() =>
            parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
          ),
        )
        await context.close()
      }
      if (sizes[0] > px + 0.5 || sizes[0] < px * 0.9) {
        failures.push(
          `[h1-baseline ${vw}x${vh}] h1=${sizes[0].toFixed(2)}px(期待 ${px * 0.9}〜${px}px、旧来の式からずれている)`,
        )
      }
      if (sizes.some((size) => Math.abs(size - sizes[0]) > 0.1)) {
        failures.push(
          `[h1-baseline ${vw}x${vh}] h1 のサイズが文字サイズ設定で変わる(${sizes.map((x) => x.toFixed(2)).join(' / ')})`,
        )
      }
    }

    // PR#16 5巡目 must-G: cqi/cqb係数をブレークポイントごとに戻し、--label-ratioを
    // 標準0.85/大0.93/特大1.0にした後、標準時のラベルサイズが後退していないかを
    // 具体的な下限値で確認する。実測値(このコミット時点)を基準に、4巡目で発生した
    // 22〜28%縮小(390x844で22.0px等)へ戻ったら検知できるよう、実測よりわずかに
    // 低い値を下限にする(rendering jitter の許容と、回帰検知の両立)
    const standardLabelMinimums = [
      // 実測23.33px(4巡目の回帰値は22.0px)
      { vw: 390, vh: 844, screenName: 'home', keys: [], minPx: 23 },
      { vw: 390, vh: 844, screenName: 'discomfort', keys: ['4'], minPx: 23 },
      // 実測41.17px
      { vw: 768, vh: 1024, screenName: 'home', keys: [], minPx: 34 },
      // 実測28.79px
      { vw: 1024, vh: 768, screenName: 'discomfort', keys: ['4'], minPx: 27 },
    ]
    for (const { vw, vh, screenName, keys, minPx } of standardLabelMinimums) {
      const context = await browser.newContext({ viewport: { width: vw, height: vh } })
      const page = await context.newPage()
      await page.addInitScript(
        (settings) => window.localStorage.setItem('libra', JSON.stringify(settings)),
        { fontSize: 'standard', intervalMs: 5000 },
      )
      await page.goto(base)
      await page.waitForTimeout(200)
      for (const key of keys) {
        await page.keyboard.press(key)
        await page.waitForTimeout(80)
      }
      await page.waitForTimeout(150)
      await page.evaluate(() => document.fonts.ready)
      const size = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.tile-label')].map((el) =>
          parseFloat(getComputedStyle(el).fontSize),
        )
        return labels.length > 0 ? Math.min(...labels) : null
      })
      if (size != null && size < minPx - 0.1) {
        failures.push(
          `[standard-label-min ${vw}x${vh} ${screenName}] 標準=${size.toFixed(2)}px(下限 ${minPx}px を下回った)`,
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

  console.log(`--- checking: heading-fit (port ${port}) ---`)
  const headingFitFailures = await checkHeadingFit(chromium, port)
  if (headingFitFailures.length === 0) {
    console.log('[heading-fit] OK')
  } else {
    headingFitFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...headingFitFailures)
  port += 1

  console.log(`--- checking: xlarge-fit (port ${port}) ---`)
  const xlargeFitFailures = await checkLabelsFitAtXlarge(chromium, port)
  if (xlargeFitFailures.length === 0) {
    console.log('[xlarge-fit] OK')
  } else {
    xlargeFitFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...xlargeFitFailures)
  port += 1

  console.log(`--- checking: font-size-monotonic (port ${port}) ---`)
  const monotonicFailures = await checkFontSizeMonotonicity(chromium, port)
  if (monotonicFailures.length === 0) {
    console.log('[font-size-monotonic] OK')
  } else {
    monotonicFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...monotonicFailures)
  port += 1

  console.log(`--- checking: back-navigation-and-emergency-retention (port ${port}) ---`)
  const navigationFailures = await checkBackNavigationAndEmergencyRetention(chromium, port)
  if (navigationFailures.length === 0) {
    console.log('[back-navigation-and-emergency-retention] OK')
  } else {
    navigationFailures.forEach((f) => console.error(f))
  }
  allFailures.push(...navigationFailures)

  if (allFailures.length > 0) {
    console.error(`\n${allFailures.length} 件失敗した`)
    process.exitCode = 1
  } else {
    console.log('\nすべてのモードでオフライン起動(reload・ディープリンク)を確認した')
  }
}

main()
