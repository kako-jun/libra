import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'

// App の配線(h1 の ref と再計算の契機)だけを見るため、DOM 測定本体はモックにする
vi.mock('../lib/fitHeading', () => ({ applyHeadingFit: vi.fn() }))

import App from '../App'
import { applyHeadingFit } from '../lib/fitHeading'

const HEAD_HOLD_MS = 2000
const FRAME_MS = 16

describe('App: 見出しの 1 行フィット配線 (Issue #22)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
    vi.mocked(applyHeadingFit).mockClear()
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('起動後、rAF 経由で h1 に applyHeadingFit が呼ばれる', () => {
    const { container } = render(() => <App />)
    expect(applyHeadingFit).not.toHaveBeenCalled() // rAF でまとめるので同期では呼ばない
    vi.advanceTimersByTime(FRAME_MS * 2)
    expect(applyHeadingFit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(applyHeadingFit).mock.calls[0][0]).toBe(container.querySelector('h1'))
  })

  it('メッセージが変わると再度 h1 に対して呼ばれる', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(FRAME_MS * 2)
    vi.mocked(applyHeadingFit).mockClear()
    vi.advanceTimersByTime(HEAD_HOLD_MS) // カーソルが「はい」へ
    fireEvent.keyDown(window, { key: ' ' }) // はい選択 → メッセージが変わる
    vi.advanceTimersByTime(FRAME_MS * 2)
    expect(applyHeadingFit).toHaveBeenCalled()
    expect(vi.mocked(applyHeadingFit).mock.calls.at(-1)?.[0]).toBe(container.querySelector('h1'))
  })

  it('アンマウント後は rAF の予約も呼び出しも起きない', () => {
    render(() => <App />)
    cleanup()
    vi.mocked(applyHeadingFit).mockClear()
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(FRAME_MS * 4)
    expect(applyHeadingFit).not.toHaveBeenCalled()
  })

  it('document.fonts.ready の解決がアンマウント後なら再計算を予約しない', async () => {
    let resolveReady: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } })
    try {
      render(() => <App />)
      vi.advanceTimersByTime(FRAME_MS * 2)
      cleanup()
      vi.mocked(applyHeadingFit).mockClear()
      resolveReady()
      await ready
      await Promise.resolve()
      vi.advanceTimersByTime(FRAME_MS * 4)
      expect(applyHeadingFit).not.toHaveBeenCalled()
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts
    }
  })
})
