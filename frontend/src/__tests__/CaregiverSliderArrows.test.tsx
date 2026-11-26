// Issue #141: スライダーの左右の矢印。#140/#157: タブの並び。#142: 縦線なし。#143: 見本は中央・高さ固定。
//
// デシジョンテーブル(矢印):
//   値の位置   | 減らす矢印       | 増やす矢印
//   下限       | 出さない(場所あり) | 押すと +1 段階
//   中間       | -1 段階          | +1 段階
//   上限       | 押すと -1 段階   | 出さない(場所あり)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import {
  menuOpen,
  openCaregiverMenu,
  selectCaregiverTab,
  setSettings,
  setupApp,
  teardownApp,
} from './appTestKit'

beforeEach(setupApp)
afterEach(teardownApp)

const stored = () => JSON.parse(window.localStorage.getItem('libra') ?? '{}')

/** [タブ, 設定名, 保存キー, 下限, 上限, 1 段階, 保存値 → つまみの値] */
const SLIDERS = [
  ['スキャン', 'スキャン間隔', 'intervalMs', 500, 5000, 100, 1],
  ['スキャン', '先頭待機倍率', 'headHoldMultiplier', 3, 15, 1, 3],
  ['スキャン', '連打無視', 'debounceMs', 0, 3000, 100, 1],
  ['スキャン', '押下時間の下限', 'minHoldMs', 0, 2000, 100, 1],
  ['モールス', '長押しの境目', 'morseDashMs', 150, 1500, 50, 1],
  ['モールス', '文字の確定までの無入力', 'morseLetterGapMs', 500, 3000, 100, 1],
  ['モールス', '語の区切りまでの無入力', 'morseWordGapMs', 1500, 8000, 100, 1],
] as const

function open(tab: string) {
  const view = render(() => <App />)
  openCaregiverMenu(view.container)
  selectCaregiverTab(view.container, tab)
  return view.container
}
const arrow = (c: HTMLElement, name: string, direction: '減らす' | '増やす') =>
  c.querySelector(`button[aria-label="${name}を${direction}"]`) as HTMLButtonElement
const sliderOf = (c: HTMLElement, name: string) =>
  arrow(c, name, '増やす').parentElement?.querySelector('input[type="range"]') as HTMLInputElement

describe('Issue #141: スライダーの矢印', () => {
  it('全タブのスライダーに左右の矢印がある(スキャン 4 本・モールス 3 本。他のタブにスライダーは無い)', () => {
    setSettings({ morseEnabled: true })
    const c = open('使用準備')
    const counts: Record<string, number> = {}
    for (const tab of Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]'))) {
      fireEvent.click(tab)
      const ranges = Array.from(c.querySelectorAll('.caregiver-panel input[type="range"]'))
      counts[tab.textContent ?? ''] = ranges.length
      for (const range of ranges) {
        const row = range.parentElement as HTMLElement
        expect(row.className).toBe('caregiver-range-row')
        expect(Array.from(row.children).map((el) => el.tagName)).toEqual([
          'BUTTON',
          'INPUT',
          'BUTTON',
        ])
      }
    }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(SLIDERS.length)
    expect(counts['スキャン']).toBe(4)
    expect(counts['モールス']).toBe(3)
  })

  it.each(SLIDERS)(
    '%s「%s」: 1 回で 1 段階。下限・上限では外側の矢印が押せない状態になる',
    (tab, name, key, min, max, step, scale) => {
      // 語の区切りの下限は文字の確定で決まるので、最短(500ms → 下限 1500ms = min)にして端を見る
      setSettings({ morseEnabled: true, morseLetterGapMs: 500 })
      const c = open(tab)
      const slider = () => sliderOf(c, name)
      const value = () => Number(slider().value)
      expect(Number(slider().min)).toBe(min)
      expect(Number(slider().max)).toBe(max)
      expect(Number(slider().step)).toBe(step)

      fireEvent.input(slider(), { target: { value: String(min) } })
      expect(arrow(c, name, '減らす').disabled).toBe(true)
      expect(arrow(c, name, '増やす').disabled).toBe(false)
      fireEvent.click(arrow(c, name, '増やす'))
      expect(value()).toBe(min + step)
      expect(arrow(c, name, '減らす').disabled).toBe(false)

      fireEvent.input(slider(), { target: { value: String(max) } })
      expect(arrow(c, name, '増やす').disabled).toBe(true)
      fireEvent.click(arrow(c, name, '減らす'))
      expect(value()).toBe(max - step)
      expect(stored()[key] * scale).toBeCloseTo(max - step)
      expect(arrow(c, name, '増やす').disabled).toBe(false)
    },
  )

  it('見出しは label[for] でスライダーに結び、見出しを押しても矢印は押されない', () => {
    const c = open('スキャン')
    const field = sliderOf(c, 'スキャン間隔').closest('.caregiver-range') as HTMLElement
    const label = field.querySelector('label') as HTMLLabelElement
    expect(label.control).toBe(sliderOf(c, 'スキャン間隔'))
    expect(label.querySelector('button')).toBeNull()
    fireEvent.click(label)
    expect(sliderOf(c, 'スキャン間隔').value).toBe('1500')
  })

  it('「文字の確定」を矢印で延ばすと、語の区切りも一緒に延びる(つまみと同じ処理)', () => {
    setSettings({ morseEnabled: true, morseLetterGapMs: 2000, morseWordGapMs: 2500 })
    const c = open('モールス')
    fireEvent.click(arrow(c, '文字の確定までの無入力', '増やす'))
    expect(stored().morseLetterGapMs).toBe(2100)
    expect(stored().morseWordGapMs).toBe(2600)
  })

  it.each([
    // [保存値, 矢印, 結果]。つまみは目盛り(四捨五入)に出るので、そこから 1 段階
    [1540, '増やす', 1600],
    [1540, '減らす', 1400],
    [1550, '増やす', 1700],
    [1550, '減らす', 1500],
    [520, '減らす', 500],
    [4980, '増やす', 5000],
  ] as const)(
    '目盛りに無い値 %i で「%s」を押すと目盛りの %i になり、つまみと表示がそろう',
    (stored_, direction, expected) => {
      setSettings({ intervalMs: stored_ })
      const c = open('スキャン')
      fireEvent.click(arrow(c, 'スキャン間隔', direction))
      expect(stored().intervalMs).toBe(expected)
      expect(Number(sliderOf(c, 'スキャン間隔').value)).toBe(expected)
      expect(c.textContent).toContain(`スキャン間隔: ${(expected / 1000).toFixed(1)} 秒`)
    },
  )

  it.each([
    [1500, 2000],
    [1550, 2100],
    [500, 1500],
    [3000, 3500],
  ])(
    '文字の確定 %i ms のとき、語の区切りは矢印でもつまみでも %i ms より下がらない',
    (letter, floor) => {
      setSettings({ morseEnabled: true, morseLetterGapMs: letter, morseWordGapMs: floor + 100 })
      const c = open('モールス')
      const name = '語の区切りまでの無入力'
      fireEvent.click(arrow(c, name, '減らす'))
      expect(stored().morseWordGapMs).toBe(floor)
      expect(arrow(c, name, '減らす').disabled).toBe(true)
      fireEvent.click(arrow(c, name, '減らす'))
      expect(stored().morseWordGapMs).toBe(floor)
      // つまみで下限より下へ引くと、保存値もつまみも下限に戻る(同じ値が続いても戻る)
      for (let i = 0; i < 2; i += 1) {
        fireEvent.input(sliderOf(c, name), { target: { value: '1500' } })
        expect(stored().morseWordGapMs).toBe(floor)
        expect(Number(sliderOf(c, name).value)).toBe(floor)
      }
      expect(stored().morseWordGapMs).toBeGreaterThanOrEqual(letter + 500)
    },
  )

  it('矢印の押下(pointerdown)で、自動で閉じるまでの 60 秒を数え直す', () => {
    const c = open('スキャン')
    vi.advanceTimersByTime(50000)
    const button = arrow(c, 'スキャン間隔', '増やす')
    fireEvent.pointerDown(button, { pointerId: 1 })
    fireEvent.pointerUp(button, { pointerId: 1 })
    fireEvent.click(button)
    vi.advanceTimersByTime(59999)
    expect(menuOpen(c)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(menuOpen(c)).toBe(false)
  })
})

describe('Issue #140 / #157: タブの並びと矢印キーの移動順', () => {
  const ORDER = [
    '使用準備',
    'スキャン',
    '音と振動',
    '表示',
    'フレーズ',
    'モールス',
    'データ',
    'このアプリ',
  ]
  it('左から重要順に並び、→ はその順に一巡する', () => {
    const view = render(() => <App />)
    const c = view.container
    openCaregiverMenu(c)
    const tabs = () => Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]'))
    expect(tabs().map((t) => t.textContent)).toEqual(ORDER)
    tabs()[0].focus()
    const visited: string[] = []
    for (let i = 0; i < ORDER.length; i += 1) {
      visited.push(document.activeElement?.textContent ?? '')
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    }
    expect(visited).toEqual(ORDER)
    expect(document.activeElement?.textContent).toBe(ORDER[0])
    expect(c.textContent).not.toContain('端末の状態')
  })
})

describe('Issue #141 / #142 / #143: スタイル(静的。実寸は実ブラウザで確認する)', () => {
  let css = ''
  beforeAll(async () => {
    // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
    const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
    const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
    css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  })
  const bodies = (selector: string): string => {
    const out: string[] = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (
        m[1]
          .split(',')
          .map((x) => x.trim())
          .includes(selector)
      )
        out.push(m[2])
    }
    expect(out.length, selector).toBeGreaterThan(0)
    return out.join('\n')
  }

  it('矢印は 48px 四方(44px 以上)で、端では見えなくするだけ(場所は残る)', () => {
    expect(bodies('.caregiver-range-step')).toMatch(/(^|[;\s])width:\s*48px/)
    expect(bodies('.caregiver-range-step')).toMatch(/(^|[;\s])height:\s*48px/)
    expect(bodies('.caregiver-range-step:disabled')).toMatch(/visibility:\s*hidden/)
    expect(bodies('.caregiver-range-step:disabled')).not.toMatch(/display/)
    expect(bodies('.caregiver-range-row')).toMatch(
      /grid-template-columns:\s*48px minmax\(0, 1fr\) 48px/,
    )
  })

  it('従属する設定は字下げだけで示し、左の縦線を引かない', () => {
    expect(bodies('.caregiver-sub')).toMatch(/padding-left:\s*30px/)
    // 上の項目との区切りの横線(border-top)は対象外。左の線だけを見る
    expect(bodies('.caregiver-sub')).not.toMatch(/border-(left|inline)|(^|[;\s])border:/)
  })

  it('状態表示・注意表示にも左の線を引かず、印の位置は同じ余白でそろえる', () => {
    for (const selector of ['.caregiver-status', '.caregiver-status.warn']) {
      expect(bodies(selector), selector).not.toMatch(/border/)
    }
    expect(css).not.toMatch(/border-(left|inline-start)[^;{}]*caregiver-status/)
    expect(bodies('.caregiver-status')).toMatch(/padding:\s*2px 0 2px 12px/)
    // 対応が必要な表示は、背景と文字色でも区別する(印と文は App 側)
    expect(bodies('.caregiver-status.warn')).toMatch(
      /background:\s*var\(--caregiver-status-warn-bg\)/,
    )
  })

  it('フレーズ編集の列は入力欄の最小幅で広がらない(320 幅で横にはみ出さない)', () => {
    for (const selector of ['.phrase-editor', '.phrase-list', '.phrase-row', '.phrase-row label']) {
      expect(bodies(selector), selector).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
    }
    expect(bodies('.phrase-row input')).toMatch(/(^|[;\s])width:\s*100%/)
  })

  it('文字サイズの見本は中央に置き、高さは固定', () => {
    expect(bodies('.font-size-sample')).toMatch(/justify-self:\s*center/)
    expect(bodies('.font-size-sample')).toMatch(/(^|[;\s])height:\s*150px/)
  })
})
