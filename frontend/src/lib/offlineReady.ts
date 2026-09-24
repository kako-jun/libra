// オフライン準備状態(Service Worker がこのページを制御しているか)。
// 正本: docs/requirements.md §8「バックエンドが落ちていても、すべての伝達機能はオフラインで
// 動かなければならない」。PR #11 レビュー対応(should-1): Wake Lock の状態表示と同様、
// 「本当にオフラインで動く準備ができているか」を介助者メニューで確認できるようにする。
//
// navigator.serviceWorker.controller が付くのは、SW が有効化されてこのページを
// clients.claim() した後(初回アクセス直後はまだ controller が無く、次のナビゲーションで
// 付く)。controller が付いていれば、そのバージョンの SW がこのページの fetch を
// 一通りハンドリングできる状態にあるとみなす。

export type OfflineReadyStatus = 'ready' | 'not-ready'

function getStatus(): OfflineReadyStatus {
  if (!('serviceWorker' in navigator)) return 'not-ready'
  return navigator.serviceWorker.controller ? 'ready' : 'not-ready'
}

/** 現在のオフライン準備状態。 */
export function getOfflineReadyStatus(): OfflineReadyStatus {
  return getStatus()
}

/**
 * オフライン準備状態を監視する。controllerchange(SW が有効化されて制御し始めた/
 * 制御が変わった)のたびに再判定して通知する。
 * App.tsx の onMount から呼び、返り値の解除関数を onCleanup に渡す。
 */
export function initOfflineReadyWatch(notify?: (status: OfflineReadyStatus) => void): () => void {
  if (!('serviceWorker' in navigator)) {
    notify?.('not-ready')
    return () => {}
  }

  const update = () => notify?.(getStatus())
  update()
  navigator.serviceWorker.addEventListener('controllerchange', update)

  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', update)
  }
}
