// オフライン準備状態(Service Worker が実際にこのページをオフラインで動かせる状態にあるか)。
// 正本: docs/requirements.md §8「バックエンドが落ちていても、すべての伝達機能はオフラインで
// 動かなければならない」。PR #11 レビュー対応(should-1/should-2): Wake Lock の状態表示と
// 同様、「本当にオフラインで動く準備ができているか」を介助者メニューで確認できるようにする。
//
// navigator.serviceWorker.controller の有無だけでは「SW がこのページを制御している」ことしか
// 分からず、install が完了して必要なファイル(本体 HTML・JS・CSS)が実際にキャッシュに揃って
// いるかまでは保証しない。そのため、現在ロードされているページが実際に参照している URL
// (`/` と、DOM 上の script/link タグが指す JS/CSS)が、`libra-` で始まる名前の Cache に
// 一通り揃っているかまで確認する。

export type OfflineReadyStatus = 'ready' | 'not-ready'

const CACHE_NAME_PREFIX = 'libra-'

function getRequiredUrls(): string[] {
  const urls = new Set<string>(['/'])
  document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
    const href = el.getAttribute('href')
    if (href) urls.add(href)
  })
  document.querySelectorAll('script[src]').forEach((el) => {
    const src = el.getAttribute('src')
    if (src) urls.add(src)
  })
  return [...urls]
}

async function computeStatus(): Promise<OfflineReadyStatus> {
  if (!('serviceWorker' in navigator)) return 'not-ready'
  if (!navigator.serviceWorker.controller) return 'not-ready'
  if (!('caches' in globalThis)) return 'not-ready'

  try {
    const cacheNames = await caches.keys()
    const cacheName = cacheNames.find((name) => name.startsWith(CACHE_NAME_PREFIX))
    if (!cacheName) return 'not-ready'

    const cache = await caches.open(cacheName)
    const requiredUrls = getRequiredUrls()
    const matches = await Promise.all(
      requiredUrls.map((url) => cache.match(url, { ignoreVary: true })),
    )
    return matches.every((match) => match !== undefined) ? 'ready' : 'not-ready'
  } catch {
    return 'not-ready'
  }
}

/** 現在のオフライン準備状態を判定する(非同期。Cache の中身まで確認するため)。 */
export function getOfflineReadyStatus(): Promise<OfflineReadyStatus> {
  return computeStatus()
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

  const update = () => {
    void computeStatus().then((status) => notify?.(status))
  }
  update()
  navigator.serviceWorker.addEventListener('controllerchange', update)

  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', update)
  }
}
