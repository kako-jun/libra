import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfflineReadyStatus, initOfflineReadyWatch } from '../offlineReady'

let mod: {
  initOfflineReadyWatch: typeof initOfflineReadyWatch
  getOfflineReadyStatus: () => OfflineReadyStatus
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

describe('offlineReady', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'serviceWorker')

  beforeEach(async () => {
    vi.resetModules()
    mod = await import('../offlineReady')
  })

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(Navigator.prototype, 'serviceWorker', originalDescriptor)
    } else {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
    }
  })

  it('serviceWorker 非対応環境では not-ready', () => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
    expect(mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('controller が無ければ not-ready', () => {
    setServiceWorker(new MockServiceWorkerContainer())
    expect(mod.getOfflineReadyStatus()).toBe('not-ready')
  })

  it('controller があれば ready', () => {
    const container = new MockServiceWorkerContainer()
    container.controller = {}
    setServiceWorker(container)
    expect(mod.getOfflineReadyStatus()).toBe('ready')
  })

  describe('initOfflineReadyWatch', () => {
    it('呼び出し直後に現在の状態を通知する', () => {
      setServiceWorker(new MockServiceWorkerContainer())
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      expect(notify).toHaveBeenCalledWith('not-ready')
      stop()
    })

    it('controllerchange で ready になったことを通知する', () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      notify.mockClear()

      container.controller = {}
      container.dispatchEvent(new Event('controllerchange'))

      expect(notify).toHaveBeenCalledWith('ready')
      stop()
    })

    it('解除関数を呼んだ後は controllerchange を見ない', () => {
      const container = new MockServiceWorkerContainer()
      setServiceWorker(container)
      const notify = vi.fn()
      const stop = mod.initOfflineReadyWatch(notify)
      stop()
      notify.mockClear()

      container.controller = {}
      container.dispatchEvent(new Event('controllerchange'))

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
