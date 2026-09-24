// オフライン準備状態(Service Worker が実際にこのページをオフラインで動かせる状態にあるか)。
// 正本: docs/requirements.md §8「バックエンドが落ちていても、すべての伝達機能はオフラインで
// 動かなければならない」。PR #11 レビュー対応: Wake Lock の状態表示と同様、「本当にオフラインで
// 動く準備ができているか」を介助者メニューで確認できるようにする。
//
// navigator.serviceWorker.controller の有無だけでは「SW がこのページを制御している」ことしか
// 分からず、install が完了して必要なファイル(本体 HTML・JS・CSS)が実際にキャッシュに揃って
// いるかまでは保証しない。そのため、現在ロードされているページが実際に参照している URL
// (`/` と、DOM 上の script/link タグが指す JS/CSS)が、現在の SW が使っている名前の Cache に
// 一通り揃っているかまで確認する。
//
// PR#11 3巡目 nit: どの Cache を見るかは、名前のプレフィックス一致(`libra-` で始まる、等)
// のような推測ではなく、実際に制御している SW 自身に postMessage で問い合わせて教えてもらう
// (`frontend/public/sw.js` の 'message' ハンドラ参照)。install の一時キャッシュ
// (`${CACHE_NAME}-installing`)も同じ prefix を持つため、推測方式では取り違える恐れがあった。

export type OfflineReadyStatus = 'ready' | 'not-ready'

/** SW への問い合わせがこの時間内に応答しなければ諦めて not-ready とみなす。 */
const CACHE_NAME_QUERY_TIMEOUT_MS = 2000
/** should-A: オフライン準備が未完了のあいだ、この間隔でも SW の更新チェックを試みる。 */
const RECHECK_INTERVAL_MS = 5 * 60 * 1000

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
  // フォント(woff2)は必須URLに含めない。sw.js の install は全件成功/全件失敗の
  // all-or-nothing(1件でも取得失敗すれば install 自体が失敗する)なので、本体HTML/JS/CSSが
  // キャッシュにあるなら、同じ install で precache されたフォントも論理的には必ずある。
  // 逐一確認しないことで、判定を本当に「起動に要る最小限」に絞り、フォントの巨大な
  // blob(日本語サブセットはMB単位)を毎回 match するコストも避ける。
  return [...urls]
}

/**
 * このページを制御している SW に postMessage で問い合わせ、その SW が実際に使っている
 * Cache 名を教えてもらう。応答が無い/controller が無ければ undefined を返す。
 */
function getControllerCacheName(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const controller = navigator.serviceWorker.controller
    if (!controller) {
      resolve(undefined)
      return
    }

    let settled = false
    const finish = (name: string | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(name)
    }

    function onMessage(event: MessageEvent) {
      if (event.data?.type === 'CACHE_NAME') finish(event.data.name)
    }

    const timer = setTimeout(() => finish(undefined), CACHE_NAME_QUERY_TIMEOUT_MS)
    navigator.serviceWorker.addEventListener('message', onMessage)
    controller.postMessage({ type: 'GET_CACHE_NAME' })
  })
}

async function computeStatus(): Promise<OfflineReadyStatus> {
  if (!('serviceWorker' in navigator)) return 'not-ready'
  if (!navigator.serviceWorker.controller) return 'not-ready'
  if (!('caches' in globalThis)) return 'not-ready'

  try {
    const cacheName = await getControllerCacheName()
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

// PR#11 3巡目 nit: computeStatus() は複数箇所(controllerchange・介助者メニューを開く・
// 5分おきのタイマー)から重ねて呼ばれる。後から呼んだ方が先に解決するとは限らないため、
// 世代カウンタで「自分より新しい呼び出しが既に始まっていたら、自分の結果は notify しない」
// ようにし、古い結果が新しい結果を上書きしないようにする。
let generation = 0

async function triggerServiceWorkerUpdate(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update()
  } catch {
    // 更新チェックに失敗しても致命的ではない。次の機会にまた試す
  }
}

async function recheck(notify?: (status: OfflineReadyStatus) => void): Promise<void> {
  const myGeneration = ++generation
  const status = await computeStatus()
  if (myGeneration !== generation) return // 自分より新しい呼び出しが既に走っている。古い結果は捨てる
  notify?.(status)
  // should-A: 未完了のあいだは SW の更新チェックを試みる(install が途中で失敗した後、
  // ネットワークが復旧していれば次の機会に成功させたい)
  if (status !== 'ready') void triggerServiceWorkerUpdate()
}

/** 現在のオフライン準備状態を判定する(非同期。Cache の中身まで確認するため)。 */
export function getOfflineReadyStatus(): Promise<OfflineReadyStatus> {
  return computeStatus()
}

/**
 * オフライン準備状態を即時に再計算して通知する。should-B: 介助者メニューを開くたびに
 * App.tsx から呼ぶ。should-A: 結果が not-ready なら SW の更新チェックも試みる。
 */
export function recheckOfflineReady(notify?: (status: OfflineReadyStatus) => void): Promise<void> {
  return recheck(notify)
}

/**
 * オフライン準備状態を監視する。controllerchange(SW が有効化されて制御し始めた/
 * 制御が変わった)のたびに再判定して通知する。加えて should-A: 5分おきにも再判定し、
 * 未完了のままなら SW の更新チェックを試みる(通信が安定した頃にもう一度 install を
 * 試みる機会を作る)。
 * App.tsx の onMount から呼び、返り値の解除関数を onCleanup に渡す。
 */
export function initOfflineReadyWatch(notify?: (status: OfflineReadyStatus) => void): () => void {
  if (!('serviceWorker' in navigator)) {
    notify?.('not-ready')
    return () => {}
  }

  const update = () => void recheck(notify)
  update()
  navigator.serviceWorker.addEventListener('controllerchange', update)
  const intervalId = setInterval(update, RECHECK_INTERVAL_MS)

  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', update)
    clearInterval(intervalId)
  }
}
