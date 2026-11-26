#!/usr/bin/env node
// 実描画フォントの e2e(Issue #156)。CDP の CSS.getPlatformFontsForNode で、実際に字を描いた書体を調べる
// (computed style の font-family は指定を返すだけで、代替書体に落ちたことは分からない)。
//
// 事前に `npm run build` で dist/ を作っておくこと。実行方法は docs/development.md 参照。
//
// この e2e が保証するのは「確かめた画面の字が、別の書体で描かれていないこと」だけ。同梱の書体に字が
// あることは保証しない(代わりの書体が OS に無い字は、同梱の書体の代替字形(豆腐)で描かれ、この検査を
// 通る)。全字があることは、同梱ファイルの SHA-256 の固定(src/__tests__/SingleFont.test.ts)が担う。
//
// - single-font: 本人画面・介助者用メニューの全タブ・入力欄(UA の shadow DOM の中の文字まで)に、
//   同梱の BIZ UDGothic 以外の書体で描かれた字が無い
// - offline-all-glyphs: 2つのウェイトの woff2 が precache され、オフラインの reload でも同じ。以前の同梱
//   (japanese + latin 分割)に無かった字を入れても別の書体にならない。ライセンス全文(OFL)も precache
//   され、原本と一致する。最後に、monospace を指定した入力欄の字を検出できること(この検査が働くことの確認)

import { readFileSync } from 'node:fs'
import { launchBrowser, runChecks, startServer } from './lib.mjs'

const FAMILY = 'BIZ UDGothic'
const LICENSE_PATH = '/licenses/BIZUDGothic-OFL.txt'
const LICENSE_SOURCE = new URL('../src/assets/fonts/OFL.txt', import.meta.url)
// 以前の同梱に無かった字と、配布されている分割版(全分割の和)にも無い字(Ⅰ ⅰ ≒ ‾ α)
// ラベルは20字までなので2つのフレーズに分ける
const RARE = '→←⇒✓●○◎△※㎝㎖℃'
const RARE_2 = '髙﨑頰剝吞瘙搔𠮟ⅠⅰΑα≒‾'
const TABS = ['status', 'scan', 'input', 'feedback', 'display', 'phrases', 'backup', 'about']

/** selector の要素とその中(UA の shadow DOM を含む)の字を描いた書体の一覧 */
async function fontsInside(cdp, selector) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const matches = (node) => {
    const attributes = node.attributes ?? []
    return attributes.some((name, i) => i % 2 === 0 && name === selector)
  }
  const found = []
  const walk = (node, inside) => {
    const within = inside || matches(node)
    const children = node.children ?? []
    if (within && node.nodeType === 1 && children.some((c) => c.nodeType === 3)) found.push(node)
    for (const child of [...children, ...(node.shadowRoots ?? [])]) walk(child, within)
  }
  walk(root, false)
  const fonts = []
  for (const node of found) {
    fonts.push(...(await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })).fonts)
  }
  return fonts
}

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
    const licenseCached = await page.evaluate(
      async (path) => !!(await caches.match(path)),
      LICENSE_PATH,
    )
    if (!licenseCached) failures.push(`${label} ライセンス全文が precache に無い: ${LICENSE_PATH}`)
    // ブラウザの HTTP キャッシュではなく Service Worker から読むことを確かめるため、消してから切る
    const session = await context.newCDPSession(page)
    await session.send('Network.clearBrowserCache')
    await context.setOffline(true)
    await page.reload()
    await page.waitForTimeout(500)

    // 配信されるライセンス全文は原本そのもの(オフラインでは Service Worker の precache から返る)
    const license = await page.evaluate(async (path) => {
      const response = await fetch(path)
      return { status: response.status, text: await response.text() }
    }, LICENSE_PATH)
    if (license.status !== 200 || license.text !== readFileSync(LICENSE_SOURCE, 'utf8')) {
      failures.push(`${label} 配信のライセンス全文が原本と一致しない(status ${license.status})`)
    }

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

    // 対照: 別の書体で描いた字を、この検査が見つけられること。見つけられないなら上の合格は意味を持たない。
    // 書体に無い字を使う方法は取らない(その字を持つ書体が OS に無い環境では、同梱の書体の
    // 代替字形で描かれ、別の書体にならない。CI の実行環境がそうだった)
    await input.evaluate((el) => {
      el.setAttribute('data-font-control', '')
      el.style.fontFamily = 'monospace'
    })
    await input.fill('abc')
    await page.waitForTimeout(200)
    // 画面のほかの場所の字ではなく、この入力欄の中の字が別の書体として見えることだけを数える
    const control = await fontsInside(cdp, 'data-font-control')
    const detected = control
      .filter((font) => font.familyName !== FAMILY || !font.isCustomFont)
      .reduce((sum, font) => sum + font.glyphCount, 0)
    if (detected !== 3) {
      failures.push(
        `${label} monospace を指定した入力欄の3字を別の書体として検出できていない: ${JSON.stringify(control)}`,
      )
    }

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
