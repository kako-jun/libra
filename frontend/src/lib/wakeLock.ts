// 画面スリープ防止(Screen Wake Lock API)。
// 正本: docs/requirements.md §8(常設運用で画面ロックにより本人操作が届かなくなるのを防ぐ)。
// Issue #5: 起動時に取得し、visibilitychange で復帰時に再取得する。非対応/失敗時は
// 介助者メニューに「端末の自動ロックを切ってください」と表示するため、状態を公開する。
//
// PR #11 レビュー対応: 画面を表示したままでも error/released になることがあり、その場合の
// 再取得経路が無いと画面消灯を防げないまま常設運用が続くことになる。status が 'active' 以外の
// あいだ、本人のスイッチ入力(pointerdown/keydown)のたびに再試行し、入力が無い場合の保険として
// 30秒間隔のタイマーでも再試行する。

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

/** 再試行のポーリング間隔(ms)。可視のまま error/released になったときの保険。 */
export const WAKE_LOCK_RETRY_INTERVAL_MS = 30000

let sentinel: WakeLockSentinelLike | null = null
let status: WakeLockStatus = 'unsupported'
// release() を自分で呼んだ(cleanup)のか、OS/ブラウザ側で自動解放されたのかを区別する。
// 自動解放(タブが隠れた等)のときだけ再取得したい。
let releasingIntentionally = false
// cleanup 済みかどうか。true のあいだに解決した取得は使わず即 release し、active にしない
// (cleanup 後にネットワーク越しでなく非同期に解決するだけの request() でも、画面が
// もう Wake Lock を持ち続けるべきでない状態になっている)
let stopped = false
// 進行中の取得を共有し、多重取得(複数の sentinel を同時に持つ)を防ぐ(nit-1)。
// 先に投げた request() が解決する前に別の呼び出しが来ても、同じ Promise を返すだけにする
let inFlight: Promise<void> | null = null

/** 現在の Wake Lock 状態。 */
export function getWakeLockStatus(): WakeLockStatus {
  return status
}

function setStatus(next: WakeLockStatus, notify?: (status: WakeLockStatus) => void): void {
  status = next
  notify?.(next)
}

/**
 * Wake Lock を(再)取得する。非対応環境や取得失敗でも例外は投げない。
 * 既に進行中の取得があれば、新しい request() は投げずその Promise を共有する。
 */
export function requestWakeLock(notify?: (status: WakeLockStatus) => void): Promise<void> {
  if (inFlight) return inFlight

  const api = getWakeLockApi()
  if (!api) {
    setStatus('unsupported', notify)
    return Promise.resolve()
  }

  // try/catch/finally を使った単一の async 関数にする(.then().catch().finally() の
  // ように Promise チェーンを重ねると、テストで待つべき microtask の回数が実装の内部
  // 事情で増減し脆くなるため)
  const promise = (async () => {
    try {
      const acquired = await api.request('screen')
      if (stopped) {
        // cleanup 後に解決した取得。使わずに即解放し、active へは遷移させない
        void acquired.release().catch(() => {})
        return
      }
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
      if (!stopped) setStatus('error', notify)
    } finally {
      inFlight = null
    }
  })()

  inFlight = promise
  return promise
}

/**
 * 起動時に Wake Lock を取得し、タブが再び表示されたときに再取得する。加えて、
 * 可視のまま error/released になった場合の再取得経路として、本人のスイッチ入力
 * (pointerdown/keydown)のたびと、保険としての30秒間隔タイマーで再試行する
 * (status が既に 'active' なら何もしない)。
 * App.tsx の onMount から呼び、返り値の解除関数を onCleanup に渡す。
 */
export function initWakeLock(notify?: (status: WakeLockStatus) => void): () => void {
  stopped = false
  releasingIntentionally = false
  void requestWakeLock(notify)

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void requestWakeLock(notify)
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  // PR#11 再レビュー nit: タブが非表示のあいだに Wake Lock を request() しても
  // 仕様上取得できず(拒否されて 'error' になるだけ)無意味なので、可視のときだけ試す。
  // 非表示から復帰したときの再取得は上の visibilitychange 側が別途担っている
  const retryIfNeeded = () => {
    if (status !== 'active' && document.visibilityState === 'visible') {
      void requestWakeLock(notify)
    }
  }
  window.addEventListener('pointerdown', retryIfNeeded)
  window.addEventListener('keydown', retryIfNeeded)
  const retryIntervalId = window.setInterval(retryIfNeeded, WAKE_LOCK_RETRY_INTERVAL_MS)

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pointerdown', retryIfNeeded)
    window.removeEventListener('keydown', retryIfNeeded)
    window.clearInterval(retryIntervalId)
    stopped = true
    releasingIntentionally = true
    const current = sentinel
    sentinel = null
    if (current) void current.release().catch(() => {})
  }
}
