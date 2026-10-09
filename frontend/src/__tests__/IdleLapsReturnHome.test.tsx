// Issue #76: 下位画面で入力がないまま3周するとホームへ自動復帰する(App レベル)。
// 周回は「無入力の間にカーソルが進んだ項目数が項目数×3に達した」ときに数える。画面ごとに項目数が違うので、
// 固定の ms ではなくカーソルが進んだ項目数の観測(advanceSteps)で進める。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'
import { MORSE_IDLE_EXIT_MS } from '../lib/morse'
import { IDLE_LAPS_BEFORE_HOME } from '../lib/idleLaps'

const INTERVAL_MS = 1500
const STEP_MS = 100

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

const scanningLabel = (c: HTMLElement) =>
  c.querySelector('.tile.scanning .tile-label')?.textContent ?? null
const screenLabel = (c: HTMLElement) =>
  c.querySelector('.grid-board')?.getAttribute('aria-label') ?? ''
const isHome = (c: HTMLElement) =>
  c.querySelector('.screen-breadcrumb li')?.textContent === 'ホーム' &&
  c.querySelectorAll('.screen-breadcrumb li').length === 1
const tile = (c: HTMLElement, label: string) => {
  const found = Array.from(c.querySelectorAll<HTMLElement>('.grid-board .tile')).find(
    (el) => el.querySelector('.tile-label')?.textContent === label,
  )
  expect(found, `tile ${label}`).toBeTruthy()
  return found as HTMLElement
}
const setSettings = (value: object) => window.localStorage.setItem('libra', JSON.stringify(value))

function selectByLabel(c: HTMLElement, label: string) {
  for (let i = 0; i < 40 && scanningLabel(c) !== label; i += 1) vi.advanceTimersByTime(INTERVAL_MS)
  expect(scanningLabel(c)).toBe(label)
  vi.advanceTimersByTime(600)
  fireEvent.keyDown(window, { key: ' ' })
  fireEvent.keyUp(window, { key: ' ' })
}

/** 下位画面(不快)を開いた直後の状態にする。返り値は先頭項目のラベル(周回の観測に使う) */
function openDiscomfort(c: HTMLElement): string {
  selectByLabel(c, '不快')
  expect(isHome(c)).toBe(false)
  const head = scanningLabel(c)
  expect(head).not.toBeNull()
  return head as string
}

/** 表示中の画面のタイル数(=スキャン項目数) */
const tileCount = (c: HTMLElement) => c.querySelectorAll('.grid-board .tile').length

/**
 * カーソルが n 項目進む(=ラベルが n 回変わる)まで時間を進める。ホームへ戻ったら打ち切る。
 * 画面内のラベルは重複しない前提。
 */
function advanceSteps(c: HTMLElement, n: number): void {
  let done = 0
  let last = scanningLabel(c)
  for (let t = 0; t < 600_000 && done < n; t += STEP_MS) {
    vi.advanceTimersByTime(STEP_MS)
    if (isHome(c)) return
    const now = scanningLabel(c)
    if (now !== last) {
      done += 1
      last = now
    }
  }
}

/** 画面の項目数×laps 周ぶんから extra 歩引いた位置まで進める(戻る直前) */
function advanceToJustBeforeReturn(c: HTMLElement, n: number): void {
  advanceSteps(c, n * IDLE_LAPS_BEFORE_HOME - 1)
}

describe('Issue #76: 下位画面の無入力3周でホームへ自動復帰', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
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
  })

  it('無入力のまま項目数×3歩(3周ぶん)の手前では戻らず、ちょうどで戻る(開いた直後の先頭待機は数えない)', () => {
    const { container } = render(() => <App />)
    openDiscomfort(container)
    const n = tileCount(container)
    // 開いた直後の先頭待機を十分に過ぎても、まだ戻らない
    vi.advanceTimersByTime(2000)
    expect(isHome(container)).toBe(false)
    advanceSteps(container, n * 2) // 2周ぶん
    expect(isHome(container)).toBe(false)
    expect(screenLabel(container)).toContain('不快')
    advanceSteps(container, n - 1) // 3周ぶんの1歩手前
    expect(isHome(container)).toBe(false)
    expect(screenLabel(container)).toContain('不快')
    advanceSteps(container, 1)
    expect(isHome(container)).toBe(true)
    expect(scanningLabel(container)).toBe('緊急') // ホームの先頭から再開する
  })

  describe('入力で数え直しになる(その時点からちょうど3周ぶんで戻る)', () => {
    const cases: Array<[string, (c: HTMLElement) => void, object]> = [
      [
        'キーの長押し繰り返し(event.repeat)',
        () => {
          fireEvent.keyDown(window, { key: ' ', repeat: true })
          fireEvent.keyUp(window, { key: ' ' }) // 離した時点から数え直す
        },
        {},
      ],
      [
        'タイルのタップ(離して決定で、離さず取り消した=何も実行されない押下)',
        (c) => {
          fireEvent.pointerDown(tile(c, scanningLabel(c) as string), { pointerId: 9 })
          fireEvent.pointerCancel(window, { pointerId: 9 })
        },
        { activateOn: 'release' },
      ],
    ]
    it.each(cases)('%s', (_name, act, settings) => {
      setSettings(settings)
      const { container } = render(() => <App />)
      openDiscomfort(container)
      const n = tileCount(container)
      advanceSteps(container, n * 2 + 1) // あと少しで戻る状態(末尾近く)
      expect(isHome(container)).toBe(false)
      const before = screenLabel(container)
      act(container)
      expect(screenLabel(container)).toBe(before) // 画面遷移はしていない(純粋に数え直しだけ)
      advanceToJustBeforeReturn(container, n) // 入力から 3周ぶん−1歩
      expect(isHome(container)).toBe(false) // 入力から数えて3周ぶんには足りない
      advanceSteps(container, 1)
      expect(isHome(container)).toBe(true)
    })
  })

  it('支援技術の合成 click(pointerdown を伴わない onTileClick)でも数え直しになる', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '文字盤')
    const n = tileCount(container)
    expect(n).toBe(14)
    advanceSteps(container, n * 2 + 1)
    expect(isHome(container)).toBe(false)
    const target = Array.from(container.querySelectorAll<HTMLElement>('.grid-board .tile')).find(
      (el) => el.querySelector('.tile-label')?.textContent === '1字消す',
    ) as HTMLElement
    expect(target).toBeTruthy()
    fireEvent.click(target) // 画面遷移しない(文字盤の行段階のまま)
    expect(screenLabel(container)).toContain('文字盤')
    advanceToJustBeforeReturn(container, n)
    expect(isHome(container)).toBe(false)
    advanceSteps(container, 1)
    expect(isHome(container)).toBe(true)
  })

  it('末尾の1つ手前(13番目)で入力しても、その入力から3周ぶんかかる(2周ちょっとでは戻らない)', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '文字盤')
    const n = tileCount(container)
    // 13番目(index 12)まで進めて入力(タイルの直接タップ。「1字消す」は#95以降 末尾の14番目だが、位置と無関係に押せる)(タイルの直接タップ)
    advanceSteps(container, 12)
    fireEvent.pointerDown(tile(container, '1字消す'), { pointerId: 3 })
    fireEvent.pointerUp(window, { pointerId: 3 })
    expect(isHome(container)).toBe(false)
    advanceSteps(container, n * 2 + 3) // 2周ちょっと(先頭へ戻ってから更に進んだ)
    expect(isHome(container)).toBe(false)
    advanceSteps(container, n - 3 - 1)
    expect(isHome(container)).toBe(false)
    advanceSteps(container, 1)
    expect(isHome(container)).toBe(true)
  })

  describe('押している間は数えない(離したら改めて3周ぶんで戻る)', () => {
    it('タイルを押したまま(離して決定)3周ぶん超えても戻らない。取り消して離すと、そこから3周ぶんで戻る', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      openDiscomfort(container)
      const n = tileCount(container)
      fireEvent.pointerDown(tile(container, scanningLabel(container) as string), { pointerId: 5 })
      advanceSteps(container, n * 3 + 5) // 押したまま 3周ぶん超過
      expect(isHome(container)).toBe(false)
      expect(screenLabel(container)).toContain('不快')
      fireEvent.pointerCancel(window, { pointerId: 5 })
      advanceToJustBeforeReturn(container, n)
      expect(isHome(container)).toBe(false) // 離してから 3周ぶんに足りない
      advanceSteps(container, 1)
      expect(isHome(container)).toBe(true)
    })

    it('「緊急」をキーで押したまま(離して決定)3周ぶん超えても戻らず、離すと緊急が実行される', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      openDiscomfort(container)
      const n = tileCount(container)
      advanceSteps(container, 1) // 先頭「戻る」の次=「緊急」
      expect(scanningLabel(container)).toBe('緊急')
      fireEvent.keyDown(window, { key: ' ', code: 'Space' })
      advanceSteps(container, n * 3 + 5)
      expect(isHome(container)).toBe(false)
      expect(screenLabel(container)).toContain('不快')
      fireEvent.keyUp(window, { key: ' ', code: 'Space' })
      expect(isHome(container)).toBe(false) // ホームでなく緊急(詳細)画面へ
      expect(screenLabel(container)).not.toContain('不快')
      expect(container.querySelector('.emergency-status-message')).not.toBeNull()
    })

    it('ウィンドウがフォーカスを失うと押下中の扱いは解除され、数え直す', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      openDiscomfort(container)
      const n = tileCount(container)
      fireEvent.keyDown(window, { key: ' ', code: 'Space' })
      advanceSteps(container, n * 3 + 5)
      expect(isHome(container)).toBe(false)
      fireEvent.blur(window) // keyup を取りこぼした
      advanceToJustBeforeReturn(container, n)
      expect(isHome(container)).toBe(false)
      advanceSteps(container, 1)
      expect(isHome(container)).toBe(true)
    })


    it('ページが非表示になると押下中の扱いは解除され、数え直す(visibilitychange)', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      openDiscomfort(container)
      const n = tileCount(container)
      fireEvent.keyDown(window, { key: ' ', code: 'Space' })
      advanceSteps(container, n * 3 + 5)
      expect(isHome(container)).toBe(false)
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      try {
        document.dispatchEvent(new Event('visibilitychange')) // keyup を取りこぼした
      } finally {
        delete (document as unknown as Record<string, unknown>).visibilityState
      }
      advanceToJustBeforeReturn(container, n)
      expect(isHome(container)).toBe(false)
      advanceSteps(container, 1)
      expect(isHome(container)).toBe(true)
    })

    it('背景(タイルの外)に触れても数え直しになり、触れている間は戻らない', () => {
      const { container } = render(() => <App />)
      openDiscomfort(container)
      const n = tileCount(container)
      const board = container.querySelector('.grid-board') as HTMLElement
      advanceSteps(container, n * 2 + 1) // あと少しで戻る状態
      expect(isHome(container)).toBe(false)
      fireEvent.pointerDown(board, { pointerId: 7 })
      advanceSteps(container, n * 3 + 5) // 触れたまま 3周ぶん超過
      expect(isHome(container)).toBe(false)
      expect(screenLabel(container)).toContain('不快')
      fireEvent.pointerUp(window, { pointerId: 7 })
      expect(screenLabel(container)).toContain('不快') // 背景は何も実行しない
      advanceToJustBeforeReturn(container, n)
      expect(isHome(container)).toBe(false) // 離してから 3周ぶんに足りない
      advanceSteps(container, 1)
      expect(isHome(container)).toBe(true)
    })
  })

  it('パンくずで祖先へ移動すると数え直しになる', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    expect(screenLabel(container)).toContain('痛い場所')
    const n1 = tileCount(container)
    advanceSteps(container, n1 * 2 + 1) // あと少しで戻る状態
    const crumb = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.screen-breadcrumb button.breadcrumb-link'),
    ).find((b) => b.textContent === '不快') as HTMLButtonElement
    expect(crumb).toBeDefined()
    fireEvent.click(crumb)
    expect(screenLabel(container)).toContain('不快')
    expect(screenLabel(container)).not.toContain('痛い場所')
    const n2 = tileCount(container)
    advanceToJustBeforeReturn(container, n2)
    expect(isHome(container)).toBe(false) // 遷移から数えて3周ぶんに足りない
    advanceSteps(container, 1)
    expect(isHome(container)).toBe(true)
  })

  it('介助者メニューを開いて閉じると、ホーム先頭から再開する', () => {
    const { container } = render(() => <App />)
    openDiscomfort(container)
    const n = tileCount(container)
    advanceSteps(container, n * 3 - 2) // 戻る直前
    fireEvent.pointerDown(container.querySelector('.caregiver-button') as HTMLElement, {
      pointerType: 'mouse',
      button: 0,
    })
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'x' }) // 閉じる(ホームへ)
    fireEvent.keyUp(window, { key: 'x' })
    expect(container.querySelector('.caregiver-overlay')).toBeNull()
    expect(isHome(container)).toBe(true)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('介助者メニューを開いている間は数えず、戻らない', () => {
    const { container } = render(() => <App />)
    openDiscomfort(container)
    fireEvent.pointerDown(container.querySelector('.caregiver-button') as HTMLElement, {
      pointerType: 'mouse',
      button: 0,
    })
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
    // 3周分を十分に超える時間(メニューの無操作自動クローズ60秒の手前まで)
    vi.advanceTimersByTime(50_000)
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
    expect(screenLabel(container)).toContain('不快')
  })

  it('モールス画面では戻らない', () => {
    setSettings({ morseEnabled: true })
    const { container } = render(() => <App />)
    fireEvent.pointerDown(tile(container, 'モールス'), { pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(container.querySelector('.morse-panel')).not.toBeNull()
    vi.advanceTimersByTime(MORSE_IDLE_EXIT_MS - 1000) // モールス自身の無操作終了(30秒)の手前まで
    expect(container.querySelector('.morse-panel')).not.toBeNull()
  })

  it('ホームでは何周しても戻る先がなく、ホームのまま(緊急の先頭に戻り続ける)', () => {
    const { container } = render(() => <App />)
    expect(isHome(container)).toBe(true)
    advanceSteps(container, tileCount(container) * 4)
    expect(isHome(container)).toBe(true)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('自動復帰したあとも、緊急表示と伝達済みメッセージは残る', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急 → urgentDetail
    fireEvent.keyUp(window, { key: ' ' })
    selectByLabel(container, '苦しい') // 詳細を選んで home
    selectByLabel(container, 'はい') // 緊急中の通常伝達
    openDiscomfort(container)
    advanceSteps(container, tileCount(container) * 3)
    expect(isHome(container)).toBe(true)
    expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
      '緊急です。来てください。',
    )
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('はい。')
  })
})
