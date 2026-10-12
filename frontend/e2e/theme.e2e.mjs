#!/usr/bin/env node
// テーマ(色だけが変わる・スキャン枠)の e2e。4テーマ × 複数サイズ × 複数状態を実描画で測る。
//
// 事前に `npm run build` で dist/ を作っておくこと。実行方法は docs/development.md 参照。
//
// - scan-ring-surface: スキャン枠が黄色一本(box-shadow・::before なし)で、スキャン中の面が他のタイルと異なり赤タイルが無い(#36/#33)。
//   SCAN_RING_REPORT_DIR で画像と測定値を保存する
// - theme-parity: 明るい/夜間で同条件のラベルpx・セル寸法・案内帯高さ・寸法トークンが一致する(テーマは色だけ, #65)

import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser, runChecks, startServer } from './lib.mjs'

// Issue #36/#33: スキャン枠は黄色一本(box-shadow・::before なし)で、スキャン中のタイルの面が
// 緊急入口・通常タイルの面と異なり、赤いタイルが無いことを実描画(computed style)で確認する。
// 4テーマ(明/夜 × 高コントラスト) × 4サイズ × 6状態 × 全タイルを順にスキャン状態にして測る。
// SCAN_RING_REPORT_DIR を指定すると、スクリーンショットと測定値(rows.json)をそこへ保存する。
async function checkScanRingSurface(chromium, port) {
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []
  const reportDir = process.env.SCAN_RING_REPORT_DIR
  if (reportDir) fs.mkdirSync(path.join(reportDir, 'shots'), { recursive: true })
  const rows = []
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => {
    const x = lum(a)
    const y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const parse = (s) =>
    s
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
  const same = (a, b) => parse(a).every((v, i) => v === parse(b)[i])
  try {
    for (const [theme, hc] of [
      ['light', false],
      ['dark', false],
      ['light', true],
      ['dark', true],
    ]) {
      for (const [w, h] of [
        [390, 844],
        [568, 320],
        [844, 390],
        [320, 568],
      ]) {
        const tag = `${theme}${hc ? '-hc' : ''}_${w}x${h}`
        const fresh = async (emergency) => {
          const context = await browser.newContext({ viewport: { width: w, height: h } })
          const page = await context.newPage()
          await page.addInitScript(
            ([t, c, em]) => {
              localStorage.setItem(
                'libra',
                JSON.stringify({ intervalMs: 600000, theme: t, highContrast: c }),
              )
              if (em) {
                localStorage.setItem(
                  'libra:emergency',
                  JSON.stringify({ active: true, details: ['苦しい'], sub: null }),
                )
              } else localStorage.removeItem('libra:emergency')
            },
            [theme, hc, emergency],
          )
          await page.goto(`http://localhost:${port}/`)
          await page.waitForTimeout(400)
          const applied = await page.evaluate(() => ({
            t: document.documentElement.dataset.theme,
            hc: document.documentElement.dataset.highContrast,
          }))
          if (applied.t !== theme || applied.hc !== String(hc)) {
            failures.push(`[scan-ring] ${tag} 設定が反映されていない ${JSON.stringify(applied)}`)
          }
          return { context, page }
        }
        const click = async (page, label) => {
          await page
            .locator('.grid-board .tile')
            .filter({ has: page.getByText(label, { exact: true }) })
            .first()
            .click()
          await page.waitForTimeout(1000) // 遷移直後の連打無視を過ぎる
        }
        const measure = async (page, name) => {
          if (reportDir)
            await page.screenshot({ path: path.join(reportDir, 'shots', `${tag}_${name}.png`) })
          const n = await page.locator('.grid-board .tile:not(.tile-empty)').count()
          for (let i = 0; i < n; i++) {
            const r = await page.evaluate((i) => {
              document
                .querySelectorAll('.tile.scanning')
                .forEach((e) => e.classList.remove('scanning'))
              const tiles = [...document.querySelectorAll('.grid-board .tile:not(.tile-empty)')]
              const t = tiles[i]
              t.classList.add('scanning')
              const cs = getComputedStyle(t)
              const af = getComputedStyle(t, '::after')
              const bf = getComputedStyle(t, '::before')
              const bg = (e) => getComputedStyle(e).backgroundColor
              const lab = t.querySelector('.tile-label')
              const det = t.querySelector('.tile-detail, .tile-preview')
              return {
                emergencyTile: t.classList.contains('tile-emergency'),
                fill: cs.backgroundColor,
                ring: af.borderTopColor,
                shadow: af.boxShadow,
                before: bf.content,
                label: lab ? getComputedStyle(lab).color : null,
                detail: det ? getComputedStyle(det).color : null,
                others: tiles
                  .filter((x) => x !== t)
                  .map((x) => ({ bg: bg(x), em: x.classList.contains('tile-emergency') })),
              }
            }, i)
            const where = `[scan-ring] ${tag} ${name}#${i}`
            if (r.shadow !== 'none') failures.push(`${where} ::after に box-shadow ${r.shadow}`)
            if (r.before !== 'none' && r.before !== 'normal')
              failures.push(`${where} ::before がある ${r.before}`)
            const ringFill = ratio(parse(r.ring), parse(r.fill))
            if (ringFill < 3) failures.push(`${where} 黄枠と面が 3:1 未満 (${ringFill.toFixed(2)})`)
            const text = r.label ? ratio(parse(r.label), parse(r.fill)) : 99
            const detail = r.detail ? ratio(parse(r.detail), parse(r.fill)) : 99
            if (text < 4.5 || detail < 4.5)
              failures.push(
                `${where} 文字が 4.5:1 未満 (${text.toFixed(2)} / ${detail.toFixed(2)})`,
              )
            if (r.detail && r.label && same(r.detail, r.label))
              failures.push(`${where} 予告とラベルの文字色が同じ`)
            // スキャン面は他のどのタイル(緊急入口を含む)の面とも同色にならない
            for (const o of r.others) {
              if (same(o.bg, r.fill))
                failures.push(
                  `${where} スキャン面が他タイル(${o.em ? '緊急入口' : '通常'})と同色 ${r.fill}`,
                )
              // 静的テスト(VisualCleanup.test.tsx)の下限 1.3 と揃える
              const faceRatio = ratio(parse(r.fill), parse(o.bg))
              if (faceRatio < 1.3)
                failures.push(
                  `${where} スキャン面と他タイル面が 1.3:1 未満 (${faceRatio.toFixed(2)})`,
                )
              // 夜間は黄枠が隣接タイルに対しても 3:1 以上(明るいテーマの白面とは 1.53:1 のため対象外)
              if (theme === 'dark') {
                const ringNb = ratio(parse(r.ring), parse(o.bg))
                if (ringNb < 3)
                  failures.push(
                    `${where} 夜間の黄枠と隣接タイル面が 3:1 未満 (${ringNb.toFixed(2)})`,
                  )
              }
              const c = parse(o.bg)
              if (c[0] > 150 && c[1] < 80 && c[2] < 80) failures.push(`${where} 赤いタイル ${o.bg}`)
            }
            const ordinary = r.others
              .filter((o) => !o.em)
              .map((o) => ratio(parse(r.fill), parse(o.bg)))
            rows.push({
              tag,
              screen: name,
              i,
              emergencyTile: r.emergencyTile,
              ringFill,
              text,
              detail,
              fillVsOrdinaryMin: ordinary.length ? Math.min(...ordinary) : null,
            })
            if (reportDir && (i === 0 || r.emergencyTile)) {
              await page.screenshot({
                path: path.join(reportDir, 'shots', `${tag}_${name}_scan${i}.png`),
              })
            }
          }
          await page.evaluate(() =>
            document
              .querySelectorAll('.tile.scanning')
              .forEach((e) => e.classList.remove('scanning')),
          )
        }
        {
          const { context, page } = await fresh(false)
          await measure(page, 'home')
          await click(page, '不快')
          await measure(page, 'discomfort')
          await click(page, '痛い')
          await measure(page, 'pain')
          await click(page, '頭')
          await measure(page, 'pain-intensity')
          await context.close()
        }
        {
          const { context, page } = await fresh(true)
          if (!(await page.locator('.emergency-status').count()))
            failures.push(`[scan-ring] ${tag} 緊急状態が復元されていない`)
          await measure(page, 'emergency-home')
          await context.close()
        }
        {
          const { context, page } = await fresh(false)
          await click(page, '緊急')
          if (!(await page.locator('.emergency-status').count()))
            failures.push(`[scan-ring] ${tag} 緊急詳細へ入れていない`)
          await measure(page, 'emergency-detail')
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
    server.close()
  }
  if (reportDir) fs.writeFileSync(path.join(reportDir, 'rows.json'), JSON.stringify(rows))
  return failures
}

// Issue #65: テーマ(明るい/夜間)は色トークンだけを持ち、寸法・文字の大きさを変えない。
// 同じ条件(画面サイズ・文字サイズ・高コントラスト・案内帯・状態)で明るい/夜間を実描画で測り、
// ラベルのpx・セル寸法・案内帯の高さ・メッセージ欄の高さ・寸法トークンが一致すること(テーマ間差0)を確認する。
// 設定が実際に効いたこと(data-theme / data-high-contrast / data-font-size と保存設定)を読み戻し、不一致なら失敗にする。
async function checkThemeParity(chromium, port) {
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []
  const maxNotes = { minHoldMs: 500, auditoryScan: true, voiceMode: 'full', activateOn: 'release' }
  const viewports = [
    [390, 844],
    [568, 320],
    [320, 568],
    [768, 1024],
  ]
  const states = [
    { name: 'home', path: [] },
    { name: 'emergency+message', path: ['緊急', '苦しい', '不快', '痰を取ってほしい'] },
  ]
  const measure = async (width, height, settings, path) => {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    await page.addInitScript(
      (value) => {
        window.localStorage.removeItem('libra:emergency')
        window.localStorage.setItem('libra', JSON.stringify(value))
      },
      { intervalMs: 600000, morseEnabled: true, ...settings },
    )
    await page.goto(`http://localhost:${port}/`)
    await page.waitForTimeout(300)
    const applied = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      highContrast: document.documentElement.dataset.highContrast,
      fontSize: document.documentElement.dataset.fontSize,
      stored: JSON.parse(window.localStorage.getItem('libra') ?? '{}'),
    }))
    if (
      applied.theme !== settings.theme ||
      applied.highContrast !== String(settings.highContrast) ||
      applied.fontSize !== settings.fontSize ||
      applied.stored.theme !== settings.theme
    ) {
      await context.close()
      return { guard: `設定が反映されていない ${JSON.stringify(applied)}` }
    }
    for (const label of path) {
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
    const m = await page.evaluate(() => {
      const root = document.documentElement
      const tiles = [...document.querySelectorAll('.grid-board .tile')]
      const px = (el) => Number.parseFloat(getComputedStyle(el).fontSize)
      const h = (sel) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0
      const token = (name) => getComputedStyle(root).getPropertyValue(name).trim()
      return {
        tiles: tiles.length,
        theme: root.dataset.theme,
        labelMin: Math.min(...tiles.map((t) => px(t.querySelector('.tile-label')))),
        sizes: [...new Set(tiles.map((t) => `${t.offsetWidth}x${t.offsetHeight}`))].join(','),
        notes: h('.screen-notes'),
        message: h('.message-panel'),
        tokens: [
          '--label-cqi',
          '--label-cqb',
          '--label-ratio',
          '--font-scale',
          '--scan-ring-width',
          '--scan-ring-inset',
          '--grid-line-width',
        ]
          .map((name) => `${name}=${token(name)}`)
          .join(' '),
      }
    })
    await context.close()
    return m
  }

  try {
    for (const [width, height] of viewports) {
      // 全組合せは実測(DESIGN §11)で取り、この自動検査は時間を抑えて互いに素な4通りだけ回す
      for (const [fontSize, highContrast, band] of [
        ['standard', false, false],
        ['standard', true, true],
        ['xlarge', false, true],
        ['xlarge', true, false],
      ]) {
        for (const state of states) {
          const name = `${width}x${height} ${fontSize} hc=${highContrast} band=${band ? 'max' : 'default'} ${state.name}`
          const result = {}
          for (const theme of ['light', 'dark']) {
            result[theme] = await measure(
              width,
              height,
              { theme, fontSize, highContrast, ...(band ? maxNotes : {}) },
              state.path,
            )
            if (result[theme].guard)
              failures.push(`[theme-parity ${name} ${theme}] ${result[theme].guard}`)
          }
          const [l, d] = [result.light, result.dark]
          if (l.guard || d.guard) continue
          if (l.tiles < 5 || l.tiles !== d.tiles) {
            failures.push(
              `[theme-parity ${name}] 想定の状態に到達していない(明 ${l.tiles} / 夜 ${d.tiles} タイル)`,
            )
            continue
          }
          if (Math.abs(l.labelMin - d.labelMin) > 0.01) {
            failures.push(
              `[theme-parity ${name}] ラベルの大きさがテーマで違う(明 ${l.labelMin.toFixed(2)}px / 夜 ${d.labelMin.toFixed(2)}px)`,
            )
          }
          if (l.sizes !== d.sizes) {
            failures.push(
              `[theme-parity ${name}] セル寸法がテーマで違う(明 ${l.sizes} / 夜 ${d.sizes})`,
            )
          }
          if (Math.abs(l.notes - d.notes) > 0.01 || Math.abs(l.message - d.message) > 0.01) {
            failures.push(
              `[theme-parity ${name}] 案内帯/メッセージ欄の高さがテーマで違う(案内 明 ${l.notes} / 夜 ${d.notes}、メッセージ 明 ${l.message} / 夜 ${d.message})`,
            )
          }
          if (l.tokens !== d.tokens) {
            failures.push(
              `[theme-parity ${name}] 寸法トークンがテーマで違う(明 ${l.tokens} / 夜 ${d.tokens})`,
            )
          }
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
    { name: 'scan-ring-surface', run: checkScanRingSurface },
    { name: 'theme-parity', run: checkThemeParity },
  ],
  { basePort: 4780 },
)
