# Libra 開発ガイドライン

## 方針

Libra は Esuna と同じ技術スタック・CI・docs 形態を使う兄弟アプリ。

ただし用途は異なる。Libra は病棟ベッドサイドの意思伝達に絞る。

## ディレクトリ

```text
libra/
├── frontend/              # Vite + SolidJS + TypeScript
├── backend/               # Hono on Cloudflare Workers
├── docs/                  # ドキュメント
├── .github/workflows/     # CI
├── DESIGN.md
├── CLAUDE.md
└── README.md
```

## ローカル起動

```bash
cd frontend
npm install
npm run dev

cd backend
npm install
npm run dev
```

## CI

`.github/workflows/ci.yml` で frontend/backend の型チェックと frontend build を実行する。

## オフライン動作の e2e 検証

```bash
cd frontend
npm run build   # dist/ を作る(scripts/generate-precache-manifest.mjs が sw.js に precache 一覧を埋め込む)
npm run e2e     # dist/ を素の静的配信 / Cloudflare Pages 相当 / ドットファイル404環境の3パターンで検証する
```

`frontend/e2e/offline.e2e.mjs` が各配信モードで静的サーバーを立て、Playwright(Chromium) でオフライン化した状態の reload とディープリンク(`/foo/bar` 等)への直接アクセスがアプリのシェルまで表示できることを確認する。Chromium の実行体が `playwright install` 済みでない場合は `PLAYWRIGHT_CHROMIUM_PATH` 環境変数で既存の Chromium 実行ファイルを指定する(例: `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e`)。

## PWA アイコンの再生成

`frontend/public/icon.svg` を変更したら、192px/512px の PNG(favicon・PWA アイコン・maskable すべて共通)を作り直す。

```bash
cd frontend
node scripts/render-icons.mjs public
```

このスクリプトも Playwright(Chromium) で SVG をレンダリング・スクリーンショットして PNG を書き出す(sharp 等の画像ライブラリは依存に入れない)。`playwright` は devDependency に入っているが、ブラウザ本体(`npx playwright install chromium`)は別途必要。既存の Chromium 実行体を使う場合は `PLAYWRIGHT_CHROMIUM_PATH` を指定する。

## UI

格子状で押しやすいデザインを維持する。9分割固定にはしない。

## 禁止

- 小さいボタンにしない
- 緊急導線を深い設定画面に混ぜない
- バックエンドが落ちると意思伝達できない設計にしない
