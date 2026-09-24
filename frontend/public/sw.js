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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map(async (url) => {
            // Cache.addAll() は使わない。Cloudflare Pages 等は `/index.html` への直接
            // アクセスを `/` へ 308 リダイレクトすることがあり(PRECACHE_URLS 側は既に
            // `/` キーで統一済みだが、配信側の設定次第では `/` 自体が何かにリダイレクト
            // される可能性もゼロではない)、redirected な Response をそのまま
            // cache.put() すると、オフライン時にそれを返した際ブラウザが存在しない
            // リダイレクト先を辿ろうとして失敗する(実機 Playwright 検証で
            // net::ERR_FAILED として再現)。{cache:'reload'} でキャッシュを経由せず
            // 取得し、redirected なら本文だけを取り出して素の 200 レスポンスに
            // 作り直してから保存する
            const response = await fetch(url, { cache: 'reload' })
            const toStore = response.redirected
              ? new Response(await response.blob(), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              : response
            await cache.put(url, toStore)
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      ),
  )
  self.clients.claim()
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

  async function navigateFallback() {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match('/', matchOptions)) ?? Response.error()
  }

  // ナビゲーション(URL直入力・リロード等)は 3秒タイムアウト付き network-first。
  // オフライン・タイムアウト・5xx等の失敗時はキャッシュ済みの `/` へ必ずフォールバックする
  // (SPA なので実ファイルが無いパスでもこれで起動できる)。lie-fi 等で応答は来るが
  // !response.ok なだけの場合も、白画面よりキャッシュ済みの本体を出す方を優先する
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, 3000)
        .then((response) => (response.ok ? response : navigateFallback()))
        .catch(() => navigateFallback()),
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
