import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { resumeAlarmAudioContext, startAlarm, stopAlarm } from '../alarm'

// alarm.ts はモジュール内に audioContext をキャッシュするため、テスト間の状態漏れを防ぐため
// 各テストで vi.resetModules() してから動的 import する。
let mod: {
  resumeAlarmAudioContext: typeof resumeAlarmAudioContext
  startAlarm: typeof startAlarm
  stopAlarm: typeof stopAlarm
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

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    beepCount += 1
    return new MockOscillator()
  }
  createGain() {
    return new MockGain()
  }
}

describe('alarm', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    beepCount = 0
    vi.resetModules()
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = MockAudioContext
    mod = await import('../alarm')
  })

  afterEach(() => {
    mod.stopAlarm()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
  })

  it('startAlarm は即時に1回鳴らす', () => {
    mod.startAlarm(3000)
    expect(beepCount).toBe(1)
  })

  it('startAlarm は repeatMs 間隔で鳴らし続ける', () => {
    mod.startAlarm(3000)
    vi.advanceTimersByTime(3000)
    expect(beepCount).toBe(2)
    vi.advanceTimersByTime(3000)
    expect(beepCount).toBe(3)
  })

  it('2回連続で startAlarm しても多重化しない(intervalが1本だけ動く)', () => {
    mod.startAlarm(3000)
    mod.startAlarm(3000)
    beepCount = 0
    vi.advanceTimersByTime(3000)
    // 多重化していれば2回以上呼ばれるはず
    expect(beepCount).toBe(1)
  })

  it('stopAlarm を呼んだ後は鳴らない', () => {
    mod.startAlarm(3000)
    mod.stopAlarm()
    beepCount = 0
    vi.advanceTimersByTime(10000)
    expect(beepCount).toBe(0)
  })

  it('未 start の状態で stopAlarm を呼んでも例外を出さない', () => {
    expect(() => mod.stopAlarm()).not.toThrow()
  })

  it('AudioContext 非対応環境でも startAlarm/resumeAlarmAudioContext は例外を出さない', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
    expect(() => mod.resumeAlarmAudioContext()).not.toThrow()
    expect(() => mod.startAlarm(3000)).not.toThrow()
  })
})
