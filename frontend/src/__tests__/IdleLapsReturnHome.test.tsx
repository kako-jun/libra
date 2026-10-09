// Issue #76: 下位画面で入力がないまま3周するとホームへ自動復帰する(App レベル)。
// 周回は「カーソルが先頭以外から先頭へ戻った瞬間」で数える。画面ごとに項目数が違うので、
// 固定の ms ではなくカーソル位置の観測(waitForWrap)で周回を進める。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'
import { MORSE_IDLE_EXIT_MS } from '../lib/morse'

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

/** カーソルが先頭以外から先頭へ戻る(=1周終わる)まで進める。ホームへ戻ったら true で打ち切る */
function waitForWrap(c: HTMLElement, head: string): void {
  let left = false
  for (let t = 0; t < 120_000; t += STEP_MS) {
    vi.advanceTimersByTime(STEP_MS)
    if (isHome(c)) return
    const now = scanningLabel(c)
    if (now !== head) left = true
    else if (left) return
  }
  throw new Error('wrap not reached')
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

  it('無入力のまま2周では戻らず、3周目の終わりでホームへ戻る(開いた直後の先頭待機は数えない)', () => {
    const { container } = render(() => <App />)
    const head = openDiscomfort(container)
    // 開いた直後の先頭待機を十分に過ぎても、まだ1周も終わっていないので戻らない
    vi.advanceTimersByTime(2000)
    expect(isHome(container)).toBe(false)
    waitForWrap(container, head) // 1周
    expect(isHome(container)).toBe(false)
    expect(screenLabel(container)).toContain('不快')
    waitForWrap(container, head) // 2周
    expect(isHome(container)).toBe(false)
    expect(screenLabel(container)).toContain('不快')
    waitForWrap(container, head) // 3周
    expect(isHome(container)).toBe(true)
    expect(scanningLabel(container)).toBe('緊急') // ホームの先頭から再開する
  })

  describe('周回の途中の入力で数え直しになる(その後も3周で戻る)', () => {
    const cases: Array<[string, (c: HTMLElement) => void, object]> = [
      [
        'キーの長押し繰り返し(event.repeat)',
        () => fireEvent.keyDown(window, { key: ' ', repeat: true }),
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
      const head = openDiscomfort(container)
      waitForWrap(container, head)
      waitForWrap(container, head) // あと1周で戻る状態
      expect(isHome(container)).toBe(false)
      const before = screenLabel(container)
      act(container)
      expect(screenLabel(container)).toBe(before) // 画面遷移はしていない(純粋に数え直しだけ)
      waitForWrap(container, head)
      waitForWrap(container, head)
      expect(isHome(container)).toBe(false) // 入力から数えて2周ではまだ戻らない
      waitForWrap(container, head)
      expect(isHome(container)).toBe(true) // 3周で戻る
    })
  })

  it('パンくずで祖先へ移動すると数え直しになる', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    const head = scanningLabel(container) as string
    expect(screenLabel(container)).toContain('痛い場所')
    waitForWrap(container, head)
    waitForWrap(container, head) // あと1周で戻る状態
    const crumb = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.screen-breadcrumb button.breadcrumb-link'),
    ).find((b) => b.textContent === '不快') as HTMLButtonElement
    expect(crumb).toBeDefined()
    fireEvent.click(crumb)
    expect(screenLabel(container)).toContain('不快')
    expect(screenLabel(container)).not.toContain('痛い場所')
    const head2 = scanningLabel(container) as string
    waitForWrap(container, head2)
    waitForWrap(container, head2)
    expect(isHome(container)).toBe(false) // 遷移から数えて2周では戻らない
    waitForWrap(container, head2)
    expect(isHome(container)).toBe(true)
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
    waitForWrapHome(container)
    waitForWrapHome(container)
    waitForWrapHome(container)
    waitForWrapHome(container)
    expect(isHome(container)).toBe(true)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('自動復帰したあとも、緊急表示と伝達済みメッセージは残る', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急 → urgentDetail
    fireEvent.keyUp(window, { key: ' ' })
    selectByLabel(container, '苦しい') // 詳細を選んで home
    selectByLabel(container, 'はい') // 緊急中の通常伝達
    const head = openDiscomfort(container)
    waitForWrap(container, head)
    waitForWrap(container, head)
    waitForWrap(container, head)
    expect(isHome(container)).toBe(true)
    expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
      '緊急です。来てください。',
    )
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('はい。')
  })
})

/** ホームで1周(緊急から出て緊急へ戻る)進める */
function waitForWrapHome(c: HTMLElement): void {
  waitForWrap(c, '緊急')
}
