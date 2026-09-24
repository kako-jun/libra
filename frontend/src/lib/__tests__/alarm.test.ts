import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  getAlarmAudioStatus,
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
  getAlarmAudioStatus: typeof getAlarmAudioStatus
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

  describe('S-new-2 / M-new-1: onstatechange で running への遷移を捉え、次の周期を待たず即座に1回鳴らす', () => {
    // 実機の AudioContext は resume() を呼んでも「アクティベーション(ユーザー操作)を
    // 伴わない」場合、reject されずに pending のまま残ることがある(Safari 相当)。
    // このモックは、指定した呼び出し回目までは resume() が永遠に解決しない(pending)
    // ままにし、それ以降の呼び出しでは実際に running へ遷移して onstatechange を発火させる。
    // 状態遷移は実機同様マイクロタスクで非同期に起こる(startAlarm内の同期処理の
    // 順序に依存する不自然なテストにならないようにするため)。
    function makeActivationAwareAudioContext(pendingCallCount: number) {
      return class ActivationAwareAudioContext extends MockAudioContext {
        state = 'suspended'
        onstatechange: (() => void) | null = null
        callCount = 0
        resume = vi.fn().mockImplementation((): Promise<void> => {
          this.callCount += 1
          if (this.callCount <= pendingCallCount) {
            // アクティベーション無し(例: pointerdown)を模す。reject もされず pending のまま
            return new Promise<void>(() => {})
          }
          // アクティベーション有り(例: pointerup)を模す。実際に running へ遷移する
          return Promise.resolve().then(() => {
            this.state = 'running'
            this.onstatechange?.()
          })
        })
      }
    }

    it('M-new-1: pointerdown相当(アクティベーション無し)のresumeがpendingのままでも、pointerup相当(有り)で即座に鳴る', async () => {
      vi.resetModules()
      beepCount = 0
      // startAlarm は内部で resumeAlarmAudioContext(1回目) と beep() 自身の resume(2回目)
      // を呼ぶため、どちらもアクティベーション無し(pending)として扱う
      ;(window as unknown as { AudioContext?: unknown }).AudioContext =
        makeActivationAwareAudioContext(2)
      mod = await import('../alarm')

      mod.startAlarm(3000)
      await Promise.resolve()
      await Promise.resolve()
      expect(beepCount).toBe(0) // pending のままなので鳴らない

      // pointerup相当: 3回目のresume呼び出しで実際にrunningへ遷移し、onstatechangeが発火する
      mod.resumeAlarmAudioContext()
      await Promise.resolve()
      await Promise.resolve()

      // repeatMs(3000ms)を待たずに、onstatechangeの時点で鳴っている
      expect(beepCount).toBe(1)
    })

    it('running になった後にさらに resumeAlarmAudioContext を呼んでも、複数回鳴らない', async () => {
      vi.resetModules()
      beepCount = 0
      ;(window as unknown as { AudioContext?: unknown }).AudioContext =
        makeActivationAwareAudioContext(2)
      mod = await import('../alarm')

      mod.startAlarm(3000)
      mod.resumeAlarmAudioContext() // running へ遷移させる(3回目の呼び出し)
      await Promise.resolve()
      await Promise.resolve()
      expect(beepCount).toBe(1)

      mod.resumeAlarmAudioContext() // 既にrunningなので resume() 自体呼ばれない(再遷移なし)
      mod.resumeAlarmAudioContext()
      await Promise.resolve()
      await Promise.resolve()

      expect(beepCount).toBe(1)
    })

    it('アラームが動作していない(intervalId===null)ときは running になっても鳴らない', async () => {
      vi.resetModules()
      beepCount = 0
      ;(window as unknown as { AudioContext?: unknown }).AudioContext =
        makeActivationAwareAudioContext(0)
      mod = await import('../alarm')

      mod.resumeAlarmAudioContext() // startAlarm は呼ばない(アラーム未動作)。1回目で即running
      await Promise.resolve()
      await Promise.resolve()

      expect(beepCount).toBe(0)
    })
  })

  describe('getAlarmAudioStatus', () => {
    it('AudioContext が未生成のときは not-running', () => {
      expect(mod.getAlarmAudioStatus()).toBe('not-running')
    })

    it('running な AudioContext を生成した後は running', () => {
      mod.resumeAlarmAudioContext()
      expect(mod.getAlarmAudioStatus()).toBe('running')
    })

    it('suspended な AudioContext のときは not-running', async () => {
      class SuspendedAudioContext extends MockAudioContext {
        state = 'suspended'
      }
      vi.resetModules()
      ;(window as unknown as { AudioContext?: unknown }).AudioContext = SuspendedAudioContext
      mod = await import('../alarm')
      mod.resumeAlarmAudioContext()
      expect(mod.getAlarmAudioStatus()).toBe('not-running')
    })
  })
})
