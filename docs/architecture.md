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

## Backend

Hono on Cloudflare Workers。現時点では薄い API に留める。

- `GET /`
- `GET /health`
- `GET /api/presets`
- `POST /api/log`

将来、フレーズ同期・共有設定・介助者モードを置く余地を残す。

## Offline（Service Worker）

`frontend/public/sw.js` が担う。requirements.md §8「バックエンドが落ちていても、すべての伝達機能はオフラインで動かなければならない」に対応する。

- ビルド時に `frontend/scripts/generate-precache-manifest.mjs` が `dist/` を走査し、precache 対象 URL 一覧と、その内容のハッシュ（`CACHE_NAME` に使う）を `sw.js` のプレースホルダへ埋め込む（`npm run build` から自動実行される。ドットファイル・`_headers`/`_redirects`・`.woff2` がある場合の `.woff` フォールバックは対象から除く）
- `install` 時、各 URL を `fetch(url, { cache: 'reload' })` で取得して precache する（`cache.addAll()` は使わない）。Cloudflare Pages 等が `/index.html` への直接アクセスを `/` へ 308 リダイレクトすることがあり、redirected なレスポンスをそのまま precache すると壊れたエントリになるため、precache キーは常に `/`（index.html を指す）に統一し、redirected な場合は本文だけを取り出して素の 200 レスポンスに作り直してから保存する
- 同一オリジンの GET は stale-while-revalidate（キャッシュがあれば即返し、裏でネットワークから更新）。ナビゲーション（リロード・URL直入力等）は 3 秒タイムアウト付き network-first で、失敗・非 2xx 時はキャッシュ済みの `/` へフォールバックする（SPA なので実ファイルが無い深いパスでもこれで起動できる）
- `/api/` 配下は SW で握らず常にネットワークのみ（将来バックエンド通信を追加した場合の指針）
- `frontend/e2e/offline.e2e.mjs` が、素の静的配信・Cloudflare Pages 相当（`/index.html` 308 リダイレクト）・ドットファイル 404 環境の3パターンでオフライン起動（reload・ディープリンク直接アクセス）を Playwright で検証する

## Storage

プロトタイプでは永続化していない。次フェーズで Esuna と同じく localStorage のルートキー方式にする。

想定キー: `libra`
