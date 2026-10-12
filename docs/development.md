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

`.github/workflows/ci.yml` で frontend は型チェック（`tsc --noEmit`）・単体テスト（`npm test`）・build、backend は型チェックを実行する。加えて e2e ジョブが `npm run build` の成果物に対して Playwright(Chromium) の e2e を全件実行する（種類ごとに4つの job に分けて並列。どれかが落ちると CI が落ちる）。ログには検査ごとに `--- checking: <検査名> ---` と `[<検査名>] OK` / `[<検査名>] FAILED` が出るので、どの検査が落ちたかはログで分かる。

## e2e 検証（実ブラウザ）

```bash
cd frontend
npm run build          # dist/ を作る(scripts/generate-precache-manifest.mjs が sw.js に precache 一覧を埋め込む。vite build だけでは足りない)
npm run e2e            # 下の4種類を順に全件実行する
npm run e2e:offline    # 種類ごとに単独でも実行できる(e2e:navigation / e2e:layout / e2e:theme)
E2E_ONLY=theme-parity npm run e2e:theme   # 検査名で絞る(カンマ区切りで複数可)
```

`frontend/e2e/` は検証の種類ごとに分かれている。共通の静的サーバー・Chromium 起動・実行ランナーは `lib.mjs`（各検査は名前を出力し、1件でも失敗すれば終了コード 1）。

- `offline.e2e.mjs`: 素の静的配信 / Cloudflare Pages 相当 / ドットファイル404環境の3パターンで、オフライン化した状態の reload とディープリンク(`/foo/bar` 等)への直接アクセスがアプリのシェルまで表示できること。install 時の 5xx で旧 SW とキャッシュが生き残ること
- `navigation.e2e.mjs`: 緊急詳細の戻る・状態保持、通常下位画面の戻る→緊急順、痛い場所から不快への親戻り、パンくずが省略されず祖先ボタンで戻れること
- `layout.e2e.mjs`: 横向き小画面・極大文字・緊急中などで、文字盤のスクロール・案内領域と「介助者用」ボタンの重なり・見出しとラベルの収まり・プレビューの重なり・モールス凡例などが崩れないこと
- `theme.e2e.mjs`: スキャン枠が黄色一本で面が他のタイルと異なること、明るい/夜間でラベル・寸法が一致すること（テーマは色だけ）

Chromium の実行体が `playwright install` 済みでない場合は `PLAYWRIGHT_CHROMIUM_PATH` 環境変数で既存の Chromium 実行ファイルを指定する(例: `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e`)。

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
