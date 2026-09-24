import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  initAlarmVisibilityResume,
  resumeAlarmAudioContext,
  startAlarm,
  stopAlarm,
} from '../alarm'

// alarm.ts はモジュール内に audioContext をキャッシュするため、テスト間の状態漏れを防ぐため
// 各テストで vi.resetModules() してから動的 import する。
let mod: {
  resumeAlarmAudioContext: typeof resumeAlarmAudioContext
  startAlarm: typeof startAlarm
  stopAlarm: typeof stopAlarm
  initAlarmVisibilityResume: typeof initAlarmVisibilityResume
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
  state: string = 'running'
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

  describe('M2: state!=="running" のときは鳴らさず、resume を試みてから待つ', () => {
    // resume は実機では非同期に完了するため、テストでは呼ばれたことだけを記録し、
    // state の書き換えはテストコードから明示的に行う(タイミングを確定的にする)。
    // インスタンスをオブジェクトのプロパティに持ち、常に関数越しに読む。クラスの
    // コンストラクタ(別クロージャ、`new` はモジュール内部から呼ばれるため TS には
    // 見えない)からの代入を、TS の制御フロー分析が誤って `never` に narrow するのを防ぐ。
    const captured: { instance?: { state: string; resume: ReturnType<typeof vi.fn> } } = {}
    const getInstance = () => captured.instance

    class ControllableAudioContext extends MockAudioContext {
      state = 'suspended'
      resume = vi.fn().mockResolvedValue(undefined)
      constructor() {
        super()
        captured.instance = this
      }
    }

    it('running でなければ鳴らず resume を試みる。running に戻れば次の周期から鳴る(キャッチアップしない)', async () => {
      vi.resetModules()
      beepCount = 0
      captured.instance = undefined
      ;(window as unknown as { AudioContext?: unknown }).AudioContext = ControllableAudioContext
      mod = await import('../alarm')

      mod.startAlarm(3000)
      // 1周期目: suspended のままなので鳴らない
      expect(beepCount).toBe(0)
      expect(getInstance()?.resume).toHaveBeenCalled()

      // resume が実を結び running になった、とみなす
      const instance = getInstance()
      if (instance) instance.state = 'running'

      vi.advanceTimersByTime(3000)
      // 2周期目: running になっているので鳴る。複数周期分がまとめて鳴る(キャッチアップ)ことはない
      expect(beepCount).toBe(1)

      vi.advanceTimersByTime(3000)
      expect(beepCount).toBe(2)
    })

    it("iOS の 'interrupted' も running 以外として扱われ鳴らない", async () => {
      class InterruptedAudioContext extends MockAudioContext {
        state = 'interrupted'
      }
      vi.resetModules()
      beepCount = 0
      ;(window as unknown as { AudioContext?: unknown }).AudioContext = InterruptedAudioContext
      mod = await import('../alarm')

      mod.startAlarm(3000)
      expect(beepCount).toBe(0)
      vi.advanceTimersByTime(3000)
      expect(beepCount).toBe(0)
    })
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
})
