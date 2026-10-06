// Issue #43: 緊急の警告音(ピコピコ)の廃止。緊急は「静かな視覚表示 + 振動」だけで伝える。
//
// デシジョンテーブル(緊急の発生経路 × 観測対象)。全経路で同じ結果になることを確認する。
//   経路               | oscillator | 緊急の視覚表示 | 周期振動 | .audio-status-hint
//   スキャンで選択     |     0      |     維持       |  3秒毎   |   なし
//   モールス-5つ即緊急 |     0      |     維持       |  3秒毎   |   なし
//   リロード復元       |     0      |     維持       | 3秒毎(直後は出ない) | なし
//   解除後             |     0      |     消える     |  止まる  |   なし
import swSource from '../../public/sw.js?raw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'
import { resumeToneAudioContext } from '../lib/tone'
import { HAPTIC_PATTERNS } from '../lib/feedback'
import {
  DEFAULT_SETTINGS,
  exportSettingsJson,
  loadSettings,
  parseSettingsJson,
} from '../lib/settings'

const HEAD_HOLD_MS = 3000
const INTERVAL_MS = 1500
const EMERGENCY_TEXT = '緊急です。来てください'
const EMERGENCY_KEY = 'libra:emergency'

let oscillatorCount = 0
let audioState: 'running' | 'suspended' = 'running'

class MockAudioContext {
  state: 'running' | 'suspended' = audioState
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    oscillatorCount += 1
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

const vibrateMock = () => navigator.vibrate as unknown as ReturnType<typeof vi.fn>
const speakMock = () =>
  (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } }).speechSynthesis
    .speak
const activeVibrations = () =>
  vibrateMock().mock.calls.filter(
    (c) => JSON.stringify(c[0]) === JSON.stringify(HAPTIC_PATTERNS.emergencyActive),
  ).length

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
function clearEmergencyViaCaregiver(container: HTMLElement) {
  fireEvent.click(container.querySelector('.caregiver-button') as HTMLElement)
  const target = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('緊急解除'),
  ) as HTMLElement
  expect(target).toBeTruthy()
  fireEvent.click(target)
}
function tap(ms: number) {
  fireEvent.keyDown(window, { key: ' ', code: 'Space' })
  vi.advanceTimersByTime(ms)
  fireEvent.keyUp(window, { key: ' ', code: 'Space' })
  vi.advanceTimersByTime(150)
}

type Path = { name: string; start: () => ReturnType<typeof render> }
const PATHS: Path[] = [
  {
    name: 'スキャンで選択',
    start: () => {
      const view = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' })
      return view
    },
  },
  {
    name: 'モールスSOSで即緊急',
    start: () => {
      window.localStorage.setItem('libra', JSON.stringify({ morseEnabled: true }))
      const view = render(() => <App />)
      selectByLabel(view.container, 'モールス')
      for (const symbol of '...---...') tap(symbol === '-' ? 600 : 100)
      return view
    },
  },
  {
    name: 'リロード復元',
    start: () => {
      window.localStorage.setItem(
        EMERGENCY_KEY,
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      return render(() => <App />)
    },
  },
]

describe('Issue #43: 緊急の警告音廃止', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
    oscillatorCount = 0
    audioState = 'running'
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

  describe.each(PATHS)('経路: $name', ({ start }) => {
    it('緊急中は十数秒進めても oscillator が鳴らず、警告音停止中ヒントも出ず、視覚表示が維持される', () => {
      const { container } = start()
      oscillatorCount = 0
      for (let i = 0; i < 4; i += 1) {
        vi.advanceTimersByTime(3000)
        expect(oscillatorCount).toBe(0)
        expect(container.querySelector('.audio-status-hint')).toBeNull()
        expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
          EMERGENCY_TEXT,
        )
      }
      expect(window.localStorage.getItem(EMERGENCY_KEY)).toContain('"active":true')
    })

    it('AudioContext が suspended でも「警告音停止中」ヒントは出ない', () => {
      audioState = 'suspended'
      const { container } = start()
      vi.advanceTimersByTime(2000)
      expect(container.querySelector('.audio-status-hint')).toBeNull()
      expect(container.textContent).not.toContain('警告音停止中')
    })

    it('周期振動が3秒ごとに出る(音は出ない)', () => {
      start()
      vibrateMock().mockClear()
      vi.advanceTimersByTime(9000)
      expect(activeVibrations()).toBe(3)
      expect(oscillatorCount).toBe(0)
    })

    it('介助者の解除で視覚表示が消え、振動も音も止まる', () => {
      const { container } = start()
      vi.advanceTimersByTime(3000)
      clearEmergencyViaCaregiver(container)
      expect(container.querySelector('.emergency-status')).toBeNull()
      expect(window.localStorage.getItem(EMERGENCY_KEY)).toBeNull()
      vibrateMock().mockClear()
      oscillatorCount = 0
      vi.advanceTimersByTime(12000)
      expect(activeVibrations()).toBe(0)
      expect(oscillatorCount).toBe(0)
      expect(container.querySelector('.audio-status-hint')).toBeNull()
    })
  })

  describe('通常時(緊急なし)にも警告音停止中ヒントは出ない', () => {
    it.each(['running', 'suspended'] as const)('AudioContext=%s', (state) => {
      audioState = state
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(2000)
      expect(container.querySelector('.audio-status-hint')).toBeNull()
    })
  })

  describe('周期振動の境界(3秒)', () => {
    it('2999ms では出ず、3000ms で1回目、3001ms でも増えず、6000ms で2回目', () => {
      render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急(t=0, 緊急発生の振動は即時)
      vibrateMock().mockClear()
      vi.advanceTimersByTime(2999)
      expect(activeVibrations()).toBe(0)
      vi.advanceTimersByTime(1)
      expect(activeVibrations()).toBe(1)
      vi.advanceTimersByTime(1)
      expect(activeVibrations()).toBe(1)
      vi.advanceTimersByTime(2999)
      expect(activeVibrations()).toBe(2)
    })

    it('本人の入力から 3000ms ちょうどなら周期振動が出る', () => {
      render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // t=0 緊急
      vi.advanceTimersByTime(3000) // 周期1回目
      fireEvent.keyDown(window, { key: ' ' }) // t=3000 本人入力(戻る)
      vibrateMock().mockClear()
      vi.advanceTimersByTime(3000) // t=6000: 入力から 3000ms
      expect(activeVibrations()).toBe(1)
    })

    it('本人の入力から 2999ms なら周期振動は出ず、次の周期で戻る', () => {
      render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // t=0 緊急
      vi.advanceTimersByTime(3001)
      fireEvent.keyDown(window, { key: ' ' }) // t=3001 本人入力
      vibrateMock().mockClear()
      vi.advanceTimersByTime(2999) // t=6000: 入力から 2999ms
      expect(activeVibrations()).toBe(0)
      vi.advanceTimersByTime(3000) // t=9000
      expect(activeVibrations()).toBe(1)
    })

    it('リロード復元の直後は緊急発生の振動を出さず、3秒後から周期振動', () => {
      window.localStorage.setItem(
        EMERGENCY_KEY,
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      render(() => <App />)
      expect(vibrateMock()).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2999)
      expect(vibrateMock()).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(activeVibrations()).toBe(1)
    })
  })

  describe('回帰: 効果音・読み上げ・聴覚スキャンは残っている', () => {
    it('効果音ONなら通常操作(はい)で oscillator が鳴る', () => {
      window.localStorage.setItem('libra', JSON.stringify({ hapticSoundAlso: true }))
      resumeToneAudioContext() // 実アプリは最初の pointerdown で呼ぶ
      const { container } = render(() => <App />)
      oscillatorCount = 0
      selectByLabel(container, 'はい')
      expect(oscillatorCount).toBeGreaterThan(0)
    })

    it('効果音ONでも、緊急(選択・周期)では効果音を重ねず振動だけ出す', () => {
      window.localStorage.setItem('libra', JSON.stringify({ hapticSoundAlso: true }))
      resumeToneAudioContext()
      render(() => <App />)
      oscillatorCount = 0
      fireEvent.keyDown(window, { key: ' ' })
      // 画面遷移(urgentDetailへ)の受理音(accepted)が1回だけ鳴る。緊急専用の音は無い
      expect(oscillatorCount).toBe(1)
      expect(vibrateMock()).toHaveBeenCalledWith(HAPTIC_PATTERNS.emergency)
      vi.advanceTimersByTime(9000)
      expect(oscillatorCount).toBe(1) // 周期経過で増えない
      expect(activeVibrations()).toBe(3)
    })

    it('緊急の選択は音声モードが有効なら読み上げられる', () => {
      window.localStorage.setItem('libra', JSON.stringify({ voiceMode: 'full' }))
      render(() => <App />)
      speakMock().mockClear()
      fireEvent.keyDown(window, { key: ' ' })
      const spoken = speakMock().mock.calls.map((c) => (c[0] as { text: string }).text)
      expect(spoken.some((t) => t.includes('緊急'))).toBe(true)
    })

    it('音声モードOFFなら緊急でも読み上げない(警告音も無い)', () => {
      render(() => <App />)
      speakMock().mockClear()
      fireEvent.keyDown(window, { key: ' ' })
      expect(speakMock()).not.toHaveBeenCalled()
      expect(oscillatorCount).toBe(0)
    })

    it('聴覚スキャンON: カーソル移動で項目名を読み上げる', () => {
      window.localStorage.setItem(
        'libra',
        JSON.stringify({ voiceMode: 'full', auditoryScan: true }),
      )
      render(() => <App />)
      speakMock().mockClear()
      vi.advanceTimersByTime(HEAD_HOLD_MS) // 緊急 → はい
      const spoken = speakMock().mock.calls.map((c) => (c[0] as { text: string }).text)
      expect(spoken).toContain('はい')
    })
  })

  describe('旧保存設定との互換', () => {
    const legacy = {
      voiceMode: 'full',
      auditoryScan: true,
      hapticSoundAlso: true,
      hapticSoundWhenVoiceOff: true,
      intervalMs: 2000,
    }

    it('警告音廃止前の設定(voiceMode 等)を読み込んでも値が保たれる', () => {
      window.localStorage.setItem('libra', JSON.stringify(legacy))
      const s = loadSettings()
      expect(s.voiceMode).toBe('full')
      expect(s.auditoryScan).toBe(true)
      expect(s.hapticSoundAlso).toBe(true)
      expect(s.intervalMs).toBe(2000)
    })

    it('未知の旧キー(alarm 関連など)が混ざっていても読み込みが壊れない', () => {
      window.localStorage.setItem(
        'libra',
        JSON.stringify({ ...legacy, alarmEnabled: true, alarmRepeatMs: 3000 }),
      )
      const s = loadSettings()
      expect(s.voiceMode).toBe('full')
      expect(s).not.toHaveProperty('alarmEnabled')
      const { container } = render(() => <App />)
      expect(container.querySelector('.grid-board')).not.toBeNull()
    })

    it('書き出し→取り込みの往復で設定が一致する', () => {
      const custom = { ...DEFAULT_SETTINGS, voiceMode: 'short' as const, auditoryScan: true }
      expect(parseSettingsJson(exportSettingsJson(custom))).toEqual(custom)
    })
  })

  describe('静的確認', () => {
    it('Service Worker に音声再生のコードが無い', () => {
      for (const word of ['AudioContext', 'createOscillator', 'new Audio', 'speechSynthesis']) {
        expect(swSource).not.toContain(word)
      }
    })

    it('警告音の残骸(startAlarm 等・ヒント表示・CSS)がソースに残っていない', () => {
      const sources = import.meta.glob(['../**/*.{ts,tsx,css}', '!../**/__tests__/**'], {
        query: '?raw',
        import: 'default',
        eager: true,
      }) as Record<string, string>
      expect(Object.keys(sources).length).toBeGreaterThan(5)
      const pattern = /startAlarm|stopAlarm|getAlarmAudioStatus|ALARM_REPEAT_MS|audio-status-hint/
      for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(pattern)
    })
  })
})
