// App を描画するテストの共通の道具(Issue #108〜#123 のテストで使う)。
// 端末の API(振動・読み上げ・音)を差し替え、本人の操作(タイルのタップ)と介助者の操作(メニュー)を短く書けるようにする。
import { expect, vi } from 'vitest'
import { cleanup, fireEvent } from '@solidjs/testing-library'
import * as offlineReadyModule from '../lib/offlineReady'

export const DEFAULT_MESSAGE = '選んだ内容がここに大きく出ます。'
export const EMERGENCY_MESSAGE = '緊急です。来てください。'
export const RELEASED_MESSAGE = '緊急を解除しました。'
/** 連打無視(既定 0.5 秒)を過ぎるまでの時間 */
const PAST_DEBOUNCE_MS = 600
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

/** beforeEach で呼ぶ。偽の時計・端末 API の差し替え・保存値の消去 */
export function setupApp(): void {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
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
  // 見出しのフィットが canvas を使う。jsdom は getContext 未実装なので「測れない」として黙らせる
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
}

/** afterEach で呼ぶ */
export function teardownApp(): void {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
}

export const setSettings = (value: object) =>
  window.localStorage.setItem('libra', JSON.stringify(value))

// ---- 画面の読み取り ----

export const tileLabels = (c: HTMLElement): string[] =>
  Array.from(c.querySelectorAll('.grid-board .tile-label')).map((el) => el.textContent ?? '')

export const scanningLabel = (c: HTMLElement): string | null =>
  c.querySelector('.tile.scanning .tile-label')?.textContent ?? null

export const tile = (c: HTMLElement, label: string): HTMLElement => {
  const found = Array.from(c.querySelectorAll<HTMLElement>('.grid-board .tile')).find(
    (el) => el.querySelector('.tile-label')?.textContent === label,
  )
  expect(found, `タイル「${label}」`).toBeTruthy()
  return found as HTMLElement
}

export const breadcrumb = (c: HTMLElement): string[] =>
  Array.from(c.querySelectorAll('.screen-breadcrumb li')).map((el) => el.textContent ?? '')

export const isHome = (c: HTMLElement): boolean => breadcrumb(c).join('>') === 'ホーム'

export const emergencyBand = (c: HTMLElement): HTMLElement | null =>
  c.querySelector<HTMLElement>('.emergency-status')

export const isEmergency = (c: HTMLElement): boolean => emergencyBand(c) !== null

export const messagePanel = (c: HTMLElement): HTMLElement =>
  c.querySelector('.message-panel') as HTMLElement

/** 伝達欄の見出し(「直前に伝えたこと」など) */
export const panelLabel = (c: HTMLElement): string =>
  c.querySelector('.message-panel-label')?.textContent ?? ''

/** 伝達欄に見えている伝達文。最新が空で h1 を隠しているときは null */
export const shownMessage = (c: HTMLElement): string | null => {
  const h1 = c.querySelector('.message-panel h1') as HTMLElement | null
  if (!h1 || h1.hidden) return null
  return h1.textContent
}

// ---- 端末 API の呼び出しの読み取り ----

export const vibrateMock = () =>
  (navigator as unknown as { vibrate: ReturnType<typeof vi.fn> }).vibrate

export const vibrations = (): unknown[] => vibrateMock().mock.calls.map((call) => call[0])

export const lastVibration = (): unknown => vibrations().at(-1)

const speakMock = () =>
  (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } }).speechSynthesis
    .speak

/** 読み上げた文(呼ばれた順) */
export const spoken = (): string[] =>
  speakMock().mock.calls.map((call) => (call[0] as { text: string }).text)

export const clearDeviceCalls = (): void => {
  vibrateMock().mockClear()
  speakMock().mockClear()
}

// ---- 本人の操作 ----

/** タイルを直接タップする(連打無視を過ぎてから)。押したタイルがそのまま実行される */
export function tap(c: HTMLElement, label: string, pointerId = 1): void {
  vi.advanceTimersByTime(PAST_DEBOUNCE_MS)
  const target = tile(c, label)
  fireEvent.pointerDown(target, { pointerId, pointerType: 'touch' })
  // 押下で画面が切り替わるとタイルは DOM から外れ、そこへ送った pointerup は window へ届かない
  // (押しっぱなし扱いになり、無入力周回が数えられなくなる)。実機では指の下の要素から届くので、
  // つながっていれば元のタイル、外れていれば body へ送る
  fireEvent.pointerUp(target.isConnected ? target : document.body, {
    pointerId,
    pointerType: 'touch',
  })
}

/** カーソルが目的の項目に来るまで待って、スイッチ(キー)を押す */
export function selectByScan(c: HTMLElement, label: string): void {
  vi.advanceTimersByTime(PAST_DEBOUNCE_MS)
  for (let i = 0; i < 400 && scanningLabel(c) !== label; i += 1) vi.advanceTimersByTime(STEP_MS)
  expect(scanningLabel(c)).toBe(label)
  pressSwitch()
}

/** スイッチ(キー)を 1 回押して離す。カーソルのある項目が実行される */
export function pressSwitch(): void {
  fireEvent.keyDown(window, { key: ' ' })
  fireEvent.keyUp(window, { key: ' ' })
}

/**
 * カーソルが n 項目進む(=ラベルが n 回変わる)まで時間を進める。ホームへ戻ったら打ち切る。
 * 項目が 2 つの画面でもラベルは交互に変わるので数えられる。
 */
export function advanceSteps(c: HTMLElement, n: number): void {
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

// ---- 介助者の操作 ----

export const menuOpen = (c: HTMLElement): boolean => c.querySelector('.caregiver-overlay') !== null

/** 介助者用メニューを開く(キーボード・支援技術の click 相当。押下を伴わない) */
export function openCaregiverMenu(c: HTMLElement): void {
  fireEvent.click(c.querySelector('.caregiver-button') as HTMLElement)
  expect(menuOpen(c)).toBe(true)
}

export function closeCaregiverMenu(c: HTMLElement): void {
  fireEvent.click(c.querySelector('.caregiver-close') as HTMLElement)
  expect(menuOpen(c)).toBe(false)
}

export function selectCaregiverTab(c: HTMLElement, label: string): HTMLElement {
  const tab = Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]')).find(
    (t) => t.textContent === label,
  )
  expect(tab, `タブ「${label}」`).toBeTruthy()
  fireEvent.click(tab as HTMLElement)
  return c.querySelector('.caregiver-tabpanel') as HTMLElement
}

export function buttonByText(root: Element, text: string): HTMLElement {
  const found = Array.from(root.querySelectorAll<HTMLElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
  expect(found, `ボタン「${text}」`).toBeTruthy()
  return found as HTMLElement
}

/** click に pointerId を載せる(実ブラウザの click は PointerEvent で、押下と同じ pointerId を持つ) */
export const pointerClick = (el: Element, pointerId: number) =>
  fireEvent(el, new PointerEvent('click', { pointerId, bubbles: true, cancelable: true }))
