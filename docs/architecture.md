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

画面状態は `frontend/src/App.tsx` に集約し、画面ごとの項目は `frontend/src/lib/menus.ts` のビルダーが組み立てる。

- 画面: 本人画面の全 `ScreenId`（home / urgentDetail / discomfort / discomfortOther / painLocation / painIntensity / moodRequest / requests / feelings / letters / lettersRow / lettersYesNo / morse）。親子関係・戻り先の正本は `requirements.md` §4.1.1 と `menus.ts` の `PARENT_SCREEN`。介助者メニューは本人画面の階層に含めない
- 状態: 画面・メッセージ履歴・緊急状態（`libra:emergency`）・スキャン位置・文字盤の入力中文字列・介助者設定（`libra`）
- 入力: キー（任意のキー・Bluetooth シャッター）と、タイルの直接タップ/クリック。背景のタップは何も実行しない。数字キー（1-9）は URL に `?dev` を付けたときだけ有効な開発補助
- 主な `lib/`: `scan.ts`（自動スキャン・先頭待機・連打無視）/ `switchInput.ts`（押下時間の下限・離して決定）/ `morse.ts`・`morseInput.ts`（モールス）/ `feedback.ts`・`tone.ts`（振動・効果音）/ `guidance.ts`（常時案内の文言）/ `gridLayout.ts`（固定格子）/ `phrases.ts`・`settings.ts`（フレーズ・設定）/ `emergencyState.ts`・`wakeLock.ts`・`offlineReady.ts`・`fitHeading.ts`
- 音声: Web Speech API
- レイアウト: `.app-shell` は `height: 100dvh`（非対応環境は `100vh`）で固定し、`overflow: hidden` を実際に効かせる。垂直方向の溢れは `.grid-board`（`overflow-y: auto`）だけが引き受け、document 自体はスクロールしない（`html, body` は `overflow: hidden`、`body` は `position: fixed; inset: 0`。`html/body/#root` に 100vh 基準の高さを置かない。Issue #84）。スキャン対象が変わるたびに `scrollIntoView({block:'nearest'})` で追従させる

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
- `install` は本名（`CACHE_NAME`）ではなく `${CACHE_NAME}-installing` という一時名のキャッシュに対して作業する。全 URL で1つの `AbortController` を共有しながら `fetch(url, { cache: 'reload' })`（60秒タイムアウト）で取得し、全件 `response.ok` を確認してから一時キャッシュへまとめて `put` し、全件成功して初めて本名へコピー（rename 相当）してから一時名を削除する。1件でも取得失敗/非 ok/タイムアウトがあれば、その時点で共有 `AbortController` を abort して残りの URL の取得も打ち切り（1件失敗すれば install はどうせ失敗するため、不安定な回線で precache 総量を律儀に取り切ってから失敗する無駄を避ける）、本名には一度も書き込まずに一時名だけを削除して install 自体を失敗させる（`cache.addAll()` は使わない）。install が失敗すればこの新しい SW は有効化されず、既存の（直前まで正常だった）SW とそのキャッシュがそのまま残って動き続ける。Cloudflare Pages 等が `/index.html` への直接アクセスを `/` へ 308 リダイレクトすることがあり、redirected なレスポンスをそのまま precache すると壊れたエントリになるため、precache キーは常に `/`（index.html を指す）に統一し、redirected な場合は本文だけを取り出して素の 200 レスポンスに作り直してから保存する
- 同一オリジンの GET は stale-while-revalidate（キャッシュがあれば即返し、裏でネットワークから更新）。ナビゲーション（リロード・URL直入力等）は、precache キャッシュに `/` があれば 3 秒タイムアウト付き network-first（失敗・非 2xx 時はキャッシュ済みの `/` へフォールバック）。キャッシュに `/` が無い場合（初回アクセス等）は諦めてエラーを返すのではなく、タイムアウト無しでネットワークの応答を待ち続ける（非 ok 応答であってもそのまま返す）
- `/api/` 配下は SW で握らず常にネットワークのみ（将来バックエンド通信を追加した場合の指針）
- ページ側（`frontend/src/lib/offlineReady.ts`）が「オフライン準備ができているか」を確認する際は、SW に `postMessage({type:'GET_CACHE_NAME'})` で問い合わせて現在の `CACHE_NAME` を教えてもらい、そのキャッシュに `/` と実際に参照中の JS/CSS が揃っているかで判定する（キャッシュ名のプレフィックス一致等の推測はしない。一時名 `-installing` と取り違える恐れがあるため）。未完了のあいだは、既存の `registration` が無ければ `navigator.serviceWorker.register()` を呼び直し(初回 install 失敗時は registration 自体が残らないため)、あれば `registration.update()` を呼ぶ。再試行の間隔は5分から始まり失敗するたびに倍にして60分で打ち止め、成功したら5分にリセットする(指数バックオフ)。`navigator.onLine===false` のあいだは試みない
- `frontend/e2e/offline.e2e.mjs` が、素の静的配信・Cloudflare Pages 相当（`/index.html` 308 リダイレクト）・ドットファイル 404 環境の3パターンでオフライン起動（reload・ディープリンク直接アクセス）を Playwright で検証する。加えて、install 時の 5xx で旧 SW が生き残ること（新旧 CACHE_NAME が衝突する場合を含む）、横向き小画面でのレイアウト崩れが無いこと、案内領域・「介助者用」ボタンがタイルと重ならないことも検証する

## Storage

localStorage に2つのキーで保存する。

- `libra`: 介助者の設定（スキャン間隔・文字サイズ・テーマ等）。実装: `frontend/src/lib/settings.ts`
- `libra:emergency`: 緊急状態（下記）

緊急状態（有効・詳細・副表示）は設定とは別キー `libra:emergency` に保存し、起動時に未解除なら復元して視覚表示を再開する。介助者の緊急解除で保存ごと消す（実装: `frontend/src/lib/emergencyState.ts`）。

複数タブでの同期（storage イベント）は行わない。
