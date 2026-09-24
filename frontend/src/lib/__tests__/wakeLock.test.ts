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
      mod.initWakeLock(notify)
      await Promise.resolve()
      await Promise.resolve()
      notify.mockClear()

      sentinel.emitRelease()

      expect(notify).toHaveBeenCalledWith('released')
      expect(mod.getWakeLockStatus()).toBe('released')
    })
  })
})
