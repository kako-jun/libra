import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { initAlarmVisibilityResume, playTonePattern, resumeAlarmAudioContext } from '../alarm'

// alarm.ts はモジュール内に audioContext をキャッシュするため、テスト間の状態漏れを防ぐため
// 各テストで vi.resetModules() してから動的 import する。
let mod: {
  resumeAlarmAudioContext: typeof resumeAlarmAudioContext
  initAlarmVisibilityResume: typeof initAlarmVisibilityResume
  playTonePattern: typeof playTonePattern
}

class MockGain {
  gain = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  }
  connect = vi.fn()
}

class MockOscillator {
  type = ''
  frequency = { setValueAtTime: vi.fn() }
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

let beepCount = 0
let lastContext: { state: string }
const createdOscillators: MockOscillator[] = []

class MockAudioContext {
  state: string = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  constructor() {
    lastContext = this
  }
  createOscillator() {
    beepCount += 1
    const oscillator = new MockOscillator()
    createdOscillators.push(oscillator)
    return oscillator
  }
  createGain() {
    return new MockGain()
  }
}

describe('alarm(効果音用 AudioContext)', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    beepCount = 0
    createdOscillators.length = 0
    vi.resetModules()
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = MockAudioContext
    mod = await import('../alarm')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
  })

  describe('playTonePattern (Issue #13: 振動の代替の効果音)', () => {
    it('AudioContext が running なら、パターンの振動する区間の数だけ音を鳴らす', () => {
      mod.resumeAlarmAudioContext() // AudioContext を作る(MockAudioContext は running)
      mod.playTonePattern([80, 100, 80])
      expect(beepCount).toBe(2)
    })

    it('AudioContext が無い・running でないときは何もしない(例外も出さない)', () => {
      expect(() => mod.playTonePattern([80])).not.toThrow() // まだ作られていない
      expect(beepCount).toBe(0)
    })

    it('AudioContext が suspended のときは何も鳴らさない', () => {
      mod.resumeAlarmAudioContext()
      lastContext.state = 'suspended'
      mod.playTonePattern([80])
      expect(beepCount).toBe(0)
    })

    it('新しい効果音は、直前の効果音を止めて置き換える(重ならない)', () => {
      mod.resumeAlarmAudioContext()
      mod.playTonePattern([80, 100, 80])
      const first = createdOscillators.slice()
      mod.playTonePattern([120])
      for (const osc of first) expect(osc.stop).toHaveBeenCalledTimes(2) // 予約の stop と、置き換えの stop
    })
  })

  it('AudioContext 非対応環境でも resumeAlarmAudioContext は例外を出さない', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
    expect(() => mod.resumeAlarmAudioContext()).not.toThrow()
  })

  describe('M2: initAlarmVisibilityResume', () => {
    const captured: { instance?: { resume: ReturnType<typeof vi.fn> } } = {}
    const getInstance = () => captured.instance

    class TrackedAudioContext extends MockAudioContext {
      state = 'suspended'
      resume = vi.fn().mockResolvedValue(undefined)
      constructor() {
        super()
        captured.instance = this
      }
    }

    it('visibilitychange で visible に戻ったときに resume を試みる', async () => {
      vi.resetModules()
      captured.instance = undefined
      ;(window as unknown as { AudioContext?: unknown }).AudioContext = TrackedAudioContext
      mod = await import('../alarm')
      mod.resumeAlarmAudioContext() // audioContext を作らせておく(この呼び出し自体もresumeする)
      // resume 進行中フラグが解除されるまでマイクロタスクを進める(多重resume防止と競合しないように)
      await Promise.resolve()
      await Promise.resolve()
      getInstance()?.resume.mockClear()

      const stop = mod.initAlarmVisibilityResume()

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      expect(getInstance()?.resume).toHaveBeenCalled()
      stop()
    })

    it('解除関数を呼んだ後は visibilitychange で resume を試みない', async () => {
      vi.resetModules()
      captured.instance = undefined
      ;(window as unknown as { AudioContext?: unknown }).AudioContext = TrackedAudioContext
      mod = await import('../alarm')
      mod.resumeAlarmAudioContext()

      const stop = mod.initAlarmVisibilityResume()
      stop()
      getInstance()?.resume.mockClear()

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      expect(getInstance()?.resume).not.toHaveBeenCalled()
    })

    it('document が存在しない等の環境でも例外を出さず、呼ばれても何もしない解除関数を返す', () => {
      const stop = mod.initAlarmVisibilityResume()
      expect(() => stop()).not.toThrow()
    })
  })

  describe('nit: closed になった AudioContext を破棄して作り直す', () => {
    it('ensureAudioContext は closed のインスタンスを再利用せず、新しく作り直す', async () => {
      const instances: Array<{ state: string; onstatechange: (() => void) | null }> = []
      class TrackedAudioContext extends MockAudioContext {
        onstatechange: (() => void) | null = null
        constructor() {
          super()
          instances.push(this)
        }
      }
      vi.resetModules()
      beepCount = 0
      ;(window as unknown as { AudioContext?: unknown }).AudioContext = TrackedAudioContext
      mod = await import('../alarm')

      mod.resumeAlarmAudioContext() // 1つ目のインスタンスを作る
      expect(instances.length).toBe(1)

      instances[0].state = 'closed'
      mod.resumeAlarmAudioContext() // closed を検出し、新しいインスタンスを作るはず
      expect(instances.length).toBe(2)
      expect(instances[0]).not.toBe(instances[1])
    })
  })
})
