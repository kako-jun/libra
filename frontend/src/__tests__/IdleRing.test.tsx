// Issue #139: 無操作で起きる自動操作を右下の円で示す。円の値と、実際に動きが起きる時刻が一致することを
// 偽の時計で確かめる(円は 100ms ごとに描き直すので、時刻の許容はその 1 回ぶん)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import { MORSE_IDLE_EXIT_MS } from '../lib/morse'
import {
  closeCaregiverMenu,
  isHome,
  menuOpen,
  openCaregiverMenu,
  pressSwitch,
  scanningLabel,
  setSettings,
  setupApp,
  tap,
  teardownApp,
  tileLabels,
} from './appTestKit'

const REFRESH_MS = 100

const selfRing = (c: HTMLElement) => c.querySelector('.app-shell > .idle-ring-slot')
const menuRing = (c: HTMLElement) => c.querySelector('.caregiver-panel > .idle-ring-slot')
const progressOf = (slot: Element | null): number => {
  expect(slot, '円').not.toBeNull()
  return Number(slot?.querySelector('.idle-ring')?.getAttribute('data-progress'))
}

/** ホームへ戻る直前まで時間を進め、最後に見えた円の値と、戻るまでにかかった時間を返す */
function runUntilHome(c: HTMLElement, stepMs = 10) {
  let elapsed = 0
  let last = progressOf(selfRing(c))
  const seen: number[] = [last]
  while (!isHome(c)) {
    last = progressOf(selfRing(c))
    seen.push(last)
    vi.advanceTimersByTime(stepMs)
    elapsed += stepMs
    expect(elapsed).toBeLessThan(600_000)
  }
  return { elapsed, last, seen }
}

beforeEach(setupApp)
afterEach(() => {
  teardownApp()
  vi.unstubAllGlobals()
})

describe('Issue #139: 本人画面の円(下位画面の無入力 3 周)', () => {
  it('ホームには円が無く、下位画面にだけ出る', () => {
    const { container } = render(() => <App />)
    expect(container.querySelector('.idle-ring-slot')).toBeNull()
    expect(container.querySelector('.app-shell')?.classList.contains('has-idle-ring')).toBe(false)
    tap(container, '不快')
    expect(selfRing(container)).not.toBeNull()
    expect(container.querySelector('.app-shell')?.classList.contains('has-idle-ring')).toBe(true)
    tap(container, '戻る')
    expect(container.querySelector('.idle-ring-slot')).toBeNull()
  })

  it('円は支援技術に出さず、ボタンでもない。読み上げる要素や文字を足さない', () => {
    const { container } = render(() => <App />)
    tap(container, '不快')
    const slot = selfRing(container) as HTMLElement
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.textContent).toBe('')
    expect(slot.querySelector('[role], [aria-live], button, [tabindex]')).toBeNull()
  })

  it('戻る瞬間にちょうど満ちる。それまで減らず、戻るまでの時間は「先頭待機＋残りの項目×間隔」', () => {
    const { container } = render(() => <App />)
    tap(container, '不快')
    const items = tileLabels(container).length
    vi.advanceTimersByTime(REFRESH_MS - 10)
    const { elapsed, last, seen } = runUntilHome(container)
    // 既定: 先頭待機 2000ms、間隔 1500ms。項目数×3 回目に進む時刻で戻る
    const total = 2000 + (items * 3 - 1) * 1500
    expect(elapsed + REFRESH_MS - 10).toBeGreaterThanOrEqual(total)
    expect(elapsed + REFRESH_MS - 10).toBeLessThanOrEqual(total + 100)
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    // 直前の値は、描き直し 1 回ぶん(最後の項目の 100ms)以内
    expect(last).toBeGreaterThanOrEqual(1 - 100 / 1500 / (items * 3) - 0.001)
    expect(selfRing(container)).toBeNull()
  })

  it('途中の入力で 0 に戻り、そこから 3 周ぶんで戻る', () => {
    const { container } = render(() => <App />)
    tap(container, '不快')
    vi.advanceTimersByTime(8000)
    const before = progressOf(selfRing(container))
    expect(before).toBeGreaterThan(0.1)
    // 画面を変えないキー入力(くり返し)
    fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft', repeat: true })
    fireEvent.keyUp(window, { key: 'Shift', code: 'ShiftLeft' })
    vi.advanceTimersByTime(REFRESH_MS)
    expect(isHome(container)).toBe(false)
    expect(progressOf(selfRing(container))).toBeLessThan(0.03)
    const items = tileLabels(container).length
    const { elapsed } = runUntilHome(container)
    expect(elapsed + REFRESH_MS).toBeGreaterThan((items * 3 - 1) * 1500)
    expect(elapsed + REFRESH_MS).toBeLessThanOrEqual(items * 3 * 1500 + 100)
  })

  it('押している間は進まない(0 のまま)。離してから進み始める', () => {
    setSettings({ activateOn: 'release', minHoldMs: 100 })
    const { container } = render(() => <App />)
    // 離して決定なので、下限より長く押してから離して下位画面を開く
    const discomfort = Array.from(container.querySelectorAll('.tile')).find(
      (el) => el.getAttribute('aria-label') === '不快',
    ) as Element
    fireEvent.pointerDown(discomfort, { pointerId: 1, pointerType: 'touch' })
    vi.advanceTimersByTime(200)
    fireEvent.pointerUp(discomfort, { pointerId: 1, pointerType: 'touch' })
    expect(isHome(container)).toBe(false)
    vi.advanceTimersByTime(8000)
    expect(progressOf(selfRing(container))).toBeGreaterThan(0.1)
    // 取り消される押下(決定しない)で確かめる
    fireEvent.keyDown(window, { key: ' ' })
    for (let t = 0; t < 120_000; t += 5000) {
      vi.advanceTimersByTime(5000)
      expect(progressOf(selfRing(container))).toBe(0)
      expect(isHome(container)).toBe(false)
    }
    fireEvent.blur(window)
    vi.advanceTimersByTime(3000)
    expect(progressOf(selfRing(container))).toBeGreaterThan(0)
  })

  it('円の場所の押下は、ボタン以外の押下として黄色のパネルを選ぶ', () => {
    const { container } = render(() => <App />)
    tap(container, '不快')
    vi.advanceTimersByTime(600)
    expect(scanningLabel(container)).toBe('戻る')
    const circle = selfRing(container)?.querySelector('circle') as Element
    fireEvent.pointerDown(circle, { pointerId: 7, pointerType: 'touch', button: 0 })
    fireEvent.pointerUp(circle, { pointerId: 7, pointerType: 'touch' })
    expect(isHome(container)).toBe(true)
  })

  it('緊急中の案内の帯と並んでも、帯は盤面の直後のまま', () => {
    const { container } = render(() => <App />)
    tap(container, '緊急')
    const notes = container.querySelector('.screen-notes') as HTMLElement
    expect(notes.previousElementSibling?.classList.contains('grid-board')).toBe(true)
    expect(notes.nextElementSibling).toBe(selfRing(container))
  })

  it('動きを減らす設定では、8 段階で進む', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const { container } = render(() => <App />)
    tap(container, '不快')
    const { seen } = runUntilHome(container, 100)
    const values = new Set(seen)
    expect(values.size).toBeGreaterThan(4)
    expect(values.size).toBeLessThanOrEqual(8)
    for (const value of values) expect(Number.isInteger(value * 8)).toBe(true)
  })
})

describe('Issue #139: モールス入力の無操作での復帰', () => {
  const openMorse = () => {
    setSettings({ morseEnabled: true })
    const rendered = render(() => <App />)
    tap(rendered.container, 'モールス')
    expect(rendered.container.querySelector('.morse-panel')).not.toBeNull()
    return rendered
  }

  it('30 秒で満ちる時刻に、スキャンへ戻る', () => {
    const { container } = openMorse()
    // モールスの時計は画面に入った時点から
    vi.advanceTimersByTime(MORSE_IDLE_EXIT_MS / 2)
    expect(progressOf(selfRing(container))).toBeCloseTo(0.5, 1)
    vi.advanceTimersByTime(MORSE_IDLE_EXIT_MS / 2 - 200)
    expect(isHome(container)).toBe(false)
    expect(progressOf(selfRing(container))).toBeGreaterThan(0.98)
    vi.advanceTimersByTime(200)
    expect(isHome(container)).toBe(true)
    expect(selfRing(container)).toBeNull()
  })

  it('押している間は 0。離して符号が入ると、その時刻から数え直す', () => {
    const { container } = openMorse()
    vi.advanceTimersByTime(10_000)
    fireEvent.keyDown(window, { key: ' ' })
    vi.advanceTimersByTime(1000)
    expect(progressOf(selfRing(container))).toBe(0)
    fireEvent.keyUp(window, { key: ' ' })
    vi.advanceTimersByTime(3000)
    expect(progressOf(selfRing(container))).toBeCloseTo(0.1, 2)
  })

  it('短すぎて符号にならない押下は数え直さないので、円も元の起点のまま', () => {
    setSettings({ morseEnabled: true, minHoldMs: 500 })
    const { container } = render(() => <App />)
    fireEvent.click(
      Array.from(container.querySelectorAll('.tile')).find(
        (el) => el.getAttribute('aria-label') === 'モールス',
      ) as Element,
    )
    vi.advanceTimersByTime(15_000)
    pressSwitch()
    vi.advanceTimersByTime(REFRESH_MS)
    expect(progressOf(selfRing(container))).toBeCloseTo(0.5, 1)
  })
})

describe('Issue #139: 介助者用メニューの円(60 秒で閉じる)', () => {
  it('開いてから満ちていき、満ちる時刻に閉じる', () => {
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    expect(progressOf(menuRing(container))).toBe(0)
    vi.advanceTimersByTime(30_000)
    expect(progressOf(menuRing(container))).toBeCloseTo(0.5, 2)
    vi.advanceTimersByTime(29_900)
    expect(menuOpen(container)).toBe(true)
    expect(progressOf(menuRing(container))).toBeCloseTo(0.998, 2)
    vi.advanceTimersByTime(100)
    expect(menuOpen(container)).toBe(false)
    expect(container.querySelector('.idle-ring-slot')).toBeNull()
  })

  it.each(['.caregiver-tabpanel', '.caregiver-panel > .idle-ring-slot'])(
    'パネル内(%s)のタップで 0 に戻り、そこから 60 秒で閉じる',
    (selector) => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      vi.advanceTimersByTime(45_000)
      fireEvent.pointerDown(container.querySelector(selector) as Element, {
        pointerId: 3,
        pointerType: 'touch',
      })
      vi.advanceTimersByTime(REFRESH_MS)
      expect(progressOf(menuRing(container))).toBeLessThan(0.01)
      vi.advanceTimersByTime(60_000 - REFRESH_MS - 100)
      expect(menuOpen(container)).toBe(true)
      expect(progressOf(menuRing(container))).toBeGreaterThan(0.99)
      vi.advanceTimersByTime(100)
      expect(menuOpen(container)).toBe(false)
    },
  )

  it('開き直すと 0 から。下位画面から開いている間、背後の円は 0', () => {
    const { container } = render(() => <App />)
    tap(container, '不快')
    vi.advanceTimersByTime(5000)
    openCaregiverMenu(container)
    vi.advanceTimersByTime(20_000)
    expect(progressOf(selfRing(container))).toBe(0)
    closeCaregiverMenu(container)
    openCaregiverMenu(container)
    expect(progressOf(menuRing(container))).toBe(0)
  })
})
