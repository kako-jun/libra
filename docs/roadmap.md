# Libra — ロードマップ

## Phase 0: Prototype

- [x] Esuna と同じ repo shape
- [x] Vite + SolidJS frontend
- [x] Hono Workers backend
- [x] 大きい格子状 UI
- [x] 緊急 / ゆっくり導線
- [x] 自動スキャン試作

## Phase 1: Single-switch MVP（要件: `requirements.md`）

- [ ] シングルスイッチ自動スキャンを唯一の本人入力にする（常時スキャン・どこでもオン・緊急先頭・戻る/取り消し）
- [ ] 安全の優先順位に沿った画面構成（緊急 → はい/いいえ → 不快 → 快 → 文字盤）
- [ ] 緊急: 介助者解除まで保持・音声 OFF でも警告音
- [ ] 介助者メニュー（長押し）とスキャン設定の localStorage 保存
- [ ] 画面デザインの立て直し
- [ ] 文字盤: 清音46字 + ー、2段階スキャン
- [ ] Bluetooth シャッターボタン実機確認
- [ ] PWA アイコンを Libra 専用化

## Phase 2: Caregiver Mode

- [ ] フレーズ編集
- [ ] 文字盤の候補補完（登録語・履歴）
- [ ] 状況別プリセット
- [ ] 日本語 / 英語切り替え
