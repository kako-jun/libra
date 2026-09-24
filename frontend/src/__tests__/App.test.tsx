import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'

// requirements.md 既定値: intervalMs=1500, headHoldMultiplier=2(=headHoldMs 3000), debounceMs=500
const HEAD_HOLD_MS = 3000
const INTERVAL_MS = 1500

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

function tileLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.tile-label')).map((el) => el.textContent ?? '')
}

function scanningLabel(container: HTMLElement): string | null {
  const el = container.querySelector('.tile.scanning .tile-label')
  return el ? el.textContent : null
}

function h1Text(container: HTMLElement): string | null {
  return container.querySelector('h1')?.textContent ?? null
}

describe('App', () => {
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
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('起動直後は先頭待機中のためカーソルは index 0 のまま', () => {
    const { container } = render(() => <App />)
    expect(scanningLabel(container)).toBe('緊急')
    vi.advanceTimersByTime(HEAD_HOLD_MS - 1)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('先頭待機の経過後は interval ごとにカーソルが進む', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS)
    expect(scanningLabel(container)).toBe('はい')
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(scanningLabel(container)).toBe('いいえ')
  })

  it('Space キーでカーソル位置の項目が実行される', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // カーソルは「はい」
    fireEvent.keyDown(window, { key: ' ' })
    expect(h1Text(container)).toBe('はい')
  })

  it('画面クリック（pointerdown）でも同じ項目が実行される', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // カーソルは「はい」
    const board = container.querySelector('.grid-board') as HTMLElement
    fireEvent.pointerDown(board)
    expect(h1Text(container)).toBe('はい')
  })

  it('event.repeat の keydown は無視される', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // カーソルは「はい」
    fireEvent.keyDown(window, { key: ' ', repeat: true })
    expect(h1Text(container)).not.toBe('はい')
    expect(scanningLabel(container)).toBe('はい')
  })

  it('連打無視区間内の2回目の押下では二重に遷移しない', () => {
    const { container } = render(() => <App />)
    // 文字盤ナビへ進める(index5)
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 4)
    expect(scanningLabel(container)).toBe('文字盤 →')
    fireEvent.keyDown(window, { key: ' ' }) // letters 画面へ遷移
    expect(container.querySelector('.letter-strip')).not.toBeNull()

    // letters 画面: index0=緊急, index1=戻る, index2=最初の文字(letterAppend)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1(戻る)
    vi.advanceTimersByTime(INTERVAL_MS) // index2(最初の文字)
    fireEvent.keyDown(window, { key: ' ' }) // 1回目: 文字を追加
    fireEvent.keyDown(window, { key: ' ' }) // 2回目: 連打無視区間内なので無視されるはず
    const output = container.querySelector('.letter-strip output')
    expect(output?.textContent?.length).toBe(1)
  })

  it('緊急選択で確認なしに即「緊急です。来てください」を表示し緊急詳細画面へ遷移する', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // index0=緊急
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.status-stack')?.textContent).toContain('緊急')
  })

  it('緊急中にホームで「はい」を選んでも見出しは緊急のまま副表示に「最新: はい」が出る', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択 → urgentDetail
    vi.advanceTimersByTime(HEAD_HOLD_MS) // urgentDetail index1=戻る
    fireEvent.keyDown(window, { key: ' ' }) // home へ戻る
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    expect(scanningLabel(container)).toBe('はい')
    fireEvent.keyDown(window, { key: ' ' }) // はい を選択
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.emergency-sub')?.textContent).toContain('最新: はい')
  })

  it('緊急中はホームに取り消しが出ない', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択
    vi.advanceTimersByTime(HEAD_HOLD_MS)
    fireEvent.keyDown(window, { key: ' ' }) // 戻る → home
    expect(tileLabels(container)).not.toContain('取り消し')
  })

  it('伝達直後の1周だけ取り消しが出て、1周後に消え、消えた後もカーソルは正しい項目を指す', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    fireEvent.keyDown(window, { key: ' ' }) // はい を選択 → home に戻る、取り消し表示
    expect(tileLabels(container)).toContain('取り消し')
    expect(tileLabels(container).length).toBe(7)

    // 1周(7項目)分進めて index が 0 に戻るまで進める
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 6)
    expect(tileLabels(container)).not.toContain('取り消し')
    expect(tileLabels(container).length).toBe(6)
    expect(scanningLabel(container)).toBe('緊急')

    // ずれ回帰: 取り消しが消えた後も次の項目は正しく「はい」を指す
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(scanningLabel(container)).toBe('はい')
  })

  it('介助者ボタンの2秒未満の長押しではメニューが開かず、スイッチ扱いにもならない', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(1000)
    fireEvent.pointerUp(button)
    expect(container.querySelector('.caregiver-overlay')).toBeNull()
    expect(h1Text(container)).not.toBe('緊急です。来てください')
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('介助者ボタンを2秒以上長押しするとメニューが開く', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
  })

  it('介助者メニュー中はキー・クリックがスイッチとして効かず、スキャンも進まない', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニュー開く
    const before = h1Text(container)

    fireEvent.keyDown(window, { key: ' ' })
    const board = container.querySelector('.grid-board') as HTMLElement
    fireEvent.pointerDown(board)
    vi.advanceTimersByTime(10000) // スキャンが進むはずの時間

    expect(h1Text(container)).toBe(before)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('介助者メニューの緊急解除ボタンで緊急表示が消える', () => {
    const { container, getByText } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択
    expect(h1Text(container)).toBe('緊急です。来てください')

    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const clearButton = getByText(/緊急解除/)
    fireEvent.click(clearButton)

    expect(container.querySelector('.emergency-sub')).toBeNull()
    expect(h1Text(container)).not.toBe('緊急です。来てください')
  })

  it('?dev なしでは数字キー "3" はカーソル位置の項目を実行する(直接ジャンプしない)', () => {
    const { container } = render(() => <App />)
    // カーソルは index0(緊急)。"3"キーは index2(いいえ)への直接ジャンプではなく
    // カーソル位置(緊急)を実行するはず
    fireEvent.keyDown(window, { key: '3' })
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  it('M1: 押下→画面遷移→連打無視区間内の2回目は遷移先の先頭を誤って実行しない', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    fireEvent.keyDown(window, { key: ' ' }) // はい選択 → home先頭(緊急)へ遷移
    expect(h1Text(container)).toBe('はい')

    vi.advanceTimersByTime(100) // debounceMs(500)未満
    fireEvent.keyDown(window, { key: ' ' }) // 連打: 遷移先の先頭(緊急)を誤って実行してはいけない
    expect(h1Text(container)).toBe('はい')
    expect(h1Text(container)).not.toBe('緊急です。来てください')
  })

  it('設定変更がリロード相当（再マウント）後も localStorage から復元される', () => {
    const first = render(() => <App />)
    const button = first.container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    const slider = first.container.querySelector(
      'input[type="range"][min="500"]',
    ) as HTMLInputElement
    fireEvent.input(slider, { target: { value: '2500' } })
    first.unmount()

    const second = render(() => <App />)
    const button2 = second.container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button2)
    vi.advanceTimersByTime(2000)
    expect(second.container.textContent).toContain('スキャン間隔: 2.5 秒')
  })
})
