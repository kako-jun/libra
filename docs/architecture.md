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

## Storage

プロトタイプでは永続化していない。次フェーズで Esuna と同じく localStorage のルートキー方式にする。

想定キー: `libra`
