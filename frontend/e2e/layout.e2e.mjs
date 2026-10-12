#!/usr/bin/env node
// レイアウト(寸法・重なり・はみ出し・スクロール)の e2e。実描画の computed style・矩形で測る。
//
// 事前に `npm run build` で dist/ を作っておくこと。実行方法は docs/development.md 参照。
//
// - letters-scroll: 横向き小画面で文字盤のスキャン対象が下段に来ても document がスクロールせず、h1 と対象が画面内にある
// - no-overlap: 案内領域・「介助者用」ボタンがタイルと重ならない
// - heading-fit / xlarge-fit / font-size-monotonic: 見出し・ラベルが収まり、文字サイズが単調に効く
// - issue37-small-viewport / tight-labels-and-ring / preview-two-lines-overlap / morse-legend-fit: 狭い画面・緊急・プレビューの崩れ

import { launchBrowser, runChecks, startServer } from './lib.mjs'

/**
 * PR#11 再レビュー must-C: orientation:any(縦横両対応)の横向き小画面で、文字盤画面の
 * スキャン対象が下段に来ても、document 自体はスクロールせず(window.scrollY===0)、
 * メッセージパネル(h1、緊急表示を含む)がビューポート内にあり続け、かつスキャン対象の
 * タイル自体もビューポート内にあることを確認する。
 */
async function checkLettersScrollLayout(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
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

      // home: index6 = 文字盤(先頭待機2000ms、以降intervalMs=1500ごとに進む)
      await page.waitForTimeout(2000 + 5 * 1500 + 150)
      await page.keyboard.press('Space')
      await page.waitForTimeout(200)

      // letters screen(2 段階文字盤の行段階): 戻る,緊急,あ〜わ行,確定,1字消す(Issue #95 で はい・いいえ を削除)。
      // 確定は末尾ではないので、ラベルから位置を引く
      const commitIndex = await page.evaluate(() =>
        [...document.querySelectorAll('.grid-board .tile')].findIndex(
          (tile) => tile.querySelector('.tile-label')?.textContent === '確定',
        ),
      )
      await page.waitForTimeout(2000 + (commitIndex - 1) * 1500 + 150)

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
 * kako-jun 追加指示: 「介助者用」ボタンは position:fixed をやめ、
 * メッセージ欄右上(.message-panel-controls)へ移した。下部の帯(約130px)は廃止し、
 * タイル領域は画面下端まで使う。このチェックは新配置で以下を確認する:
 * - メッセージ文字(h1)と介助ボタンが重ならない
 * - タイル領域(grid-board)が介助ボタンと重ならない
 *   (overflow:auto でスクロールアウトしている、実際には描画されていないタイルは対象外)
 */
async function checkNoOverlapWithFixedControls(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
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
      const rectOf = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
      return {
        board: rectOf(board),
        h1: rectOf(h1),
        button: rectOf(button),
        tiles: [...document.querySelectorAll('.grid-board .tile')].map((t) => rectOf(t)),
      }
    })
    if (info.h1 && info.button && rectsOverlap(info.h1, info.button)) {
      failures.push(
        `[overlap ${name} ${screenLabel}] メッセージ文字(h1)が「介助者用」ボタンと重なっている`,
      )
    }
    for (const tile of info.tiles) {
      if (info.board && !rectsOverlap(tile, info.board)) continue // スクロールアウトしている
      if (info.button && rectsOverlap(tile, info.button)) {
        failures.push(`[overlap ${name} ${screenLabel}] タイルが「介助者用」ボタンと重なっている`)
      }
    }
  }

  try {
    for (const [name, width, height] of viewports) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      await page.goto(base)
      await page.waitForTimeout(700)
      await checkScreen(page, name, 'home')

      // home: index6 = 文字盤(先頭待機2000ms、以降intervalMs=1500ごとに進む)
      await page.waitForTimeout(2000 + 5 * 1500 + 150)
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
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
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
      if (emergency.text !== '緊急です。来てください。') {
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
 * 固定格子(gridLayout.ts)・container-type:size + cqb clamp・overflow:hiddenの
 * 3段構えの対策がすべて外れた場合にここで検知する。
 */
async function checkLabelsFitAtXlarge(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []

  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await page.addInitScript(
        (settings) => window.localStorage.setItem('libra', JSON.stringify(settings)),
        { intervalMs: 5000, headHoldMultiplier: 1, fontSize: 'xlarge', theme },
      )
      await page.goto(base)
      await page.waitForTimeout(300)
      // home: index4 = 不快(先頭待機は倍率1×intervalMs=5000ms、以降intervalMs=5000msごとに進む。
      // addInitScriptで intervalMs を伸ばし、タイミングのブレでずれないようにしている。
      // 先頭待機は倍率の既定に依存させないため倍率1を明示する。Issue #92)
      await page.waitForTimeout(5000 + 3 * 5000 + 200)
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      // 押した項目が実際に不快で、不快画面を検査していること(別の画面を見ていないこと)
      const crumbText = await page.evaluate(
        () => document.querySelector('.screen-breadcrumb')?.textContent ?? '',
      )
      if (!crumbText.includes('不快')) {
        failures.push(
          `[xlarge-fit 390x844 ${theme} discomfort] 不快画面を開けていない(パンくず="${crumbText}")`,
        )
      }

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
      // PR#16 再レビュー must-A/B: 8項目以下(この画面=不快、8項目)の画面は、文字サイズが
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

/**
 * PR#16 3巡目 must-3: 文字サイズ設定(標準/大/特大)を上げたときに、タイルのラベル文字が
 * 逆に縮むことがないか(単調性: 標準 ≤ 大 ≤ 特大)を、6画面サイズ × 6画面で確認する。
 * 「見出しの拡大→メッセージ欄が伸びる→格子が縮む→列数反転→タイルの文字が逆に縮む」
 * という連鎖(3巡目で発覚した新規must)の再発を防ぐための回帰チェック。
 * ?dev の数字キー直接ジャンプ(App.tsx: showDevNumbers時のみ有効)で画面へ移動する。
 */
async function checkFontSizeMonotonicity(chromium, port) {
  const base = `http://localhost:${port}/?dev`
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []

  // ホーム(緊急/はい/いいえ/快/不快/要望/文字盤)から数字キーで各画面へ直接ジャンプする。
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
    ['discomfort', ['5']],
    ['discomfortOther', ['5', '8']],
    ['comfort', ['4']],
    ['requests', ['6']],
    ['feelings', ['4', '6']],
    ['pain', ['5', '3']],
    ['painIntensity', ['5', '3', '4']],
    ['urgentDetail', ['1']],
    ['emerg5(緊急中ホーム)', ['1', '3', '1', '4', '1', '5', '1', '6', '1', '7']],
    ['letters', ['7']],
    ['letters-a', ['7', '2']],
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
    // この表は標準コントラストだけの下限。高コントラストの同等性(標準と同じ大きさ)と、
    // 短い画面の下限(13px)・枠の帯への食い込み0は、別の checkTightScreenLabelsAndRing
    // で検査する(高コントラストの別下限は設けない。標準と等しいことを直接比較する)。
    const standardLabelMinimums = [
      // 実測21.80px。Issue #47 で縦長が 2列×4行の固定格子になり(従来は項目数に応じて3行)、
      // Issue #34 でスキャン枠の厚みぶん余白を取るためセルが低くなった結果。
      // 4巡目の回帰値(22.0px)より下だが、固定格子の仕様上の値なので新しい実測を基準にする
      { vw: 390, vh: 844, screenName: 'home', keys: [], minPx: 21 },
      { vw: 390, vh: 844, screenName: 'discomfort', keys: ['5'], minPx: 21 },
      // 実測41.17px
      { vw: 768, vh: 1024, screenName: 'home', keys: [], minPx: 34 },
      // 実測28.79px
      { vw: 1024, vh: 768, screenName: 'discomfort', keys: ['5'], minPx: 27 },
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
      // 数字キーが意図した画面(不快)を開いたことを確かめる(快と取り違えると別の画面を検査してしまう)
      const crumb = await page.locator('.screen-breadcrumb').textContent()
      const expectedCrumb = screenName === 'home' ? 'ホーム' : '不快'
      if (!(crumb ?? '').trim().endsWith(expectedCrumb)) {
        failures.push(
          `[standard-label-min ${vw}x${vh} ${screenName}] 想定外の画面を検査している(パンくず: ${crumb})`,
        )
      }
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

/** Issue #37: 小画面で深いパンくずがグリッド領域を押しつぶさず、重ならない。 */
async function checkIssue37SmallViewport(chromium, port) {
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []

  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } })
    await page.addInitScript(() => {
      localStorage.setItem(
        'libra',
        JSON.stringify({ intervalMs: 400, headHoldMultiplier: 1, fontSize: 'xlarge' }),
      )
    })
    await page.goto(`http://localhost:${port}/`)
    const select = async (label) => {
      await page.waitForFunction(
        (expected) =>
          document.querySelector('.tile.scanning .tile-label')?.textContent === expected,
        label,
        { timeout: 10000 },
      )
      await page.keyboard.press('Space')
      await page.waitForTimeout(600)
    }
    const checkLayout = async (caseName) => {
      const result = await page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector)
          if (!element || getComputedStyle(element).display === 'none') return null
          const { x, y, width, height, bottom, right } = element.getBoundingClientRect()
          return { x, y, width, height, bottom, right }
        }
        const guide = rect('.screen-guide')
        const accepted = document.querySelector('.selection-confirmation')
        const board = rect('.grid-board')
        const tiles = [...document.querySelectorAll('.grid-board .tile')].map((tile) => {
          const { x, y, width, height, bottom, right } = tile.getBoundingClientRect()
          return { x, y, width, height, bottom, right }
        })
        return {
          guide,
          accepted: Boolean(accepted),
          board,
          tiles,
          viewport: { width: innerWidth, height: innerHeight },
        }
      })
      if (!result.guide || !result.board) {
        failures.push(`[${caseName}] guide or grid is missing`)
        return
      }
      if (result.accepted) {
        failures.push(`[${caseName}] the removed selection strip (#75) is rendered`)
      }
      if (result.guide.bottom > result.board.y) {
        failures.push(`[${caseName}] breadcrumb overlaps the tile grid`)
      }
      if (result.board.height < 100 || result.board.bottom > result.viewport.height + 1) {
        failures.push(`[${caseName}] tile grid is compressed or extends below the viewport`)
      }
      if (
        result.tiles.some(
          (tile) => tile.width <= 0 || tile.height <= 0 || tile.bottom > result.viewport.height + 1,
        )
      ) {
        failures.push(`[${caseName}] one or more tiles are clipped or outside the viewport`)
      }
    }

    await select('不快')
    await select('痛い')
    await select('胸')
    const painPath = await page.locator('.screen-breadcrumb li').allTextContents()
    if (JSON.stringify(painPath) !== JSON.stringify(['ホーム', '不快', '胸', '痛みの強さ'])) {
      failures.push(`[painIntensity] incorrect breadcrumb: ${JSON.stringify(painPath)}`)
    }
    await checkLayout('painIntensity')

    await select('戻る')
    await select('戻る')
    await select('戻る')
    await select('文字盤')
    await select('あ行')
    const rowPath = await page.locator('.screen-breadcrumb li').allTextContents()
    if (JSON.stringify(rowPath) !== JSON.stringify(['ホーム', '文字盤', 'あ行', '文字盤・文字'])) {
      failures.push(`[lettersRow] incorrect breadcrumb: ${JSON.stringify(rowPath)}`)
    }
    await checkLayout('lettersRow')
  } catch (error) {
    failures.push(`[issue37-small-viewport] ${error.message.split('\n')[0]}`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return failures
}

/**
 * Issue #34: ラベルは縮めず(下限 13px)、2行ラベルも枠の帯(--scan-ring-inset)へ食い込ませない。
 * ① 568x320・高コントラスト+案内帯最大(最小押下0.5秒/聴覚スキャン/音声full/離して決定)・
 *    緊急+伝達メッセージ表示中の8項目画面(不快): 文字が枠の帯に入らない、ラベル最小px >= 13
 * ② 390x844 home: 高コントラストのON/OFFでラベルpxが等しい(高コントラストで標準より小さくならない)
 * 設定が実際に効いている(data-high-contrast 等)ことも検査し、効いていない測定を通さない。
 */
async function checkTightScreenLabelsAndRing(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []
  const MIN_LABEL_PX = 13
  const maxNotes = {
    minHoldMs: 500,
    auditoryScan: true,
    voiceMode: 'full',
    activateOn: 'release',
  }

  const open = async (viewport, settings) => {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.addInitScript(
      (value) => {
        window.localStorage.removeItem('libra:emergency')
        window.localStorage.setItem('libra', JSON.stringify(value))
      },
      { intervalMs: 5000, morseEnabled: true, ...settings },
    )
    await page.goto(base)
    await page.waitForTimeout(300)
    const applied = await page.evaluate(() => ({
      highContrast: document.documentElement.dataset.highContrast,
      fontSize: document.documentElement.dataset.fontSize,
    }))
    if (
      applied.highContrast !== String(settings.highContrast ?? false) ||
      applied.fontSize !== (settings.fontSize ?? 'standard')
    ) {
      failures.push(`[tight] 設定が反映されていない ${JSON.stringify(applied)}`)
    }
    return { context, page }
  }
  // 離して決定 + 最小押下時間のため、長めに押して離す
  const hold = async (page, label) => {
    const tile = page
      .locator('.grid-board .tile')
      .filter({ has: page.getByText(label, { exact: true }) })
      .first()
    const box = await tile.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.waitForTimeout(900)
  }
  const labelMinPx = (page) =>
    page.evaluate(() =>
      Math.min(
        ...[...document.querySelectorAll('.grid-board .tile .tile-label')].map((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        ),
      ),
    )

  try {
    // ①(緊急詳細を1つだけ選んだ場合と、5件すべて選んだ場合。後者は緊急帯の詳細が最も長い)
    const emergencyPaths = [
      ['緊急', '苦しい', '不快', '痰を取ってほしい', '不快'],
      [
        ...['苦しい', '痛い', '息ができない', '吐きそう', '胸が痛い'].flatMap((d) => ['緊急', d]),
        '不快',
        '痰を取ってほしい',
        '不快',
      ],
    ]
    for (const path of emergencyPaths) {
      const { context, page } = await open(
        { width: 568, height: 320 },
        { fontSize: 'standard', highContrast: true, ...maxNotes },
      )
      for (const label of path) await hold(page, label)
      const result = await page.evaluate(() => {
        const ringW = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--scan-ring-width'),
        )
        const inset = 4 + ringW + 2
        let worst = 0
        const tiles = [...document.querySelectorAll('.grid-board .tile')]
        for (const tile of tiles) {
          const tr = tile.getBoundingClientRect()
          for (const sel of ['.tile-label', '.tile-detail', '.tile-preview', '.tile-chevron']) {
            const el = tile.querySelector(sel)
            if (!el) continue
            const range = document.createRange()
            range.selectNodeContents(el)
            const r =
              sel === '.tile-chevron' ? el.getBoundingClientRect() : range.getBoundingClientRect()
            const left = sel === '.tile-preview' ? el.getBoundingClientRect().left : r.left
            const right = sel === '.tile-preview' ? el.getBoundingClientRect().right : r.right
            worst = Math.max(
              worst,
              tr.left + inset - left,
              right - (tr.right - inset),
              tr.top + inset - r.top,
              r.bottom - (tr.bottom - inset),
            )
          }
        }
        return {
          count: tiles.length,
          worst,
          emergency: !!document.querySelector('.emergency-status'),
          emergencyHeight:
            document.querySelector('.emergency-status')?.getBoundingClientRect().height ?? 0,
          sizes: new Set(tiles.map((t) => `${t.offsetWidth}x${t.offsetHeight}`)).size,
        }
      })
      const px = await labelMinPx(page)
      if (result.count !== 8 || !result.emergency) {
        failures.push(
          `[tight 568x320] 想定の状態(緊急+8項目)に到達していない(緊急帯 ${result.emergencyHeight}px) ${JSON.stringify(result)}`,
        )
      }
      if (result.sizes !== 1) failures.push(`[tight 568x320] 全タイルが同サイズでない`)
      // 短い画面の緊急帯は、詳細が長くても1行に保つ(2行に戻るとセルが低くなる)
      if (result.emergencyHeight > 40) {
        failures.push(
          `[tight 568x320] 緊急帯が1行でない(高さ ${result.emergencyHeight.toFixed(1)}px)`,
        )
      }
      if (result.worst > 0.5) {
        failures.push(`[tight 568x320] 文字が枠の帯へ ${result.worst.toFixed(1)}px 食い込んでいる`)
      }
      if (px < MIN_LABEL_PX) {
        failures.push(`[tight 568x320] ラベル最小 ${px.toFixed(2)}px(下限 ${MIN_LABEL_PX}px 未満)`)
      }
      await context.close()
    }
    // ②(390x844 は枠9px・幅で頭打ち、768x1024 は枠9px・高さで頭打ち。補正が無いと 0.8〜1.2px 以上小さくなる。
    // 高コントラストは区切り線が太くセルが約1px低くなるため、許容は 0.5px)
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
    ]) {
      const sizes = {}
      for (const highContrast of [false, true]) {
        const { context, page } = await open(viewport, { fontSize: 'standard', highContrast })
        sizes[highContrast] = await labelMinPx(page)
        await context.close()
      }
      if (sizes[true] < sizes[false] - 0.5) {
        failures.push(
          `[tight ${viewport.width}x${viewport.height} home] 高コントラストで標準より小さい(標準 ${sizes[false].toFixed(2)}px / 高コントラスト ${sizes[true].toFixed(2)}px)`,
        )
      }
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return failures
}

/**
 * Issue #71: 予告(.tile-preview)が2行モードのセルで、遷移タイルの「ラベルの行矩形」「予告の行矩形」
 * 「山形アイコン(.tile-chevron)の矩形」が互いに交差しないことを検査する(Range.getClientRects() の
 * 文字の行矩形で測る。要素矩形ではない)。予告は全幅を使い、2行モードでは山形アイコンの方を
 * 予告の上端より上へ寄せる(Issue #82)。その寄せを外すと、2行目が出た予告の1行目が右端の
 * アイコンの列へ届いて落ちる。
 * 検査した状態に2行モードの遷移タイルが1つも無いと、検査が空振りなので失敗にする。
 */
async function checkTilePreviewTwoLineOverlap(chromium, port) {
  const base = `http://localhost:${port}/`
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []
  const maxNotes = { minHoldMs: 500, auditoryScan: true, voiceMode: 'full', activateOn: 'release' }
  const fivePath = [
    ...['苦しい', '痛い', '息ができない', '吐きそう', '胸が痛い'].flatMap((d) => ['緊急', d]),
    '不快',
    '痰を取ってほしい',
    '不快',
  ]
  // [名前, viewport, 設定, 押すタイルの列, 最後に「戻る」でホームへ戻るか]
  const cases = [
    [
      '390x844 特大 高コントラスト 緊急詳細5件+伝達 ホーム',
      { width: 390, height: 844 },
      { fontSize: 'xlarge', highContrast: true, ...maxNotes },
      fivePath,
      true,
    ],
    ['320x480 特大 ホーム', { width: 320, height: 480 }, { fontSize: 'xlarge' }, [], false],
    ['320x568 標準 ホーム', { width: 320, height: 568 }, { fontSize: 'standard' }, [], false],
    [
      '844x390 特大 高コントラスト 緊急詳細5件+伝達 不快',
      { width: 844, height: 390 },
      { fontSize: 'xlarge', highContrast: true, ...maxNotes },
      fivePath,
      false,
    ],
  ]
  const hold = async (page, label) => {
    const tile = page
      .locator('.grid-board .tile')
      .filter({ has: page.getByText(label, { exact: true }) })
      .first()
    const box = await tile.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.waitForTimeout(900)
  }
  try {
    for (const [name, viewport, settings, path, goHome] of cases) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      await page.addInitScript(
        (value) => {
          window.localStorage.removeItem('libra:emergency')
          window.localStorage.setItem('libra', JSON.stringify(value))
        },
        { intervalMs: 60000, morseEnabled: true, ...settings },
      )
      await page.goto(base)
      await page.waitForTimeout(300)
      for (const label of path) await hold(page, label)
      if (goHome) await hold(page, '戻る')
      // BIZ UDPGothic の読み込み前は代替フォントで折り返しが変わるので、測定の直前に待つ
      await page.evaluate(() => document.fonts.ready)
      const result = await page.evaluate(() => {
        // 見えている行だけ: 要素の箱の外(-webkit-line-clamp で隠れた行)は除き、箱でクリップする
        const lines = (el) => {
          const r = document.createRange()
          r.selectNodeContents(el)
          const box = el.getBoundingClientRect()
          return [...r.getClientRects()]
            .filter(
              (x) =>
                x.width > 0 &&
                x.height > 0 &&
                x.top >= box.top - 0.5 &&
                x.bottom <= box.bottom + 0.5,
            )
            .map((x) => ({
              left: Math.max(x.left, box.left),
              right: Math.min(x.right, box.right),
              top: x.top,
              bottom: x.bottom,
            }))
        }
        const hit = (a, b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.01 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.01
        const out = { twoLine: 0, nav: 0, bad: [] }
        for (const tile of document.querySelectorAll('.grid-board .tile-nav')) {
          const label = tile.querySelector('.tile-label')
          const preview = tile.querySelector('.tile-preview')
          const chevron = tile.querySelector('.tile-chevron')
          if (!label || !preview || !chevron) continue
          out.nav += 1
          // 2行モード = @container 内で white-space: normal になっている(display は flow-root と報告される)
          if (getComputedStyle(preview).whiteSpace !== 'normal') continue
          out.twoLine += 1
          const c = chevron.getBoundingClientRect()
          const ll = lines(label)
          const pl = lines(preview)
          const name = label.textContent
          if (pl.some((p) => hit(p, c))) out.bad.push(`${name}: 予告の行とアイコン`)
          if (ll.some((l) => hit(l, c))) out.bad.push(`${name}: ラベルの行とアイコン`)
          if (ll.some((l) => pl.some((p) => hit(l, p))))
            out.bad.push(`${name}: ラベルの行と予告の行`)
        }
        return out
      })
      if (result.twoLine === 0) {
        failures.push(
          `[preview-two-lines ${name}] 2行モードの遷移タイルが無い(検査が空振り) ${JSON.stringify(result)}`,
        )
      }
      for (const b of result.bad) failures.push(`[preview-two-lines ${name}] 行矩形が交差 ${b}`)
      await context.close()
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return failures
}

// Issue #46/#57: モールス凡例(.morse-legend)が固定パネル(.morse-panel, overflow:hidden)の中に
// 収まり、文字が切れないことを実描画で確認する。本人はスクロールできないため全項目が見える必要がある。
// 句点・符号の注記で行が増えても、高コントラスト+緊急中+押下時間の下限あり(凡例が最も多い)でも
// 下端に余白(3px以上)が残り、パネルがはみ出し(scrollHeight>clientHeight)ていないことを測る。
async function checkMorseLegendFit(chromium, port) {
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []
  const viewports = [
    [568, 320],
    [844, 390],
    [667, 375],
    [320, 568],
    [390, 844],
  ]
  try {
    for (const [width, height] of viewports) {
      for (const highContrast of [false, true]) {
        for (const emergency of [false, true]) {
          const name = `${width}x${height} ${highContrast ? 'HC' : 'normal'} ${emergency ? 'emergency' : 'calm'}`
          const context = await browser.newContext({ viewport: { width, height } })
          const page = await context.newPage()
          await page.addInitScript(
            (settings) => window.localStorage.setItem('libra', JSON.stringify(settings)),
            {
              intervalMs: 60000,
              debounceMs: 0,
              minHoldMs: 500,
              morseEnabled: true,
              voiceMode: 'off',
              fontSize: 'xlarge',
              highContrast,
            },
          )
          await page.goto(`http://localhost:${port}/`)
          await page.waitForTimeout(300)
          // 押下時間の下限があるので、タップも下限以上押し続ける
          const hold = async (label) => {
            const tile = page
              .locator('.grid-board .tile', {
                has: page.locator('.tile-label', { hasText: new RegExp(`^${label}$`) }),
              })
              .first()
            const box = await tile.boundingBox()
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
            await page.mouse.down()
            await page.waitForTimeout(650)
            await page.mouse.up()
            await page.waitForTimeout(150)
          }
          try {
            if (emergency) {
              await hold('緊急')
              await hold('苦しい')
            }
            await hold('モールス')
            await page.waitForSelector('.morse-legend', { timeout: 3000 })
            const m = await page.evaluate(() => {
              const panel = document.querySelector('.morse-panel')
              const legend = document.querySelector('.morse-legend')
              const items = [...legend.querySelectorAll('li')]
              return {
                panelBottom: panel.getBoundingClientRect().bottom,
                legendBottom: Math.max(...items.map((li) => li.getBoundingClientRect().bottom)),
                slack: panel.scrollHeight - panel.clientHeight,
                clippedItems: items.filter((li) => li.scrollHeight > li.clientHeight + 1).length,
                viewportHeight: window.innerHeight,
                items: items.length,
              }
            })
            if (m.items < 9) failures.push(`[morse-legend ${name}] 凡例が${m.items}行しかない`)
            if (m.slack > 0) {
              failures.push(
                `[morse-legend ${name}] 固定パネルがはみ出している(scrollHeight-clientHeight=${m.slack}px)`,
              )
            }
            if (m.legendBottom > m.panelBottom - 3) {
              failures.push(
                `[morse-legend ${name}] 凡例の下端(${m.legendBottom.toFixed(1)}px)がパネル下端(${m.panelBottom.toFixed(1)}px)に余白なく接している`,
              )
            }
            if (m.panelBottom > m.viewportHeight + 1) {
              failures.push(`[morse-legend ${name}] パネルが画面外へはみ出している`)
            }
            if (m.clippedItems > 0) {
              failures.push(`[morse-legend ${name}] 文字が切れている行が${m.clippedItems}行ある`)
            }
          } catch (error) {
            failures.push(`[morse-legend ${name}] ${error.message.split('\n')[0]}`)
          }
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return failures
}

await runChecks(
  [
    { name: 'letters-scroll', run: checkLettersScrollLayout },
    { name: 'no-overlap', run: checkNoOverlapWithFixedControls },
    { name: 'heading-fit', run: checkHeadingFit },
    { name: 'xlarge-fit', run: checkLabelsFitAtXlarge },
    { name: 'font-size-monotonic', run: checkFontSizeMonotonicity },
    { name: 'issue37-small-viewport', run: checkIssue37SmallViewport },
    { name: 'preview-two-lines-overlap', run: checkTilePreviewTwoLineOverlap },
    { name: 'tight-labels-and-ring', run: checkTightScreenLabelsAndRing },
    { name: 'morse-legend-fit', run: checkMorseLegendFit },
  ],
  { basePort: 4740 },
)
