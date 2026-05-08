# Libra — 開発ガイド

## コンセプト

`libra` は病棟ベッドサイド向けの超軽量コミュニケーション補助アプリ。

`esuna` が本人ひとりでも成立する娯楽・気分転換を担うのに対して、`libra` は複数人のあいだで意思を伝えるための補助に絞る。

ナースコールの置き換えではない。病院全体システムの置き換えでもない。その手前 / 横で、患者本人の細かい意思を家族や看護師に伝える。

## 技術スタック

- **フロントエンド**: Vite + SolidJS + TypeScript（`frontend/`）
- **バックエンド**: Hono on Cloudflare Workers（`backend/`）
- **デプロイ**: フロントエンド → CF Pages（push to main = auto deploy）、バックエンド → `wrangler deploy`
- **CI**: `.github/workflows/ci.yml` - push/PR to main で tsc + vite build
- **Pre-commit**: Husky + lint-staged at repo root（prettier for frontend）

## ローカル起動

```bash
cd frontend && npm install && npm run dev
cd backend && npm install && npm run dev
```

## UI 方針

Esuna のように押しやすい格子状UIにする。ただし Libra は 9 分割固定ではない。

- 画面タップ
- 長押し
- 自動スキャン + Space / Enter
- Bluetooth シャッターボタン相当の入力
- 介助者が横にいる前提の大きな表示

色は Esuna の青系ではなく、緑系統を基本にする。

## 禁止事項

- Co-Authored-By をコミットメッセージに付けない
