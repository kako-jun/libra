// Issue #5: 常設運用でのオフライン動作の要。requirements.md §8「バックエンドが落ちていても、
// すべての伝達機能はオフラインで動かなければならない」に対応する。
//
// ビルド成果物(index.html, JS, CSS, フォント, manifest, アイコン)を install 時に
// すべて precache する。下の2つの定数はビルド時に書き換わるプレースホルダ値を持つ
// (このファイルは public/ 直下のソースで、実際に配信される dist/sw.js だけが置換後の
// 値を持つ。package.json の build スクリプトが日付を埋め込み、続けて
// scripts/generate-precache-manifest.mjs が dist/ を走査した URL 配列を埋め込む)。
const CACHE_NAME = 'libra-__BUILD_DATE__'
const PRECACHE_URLS = __PRECACHE_URLS__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
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

  // ナビゲーション(URL直入力・リロード等)はキャッシュ済みの index.html に必ずフォールバックする。
  // SPA なので実ファイルが無いパスでもこれで起動できる
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        const fallback =
          (await cache.match('/index.html', matchOptions)) ??
          (await cache.match(request, matchOptions))
        return fallback ?? Response.error()
      }),
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
          if (response.ok) cache.put(request, response.clone())
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
