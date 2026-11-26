#!/usr/bin/env node
// 実描画フォントの e2e(Issue #156)。CDP の CSS.getPlatformFontsForNode で、実際に字を描いた書体を調べる
// (computed style の font-family は指定を返すだけで、代替書体に落ちたことは分からない)。
//
// 事前に `npm run build` で dist/ を作っておくこと。実行方法は docs/development.md 参照。
//
// - single-font: 本人画面・介助者用メニューの全タブ・入力欄(UA の shadow DOM の中の文字まで)が、
//   同梱の BIZ UDGothic だけで描かれる
// - offline-all-glyphs: オフラインの reload でも同じで、以前の同梱(japanese + latin 分割)に無かった字も
//   同梱の書体で描かれる。書体に無い字(𠮷)は別の書体になる(この検査が代替を見つけられることの確認)

import { launchBrowser, runChecks, startServer } from './lib.mjs'

const FAMILY = 'BIZ UDGothic'
// 以前の同梱に無かった字と、配布されている分割版(全分割の和)にも無い字(Ⅰ ⅰ ≒ ‾ α)
// ラベルは20字までなので2つのフレーズに分ける
const RARE = '→←⇒✓●○◎△※㎝㎖℃'
const RARE_2 = '髙﨑頰剝吞瘙搔ⅠⅰΑα≒‾'
const TABS = ['status', 'scan', 'input', 'feedback', 'display', 'phrases', 'backup', 'about']

/** 文字を直接持つ全要素(shadow DOM を含む)の実描画書体を調べ、同梱以外で描いた字があれば返す */
async function foreignFonts(page, cdp, where) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const targets = []
  const walk = (node) => {
    if (['HEAD', 'SCRIPT', 'STYLE'].includes(node.nodeName)) return
    const children = node.children ?? []
    if (node.nodeType === 1 && children.some((c) => c.nodeType === 3 && c.nodeValue.trim())) {
      targets.push(node)
    }
    for (const child of [...children, ...(node.shadowRoots ?? [])]) walk(child)
  }
  walk(root)
  const failures = []
  let glyphs = 0
  for (const node of targets) {
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })
    for (const font of fonts) {
      glyphs += font.glyphCount
      if (font.familyName !== FAMILY || !font.isCustomFont) {
        failures.push(
          `[${where}] <${node.nodeName.toLowerCase()}> の ${font.glyphCount} 字が ${font.familyName}(同梱=${font.isCustomFont})で描かれた`,
        )
      }
    }
  }
  if (glyphs === 0) failures.push(`[${where}] 描かれた字が1つも取れていない(検査が働いていない)`)
  return failures
}

async function openPage(chromium, port, settings) {
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.route(/^https:\/\//, (route) => route.abort())
  const page = await context.newPage()
  await page.addInitScript(
    (value) => {
      if (!localStorage.getItem('libra')) localStorage.setItem('libra', value)
    },
    JSON.stringify({
      intervalMs: 5000,
      headHoldMultiplier: 5,
      debounceMs: 0,
      morseEnabled: true,
      ...settings,
    }),
  )
  const close = async () => {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return { context, page, base: `http://localhost:${port}/`, close }
}

const tap = async (page, label) => {
  await page
    .locator('.grid-board .tile')
    .filter({ has: page.locator('.tile-label', { hasText: new RegExp(`^${label}$`) }) })
    .click()
  await page.waitForTimeout(150)
}

async function attach(context, page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  return cdp
}

async function walkScreens(context, page, prefix) {
  let cdp = await attach(context, page)
  const failures = []
  const check = async (name) =>
    failures.push(...(await foreignFonts(page, cdp, `${prefix} ${name}`)))
  await check('ホーム')
  for (const path of [
    ['不快'],
    ['不快', '痛い'],
    ['不快', 'その他'],
    ['快'],
    ['快', '気分'],
    ['要望'],
    ['文字盤'],
    ['文字盤', 'か行'],
  ]) {
    for (const label of path) await tap(page, label)
    await check(path.join('→'))
    for (let i = 0; i < path.length; i += 1) await tap(page, '戻る')
  }
  // モールス画面はタイルを出さない(戻るは符号で打つ)ので、確かめたら読み込み直してホームへ戻る
  await tap(page, 'モールス')
  await check('モールス')
  await page.reload()
  await page.waitForTimeout(300)
  cdp = await attach(context, page)
  await page.locator('.caregiver-button').click()
  for (const tab of TABS) {
    await page.locator(`#caregiver-tab-${tab}`).click()
    await check(`メニュー ${tab}`)
  }
  await page.locator('#caregiver-tab-phrases').click()
  await check('メニュー phrases(入力欄)')
  await page.reload()
  await page.waitForTimeout(300)
  const after = await attach(context, page)
  await tap(page, '緊急')
  failures.push(...(await foreignFonts(page, after, `${prefix} 緊急`)))
  await tap(page, '緊急を解除')
  failures.push(...(await foreignFonts(page, after, `${prefix} 緊急を解除`)))
  return failures
}

async function checkSingleFont(chromium, port) {
  const { context, page, base, close } = await openPage(chromium, port, {})
  try {
    await page.goto(base)
    return await walkScreens(context, page, '[single-font]')
  } finally {
    await close()
  }
}

async function checkOfflineAllGlyphs(chromium, port) {
  const phrases = {
    discomfort: [
      { id: 'rare', label: RARE, text: `${RARE}です。` },
      { id: 'rare2', label: RARE_2, text: `${RARE_2}です。` },
    ],
  }
  const { context, page, base, close } = await openPage(chromium, port, {
    phrases,
    phrasesVersion: 999,
  })
  const failures = []
  const label = '[offline-all-glyphs]'
  try {
    await page.goto(base)
    await page.evaluate(() => navigator.serviceWorker.ready)
    const cached = await page.evaluate(async () => {
      const urls = []
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
      }
      return urls.filter((url) => url.endsWith('.woff2'))
    })
    if (cached.length !== 2) failures.push(`${label} precache の woff2 が2件でない: ${cached}`)
    // ブラウザの HTTP キャッシュではなく Service Worker から読むことを確かめるため、消してから切る
    const session = await context.newCDPSession(page)
    await session.send('Network.clearBrowserCache')
    await context.setOffline(true)
    await page.reload()
    await page.waitForTimeout(500)

    let cdp = await attach(context, page)
    await tap(page, '不快')
    for (const rare of [RARE, RARE_2]) {
      const shown = await page.locator('.grid-board .tile-label', { hasText: rare }).count()
      if (shown !== 1) failures.push(`${label} 珍しい字のフレーズがタイルに出ていない: ${rare}`)
    }
    failures.push(...(await foreignFonts(page, cdp, `${label} 不快`)))
    await tap(page, RARE_2)
    failures.push(...(await foreignFonts(page, cdp, `${label} 伝達後(2)`)))
    await tap(page, '不快')
    await tap(page, RARE)
    failures.push(...(await foreignFonts(page, cdp, `${label} 伝達後(1)`)))
    await page.locator('.caregiver-button').click()
    await page.locator('#caregiver-tab-phrases').click()
    const input = page.locator('.phrase-row input').first()
    if ((await input.inputValue()) !== RARE) failures.push(`${label} 入力欄に値が出ていない`)
    failures.push(...(await foreignFonts(page, cdp, `${label} 入力欄`)))

    const bold = await page.evaluate(() =>
      [...document.fonts]
        .filter((f) => f.status === 'loaded')
        .map((f) => `${f.family} ${f.weight}`),
    )
    for (const weight of ['400', '700']) {
      if (!bold.some((f) => f.includes(FAMILY) && f.endsWith(weight))) {
        failures.push(`${label} ${weight} がオフラインで読み込まれていない: ${bold}`)
      }
    }

    // 対照: 書体に無い字は代替される。これが検出できないなら、上の合格は意味を持たない
    await input.fill('𠮷')
    const control = await foreignFonts(page, cdp, `${label} 対照`)
    if (control.length === 0) failures.push(`${label} 書体に無い字の代替を検出できていない`)

    await input.fill(RARE)
    await page.reload()
    await page.waitForTimeout(500)
    cdp = await attach(context, page)
    failures.push(...(await walkScreens(context, page, `${label} 全画面`)))
  } finally {
    await close()
  }
  return failures
}

await runChecks(
  [
    { name: 'single-font', run: checkSingleFont },
    { name: 'offline-all-glyphs', run: checkOfflineAllGlyphs },
  ],
  { basePort: 4900 },
)
