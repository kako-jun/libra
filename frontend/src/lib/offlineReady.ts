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
/** should-A: オフライン準備が未完了のあいだ、この間隔でも SW の更新チェックを試みる(最小値)。 */
const MIN_RECHECK_INTERVAL_MS = 5 * 60 * 1000
/**
 * PR#11 4巡目 should-2: install 失敗が続く環境(例えば恒常的に不安定な回線)では、固定の
 * 5分おきのままだと最大 2.7MB(precache 対象の総サイズ)を延々と再取得し続けてしまう。
 * 未完了が続くたびに間隔を倍にしていき(指数バックオフ)、この上限で打ち止めにする。
 * ready になったら MIN_RECHECK_INTERVAL_MS へリセットする。
 */
const MAX_RECHECK_INTERVAL_MS = 60 * 60 * 1000

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
  // should-2(c): 完全にオフラインだと分かっている場合、更新チェック/再登録を試みても
  // 失敗するだけで通信を無駄にするので、そもそも試みない(navigator.onLine が
  // 明確に false のときのみスキップし、undefined 等(判定不能)では試みる)
  if (navigator.onLine === false) return

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (registration) {
      await registration.update()
      return
    }
    // should-1: 初回の install が失敗すると registration 自体が残らないことがある
    // (install に失敗した SW はブラウザ側で登録ごと捨てられる)。registration.update() は
    // 既存の registration が要る前提の API で、無ければ何もしない。その場合は
    // index.tsx と同じ PROD ガードで register() を呼び直し、次の機会に install を
    // 再試行できるようにする
    if (import.meta.env.PROD) {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    }
  } catch {
    // 更新チェック/再登録に失敗しても致命的ではない。次の機会にまた試す
  }
}

/** @returns 世代チェックで古い呼び出しとして捨てられた場合は undefined。 */
async function recheck(
  notify?: (status: OfflineReadyStatus) => void,
): Promise<OfflineReadyStatus | undefined> {
  const myGeneration = ++generation
  const status = await computeStatus()
  if (myGeneration !== generation) return undefined // 自分より新しい呼び出しが既に走っている
  notify?.(status)
  // should-A: 未完了のあいだは SW の更新チェックを試みる(install が途中で失敗した後、
  // ネットワークが復旧していれば次の機会に成功させたい)
  if (status !== 'ready') void triggerServiceWorkerUpdate()
  return status
}

/** 現在のオフライン準備状態を判定する(非同期。Cache の中身まで確認するため)。 */
export function getOfflineReadyStatus(): Promise<OfflineReadyStatus> {
  return computeStatus()
}

/**
 * オフライン準備状態を即時に再計算して通知する。should-B: 介助者メニューを開くたびに
 * App.tsx から呼ぶ。should-A: 結果が not-ready なら SW の更新チェックも試みる。
 */
export function recheckOfflineReady(
  notify?: (status: OfflineReadyStatus) => void,
): Promise<OfflineReadyStatus | undefined> {
  return recheck(notify)
}

/**
 * オフライン準備状態を監視する。controllerchange(SW が有効化されて制御し始めた/
 * 制御が変わった)のたびに再判定して通知する。加えて should-A/should-2: 未完了のあいだ
 * MIN_RECHECK_INTERVAL_MS(5分)おきにも再判定し、SW の更新チェックを試みる(通信が
 * 安定した頃にもう一度 install を試みる機会を作る)。not-ready が続くほど間隔を倍にしていき
 * MAX_RECHECK_INTERVAL_MS(60分)で打ち止め、ready になれば最小値へリセットする
 * (指数バックオフ。固定間隔のままだと不安定な回線で precache 総量を延々と再取得し続ける)。
 * App.tsx の onMount から呼び、返り値の解除関数を onCleanup に渡す。
 */
export function initOfflineReadyWatch(notify?: (status: OfflineReadyStatus) => void): () => void {
  if (!('serviceWorker' in navigator)) {
    notify?.('not-ready')
    return () => {}
  }

  let currentIntervalMs = MIN_RECHECK_INTERVAL_MS
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const scheduleNext = () => {
    timeoutId = setTimeout(runScheduled, currentIntervalMs)
  }

  async function runScheduled() {
    const status = await recheck(notify)
    if (status === 'ready') {
      currentIntervalMs = MIN_RECHECK_INTERVAL_MS
    } else if (status !== undefined) {
      // undefined(世代チェックで捨てられた)のときは間隔を変えない。何が起きたか
      // 分からない古い結果でバックオフの判断はしない
      currentIntervalMs = Math.min(currentIntervalMs * 2, MAX_RECHECK_INTERVAL_MS)
    }
    scheduleNext()
  }

  const update = () => void recheck(notify)
  update()
  navigator.serviceWorker.addEventListener('controllerchange', update)
  scheduleNext()

  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', update)
    clearTimeout(timeoutId)
  }
}
