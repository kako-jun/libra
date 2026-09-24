import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OfflineReadyStatus,
  initOfflineReadyWatch,
  recheckOfflineReady,
} from '../offlineReady'

let mod: {
  initOfflineReadyWatch: typeof initOfflineReadyWatch
  recheckOfflineReady: typeof recheckOfflineReady
  getOfflineReadyStatus: () => Promise<OfflineReadyStatus>
}

class MockServiceWorkerContainer extends EventTarget {
  controller: MockController | null = null
  getRegistration = vi.fn()
}

/** postMessage({type:'GET_CACHE_NAME'}) に対し、指定したキャッシュ名で応答するモック。
 * cacheName が undefined のときは応答しない(タイムアウトを試すテスト用)。 */
class MockController {
  constructor(
    private readonly container: MockServiceWorkerContainer,
    private readonly cacheName: string | undefined,
  ) {}
  postMessage(data: { type: string }) {
    if (data?.type === 'GET_CACHE_NAME' && this.cacheName !== undefined) {
      queueMicrotask(() => {
        this.container.dispatchEvent(
          new MessageEvent('message', { data: { type: 'CACHE_NAME', name: this.cacheName } }),
        )
      })
    }
  }
}

function setServiceWorker(container: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  })
}

/** 実際の Cache/CacheStorage の代わりに、URL の集合だけを持つ最小限のモック。 */
class MockCache {
  constructor(private readonly urls: Set<string>) {}
  async match(url: string): Promise<object | undefined> {
    return this.urls.has(url) ? {} : undefined
  }
}

function setCaches(namedUrlSets: Record<string, string[]>) {
  const store = new Map(Object.entries(namedUrlSets).map(([name, urls]) => [name, new Set(urls)]))
  ;(globalThis as unknown as { caches?: unknown }).caches = {
    keys: async () => [...store.keys()],
    open: async (name: string) => new MockCache(store.get(name) ?? new Set()),
  }
}

function clearDom() {
  document.head.querySelectorAll('link[rel="stylesheet"], script[src]').forEach((el) => el.remove())
}

/** computeStatus() 内の複数の await(postMessage往復・caches.open/Promise.all(match))を
 * 漏れなく流し切る。 */
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function addAsset(tag: 'link' | 'script', attr: string) {
  const el = document.createElement(tag)
  if (tag === 'link') {
    el.setAttribute('rel', 'stylesheet')
    el.setAttribute('href', attr)
  } else {
    el.setAttribute('src', attr)
  }
  document.head.appendChild(el)
}

describe('offlineReady', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'serviceWorker')

  beforeEach(async () => {
    vi.resetModules()
    clearDom()
    mod = await import('../offlineReady')
  })

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(Navigator.prototype, 'serviceWorker', originalDescriptor)
    } else {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
    }
    delete (globalThis as unknown as { caches?: unknown }).caches
    clearDom()
    vi.useRealTimers()
  })

  it('serviceWorker 非対応環境では not-ready', async () => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('controller が無ければ not-ready', async () => {
    setServiceWorker(new MockServiceWorkerContainer())
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('controller があっても caches 自体が無ければ not-ready', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = new MockController(container, 'libra-abc123')
    setServiceWorker(container)
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('PR#11 3巡目 nit: SWからのCACHE_NAME応答が無ければ(タイムアウト)not-ready', async () => {
    vi.useFakeTimers()
    const container = new MockServiceWorkerContainer()
    container.controller = new MockController(container, undefined) // 応答しない
    setServiceWorker(container)
    setCaches({ 'libra-abc123': ['/'] })

    const promise = mod.getOfflineReadyStatus()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await promise).toBe('not-ready')
  })

  it('PR#11 再レビュー should-2: キャッシュはあるが参照中のJS/CSSが欠けていればnot-ready', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = new MockController(container, 'libra-abc123')
    setServiceWorker(container)
    addAsset('link', '/assets/index.css')
    addAsset('script', '/assets/index.js')
    // '/' と css はあるが js が欠けている
    setCaches({ 'libra-abc123': ['/', '/assets/index.css'] })
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('PR#11 再レビュー should-2: /・参照中のJS・CSSすべてがキャッシュにあればready', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = new MockController(container, 'libra-abc123')
    setServiceWorker(container)
    addAsset('link', '/assets/index.css')
    addAsset('script', '/assets/index.js')
    setCaches({ 'libra-abc123': ['/', '/assets/index.css', '/assets/index.js'] })
    expect(await mod.getOfflineReadyStatus()).toBe('ready')
  })

  it('PR#11 3巡目 nit: install中の一時キャッシュ(-installing)ではなく、SWが教えた本名を見る', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = new MockController(container, 'libra-abc123')
    setServiceWorker(container)
    // "-installing" にはまだ何も無いが、本名には揃っている状況を模す
    setCaches({ 'libra-abc123': ['/'], 'libra-abc123-installing': [] })
    expect(await mod.getOfflineReadyStatus()).toBe('ready')
  })

  it('caches.open() が例外を出す環境でも not-ready を返す(例外を外に投げない)', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = new MockController(container, 'libra-abc123')
    setServiceWorker(container)
    ;(globalThis as unknown as { caches?: unknown }).caches = {
      open: async () => {
        throw new Error('boom')
      },
    }
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  describe('recheckOfflineReady (should-A/should-B)', () => {
    it('呼ぶと現在の状態を再計算して通知する', async () => {
      const container = new MockServiceWorkerContainer()
      container.controller = new MockController(container, 'libra-abc123')
      setServiceWorker(container)
      setCaches({ 'libra-abc123': ['/'] })
      const notify = vi.fn()

      await mod.recheckOfflineReady(notify)

      expect(notify).toHaveBeenCalledWith('ready')
    })

    it('not-readyのときはSWの更新チェック(registration.update())も試みる', async () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container) // controller無し -> not-ready
      const update = vi.fn().mockResolvedValue(undefined)
      container.getRegistration.mockResolvedValue({ update })

      await mod.recheckOfflineReady(vi.fn())
      await flush()

      expect(update).toHaveBeenCalled()
    })

    it('readyのときはSWの更新チェックを試みない', async () => {
      const container = new MockServiceWorkerContainer()
      container.controller = new MockController(container, 'libra-abc123')
      setServiceWorker(container)
      setCaches({ 'libra-abc123': ['/'] })
      const update = vi.fn().mockResolvedValue(undefined)
      container.getRegistration.mockResolvedValue({ update })

      await mod.recheckOfflineReady(vi.fn())
      await flush()

      expect(update).not.toHaveBeenCalled()
    })

    it('registration.update()が失敗しても例外を外に投げない', async () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      container.getRegistration.mockRejectedValue(new Error('offline'))

      await expect(mod.recheckOfflineReady(vi.fn())).resolves.toBeUndefined()
    })
  })

  describe('PR#11 3巡目 nit: 世代カウンタで古い結果が新しい結果を上書きしない', () => {
    it('先に呼んだrecheckが後から解決しても、後に呼んだrecheckの結果が優先される', async () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      const notify = vi.fn()

      let resolveFirstCacheOpen: () => void = () => {}
      let callCount = 0
      ;(globalThis as unknown as { caches?: unknown }).caches = {
        open: (name: string) => {
          callCount += 1
          if (callCount === 1) {
            // 1回目(古い呼び出し)はまだ controller が無い状態で started したのでそもそも
            // caches.open まで届かない想定だが、念のため遅延させても影響が無いことを見る
            return new Promise((resolve) => {
              resolveFirstCacheOpen = () => resolve(new MockCache(new Set(['/'])))
            })
          }
          return Promise.resolve(new MockCache(new Set(['/'])))
        },
      }
      container.controller = new MockController(container, 'libra-abc123')

      const first = mod.recheckOfflineReady(notify) // 遅延する古い呼び出し
      await Promise.resolve()
      const second = mod.recheckOfflineReady(notify) // 後発の新しい呼び出し(先に解決する)
      await second
      notify.mockClear()

      resolveFirstCacheOpen()
      await first
      await flush()

      // 古い呼び出しの結果で notify が上書きされない
      expect(notify).not.toHaveBeenCalled()
    })
  })

  describe('initOfflineReadyWatch', () => {
    it('呼び出し直後に現在の状態を通知する', async () => {
      setServiceWorker(new MockServiceWorkerContainer())
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      await flush()
      expect(notify).toHaveBeenCalledWith('not-ready')
      stop()
    })

    it('controllerchange で ready になったことを通知する', async () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      setCaches({ 'libra-abc123': ['/'] })
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      await flush()
      notify.mockClear()

      container.controller = new MockController(container, 'libra-abc123')
      container.dispatchEvent(new Event('controllerchange'))
      await flush()

      expect(notify).toHaveBeenCalledWith('ready')
      stop()
    })

    it('解除関数を呼んだ後は controllerchange を見ない', async () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      await flush()
      stop()
      notify.mockClear()

      container.controller = new MockController(container, 'libra-abc123')
      container.dispatchEvent(new Event('controllerchange'))
      await flush()

      expect(notify).not.toHaveBeenCalled()
    })

    it('should-A: 5分おきに再計算し、未完了ならSWの更新チェックも試みる', async () => {
      vi.useFakeTimers()
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container) // controller無し -> not-ready のまま
      const update = vi.fn().mockResolvedValue(undefined)
      container.getRegistration.mockResolvedValue({ update })
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      await vi.advanceTimersByTimeAsync(0)
      update.mockClear()

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(update).toHaveBeenCalled()
      stop()
    })

    it('解除関数を呼んだ後は5分タイマーも止まる', async () => {
      vi.useFakeTimers()
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      const update = vi.fn().mockResolvedValue(undefined)
      container.getRegistration.mockResolvedValue({ update })
      const stop = mod.initOfflineReadyWatch(vi.fn())
      await vi.advanceTimersByTimeAsync(0)
      stop()
      update.mockClear()

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(update).not.toHaveBeenCalled()
    })

    it('serviceWorker 非対応環境でも例外を出さず not-ready を通知する', () => {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
      const notify = vi.fn()
      expect(() => mod.initOfflineReadyWatch(notify)).not.toThrow()
      expect(notify).toHaveBeenCalledWith('not-ready')
    })
  })
})
