import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfflineReadyStatus, initOfflineReadyWatch } from '../offlineReady'

let mod: {
  initOfflineReadyWatch: typeof initOfflineReadyWatch
  getOfflineReadyStatus: () => Promise<OfflineReadyStatus>
}

class MockServiceWorkerContainer extends EventTarget {
  controller: unknown = null
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

/** computeStatus() 内の複数の await(caches.keys/open/Promise.all(match))を漏れなく流し切る。 */
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
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
    container.controller = {}
    setServiceWorker(container)
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('PR#11 再レビュー should-2: libra- で始まるキャッシュが無ければ not-ready', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = {}
    setServiceWorker(container)
    setCaches({ 'other-cache': ['/'] })
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('PR#11 再レビュー should-2: キャッシュはあるが参照中のJS/CSSが欠けていればnot-ready', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = {}
    setServiceWorker(container)
    addAsset('link', '/assets/index.css')
    addAsset('script', '/assets/index.js')
    // '/' と css はあるが js が欠けている
    setCaches({ 'libra-abc123': ['/', '/assets/index.css'] })
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('PR#11 再レビュー should-2: /・参照中のJS・CSSすべてがキャッシュにあればready', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = {}
    setServiceWorker(container)
    addAsset('link', '/assets/index.css')
    addAsset('script', '/assets/index.js')
    setCaches({ 'libra-abc123': ['/', '/assets/index.css', '/assets/index.js'] })
    expect(await mod.getOfflineReadyStatus()).toBe('ready')
  })

  it('caches.keys() が例外を出す環境でも not-ready を返す(例外を外に投げない)', async () => {
    const container = new MockServiceWorkerContainer()
    container.controller = {}
    setServiceWorker(container)
    ;(globalThis as unknown as { caches?: unknown }).caches = {
      keys: async () => {
        throw new Error('boom')
      },
    }
    expect(await mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  describe('initOfflineReadyWatch', () => {
    it('呼び出し直後に現在の状態を通知する', async () => {
      setServiceWorker(new MockServiceWorkerContainer())
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      await Promise.resolve()
      await Promise.resolve()
      expect(notify).toHaveBeenCalledWith('not-ready')
      stop()
    })

    it('controllerchange で ready になったことを通知する', async () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      setCaches({ 'libra-abc123': ['/'] })
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      await Promise.resolve()
      await Promise.resolve()
      notify.mockClear()

      container.controller = {}
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
      await Promise.resolve()
      stop()
      notify.mockClear()

      container.controller = {}
      container.dispatchEvent(new Event('controllerchange'))
      await Promise.resolve()
      await Promise.resolve()

      expect(notify).not.toHaveBeenCalled()
    })

    it('serviceWorker 非対応環境でも例外を出さず not-ready を通知する', () => {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
      const notify = vi.fn()
      expect(() => mod.initOfflineReadyWatch(notify)).not.toThrow()
      expect(notify).toHaveBeenCalledWith('not-ready')
    })
  })
})
