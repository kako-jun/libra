// Issue #5 / PR #11 レビュー対応: 常設運用でのオフライン動作の要。requirements.md §8
// 「バックエンドが落ちていても、すべての伝達機能はオフラインで動かなければならない」に
// 対応する。
//
// ビルド成果物(index.html, JS, CSS, フォント, manifest, アイコン)を install 時に
// すべて precache する。下の2つの定数はビルド時に書き換わるプレースホルダ値を持つ
// (このファイルは public/ 直下のソースで、実際に配信される dist/sw.js だけが置換後の
// 値を持つ。scripts/generate-precache-manifest.mjs がビルド後の dist/ を走査して
// 両方を埋め込む)。
const CACHE_NAME = 'libra-__CACHE_VERSION__'
const PRECACHE_URLS = __PRECACHE_URLS__
// PR#11 3巡目 must-E: install の作業場所を本名(CACHE_NAME)とは別の一時名にする。
// 万が一(ビルド事情等で)新旧のSWでCACHE_NAMEが同じ文字列になってしまっても、install
// 失敗時に稼働中の本名キャッシュを削除してしまう事故を防ぐための保険(下の install
// ハンドラのコメント参照。本質的な対策は generate-precache-manifest.mjs 側で
// CACHE_NAME 自体をSWのロジック変更でも変わるようにすること)。
const INSTALLING_CACHE_NAME = `${CACHE_NAME}-installing`

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const installingCache = await caches.open(INSTALLING_CACHE_NAME)
        // まず全URLを取得して全件 response.ok を確認してから、まとめて cache.put する。
        // 1件でも取得失敗(reject)/非ok(4xx/5xx)があれば、この時点で cache.put を1件も
        // 行わずに throw して install 自体を失敗させる。install が失敗すればこの新しい
        // SWは有効化されず、既存の(直前まで正常だった)SWがそのまま動き続けるため、
        // 壊れた版に丸ごと入れ替わって白画面固定になることを防げる(PR#11 再レビュー must-B。
        // 以前は個々の fetch の成否を見ずに cache.put していたため、5xx/404 応答がそのまま
        // precache に入り、しかも旧キャッシュは activate 時に削除済みで復旧手段が無かった)。
        // should-A: 個々の fetch には60秒のタイムアウト(AbortController)を付け、繋がって
        // いるのに極端に遅い接続(lie-fi)で install が無期限に固まらないようにする
        const fetched = await Promise.all(
          PRECACHE_URLS.map(async (url) => {
            const response = await fetchWithAbortTimeout(url, { cache: 'reload' }, 60000)
            if (!response.ok) {
              throw new Error(`precache fetch failed: ${url} responded ${response.status}`)
            }
            return { url, response }
          }),
        )
        await Promise.all(
          fetched.map(async ({ url, response }) => {
            // Cache.addAll() は使わない。Cloudflare Pages 等は `/index.html` への直接
            // アクセスを `/` へ 308 リダイレクトすることがあり(PRECACHE_URLS 側は既に
            // `/` キーで統一済みだが、配信側の設定次第では `/` 自体が何かにリダイレクト
            // される可能性もゼロではない)、redirected な Response をそのまま
            // cache.put() すると、オフライン時にそれを返した際ブラウザが存在しない
            // リダイレクト先を辿ろうとして失敗する(実機 Playwright 検証で
            // net::ERR_FAILED として再現)。redirected なら本文だけを取り出して素の
            // 200 レスポンスに作り直してから保存する
            const toStore = response.redirected
              ? new Response(await response.blob(), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              : response
            await installingCache.put(url, toStore)
          }),
        )
        // 全件成功した。ここでようやく本名(CACHE_NAME)へコピーする(rename相当)。
        // 一時名のまま作業していたので、ここまでの間 CACHE_NAME という名前のキャッシュには
        // 一切触っていない(既存の稼働中キャッシュがまだあれば無傷のまま)
        const finalCache = await caches.open(CACHE_NAME)
        const installedRequests = await installingCache.keys()
        await Promise.all(
          installedRequests.map(async (request) => {
            const response = await installingCache.match(request)
            if (response) await finalCache.put(request, response)
          }),
        )
        await caches.delete(INSTALLING_CACHE_NAME)
      } catch (error) {
        // 失敗時は一時名だけを消す。CACHE_NAME(稼働中かもしれない既存キャッシュ)には
        // 一度も書き込んでいないので、ここで消す必要も触る必要も無い
        await caches.delete(INSTALLING_CACHE_NAME)
        throw error
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  // 稼働中の CACHE_NAME 以外(前の版・クラッシュ等で残った "-installing" の残骸を含む)を
  // すべて削除する。activate はこの SW の install が成功して初めて呼ばれるため、この時点で
  // 自分自身の INSTALLING_CACHE_NAME は install ハンドラ内で既に削除済みであり、
  // ここで削除対象になるとしても「元から不要な残骸」だけ(誤って稼働中のものを消すことはない)
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      ),
  )
  self.clients.claim()
})

// PR#11 3巡目 nit: ページ側(frontend/src/lib/offlineReady.ts)が「オフライン準備が
// できているか」を確認する際、このSWが実際に使っている Cache 名を知る必要がある。
// キャッシュ名のプレフィックス一致等の推測では、INSTALLING_CACHE_NAME(同じプレフィックスを
// 持つ一時キャッシュ)と取り違える恐れがあるため、postMessage で直接教える
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_CACHE_NAME') {
    event.source?.postMessage({ type: 'CACHE_NAME', name: CACHE_NAME })
  }
})

/** ms 経過したら reject するタイムアウト付き fetch。lie-fi(繋がっているのに極端に遅い)対策。 */
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fetch timeout')), timeoutMs)
    fetch(request).then(
      (response) => {
        clearTimeout(timer)
        resolve(response)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** ms 経過したら AbortController で中断するタイムアウト付き fetch(install 用)。 */
function fetchWithAbortTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // blob:/data: や他オリジン(バックエンドAPI等)は SW で握らない。ネットワークの生の
  // 成否に任せ、失敗時のフォールバック表示はアプリ側の責務にする(requirements.md §8)
  if (url.origin !== self.location.origin) return
  // /api/ 配下は将来バックエンド通信を追加してもキャッシュしない(常にネットワークのみ)
  if (url.pathname.startsWith('/api/')) return

  // Cache.match() は既定でレスポンスの Vary ヘッダを見て突き合わせる。開発/配信サーバーが
  // 静的アセットに Vary: Origin 等を付けることがあり、precache 時のリクエストと実際の
  // 参照(script/link 読み込み)のリクエストで Vary 対象ヘッダの値が食い違うと、実在するのに
  // キャッシュミスして 503 になる。precache されたファイルは元々 Vary で振り分ける必要が
  // 無いため、常に ignoreVary で見る
  const matchOptions = { ignoreVary: true }

  // ナビゲーション(URL直入力・リロード等)は 3秒タイムアウト付き network-first。
  // オフライン・タイムアウト・5xx等の失敗時はキャッシュ済みの `/` へフォールバックする
  // (SPA なので実ファイルが無いパスでもこれで起動できる)。lie-fi 等で応答は来るが
  // !response.ok なだけの場合も、白画面よりキャッシュ済みの本体を出す方を優先する。
  // PR#11 再レビュー should-1: キャッシュが無い場合(初回アクセス等)は、3秒で諦めて
  // Response.error() を返すのではなく、タイムアウト無しでネットワークの応答を待ち続ける
  // (非ok応答であってもそのまま返す。真っ白より情報のあるエラーページの方がよい)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME)
        const cached = await cache.match('/', matchOptions)
        if (!cached) return fetch(request)
        try {
          const response = await fetchWithTimeout(request, 3000)
          return response.ok ? response : cached
        } catch {
          return cached
        }
      })(),
    )
    return
  }

  // 同一オリジンの GET: stale-while-revalidate。キャッシュがあれば即返し、裏でネットワークから
  // 更新する。オフライン時はキャッシュが無いと 503 を返す(precache 済みなら通常発生しない)
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, matchOptions)
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone()).catch(() => {})
          return response
        })
        .catch(() => undefined)
      if (cached) {
        network.catch(() => {}) // 裏更新の失敗はオフライン時の通常状態なので無視する
        return cached
      }
      return (await network) ?? new Response('Offline', { status: 503 })
    }),
  )
})
