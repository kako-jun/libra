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

## UI

格子状で押しやすいデザインを維持する。9分割固定にはしない。

## 禁止

- 小さいボタンにしない
- 緊急導線を深い設定画面に混ぜない
- バックエンドが落ちると意思伝達できない設計にしない
