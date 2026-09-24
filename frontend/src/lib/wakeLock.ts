// 画面スリープ防止(Screen Wake Lock API)。
// 正本: docs/requirements.md §8(常設運用で画面ロックにより本人操作が届かなくなるのを防ぐ)。
// Issue #5: 起動時に取得し、visibilitychange で復帰時に再取得する。非対応/失敗時は
// 介助者メニューに「端末の自動ロックを切ってください」と表示するため、状態を公開する。

export type WakeLockStatus = 'active' | 'unsupported' | 'error' | 'released'

interface WakeLockSentinelLike {
  addEventListener(type: 'release', listener: () => void): void
  release(): Promise<void>
}

interface WakeLockApiLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function getWakeLockApi(): WakeLockApiLike | undefined {
  return (navigator as unknown as { wakeLock?: WakeLockApiLike }).wakeLock
}

let sentinel: WakeLockSentinelLike | null = null
let status: WakeLockStatus = 'unsupported'
// release() を自分で呼んだ(cleanup)のか、OS/ブラウザ側で自動解放されたのかを区別する。
// 自動解放(タブが隠れた等)のときだけ visibilitychange 復帰時に再取得したい。
let releasingIntentionally = false

/** 現在の Wake Lock 状態。 */
export function getWakeLockStatus(): WakeLockStatus {
  return status
}

function setStatus(next: WakeLockStatus, notify?: (status: WakeLockStatus) => void): void {
  status = next
  notify?.(next)
}

/** Wake Lock を(再)取得する。非対応環境や取得失敗でも例外は投げない。 */
export async function requestWakeLock(notify?: (status: WakeLockStatus) => void): Promise<void> {
  const api = getWakeLockApi()
  if (!api) {
    setStatus('unsupported', notify)
    return
  }
  try {
    const acquired = await api.request('screen')
    sentinel = acquired
    setStatus('active', notify)
    acquired.addEventListener('release', () => {
      if (sentinel !== acquired) return
      sentinel = null
      if (releasingIntentionally) return
      // OS/ブラウザ側で自動解放された(タブが隠れた等)。表示上は無効として扱う。
      setStatus('released', notify)
    })
  } catch {
    setStatus('error', notify)
  }
}

/**
 * 起動時に Wake Lock を取得し、タブが再び表示されたときに再取得する。
 * App.tsx の onMount から呼び、返り値の解除関数を onCleanup に渡す。
 */
export function initWakeLock(notify?: (status: WakeLockStatus) => void): () => void {
  releasingIntentionally = false
  void requestWakeLock(notify)

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void requestWakeLock(notify)
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    releasingIntentionally = true
    const current = sentinel
    sentinel = null
    if (current) void current.release().catch(() => {})
  }
}
