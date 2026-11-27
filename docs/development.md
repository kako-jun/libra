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

`.github/workflows/ci.yml` で frontend は型チェック（`tsc --noEmit`）・単体テスト（`npm test`）・build、backend は型チェックを実行する。加えて e2e ジョブが `npm run build` の成果物に対して Playwright(Chromium) の e2e を全件実行する（種類ごとに5つの job に分けて並列。どれかが落ちると CI が落ちる）。ログには検査ごとに `--- checking: <検査名> ---` と `[<検査名>] OK` / `[<検査名>] FAILED` が出るので、どの検査が落ちたかはログで分かる。

## e2e 検証（実ブラウザ）

```bash
cd frontend
npm run build          # dist/ を作る(scripts/generate-precache-manifest.mjs が sw.js に precache 一覧を埋め込む。vite build だけでは足りない)
npm run e2e            # 下の5種類を順に全件実行する
npm run e2e:offline    # 種類ごとに単独でも実行できる(e2e:navigation / e2e:layout / e2e:theme / e2e:font)
E2E_ONLY=theme-parity npm run e2e:theme   # 検査名で絞る(カンマ区切りで複数可)
```

`frontend/e2e/` は検証の種類ごとに分かれている。共通の静的サーバー・Chromium 起動・実行ランナーは `lib.mjs`（各検査は名前を出力し、1件でも失敗すれば終了コード 1）。

- `offline.e2e.mjs`: 素の静的配信 / Cloudflare Pages 相当 / ドットファイル404環境の3パターンで、オフライン化した状態の reload とディープリンク(`/foo/bar` 等)への直接アクセスがアプリのシェルまで表示できること。install 時の 5xx で旧 SW とキャッシュが生き残ること
- `navigation.e2e.mjs`: 緊急詳細の戻る・状態保持、通常下位画面の戻る→緊急順、痛い場所から不快への親戻り、パンくずが省略されず祖先ボタンで戻れること。タッチとマウスで、ボタン以外を押すと黄色を選び、その押下で指の下に現れたボタンは動かないこと（`press-anywhere`。Issue #134）
- `layout.e2e.mjs` の `message-panel-fixed` / `breadcrumb-center`: 伝達欄の高さと下のタイル位置が内容で変わらず長文が収まること・内容の色が過去の表示でも保たれ枠が付かないこと（#130・#131・#135）、パンくずの家アイコン・項目名・区切りが上下中央に揃うこと（#128）
- `layout.e2e.mjs`: 横向き小画面・極大文字・緊急中などで、文字盤の行段階の全項目表示（Issue #121）・ホームの格子と「はい」「いいえ」の並び・ラベルと予告の重なり（`home-grid`。Issue #126/#127）・案内領域と「介助者用」ボタンの重なり・見出しとラベルの収まり・プレビューの重なり・モールス凡例などが崩れないこと
- `theme.e2e.mjs`: スキャン枠が黄色一本で面が他のタイルと異なること、明るい/夜間でラベル・寸法が一致すること（テーマは色だけ）、押すと伝達欄が赤くなるパネルだけが専用の面になること（`urgent-panel`）
- `font.e2e.mjs`: 本人画面・介助者用メニューの全タブ・入力欄で、同梱の BIZ UDGothic 以外の書体で描かれた字が無いこと（CDP で実描画の書体を調べる）。オフラインでも同じで、珍しい字（→ ● ℃ 髙 﨑 Ⅰ ≒ など）を入れても別の書体にならないこと、ライセンス全文が precache され原本と一致すること（Issue #156）。**同梱の書体に字があることは、この e2e では保証しない**（代わりの書体が OS に無い字は、同梱の書体の代替字形で描かれて合格する）。全字があることは、同梱ファイルの SHA-256 を固定する単体テスト `SingleFont.test.ts` が担う

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
