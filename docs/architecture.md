# Libra アーキテクチャ設計書

## 構成

Esuna と同じ repository shape を採用する。

```text
libra/
├── frontend/              # Vite + SolidJS + TypeScript
├── backend/               # Hono on Cloudflare Workers
├── docs/                  # 仕様・状態・運用ドキュメント
├── .github/workflows/     # CI
├── DESIGN.md
├── CLAUDE.md
└── README.md
```

## Frontend

現時点のプロトタイプは `frontend/src/App.tsx` に画面状態を集約している。

- 画面: home / urgent / slow / pain / discomfort / mood / letters / voice / settings
- 状態: message / voiceMode / scanEnabled / scanIndex / letterText / history
- 入力: タップ、数字キー、矢印キー、Space、Enter、Escape
- 音声: Web Speech API
- レイアウト: `.app-shell` は `height: 100dvh`（非対応環境は `100vh`）で固定し、`overflow: hidden` を実際に効かせる。垂直方向の溢れは `.grid-board`（`overflow-y: auto`）だけが引き受け、document 自体はスクロールしない。スキャン対象が変わるたびに `scrollIntoView({block:'nearest'})` で追従させる

## Backend

Hono on Cloudflare Workers。現時点では薄い API に留める。

- `GET /`
- `GET /health`
- `GET /api/presets`
- `POST /api/log`

将来、フレーズ同期・共有設定・介助者モードを置く余地を残す。

## Offline（Service Worker）

`frontend/public/sw.js` が担う。requirements.md §8「バックエンドが落ちていても、すべての伝達機能はオフラインで動かなければならない」に対応する。

- ビルド時に `frontend/scripts/generate-precache-manifest.mjs` が `dist/` を走査し、precache 対象 URL 一覧と、その内容のハッシュ（`CACHE_NAME` に使う）を `sw.js` のプレースホルダへ埋め込む（`npm run build` から自動実行される。ドットファイル・`_headers`/`_redirects`・`.woff2` がある場合の `.woff` フォールバックは対象から除く）。このハッシュは precache 対象ファイルの内容だけでなく `sw.js` 自身のテンプレート本文（フェッチ/キャッシュ戦略のロジック部分）も含める。アセットは変えず SW のロジックだけを直したデプロイでも `CACHE_NAME` が変わるようにするためで、変わらないと新旧 SW が同じキャッシュ名を指すことになり、後述の install 失敗時のクリーンアップが稼働中のキャッシュを巻き込む恐れがある
- `install` は本名（`CACHE_NAME`）ではなく `${CACHE_NAME}-installing` という一時名のキャッシュに対して作業する。各 URL を `fetch(url, { cache: 'reload' }, 60秒タイムアウト付き)` で取得し、全件 `response.ok` を確認してから一時キャッシュへまとめて `put` し、全件成功して初めて本名へコピー（rename 相当）してから一時名を削除する。1件でも取得失敗/非 ok があれば、本名には一度も書き込まずに一時名だけを削除して install 自体を失敗させる（`cache.addAll()` は使わない）。install が失敗すればこの新しい SW は有効化されず、既存の（直前まで正常だった）SW とそのキャッシュがそのまま残って動き続ける。Cloudflare Pages 等が `/index.html` への直接アクセスを `/` へ 308 リダイレクトすることがあり、redirected なレスポンスをそのまま precache すると壊れたエントリになるため、precache キーは常に `/`（index.html を指す）に統一し、redirected な場合は本文だけを取り出して素の 200 レスポンスに作り直してから保存する
- 同一オリジンの GET は stale-while-revalidate（キャッシュがあれば即返し、裏でネットワークから更新）。ナビゲーション（リロード・URL直入力等）は、precache キャッシュに `/` があれば 3 秒タイムアウト付き network-first（失敗・非 2xx 時はキャッシュ済みの `/` へフォールバック）。キャッシュに `/` が無い場合（初回アクセス等）は諦めてエラーを返すのではなく、タイムアウト無しでネットワークの応答を待ち続ける（非 ok 応答であってもそのまま返す）
- `/api/` 配下は SW で握らず常にネットワークのみ（将来バックエンド通信を追加した場合の指針）
- ページ側（`frontend/src/lib/offlineReady.ts`）が「オフライン準備ができているか」を確認する際は、SW に `postMessage({type:'GET_CACHE_NAME'})` で問い合わせて現在の `CACHE_NAME` を教えてもらい、そのキャッシュに `/` と実際に参照中の JS/CSS が揃っているかで判定する（キャッシュ名のプレフィックス一致等の推測はしない。一時名 `-installing` と取り違える恐れがあるため）
- `frontend/e2e/offline.e2e.mjs` が、素の静的配信・Cloudflare Pages 相当（`/index.html` 308 リダイレクト）・ドットファイル 404 環境の3パターンでオフライン起動（reload・ディープリンク直接アクセス）を Playwright で検証する。加えて、install 時の 5xx で旧 SW が生き残ること（新旧 CACHE_NAME が衝突する場合を含む）と、横向き小画面でのレイアウト崩れが無いことも検証する

## Storage

プロトタイプでは永続化していない。次フェーズで Esuna と同じく localStorage のルートキー方式にする。

想定キー: `libra`
