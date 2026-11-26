// Issue #47(固定格子・空きセル)/ #34(スキャン枠の余白)の仕様を固定する追加テスト。
// 既存の App.test.tsx は「7項目・向き切替」の代表例、gridLayout.test.ts は「向き × 項目数 1〜8 同格子・
// 9 以上 fill:false・>= 境界」の代表例だけなので、ここでは次の観点を埋める。
//
// デシジョンテーブル(向き × 項目数 × 状態 → 格子 / 空きセル / fill):
//   向き(幅×高さ)        | 項目数    | 状態                      | 格子   | 空きセル      | fill
//   縦長 390x844          | 0         | -                         | 1x1    | 0             | false
//   縦長 390x844          | 1〜8      | -                         | 2x4    | 8-n           | true  (標準の格子。ホームは 2x5、文字盤の行段階は 3x5 の専用格子: Issue #121/#123)
//   縦長 390x844          | 9, 15     | -                         | 1x1    | 0(スクロール) | false
//   横長 844x390          | 0         | -                         | 1x1    | 0             | false
//   横長 844x390          | 1〜8      | -                         | 4x2    | 8-n           | true
//   横長 844x390          | 9, 15     | -                         | 1x1    | 0(スクロール) | false
//   幅=高さ 600x600       | 1〜8      | -                         | 2x4    | 8-n           | true  (正方形は縦長。CSS の orientation:portrait と同じ)
//   幅=高さ-1 / +1        | 1〜8      | -                         | 縦2x4 / 横4x2 | 8-n    | true
//   縦長/横長             | 6(home)   | 通常/緊急中/伝達メッセージ/特大文字 | 状態によらず同一 | 2          | true
//   縦長/横長             | 15(文字盤行) | -                      | fill:false。緊急タイルが sticky(従来どおり)・空きセルなし
//   空きセルの操作        | click 単独 / キー / スキャン / 聴覚スキャン → 対象外。押下は背景と同じで黄色のタイルを選ぶ(Issue #134)
//   高コントラスト        | --scan-ring-inset: 標準 12px(=4+6+2)、高コントラスト 15px(=4+9+2)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import { computeGridLayout } from '../lib/gridLayout'
import * as offlineReadyModule from '../lib/offlineReady'

const HEAD_HOLD_MS = 2000
const INTERVAL_MS = 1500
const EMERGENCY_LABEL = '緊急'

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }
}

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  window.dispatchEvent(new Event('resize'))
}
const board = (c: HTMLElement) => c.querySelector('.grid-board') as HTMLElement
const tiles = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.grid-board .tile'))
const emptyCells = (c: HTMLElement) => c.querySelectorAll('.grid-board .tile-empty')
const labels = (c: HTMLElement) =>
  tiles(c).map((t) => t.querySelector('.tile-label')?.textContent ?? '')
const gridOf = (c: HTMLElement) => ({
  cols: board(c).style.getPropertyValue('--cols'),
  rows: board(c).style.getPropertyValue('--rows'),
  fill: board(c).classList.contains('grid-fill'),
})
const tile = (c: HTMLElement, label: string) => {
  const found = tiles(c).find((t) => t.querySelector('.tile-label')?.textContent === label)
  expect(found, `tile ${label}`).toBeTruthy()
  return found as HTMLElement
}
const press = (c: HTMLElement, label: string) =>
  fireEvent.pointerDown(tile(c, label), { pointerId: 1 })
const setSettings = (value: object) => window.localStorage.setItem('libra', JSON.stringify(value))

// CSS の実体を読む(vitest は CSS を空にするため fs で読む。node の型は入れていない)
let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8')
})

const PORTRAIT = { cols: '2', rows: '4', fill: true }
const LANDSCAPE = { cols: '4', rows: '2', fill: true }
// ホームは「もう一度」を含む 10 セル、文字盤の行段階は 15 セルの専用格子(Issue #121/#123)
const HOME_PORTRAIT = { cols: '2', rows: '5', fill: true }
const HOME_LANDSCAPE = { cols: '5', rows: '2', fill: true }
const LETTERS_PORTRAIT = { cols: '3', rows: '5', fill: true }
const LETTERS_LANDSCAPE = { cols: '5', rows: '3', fill: true }

describe('Issue #47: 固定格子と空きセル(純関数のデシジョンテーブル)', () => {
  const orientations = [
    ['縦長 390x844', 390, 844, { cols: 2, rows: 4 }],
    ['横長 844x390', 844, 390, { cols: 4, rows: 2 }],
    ['幅=高さ 600x600(正方形は縦長)', 600, 600, { cols: 2, rows: 4 }],
    ['幅=高さ-1 599x600', 599, 600, { cols: 2, rows: 4 }],
    ['幅=高さ+1 601x600', 601, 600, { cols: 4, rows: 2 }],
  ] as const

  for (const [name, w, h, grid] of orientations) {
    it(`${name}: 項目数 1〜8 は同一格子で 空きセル=cols*rows-n、0 / 9 / 15 は fill:false`, () => {
      for (let n = 1; n <= 8; n += 1) {
        const layout = computeGridLayout(n, w, h)
        expect(layout).toEqual({ fill: true, ...grid })
        expect(layout.cols * layout.rows - n).toBe(8 - n)
      }
      for (const n of [0, 9, 15]) {
        expect(computeGridLayout(n, w, h).fill).toBe(false)
      }
    })
  }

  it('fill:false の格子は 1x1(空きセルを生まない値)', () => {
    expect(computeGridLayout(15, 390, 844)).toEqual({ fill: false, cols: 1, rows: 1 })
  })
})

describe('Issue #47: App の固定格子・空きセル', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear() // libra:emergency が漏れてテスト間で緊急状態が残るのを防ぐ
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = MockAudioContext
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vi.fn()
    ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    }
    ;(globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      class {
        lang = ''
        rate = 1
        pitch = 1
        constructor(public text: string) {}
      }
    vi.spyOn(offlineReadyModule, 'recheckOfflineReady').mockResolvedValue(undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-high-contrast')
    setViewport(1024, 768)
  })

  describe('向き切替と空きセル数', () => {
    it('ホーム(8項目)は縦長で 2x5・空き2、横長で 5x2・空き2、切替に追従する(Issue #123)', () => {
      setViewport(390, 844)
      const { container } = render(() => <App />)
      expect(labels(container)).toHaveLength(8)
      expect(gridOf(container)).toEqual(HOME_PORTRAIT)
      expect(board(container).classList.contains('grid-home')).toBe(true)
      expect(emptyCells(container)).toHaveLength(2)

      setViewport(844, 390)
      expect(gridOf(container)).toEqual(HOME_LANDSCAPE)
      expect(emptyCells(container)).toHaveLength(2)

      setViewport(390, 844)
      expect(gridOf(container)).toEqual(HOME_PORTRAIT)
    })

    it('幅=高さちょうど(正方形)は縦長、幅=高さ-1 も縦長、+1 は横長(App 上の境界)', () => {
      const { container } = render(() => <App />)
      // ホームは幅 600px 以上の縦長で 3×3(PR #124)。境界の判定は 600 未満の幅で見る
      setViewport(500, 500)
      expect(gridOf(container)).toEqual(HOME_PORTRAIT)
      setViewport(499, 500)
      expect(gridOf(container)).toEqual(HOME_PORTRAIT)
      setViewport(501, 500)
      expect(gridOf(container)).toEqual(HOME_LANDSCAPE)
    })

    it('ホームは幅 600px 以上の縦長(タブレット縦・正方形を含む)で 3×3。599px は 2×5(PR #124)', () => {
      const { container } = render(() => <App />)
      setViewport(768, 1024)
      expect(gridOf(container)).toEqual({ cols: '3', rows: '3', fill: true })
      // 8 項目 + 空きセル 1 = 9 セル。並び(スキャン順)は 2×5 と同じ
      expect(tiles(container).length + emptyCells(container).length).toBe(9)
      expect(labels(container).slice(0, 4)).toEqual(['緊急', 'もう一度', 'はい', 'いいえ'])
      setViewport(600, 600)
      expect(gridOf(container)).toEqual({ cols: '3', rows: '3', fill: true })
      setViewport(599, 1000)
      expect(gridOf(container)).toEqual(HOME_PORTRAIT)
      setViewport(1024, 768)
      expect(gridOf(container)).toEqual(HOME_LANDSCAPE)
    })

    it('空きセルは .tile-empty・aria-hidden で、タイル(.tile)でも role=button でもない', () => {
      setViewport(390, 844)
      const { container } = render(() => <App />)
      for (const cell of Array.from(emptyCells(container))) {
        expect(cell.getAttribute('aria-hidden')).toBe('true')
        expect(cell.classList.contains('tile')).toBe(false)
        expect(cell.getAttribute('role')).toBeNull()
        expect(cell.textContent).toBe('')
      }
      // タイル + 空きセル = 格子のセル数(ホームは10)
      expect(tiles(container).length + emptyCells(container).length).toBe(10)
    })

    it('取り消しが出て9項目になると、格子は同じまま空きセルが1になる(Issue #93/#123)', () => {
      setViewport(390, 844)
      const { container } = render(() => <App />)
      const before = gridOf(container)
      press(container, 'はい')
      expect(labels(container)).toHaveLength(9)
      expect(gridOf(container)).toEqual(before)
      expect(emptyCells(container)).toHaveLength(1)
    })

    it('画面を移動しても(不快など下位画面)格子は同じで、タイル数+空き=8', () => {
      for (const [w, h, grid] of [
        [390, 844, PORTRAIT],
        [844, 390, LANDSCAPE],
      ] as const) {
        setViewport(w, h)
        const { container, unmount } = render(() => <App />)
        press(container, '不快')
        expect(gridOf(container)).toEqual(grid)
        expect(board(container).classList.contains('grid-fill')).toBe(true)
        expect(tiles(container).length + emptyCells(container).length).toBe(8)
        unmount()
      }
    })
  })

  describe('状態(緊急・伝達メッセージ・特大文字・高コントラスト)は格子に影響しない', () => {
    for (const [name, w, h, grid, detailGrid] of [
      ['縦長', 390, 844, HOME_PORTRAIT, PORTRAIT],
      ['横長', 844, 390, HOME_LANDSCAPE, LANDSCAPE],
    ] as const) {
      it(`${name}: 緊急中/メッセージ表示中/特大文字/高コントラストでも同じ格子`, () => {
        setViewport(w, h)
        const base = render(() => <App />)
        const baseGrid = gridOf(base.container)
        expect(baseGrid).toEqual(grid)
        base.unmount()

        // 伝達メッセージ表示中(「いいえ」を選ぶとメッセージ欄が出る。取り消しで9項目)
        const msg = render(() => <App />)
        press(msg.container, 'いいえ')
        expect(msg.container.querySelector('h1')?.textContent).toBe('いいえ。')
        expect(gridOf(msg.container)).toEqual(grid)
        msg.unmount()

        // 緊急中(緊急帯が出て格子領域の縦横比が変わる)
        const emg = render(() => <App />)
        press(emg.container, EMERGENCY_LABEL)
        expect(emg.container.querySelector('.emergency-status')).not.toBeNull()
        // 緊急タイルを押すと緊急詳細(先頭は「戻る」)へ進む。そこは標準の8セル格子(緊急中でも変わらない)
        expect(gridOf(emg.container)).toEqual(detailGrid)
        expect(labels(emg.container)[0]).toBe('戻る')
        expect(tiles(emg.container).length + emptyCells(emg.container).length).toBe(8)
        emg.unmount()
        window.localStorage.clear()

        // 特大文字 + 高コントラスト
        setSettings({ fontSize: 'xlarge', highContrast: true })
        const big = render(() => <App />)
        expect(gridOf(big.container)).toEqual(grid)
        expect(emptyCells(big.container)).toHaveLength(2)
        big.unmount()
      })
    }

    it('緊急中の詳細画面(緊急詳細)でも固定格子・空きセル数=8-項目数', () => {
      setViewport(390, 844)
      const { container } = render(() => <App />)
      press(container, EMERGENCY_LABEL)
      // 緊急タイルを押すと実際に緊急詳細へ進む(先頭は「戻る」、緊急タイルは重複しない)
      expect(labels(container)[0]).toBe('戻る')
      expect(labels(container)).not.toContain(EMERGENCY_LABEL)
      const n = tiles(container).length
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(8)
      expect(gridOf(container)).toEqual(PORTRAIT)
      expect(emptyCells(container)).toHaveLength(8 - n)
    })
  })

  describe('空きセルは操作・スキャン・読み上げの対象外', () => {
    it('空きセルの click 単独は何も実行しない(メッセージ・緊急・画面不変)', () => {
      setViewport(390, 844)
      const { container } = render(() => <App />)
      const hBefore = container.querySelector('h1')?.textContent
      const screenBefore = board(container).getAttribute('aria-label')
      const labelsBefore = labels(container)
      for (const cell of Array.from(emptyCells(container))) {
        fireEvent.click(cell)
        fireEvent(
          cell,
          new PointerEvent('click', { pointerId: 1, bubbles: true, cancelable: true }),
        )
      }
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      expect(container.querySelector('h1')?.textContent).toBe(hBefore)
      expect(container.querySelector('.emergency-status')).toBeNull()
      expect(board(container).getAttribute('aria-label')).toBe(screenBefore)
      expect(labels(container)).toEqual(labelsBefore)
    })

    it('空きセルの押下は、黄色のタイルを 1 回だけ実行する(Issue #134)', () => {
      setViewport(390, 844)
      setSettings({ intervalMs: INTERVAL_MS })
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS)
      expect(container.querySelector('.tile.scanning .tile-label')?.textContent).toBe('はい')
      const cell = emptyCells(container)[0] as HTMLElement
      fireEvent.pointerDown(cell, { pointerId: 1 })
      fireEvent.pointerUp(document.body, { pointerId: 1 })
      fireEvent(
        document.body,
        new PointerEvent('click', { pointerId: 1, bubbles: true, cancelable: true }),
      )
      expect(container.querySelector('h1')?.textContent).toBe('はい。')
    })

    it('スキャンは全タイルを順に巡回し、最後の項目の次は先頭へ戻る(周期=項目数。空きセルには止まらない)', () => {
      setViewport(390, 844)
      setSettings({ intervalMs: INTERVAL_MS })
      const { container } = render(() => <App />)
      const all = labels(container)
      const n = all.length
      expect(n).toBeLessThan(10) // 空きセルがある画面(周期が格子のセル数=10と区別できる)
      expect(emptyCells(container)).toHaveLength(10 - n)
      const seen: string[] = []
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      for (let i = 0; i < n * 3 + 2; i += 1) {
        // 各ステップで .scanning はタイルにちょうど1つ。空きセルは決して .scanning にならない
        const scanning = container.querySelectorAll('.grid-board .scanning')
        expect(scanning.length, `step ${i}`).toBe(1)
        expect(scanning[0].classList.contains('tile')).toBe(true)
        expect(container.querySelector('.tile-empty.scanning')).toBeNull()
        seen.push(container.querySelector('.tile.scanning .tile-label')?.textContent ?? '')
        vi.advanceTimersByTime(INTERVAL_MS)
      }
      // 並びは項目の順の循環(最後→先頭)で、周期は項目数
      const start = all.indexOf(seen[0])
      expect(start).toBeGreaterThanOrEqual(0)
      seen.forEach((label, i) => expect(label, `step ${i}`).toBe(all[(start + i) % n]))
      // 最後の項目の次は先頭(上の循環検査が含むが、境界を明示する)
      const last = seen.indexOf(all[n - 1])
      expect(seen[last + 1]).toBe(all[0])
    })

    it('キー(スペース)は currentMenu の範囲のタイルだけを実行する(最後の項目の次は先頭で、空きセルは対象にならない)', () => {
      setViewport(390, 844)
      setSettings({ intervalMs: INTERVAL_MS })
      const { container } = render(() => <App />)
      const all = labels(container)
      expect(all.length).toBeLessThan(10)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      // 最後のタイルまで進め、その次(空きセルがあれば止まってしまう位置)で先頭へ戻っていることを確認する
      let guard = 0
      while (
        container.querySelector('.tile.scanning .tile-label')?.textContent !== all[all.length - 1]
      ) {
        vi.advanceTimersByTime(INTERVAL_MS)
        expect(++guard).toBeLessThan(all.length * 3)
      }
      vi.advanceTimersByTime(INTERVAL_MS)
      expect(container.querySelector('.tile.scanning .tile-label')?.textContent).toBe(all[0])
      fireEvent.keyDown(window, { key: ' ' })
      // 先頭は緊急: 実行されて緊急詳細(先頭は「戻る」)へ進む
      expect(labels(container)[0]).toBe('戻る')
    })

    it('聴覚スキャン: 読み上げられるのはタイルのラベルだけで、空きセル分の読み上げは出ない', () => {
      setViewport(390, 844)
      setSettings({ auditoryScan: true, intervalMs: INTERVAL_MS })
      const { container } = render(() => <App />)
      const speak = (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } })
        .speechSynthesis.speak
      vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 10)
      const spoken = speak.mock.calls.map((c) => (c[0] as { text: string }).text)
      expect(spoken.length).toBeGreaterThan(0)
      const allowed = labels(container)
      for (const text of spoken) {
        expect(text.trim()).not.toBe('')
        expect(
          allowed.some((l) => text.includes(l)),
          `「${text}」`,
        ).toBe(true)
      }
      // 空きセルは aria-hidden なので、支援技術の読み上げ木にも載らない
      for (const cell of Array.from(emptyCells(container))) {
        expect(cell.closest('[aria-hidden="true"]')).toBe(cell)
      }
    })
  })

  describe('快(6項目)の余り2セルは操作の対象外(Issue #78/#93)', () => {
    for (const [name, w, h] of [
      ['縦長', 390, 844],
      ['横長', 844, 390],
    ] as const) {
      it(`${name}: 空きセルは2つで、フォーカス・スキャン・クリックの対象にならない`, () => {
        setViewport(w, h)
        setSettings({ intervalMs: INTERVAL_MS })
        const { container } = render(() => <App />)
        press(container, '快')
        // 「もっと」を除いた 続けて・やめて・変えて・気分 + 戻る・緊急 = 6項目、8セル中の余り2
        expect(labels(container)).toHaveLength(6)
        expect(labels(container)).not.toContain('もっと')
        const empties = emptyCells(container)
        expect(empties).toHaveLength(2)
        const cell = empties[0] as HTMLElement
        expect(cell.getAttribute('aria-hidden')).toBe('true')
        // キー操作で到達できない(tabindex 無し=非フォーカス、または -1)
        expect([null, '-1']).toContain(cell.getAttribute('tabindex'))
        expect(cell.classList.contains('tile')).toBe(false)

        // スキャンを数周させても空きセルには付かず、スキャン中はタイルちょうど1つ
        const hBefore = container.querySelector('h1')?.textContent
        const labelsBefore = labels(container)
        vi.advanceTimersByTime(HEAD_HOLD_MS)
        for (let i = 0; i < 6 * 3 + 2; i += 1) {
          expect(container.querySelectorAll('.grid-board .scanning').length, `step ${i}`).toBe(1)
          expect(container.querySelector('.tile-empty.scanning')).toBeNull()
          vi.advanceTimersByTime(INTERVAL_MS)
        }

        // 空きセルの click 単独では何も実行されない(押下は黄色を選ぶ。上の Issue #134 のテスト)
        fireEvent.click(cell)
        expect(container.querySelector('h1')?.textContent).toBe(hBefore)
        expect(labels(container)).toEqual(labelsBefore)
        expect(container.querySelector('.emergency-status')).toBeNull()
      })
    }
  })

  describe('スキャン対象が遷移してもタイルの矩形(クラス・インラインスタイル)は変わらない', () => {
    it('scanning が移ってもタイルの style 属性・タイル数・空きセル数は不変(位置・大きさを変えない)', () => {
      setViewport(390, 844)
      setSettings({ intervalMs: INTERVAL_MS })
      const { container } = render(() => <App />)
      const snapshot = () =>
        tiles(container).map((t) => ({
          style: t.getAttribute('style'),
          cls: t.className
            .replace(/\bscanning\b/g, '')
            .replace(/\s+/g, ' ')
            .trim(),
        }))
      const before = snapshot()
      const beforeEmpty = emptyCells(container).length
      for (let i = 0; i < 8; i += 1) {
        vi.advanceTimersByTime(INTERVAL_MS)
        expect(snapshot()).toEqual(before)
        expect(emptyCells(container)).toHaveLength(beforeEmpty)
      }
    })
  })

  describe('スキャン枠の余白(--scan-ring-inset, #34)の静的検査', () => {
    const ringWidth = (block: RegExp, src = css) => {
      const m = src.match(block)
      expect(m, String(block)).toBeTruthy()
      return Number.parseFloat((m as RegExpMatchArray)[1])
    }

    it('標準 12px(= 4 + 6 + 2)、高コントラスト 15px(= 4 + 9 + 2)になる', () => {
      expect(css).toMatch(/--scan-ring-inset:\s*calc\(4px \+ var\(--scan-ring-width\) \+ 2px\)/)
      // Issue #65: 基底の枠の太さは @media の外の `:root` 単独ブロック(テーマ非依存)に1つだけ。
      // テーマのブロックには持たない(ThemeColorsOnly.test.ts が検査)ので、ライト/ダークで同じ
      const standard = ringWidth(
        /(?:^|\})\s*:root\s*\{[^}]*?--scan-ring-width:\s*(\d+)px/s,
        css.replace(/\/\*[\s\S]*?\*\//g, ''),
      )
      expect(css).not.toMatch(/:root\[data-theme='(?:light|dark)'\]\s*\{[^}]*?--scan-ring-width/s)
      const high = ringWidth(
        /:root\[data-high-contrast='true'\]\s*\{[^}]*?--scan-ring-width:\s*(\d+)px/s,
      )
      expect(4 + standard + 2).toBe(12)
      expect(4 + high + 2).toBe(15)
    })

    it('枠 ::after の inset(4px)と --scan-ring-inset の式が一致し、白縁・二重枠(box-shadow)を持たない(#33)', () => {
      const after = css.match(/\.tile\.scanning::after\s*\{([^}]*)\}/s)?.[1] ?? ''
      expect(after).toMatch(/inset:\s*4px/)
      expect(after).toMatch(/border:\s*var\(--scan-ring-width\) solid/)
      expect(after).not.toMatch(/box-shadow/)
    })

    it('タイル本体・山形・予告が --scan-ring-inset の内側に置かれ、選択状態でパディングを変えない', () => {
      expect(css).toMatch(/\.tile \{[^}]*padding:\s*var\(--scan-ring-inset\)/s)
      expect(css).toMatch(/\.tile-chevron \{[^}]*right:\s*var\(--scan-ring-inset\)/s)
      const preview = css.match(/\.tile-preview \{([^}]*)\}/s)?.[1] ?? ''
      for (const side of ['right', 'bottom', 'left']) {
        expect(preview).toMatch(new RegExp(`${side}:\\s*var\\(--scan-ring-inset\\)`))
      }
      // .tile.scanning は面の色と z-index だけ。padding/サイズ/transform を変えない
      const scanning = css.match(/\.tile\.scanning \{([^}]*)\}/s)?.[1] ?? ''
      expect(scanning).not.toMatch(/padding|width|height|transform|margin|inset|border/)
    })

    it('ラベルは縮めすぎない: 下限は max(13px, …) で、--ring-extra が上限項と下限項の両方に効く', () => {
      const font = css.match(/--tile-label-font:\s*clamp\(([\s\S]*?)\n {2}\);/)?.[1] ?? ''
      expect(font).toMatch(/max\(13px,/)
      expect(font.match(/--ring-extra/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    })

    it('高コントラストの枠は短い画面、または狭くて低い画面(幅480以下かつ高さ700以下)だけ 7px にする', () => {
      expect(css).toMatch(
        /@media \(max-height: 500px\), \(max-width: 480px\) and \(max-height: 700px\) \{\s*:root\[data-high-contrast='true'\]\s*\{[^}]*--scan-ring-width:\s*7px/s,
      )
      // 390x844 のような高さに余裕のある縦向きスマホは 9px のまま(条件が (max-width: 480px) 単独でない)
      expect(css).not.toMatch(
        /@media \(max-height: 500px\), \(max-width: 480px\) \{\s*:root\[data-high-contrast/,
      )
    })

    it('短い画面の緊急帯は1行(nowrap)で、詳細は長くても省略記号で収める', () => {
      // 低い画面向けの @media (max-height: 500px) ブロックは複数あるので、全部をまとめて見る
      const short = css.split('@media (max-height: 500px) {').slice(1).join('\n')
      expect(short).toMatch(/\.emergency-status\s*\{[^}]*display:\s*flex/s)
      expect(short).toMatch(/\.emergency-status\s*\{[^}]*flex-wrap:\s*nowrap/s)
      expect(short).toMatch(
        /\.emergency-status \.emergency-details\s*\{[^}]*text-overflow:\s*ellipsis/s,
      )
      expect(short).toMatch(
        /\.emergency-status \.emergency-details\s*\{[^}]*white-space:\s*nowrap/s,
      )
    })

    it('高コントラスト設定で documentElement に data-high-contrast=true が付く(15px 側の CSS が効く前提)', () => {
      setSettings({ highContrast: true })
      render(() => <App />)
      expect(document.documentElement.dataset.highContrast).toBe('true')
    })

    // 注: jsdom は pointer-events:none を実イベントに適用しない。ここは CSS 宣言の存在だけを見る
    // (実際に押せないことは実Chromiumの実測で確認する。直上のテストは jsdom で直接イベントを送っても
    // ハンドラが無いので何も起きないことを見ている)
    it('空きセルは面の色・区切り線を持たず、pointer-events:none', () => {
      const block = css.match(/\.tile-empty \{([^}]*)\}/s)?.[1] ?? ''
      expect(block).toMatch(/pointer-events:\s*none/)
      expect(block).toMatch(/background:\s*var\(--bg\)/)
      expect(block).not.toMatch(/box-shadow|border|--surface/)
    })
  })

  describe('取り消し表示中にモールスが有効でも、ホームは9項目で格子に収まる(Issue #93/#123)', () => {
    for (const [w, h] of [
      [390, 844],
      [844, 390],
    ] as const) {
      it(`${w}x${h}: grid-fill のまま・空きセル1・モールスの入口は取り消し中だけ畳まれる`, () => {
        setViewport(w, h)
        setSettings({ intervalMs: INTERVAL_MS, morseEnabled: true })
        const { container } = render(() => <App />)
        expect(labels(container)).toContain('モールス')
        press(container, 'はい')
        expect(labels(container)).toContain('取り消し')
        expect(labels(container)).not.toContain('モールス')
        expect(labels(container)).toHaveLength(9)
        expect(board(container).classList.contains('grid-fill')).toBe(true)
        expect(emptyCells(container)).toHaveLength(1)
        // 取り消しが消える(2周後)とモールスが戻る
        vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 9 * 2 + INTERVAL_MS)
        expect(labels(container)).not.toContain('取り消し')
        expect(labels(container)).toContain('モールス')
      })
    }
  })

  describe('文字盤の行段階(14項目): 専用の15セル格子でスクロールしない(Issue #121)', () => {
    it('14項目は 3x5 / 5x3 の専用格子に収まり(fill)、空きセルは1つ。緊急タイルは sticky 指定を持つ', () => {
      for (const [w, h, grid] of [
        [390, 844, LETTERS_PORTRAIT],
        [844, 390, LETTERS_LANDSCAPE],
      ] as const) {
        setViewport(w, h)
        const { container, unmount } = render(() => <App />)
        press(container, '文字盤')
        expect(tiles(container)).toHaveLength(14)
        expect(gridOf(container)).toEqual(grid)
        expect(board(container).classList.contains('grid-home')).toBe(false)
        expect(emptyCells(container)).toHaveLength(1)
        unmount()
      }
      expect(css).toMatch(/\.tile-emergency[^{]*\{[^}]*position:\s*sticky/s)
    })
  })

  describe('回帰: タイル直接タップ・背景の click・常時案内', () => {
    it('タイル直接タップは押したタイルを実行する(縦長/横長とも)', () => {
      for (const [w, h] of [
        [390, 844],
        [844, 390],
      ] as const) {
        setViewport(w, h)
        const { container, unmount } = render(() => <App />)
        press(container, 'いいえ')
        expect(container.querySelector('h1')?.textContent).toBe('いいえ。')
        unmount()
      }
    })

    it('背景(grid-board 自体・container)の主ボタン以外の押下と click は何も実行しない', () => {
      setViewport(390, 844)
      const { container } = render(() => <App />)
      const hBefore = container.querySelector('h1')?.textContent
      fireEvent.pointerDown(board(container), { pointerId: 1, button: 2 })
      fireEvent.click(board(container))
      fireEvent.pointerDown(container.firstElementChild as Element, { pointerId: 1, button: 1 })
      expect(container.querySelector('h1')?.textContent).toBe(hBefore)
      expect(container.querySelector('.emergency-status')).toBeNull()
    })

    it('通常時は常時案内(.screen-notes)が出ない(空きセルは影響しない)', () => {
      setViewport(390, 844)
      const { container } = render(() => <App />)
      expect(emptyCells(container).length).toBeGreaterThan(0)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })
  })
})
