# DESIGN.md

libra — Design System

## 1. Visual Theme & Atmosphere

Bedside communication UI. The screen is dominated by a large message panel and a grid of big, easy-to-press tiles.

The design should feel related to Esuna: simple, direct, high-contrast, and built around large touch targets. It is not bound to Esuna's fixed 9-grid operation model. Libra may use more or fewer tiles depending on the task.

Theme: green-based, calm, medical-adjacent, and readable. Urgent actions may use red.

## 2. Color Palette & Roles (Issue #3)

Border-first tiles were retired, then (再レビュー) gap/radius/shadow were retired too: the grid is now a seamless, edge-to-edge board. Cells carry no gap between them, no rounded corners, no drop shadow — only a background fill color and a thin divider line on each cell's right and bottom edge (`box-shadow: inset`, so it never doubles up with the neighbor's own line). The message panel and the letter-board input strip use the same seamless treatment (`border-bottom` in the divider color) so the whole screen reads as one continuous plate. Every color is a CSS custom property on `:root` in `frontend/src/styles/globals.css` (the source of truth); component CSS never hardcodes a color.

Two themes — 明るい (light, daytime ward) and 夜間 (dark, night ward) — are a caregiver setting (`Settings.theme`: `'light' | 'dark' | 'auto'`, default `'auto'`), not a URL query. `'auto'` follows the device's `prefers-color-scheme` and re-resolves immediately when the OS setting changes (App.tsx subscribes to the `matchMedia` `change` event), so a ward that dims its lights at night can just leave it on auto. App.tsx resolves the setting to the actual `light`/`dark` value and sets `:root[data-theme]` accordingly — CSS only ever sees `data-theme="light"` or `"dark"`, never `"auto"`. Selectors are identical between the two themes — only token values differ.

### Light theme — 明るい (bright, calm; daytime ward)

| Token                | Value     | Usage                                            |
| -------------------- | --------- | ------------------------------------------------- |
| `--bg`               | `#eafaf1` | App background                                    |
| `--surface`          | `#ffffff` | Neutral tile                                       |
| `--surface-calm`     | `#dcf5e6` | Slow / non-urgent actions                          |
| `--surface-positive` | `#c9f0d9` | Yes / okay / thanks                                |
| `--surface-scanning` | `#fff6c8` | Non-urgent tile currently under the scan cursor    |
| `--text`             | `#0f241d` | Body text on light surfaces                        |
| `--text-muted`       | `#4b6358` | Tile detail text                                   |
| `--message-bg`       | `#0f5132` | Message panel (neutral tone)                       |
| `--message-text`     | `#f3fbf7` | Message panel text                                 |
| `--urgent-bg`        | `#b3261e` | Emergency tile / message panel (solid fill)        |
| `--urgent-text`      | `#ffffff` | Text on urgent fill                                |
| `--scan-ring`        | `#facc15` | Scan-cursor ring (same value in both themes)     |
| `--grid-line`        | `#cde3d4` | Cell divider line (pale green-gray)                |
| `--grid-line-width`  | `1px`     | Divider line thickness (`3px` under high contrast) |

### Dark theme — 夜間 (dark, night ward)

| Token                | Value     | Usage                                            |
| -------------------- | --------- | ------------------------------------------------- |
| `--bg`               | `#07140f` | App background (near-black green)                 |
| `--surface`          | `#17362a` | Neutral tile                                       |
| `--surface-calm`     | `#123a29` | Slow / non-urgent actions                          |
| `--surface-positive` | `#1a4a32` | Yes / okay / thanks                                |
| `--surface-scanning` | `#4a3d0b` | Non-urgent tile currently under the scan cursor    |
| `--text`             | `#eafaf1` | Body text on dark surfaces                         |
| `--text-muted`       | `#9fc4b0` | Tile detail text                                   |
| `--message-bg`       | `#0a2318` | Message panel (neutral tone)                       |
| `--message-text`     | `#eafaf1` | Message panel text                                 |
| `--urgent-bg`        | `#d7263d` | Emergency tile / message panel (solid fill)        |
| `--urgent-text`      | `#ffffff` | Text on urgent fill                                |
| `--grid-line`        | `#2d5a41` | Cell divider line (lighter green than the dark bg/tile fill, so it stays visible on both) |

The emergency tile and message panel are always a solid deep-red fill (`--urgent-bg`) with white text, in both themes, so emergency stays the single most attention-grabbing surface on screen regardless of theme or time of day.

### High contrast (caregiver setting, layers on top of either theme)

`:root[data-high-contrast="true"]` only thickens `--grid-line-width` to `3px` (cells still carry no separate border) and pushes text/background toward pure black/white:

| Theme + HC | `--text`  | `--bg`    | `--message-bg` | `--message-text` |
| ---------- | --------- | --------- | ---------------- | ------------------- |
| light      | `#000000` | `#eafaf1` | `#003820`         | `#ffffff`           |
| dark       | `#ffffff` | `#000000` | `#000000`         | `#ffffff`           |

### Font size (caregiver setting)

`--font-scale` (`1` / `1.25` / `1.55` for 標準/大/特大) multiplies every `clamp()`-based font-size via `calc(var(--font-scale) * clamp(...))`, so viewport-responsive sizing is preserved at every scale. Set via `:root[data-font-size]`, stored in `localStorage` (`settings.fontSize`).

### Scan cursor emphasis

The current scan target gets a surface-color shift (`--surface-scanning`) on non-urgent tiles, plus a thick yellow ring drawn with an absolutely-positioned `::after` inset a few pixels from the cell's own edges — so it stays fully inside that cell and never overlaps the seamless-grid divider line or the neighboring cell. Scale-up is intentionally not used here (Issue #3 再レビュー): in a gap-less grid, enlarging the scanning cell would overlap its neighbors. The emergency tile keeps its solid red fill even while scanning — only the ring is added on top.

### Cell divider lines

Instead of a border on every side (which would double up between adjacent cells), each `.tile` draws a single `box-shadow: inset` line on its own right and bottom edge only (`--grid-line` color, `--grid-line-width` thickness). This means the outermost left/top edge of the whole grid has no line, while every internal seam and the outer right/bottom edge do — a uniform rule applied to every cell, not a special case per edge.

### Navigate tiles: chevron + content preview (Issue #3 追加指示)

A tile that navigates to a sub-screen no longer ends its label with an arrow character. Instead:

- A `›`-shaped inline SVG chevron sits at the tile's right edge, sized with `cqi` so it scales with the tile's own width, colored `currentColor`, `aria-hidden`.
- A small one-line content preview sits at the tile's bottom edge, truncated with `text-overflow: ellipsis` at the tile's width. It's generated automatically from the destination screen's menu — `menus.ts`'s `buildPreview()` takes that screen's first few items (excluding Emergency and Back) and joins their labels with `・`, ending in `…`. Nothing is hand-written per tile, so editing `menus.ts` keeps the preview in sync.
- Auditory scan / speech only ever reads `item.label` — the chevron and preview are display-only and never reach `announceScanItem`/`announce`.

## 3. Typography Rules

BIZ UDPGothic (400/700) is bundled via `@fontsource/biz-udpgothic` and imported from `index.tsx`, not loaded from a CDN — requirements.md §8 requires every communication feature to work offline, and a Google Fonts `<link>` breaks that. It is also a universal-design typeface (clear kana/kanji shapes, wide letter spacing), which matters because a generic `system-ui`/`sans-serif` stack falls back to a Chinese-glyph font (e.g. WenQuanYi) on many Linux systems and renders Japanese text with the wrong glyph shapes. `font-family` therefore puts `'BIZ UDPGothic'` first, followed only by other Japanese-capable fallbacks (`Hiragino Sans`, `Hiragino Kaku Gothic ProN`, `Yu Gothic UI`, `Yu Gothic`, `Noto Sans JP`) and finally generic `sans-serif` — never a bare `system-ui`/`-apple-system`/`Segoe UI` ahead of a Japanese-capable font. Text must fit inside tiles on mobile and tablet.

- Message: very large, `calc(var(--font-scale) * clamp(2.35rem, 7vh, 5.4rem))`
- Tile label: `calc(var(--font-scale) * clamp(1.05rem, min(4.8vh, 15cqi), 3.4rem))` — the `cqi` term (each `.tile` is `container-type: inline-size`) shrinks the label with the tile's own width, not just the viewport, so a narrow tile on a small screen never overflows
- Tile detail: smaller but bold
- Letter spacing: `0`
- Word breaking (Issue #3): `h1`, `.tile-label`, `.emergency-details`, `.emergency-sub` and `.audio-status-hint` use `word-break: auto-phrase; line-break: strict; overflow-wrap: anywhere;` so Japanese text wraps at phrase boundaries (e.g. "緊急です。" / "来てください", "警告音停止中：" / "画面をタップしてください") instead of mid-word (previously "ゆっく" / "り", "くださ" / "い"), with `overflow-wrap: anywhere` as a safety net on browsers that don't yet support `auto-phrase`.

## 4. Layout Principles

- Message panel stays at the top, flush with the grid below it (no gap, no radius — see §2). The caregiver button and the "alarm audio not unlocked" hint live inside the message panel's top-right corner (a dedicated `grid-template-areas` column, `.message-panel-controls`) rather than floating fixed over the bottom-right of the screen — see §8.
- Tile grid fills the remaining space edge-to-edge; `app-shell` has no padding at all (`0`) on any side, since there's no longer a fixed-position control band to leave clearance for.
- Screens with 8 items or fewer (requirements.md §4.1's "1画面8項目以内" target) use a **fill grid**: `computeGridLayout()` (`frontend/src/lib/gridLayout.ts`, unit-tested for n=2..8 × landscape/portrait/square) measures the grid area's real size via `ResizeObserver` and picks `(cols, rows=ceil(n/cols))` by, in order: (1) fewest empty cells — only 0 or 1 is ever allowed, candidates needing a span of 3+ are rejected outright; (2) among the survivors, the cell aspect ratio (`width/cols ÷ height/rows`) closest to 1, preferring one inside `[0.6, 1.6]` when any candidate reaches it. `--cols`/`--rows` then drive `grid-template-columns/rows: repeat(var(--cols/rows), 1fr)`, so the area divides exactly — no isolated tile, no leftover blank space. If the last row would be short by exactly one cell, that last tile gets `grid-column: span 2` (never more) to fill it instead of leaving an empty cell.
- Screens with more items (the letter board) fall back to `repeat(auto-fit, minmax(...))` with a scrollable grid and a minimum tile height, same as before Issue #3.
- No nested cards; no gap between cells (see §2's seamless-grid rule).
- Buttons use stable min-heights so labels do not resize the layout.
- Touch targets should remain large enough for tablet bedside use.

## 5. Interaction

Source of truth: `docs/requirements.md`.

- The patient has exactly one input: a single "on" (tap anywhere / any key / Bluetooth shutter) timed to an automatic scan cursor.
- Scanning runs from startup and never requires the patient to start or stop it.
- The first scan item of every screen is Emergency.
- Caregiver menu opens with a 2-second long press on the button in the message panel's top-right corner; it is not in the scan cycle.
- Number keys 1-9 are a developer/caregiver aid only and hidden by default.
- Speech can be OFF, tone-only, short, or full. The emergency alarm sounds even when OFF.

## 6. Do's and Don'ts

### Do

- Keep tiles large and readable.
- Prefer green variants for normal actions.
- Use red only for urgent actions.
- Keep current message visible at all times.
- Preserve Esuna-like directness without copying its 9-grid rule.

### Don't

- Do not make Libra a general portal.
- Do not mix urgent actions with deep setup flows.
- Do not rely on small icons or dense text.
- Do not make the app dependent on backend availability for core communication.
- Do not round tile corners or add per-cell shadows/gaps (Issue #3 再レビュー) — the grid is a single seamless plate, divided only by thin lines (§2).
- Do not show app-name/voice-mode/scan-position status text in the message panel (Issue #3 追加指示) — the patient reads their position from the emphasized scan cursor, not a counter; that surface is for the message and emergency detail only.

## 7. Icon

Decided at planning time (2026-05-07, corrected 2026-09-24): an abstract balance-scale (libra = the zodiac Libra) motif, single-color green (`#064e3b`) on the app background (`#f3fbf7`). `frontend/public/icon.svg` is the source; PWA icons and the favicon are generated from it.

The motif is exactly these shapes, all in `#064e3b`:

1. Two equal-sized, upward-pointing (roughly equilateral) triangles side by side, bases at the same height. **Outline only — never filled.** The stroke is thick enough to survive a 16–32px favicon (≈28–36px at the 512×512 canvas scale) with rounded joins/caps.
2. A filled circle sitting on each triangle's apex (one per triangle — two circles total).
3. A single horizontal bar that only connects the two circles — it runs from the right edge of the left circle to the left edge of the right circle, ending flush with (or barely overlapping) each circle. It never pierces through either circle, and it stays perfectly level (never tilted).

No pans, no hanging strings, no other motif (e.g. a speech bubble, grid, or a single triangle+circle+bar) — do not swap this for a different icon concept without an explicit decision, since this was chosen deliberately over the app's own tile-grid visual language. All shapes stay within the maskable safe zone (the centered 80% circle of the 512×512 canvas) so launchers that crop to a circle/squircle never cut into the scale.

## 8. Caregiver UI

The caregiver panel (long-press menu) reuses the same palette as the patient screen via tokens, as flat status/action colors rather than tile tones. Values below are the light theme; the dark theme substitutes its own `--caregiver-*` tokens (see `globals.css`) but the roles are identical:

| Element                                     | Background (token)             | Border (token)                  | Text (token)                    | Meaning                                      |
| -------------------------------------------- | -------------------------------- | ---------------------------------- | ---------------------------------- | --------------------------------------------- |
| `.caregiver-status` (normal)                  | `--caregiver-status-ok-bg`         | `--caregiver-status-ok-border`         | `--text`                             | Wake Lock / offline-ready: OK                  |
| `.caregiver-status.warn`                       | `--caregiver-status-warn-bg`       | `--caregiver-status-warn-border`       | `--caregiver-status-warn-text`         | Wake Lock / offline-ready: needs attention     |
| `.caregiver-action`                           | `--caregiver-action-bg`            | —                                     | `--caregiver-action-text`              | Primary action button (fullscreen, close…)     |
| `.caregiver-action:disabled`                  | `#e5e7eb` (fixed, not themed)      | —                                     | `#6b7280` (fixed, not themed)          | Action currently unavailable (e.g. 緊急解除)    |
| `.caregiver-close`                            | `--caregiver-close-bg`             | —                                     | `--caregiver-action-text`              | Closing action, deliberately darker            |
| `.caregiver-voice-options` / `-choice-options` `button` | `--caregiver-status-ok-bg` | `--caregiver-action-bg`               | `--text`                             | Voice mode / font size option, unselected      |
| `...button.active`                            | `--caregiver-action-bg`            | `--caregiver-action-bg`               | `--caregiver-action-text`              | Voice mode / font size option, selected        |
| `.audio-status-hint`                          | `--caregiver-status-warn-bg`       | `--caregiver-status-warn-border`       | `--caregiver-status-warn-text`         | Alarm audio not yet unlocked                   |

The warn/OK token pairing is shared by Wake Lock status, offline-ready status, and the alarm-audio hint, so caregivers learn one visual pattern for "this needs your attention" across all of them, in either theme. The 文字サイズ (font size) and 表示 (theme: light/dark/auto) pickers both reuse the same `.caregiver-choice-options` look as the voice-mode picker (`--caregiver-status-ok-bg`/`--caregiver-action-bg` unselected/selected pair); 高コントラスト is a plain checkbox like 聴覚スキャン.
