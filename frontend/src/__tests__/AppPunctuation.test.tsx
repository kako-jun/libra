// Issue #46: 句読点規則(requirements.md §4.1.3)の App 結合テスト。文言の表と保存データの
// 昇格は lib/__tests__/punctuation.test.ts。ここは「実際に画面・読み上げへ出る文言」を見る。
//
// デシジョンテーブル
//   操作/状態                                   | 観測
//   緊急開始(voice=full)                        | 読み上げ=EMERGENCY_MESSAGE=上部の緊急表示(同一文言)
//   緊急詳細を選ぶ(voice=full)                  | 読み上げ=EMERGENCY_MESSAGE+詳細ラベル(「。」の直後に続く)
//   緊急詳細を選ぶ(voice=short)                 | 読み上げ=詳細ラベルのみ(句点なし)
//   「はい」を伝える(voice=full)                | 本文「はい。」を読む。表示も「はい。」
//   聴覚スキャン(voice=full)でカーソル移動      | 読むのはラベルのまま(句点なし)
//   起動直後のメッセージ欄                      | 既定文が「。」で終わる
//   文字盤の入力欄が空                          | 既定文が「。」で終わる
//   モールス画面の凡例(既定/下限あり)           | 全行が「。」で終わる。SOS行は「）。」
//   旧既定(句点なし)が保存済み                  | 起動後の伝達は新既定(句点つき)。書き換え済みは保存のまま
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'
import { EMERGENCY_MESSAGE } from '../lib/phrases'

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

const speakMock = () =>
  (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } }).speechSynthesis
    .speak
const spoken = (): string[] => speakMock().mock.calls.map((c) => (c[0] as { text: string }).text)

function scanningLabel(container: HTMLElement): string | null {
  return container.querySelector('.tile.scanning .tile-label')?.textContent ?? null
}
function selectByLabel(container: HTMLElement, label: string) {
  for (let i = 0; i < 40 && scanningLabel(container) !== label; i += 1) {
    vi.advanceTimersByTime(INTERVAL_MS)
  }
  expect(scanningLabel(container)).toBe(label)
  vi.advanceTimersByTime(600)
  fireEvent.keyDown(window, { key: ' ' })
}
const legendLines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.morse-legend li')).map((li) =>
    (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
  )

describe('Issue #46 句読点(App 結合)', () => {
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

  it('緊急開始の読み上げ・上部の緊急表示・緊急詳細の読み上げが、同一の EMERGENCY_MESSAGE', () => {
    window.localStorage.setItem('libra', JSON.stringify({ voiceMode: 'full' }))
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急
    expect(spoken()).toEqual([EMERGENCY_MESSAGE])
    expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
      EMERGENCY_MESSAGE,
    )
    selectByLabel(container, '苦しい')
    expect(spoken().at(-1)).toBe(`${EMERGENCY_MESSAGE}苦しい`)
    expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
      EMERGENCY_MESSAGE,
    )
  })

  it('音声「短く」の緊急詳細は詳細ラベルだけ(句点なしのまま)', () => {
    window.localStorage.setItem('libra', JSON.stringify({ voiceMode: 'short' }))
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' })
    selectByLabel(container, '苦しい')
    expect(spoken().at(-1)).toBe('苦しい')
  })

  it('「はい」を伝えると、本文は「はい。」(表示も読み上げも)・ラベルは「はい」のまま', () => {
    window.localStorage.setItem('libra', JSON.stringify({ voiceMode: 'full' }))
    const { container } = render(() => <App />)
    selectByLabel(container, 'はい')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('はい。')
    expect(spoken().at(-1)).toBe('はい。')
    const labels = Array.from(container.querySelectorAll('.tile-label')).map(
      (e) => e.textContent ?? '',
    )
    expect(labels).toContain('はい')
    expect(labels).not.toContain('はい。')
  })

  it('聴覚スキャンの読み上げはラベルのまま(句点が付かない)', () => {
    window.localStorage.setItem('libra', JSON.stringify({ voiceMode: 'full', auditoryScan: true }))
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 4)
    const read = spoken()
    expect(read.length).toBeGreaterThanOrEqual(3)
    expect(read).toEqual(expect.arrayContaining(['はい', 'いいえ']))
    for (const t of read) expect(t).not.toMatch(/[。、？]/)
    expect(scanningLabel(container)).not.toBeNull()
  })

  it('メッセージ欄の既定文と文字盤の既定文は「。」で終わる', () => {
    const { container } = render(() => <App />)
    expect(container.querySelector('.message-panel h1')?.textContent).toBe(
      '選んだ内容がここに大きく出ます。',
    )
    selectByLabel(container, '文字盤')
    expect(container.querySelector('.letter-strip output')?.textContent).toBe(
      '文字を選んでください。',
    )
  })

  it('モールス凡例は全行が「。」で終わる(SOS 行は「）。」・下限ありの行も)', () => {
    window.localStorage.setItem('libra', JSON.stringify({ morseEnabled: true, minHoldMs: 800 }))
    const { container } = render(() => <App />)
    for (let i = 0; i < 40 && scanningLabel(container) !== 'モールス'; i += 1) {
      vi.advanceTimersByTime(INTERVAL_MS)
    }
    vi.advanceTimersByTime(600)
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(900)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(100)
    const lines = legendLines(container)
    expect(lines.length).toBe(10)
    for (const l of lines) expect(l.endsWith('。'), l).toBe(true)
    expect(lines.find((l) => l.startsWith('緊急＝SOS'))?.endsWith('数え直し）。')).toBe(true)
    for (const l of lines) {
      expect(l).not.toContain('。。')
      expect(l).not.toContain('？。')
    }
  })

  it('保存済みの旧既定は新既定で伝わり、書き換え済み・カスタムの保存データは書き換わらない', () => {
    window.localStorage.setItem(
      'libra',
      JSON.stringify({
        voiceMode: 'full',
        phrases: {
          discomfort: [
            { id: 'suffering', label: '苦しい', text: '苦しいです', tone: 'urgent' },
            { id: 'phlegm', label: '痰', text: '痰をとって' },
            { id: 'my1', label: '水', text: '水がほしいです' },
          ],
        },
      }),
    )
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    selectByLabel(container, '苦しい')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('苦しいです。')
    selectByLabel(container, '不快')
    selectByLabel(container, '痰')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('痰をとって')
    selectByLabel(container, '不快')
    selectByLabel(container, '水')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('水がほしいです')
  })
})
