import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WakeLockStatus, initWakeLock, requestWakeLock } from '../wakeLock'

// wakeLock.ts はモジュール内に sentinel/status をキャッシュするため、alarm.test.ts と同様に
// テスト間の状態漏れを防ぐため各テストで vi.resetModules() してから動的 import する。
let mod: {
  initWakeLock: typeof initWakeLock
  requestWakeLock: typeof requestWakeLock
  getWakeLockStatus: () => WakeLockStatus
}

class MockSentinel {
  private releaseListeners: Array<() => void> = []
  release = vi.fn().mockImplementation(async () => {
    this.releaseListeners.forEach((fn) => fn())
  })
  addEventListener(type: 'release', listener: () => void) {
    if (type === 'release') this.releaseListeners.push(listener)
  }
  emitRelease() {
    this.releaseListeners.forEach((fn) => fn())
  }
}

function setWakeLockApi(api: unknown) {
  ;(navigator as unknown as { wakeLock?: unknown }).wakeLock = api
}

describe('wakeLock', () => {
  beforeEach(async () => {
    vi.resetModules()
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock
    mod = await import('../wakeLock')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock
  })

  it('navigator.wakeLock が無い環境では unsupported になる', async () => {
    await mod.requestWakeLock()
    expect(mod.getWakeLockStatus()).toBe('unsupported')
  })

  it('request が成功すると active になる', async () => {
    const sentinel = new MockSentinel()
    setWakeLockApi({ request: vi.fn().mockResolvedValue(sentinel) })
    await mod.requestWakeLock()
    expect(mod.getWakeLockStatus()).toBe('active')
  })

  it('request が例外を出すと error になる(例外を外に投げない)', async () => {
    setWakeLockApi({ request: vi.fn().mockRejectedValue(new Error('denied')) })
    await expect(mod.requestWakeLock()).resolves.toBeUndefined()
    expect(mod.getWakeLockStatus()).toBe('error')
  })

  it('取得成功時は notify に active が渡る', async () => {
    const sentinel = new MockSentinel()
    setWakeLockApi({ request: vi.fn().mockResolvedValue(sentinel) })
    const notify = vi.fn()
    await mod.requestWakeLock(notify)
    expect(notify).toHaveBeenCalledWith('active')
  })

  describe('initWakeLock', () => {
    it('呼び出し直後に取得を試みる', async () => {
      const sentinel = new MockSentinel()
      const request = vi.fn().mockResolvedValue(sentinel)
      setWakeLockApi({ request })
      const notify = vi.fn()
      const stop = mod.initWakeLock(notify)
      await Promise.resolve()
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(1)
      expect(mod.getWakeLockStatus()).toBe('active')
      stop()
    })

    it('visibilitychange で visible に戻ったときに再取得する', async () => {
      const sentinel1 = new MockSentinel()
      const sentinel2 = new MockSentinel()
      const request = vi.fn().mockResolvedValueOnce(sentinel1).mockResolvedValueOnce(sentinel2)
      setWakeLockApi({ request })
      const stop = mod.initWakeLock()
      await Promise.resolve()
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(1)

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()

      expect(request).toHaveBeenCalledTimes(2)
      stop()
    })

    it('visibilitychange で hidden になったときは再取得しない', async () => {
      const sentinel = new MockSentinel()
      const request = vi.fn().mockResolvedValue(sentinel)
      setWakeLockApi({ request })
      const stop = mod.initWakeLock()
      await Promise.resolve()
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(1)

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()

      expect(request).toHaveBeenCalledTimes(1)
      stop()
    })

    it('解除関数を呼ぶと release され、visibilitychange のリスナーも外れる', async () => {
      const sentinel = new MockSentinel()
      const request = vi.fn().mockResolvedValue(sentinel)
      setWakeLockApi({ request })
      const stop = mod.initWakeLock()
      await Promise.resolve()
      await Promise.resolve()

      stop()
      expect(sentinel.release).toHaveBeenCalledTimes(1)

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()

      // stop 後は再取得しない
      expect(request).toHaveBeenCalledTimes(1)
    })

    it('自分で release した場合は released 状態にならない(意図的な解放と自動解放を区別する)', async () => {
      const sentinel = new MockSentinel()
      const request = vi.fn().mockResolvedValue(sentinel)
      setWakeLockApi({ request })
      const notify = vi.fn()
      const stop = mod.initWakeLock(notify)
      await Promise.resolve()
      await Promise.resolve()
      notify.mockClear()

      stop()
      await Promise.resolve()

      expect(notify).not.toHaveBeenCalledWith('released')
    })

    it('OS 側の自動解放(sentinel の release イベント)では released になる', async () => {
      const sentinel = new MockSentinel()
      setWakeLockApi({ request: vi.fn().mockResolvedValue(sentinel) })
      const notify = vi.fn()
      const stop = mod.initWakeLock(notify)
      await Promise.resolve()
      await Promise.resolve()
      notify.mockClear()

      sentinel.emitRelease()

      expect(notify).toHaveBeenCalledWith('released')
      expect(mod.getWakeLockStatus()).toBe('released')
      stop()
    })

    describe('PR#11 レビュー対応: 可視のまま released/error になった後の再取得', () => {
      it('released になった後、次のスイッチ入力(pointerdown)で active に戻る', async () => {
        const sentinel1 = new MockSentinel()
        const sentinel2 = new MockSentinel()
        const request = vi.fn().mockResolvedValueOnce(sentinel1).mockResolvedValueOnce(sentinel2)
        setWakeLockApi({ request })
        const stop = mod.initWakeLock()
        await Promise.resolve()
        await Promise.resolve()
        expect(mod.getWakeLockStatus()).toBe('active')

        sentinel1.emitRelease()
        expect(mod.getWakeLockStatus()).toBe('released')

        window.dispatchEvent(new Event('pointerdown'))
        await Promise.resolve()
        await Promise.resolve()

        expect(request).toHaveBeenCalledTimes(2)
        expect(mod.getWakeLockStatus()).toBe('active')
        stop()
      })

      it('error になった後、次のスイッチ入力(keydown)で active に戻る', async () => {
        const sentinel = new MockSentinel()
        const request = vi
          .fn()
          .mockRejectedValueOnce(new Error('denied'))
          .mockResolvedValueOnce(sentinel)
        setWakeLockApi({ request })
        const stop = mod.initWakeLock()
        await Promise.resolve()
        await Promise.resolve()
        expect(mod.getWakeLockStatus()).toBe('error')

        window.dispatchEvent(new Event('keydown'))
        await Promise.resolve()
        await Promise.resolve()

        expect(request).toHaveBeenCalledTimes(2)
        expect(mod.getWakeLockStatus()).toBe('active')
        stop()
      })

      it('30秒間隔のタイマーでも再試行する(入力が無い場合の保険)', async () => {
        vi.useFakeTimers()
        const sentinel1 = new MockSentinel()
        const sentinel2 = new MockSentinel()
        const request = vi.fn().mockResolvedValueOnce(sentinel1).mockResolvedValueOnce(sentinel2)
        setWakeLockApi({ request })
        const stop = mod.initWakeLock()
        await vi.advanceTimersByTimeAsync(0)
        expect(mod.getWakeLockStatus()).toBe('active')

        sentinel1.emitRelease()
        expect(mod.getWakeLockStatus()).toBe('released')

        await vi.advanceTimersByTimeAsync(30000)

        expect(request).toHaveBeenCalledTimes(2)
        expect(mod.getWakeLockStatus()).toBe('active')
        stop()
        vi.useRealTimers()
      })

      it('active のままなら入力があっても再取得しない', async () => {
        const sentinel = new MockSentinel()
        const request = vi.fn().mockResolvedValue(sentinel)
        setWakeLockApi({ request })
        const stop = mod.initWakeLock()
        await Promise.resolve()
        await Promise.resolve()
        expect(request).toHaveBeenCalledTimes(1)

        window.dispatchEvent(new Event('pointerdown'))
        await Promise.resolve()

        expect(request).toHaveBeenCalledTimes(1)
        stop()
      })

      it('PR#11 再レビュー nit: タブが非表示のあいだは入力/タイマーで再取得を試みない', async () => {
        vi.useFakeTimers()
        const sentinel = new MockSentinel()
        const request = vi
          .fn()
          .mockResolvedValueOnce(sentinel)
          .mockRejectedValueOnce(new Error('x'))
        setWakeLockApi({ request })
        const stop = mod.initWakeLock()
        await vi.advanceTimersByTimeAsync(0)
        expect(mod.getWakeLockStatus()).toBe('active')

        sentinel.emitRelease()
        expect(mod.getWakeLockStatus()).toBe('released')

        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          configurable: true,
        })

        window.dispatchEvent(new Event('pointerdown'))
        window.dispatchEvent(new Event('keydown'))
        await vi.advanceTimersByTimeAsync(30000)

        // 非表示のあいだは pointerdown/keydown/タイマーいずれも再取得を試みない
        expect(request).toHaveBeenCalledTimes(1)
        expect(mod.getWakeLockStatus()).toBe('released')

        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        })
        stop()
        vi.useRealTimers()
      })
    })

    describe('nit-1: 並行 request() で sentinel が1つだけになる', () => {
      it('解決前に複数回呼んでも api.request は1回だけ呼ばれ、共有した Promise が解決する', async () => {
        let resolveRequest: (sentinel: MockSentinel) => void = () => {}
        const request = vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveRequest = resolve
            }),
        )
        setWakeLockApi({ request })

        const p1 = mod.requestWakeLock()
        const p2 = mod.requestWakeLock()
        const p3 = mod.requestWakeLock()
        expect(request).toHaveBeenCalledTimes(1)

        const sentinel = new MockSentinel()
        resolveRequest(sentinel)
        await Promise.all([p1, p2, p3])

        expect(mod.getWakeLockStatus()).toBe('active')
      })
    })

    describe('cleanup 後に完了した request は使わず即 release する', () => {
      it('stop() を呼んだ後に解決した取得は release され、active にはならない', async () => {
        let resolveRequest: (sentinel: MockSentinel) => void = () => {}
        const request = vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveRequest = resolve
            }),
        )
        setWakeLockApi({ request })

        const stop = mod.initWakeLock()
        // 初回取得が進行中のまま stop() する(cleanup が先に走るケース)
        stop()

        const sentinel = new MockSentinel()
        resolveRequest(sentinel)
        await Promise.resolve()
        await Promise.resolve()

        expect(sentinel.release).toHaveBeenCalled()
        expect(mod.getWakeLockStatus()).not.toBe('active')
      })
    })
  })
})
