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
| `--surface-scanning` | `#fde68a` | Non-urgent tile currently under the scan cursor    |
| `--text`             | `#0f241d` | Body text on light surfaces                        |
| `--text-muted`       | `#4b6358` | Tile detail text                                   |
| `--message-bg`       | `#0f5132` | Message panel (neutral tone)                       |
| `--message-text`     | `#f3fbf7` | Message panel text                                 |
| `--urgent-bg`        | `#b3261e` | Emergency tile / message panel (solid fill)        |
| `--urgent-text`      | `#ffffff` | Text on urgent fill                                |
| `--scan-ring`        | `#facc15` | Scan-cursor ring (same value in both themes)     |
| `--scan-ring-width`  | `6px`     | Ring thickness (`9px` under high contrast)         |
| `--scan-ring-outline`| `#0f241d` | Dark outline pairing the ring on non-urgent tiles (§2 "Scan cursor emphasis" below) |
| `--scan-ring-outline-urgent` | `#ffffff` | Light outline pairing the ring on the emergency tile |
| `--grid-line`        | `#cde3d4` | Cell divider line (pale green-gray)                |
| `--grid-line-width`  | `1px`     | Divider line thickness (`3px` under high contrast) |

### Dark theme — 夜間 (dark, night ward)

| Token                | Value     | Usage                                            |
| -------------------- | --------- | ------------------------------------------------- |
| `--bg`               | `#07140f` | App background (near-black green)                 |
| `--surface`          | `#17362a` | Neutral tile                                       |
| `--surface-calm`     | `#123a29` | Slow / non-urgent actions                          |
| `--surface-positive` | `#1a4a32` | Yes / okay / thanks                                |
| `--surface-scanning` | `#6b5510` | Non-urgent tile currently under the scan cursor    |
| `--text`             | `#eafaf1` | Body text on dark surfaces                         |
| `--text-muted`       | `#9fc4b0` | Tile detail text                                   |
| `--message-bg`       | `#0a2318` | Message panel (neutral tone)                       |
| `--message-text`     | `#eafaf1` | Message panel text                                 |
| `--urgent-bg`        | `#d7263d` | Emergency tile / message panel (solid fill)        |
| `--urgent-text`      | `#ffffff` | Text on urgent fill                                |
| `--scan-ring-width`  | `6px`     | Ring thickness (`9px` under high contrast)         |
| `--scan-ring-outline`| `#eafaf1` | Light outline pairing the ring (clears 3:1 against both this theme's fills, so urgent reuses it too) |
| `--scan-ring-outline-urgent` | `#eafaf1` | Same as `--scan-ring-outline` above |
| `--grid-line`        | `#2d5a41` | Cell divider line (lighter green than the dark bg/tile fill, so it stays visible on both) |

The emergency tile and message panel are always a solid deep-red fill (`--urgent-bg`) with white text, in both themes, so emergency stays the single most attention-grabbing surface on screen regardless of theme or time of day.

### High contrast (caregiver setting, layers on top of either theme)

`:root[data-high-contrast="true"]` thickens `--grid-line-width` to `3px` and `--scan-ring-width` to `9px` (cells still carry no separate border), strengthens `--text-muted` and `--grid-line` so they clear 3:1 against their own theme's surfaces, and pushes text/background toward pure black/white:

| Theme + HC | `--text`  | `--bg`    | `--message-bg` | `--message-text` | `--surface` | `--surface-calm` | `--surface-positive` | `--text-muted` | `--grid-line` |
| ---------- | --------- | --------- | ---------------- | ------------------- | ----------- | ------------------ | ----------------------- | ----------------- | ---------------- |
| light      | `#000000` | `#eafaf1` | `#003820`         | `#ffffff`           | `#ffffff`   | `#d7f4e2`           | `#b8ecd0`                | `#33463e`          | `#6b9b83`         |
| dark       | `#ffffff` | `#000000` | `#000000`         | `#ffffff`           | `#000000`   | `#001a10`           | `#00301c`                | `#c9ecd9`          | `#4a8a68`         |

All of these are chosen so the WCAG non-text 3:1 threshold holds against the surface they sit on (computed with a relative-luminance script during the PR#16 review pass) — e.g. `--grid-line` under light+HC is `3.16:1` against `#ffffff`, under dark+HC `5.13:1` against `#000000`.

### Font size (caregiver setting)

`--font-scale` (`1` / `1.25` / `1.55` for 標準/大/特大) multiplies most `clamp()`-based font-sizes via `calc(var(--font-scale) * clamp(...))`, so viewport-responsive sizing is preserved at every scale. Set via `:root[data-font-size]`, stored in `localStorage` (`settings.fontSize`). **Exception (PR#16 Opus レビュー 再検証)**: `h1`, `.emergency-details` and `.emergency-sub` do *not* multiply by `--font-scale` — they're already sized generously off `7vh`/`4.2vh`, and multiplying that further at 特大 on a narrow screen pushed the message panel well past its `40dvh` cap (h1 rendering with a negative `top`, off-screen). `--font-scale` scales the *tiles* (the thing 文字サイズ is meant to help read and select), not the already-large message heading.

### Scan cursor emphasis

The current scan target gets a surface-color shift (`--surface-scanning`) on non-urgent tiles, plus a ring drawn with an absolutely-positioned `::after` inset a few pixels from the cell's own edges — so it stays fully inside that cell and never overlaps the seamless-grid divider line or the neighboring cell. Scale-up is intentionally not used here (Issue #3 再レビュー): in a gap-less grid, enlarging the scanning cell would overlap its neighbors. The emergency tile keeps its solid red fill even while scanning — only the ring is added on top.

**PR#16 Opus レビュー must-2**: a plain yellow ring (`--scan-ring`) alone only reaches `1.53:1` against a white tile, well under WCAG's `3:1` non-text contrast floor. The ring is now a double outline: the yellow `border` (`--scan-ring-width`, `6px`/`9px` under high contrast) plus a `box-shadow` line on both its outer and inner edge, in `--scan-ring-outline`. That outline color is theme-dependent because a single fixed color can't clear 3:1 against every fill the ring can sit on: light theme's non-urgent fill (`--surface-scanning: #fde68a`) needs a *dark* outline (`#0f241d`, `13.07:1`), but light theme's urgent fill (`--urgent-bg: #b3261e`) needs a *light* one instead (`--scan-ring-outline-urgent: #ffffff`, `6.54:1` — the dark outline only reaches `2.49:1` there). Dark theme's own fills are both already dark, so one light outline (`#eafaf1`) clears 3:1 against both (`9.90:1` non-urgent, `4.59:1` urgent) and `--scan-ring-outline-urgent` just reuses it.

The emergency tile also gets a permanent (not just while scanning) `2px` inset `::before` outline in `--urgent-text` (white) at `85%` opacity, so it's distinguishable by shape, not only by its red fill (kako-jun's colorblind-accessibility answer during the PR#16 review).

### Cell divider lines

Instead of a border on every side (which would double up between adjacent cells), each `.tile` draws a single `box-shadow: inset` line on its own right and bottom edge only (`--grid-line` color, `--grid-line-width` thickness). This means the outermost left/top edge of the whole grid has no line, while every internal seam and the outer right/bottom edge do — a uniform rule applied to every cell, not a special case per edge.

### Navigate tiles: chevron + content preview (Issue #3 追加指示)

A tile that navigates to a sub-screen no longer ends its label with an arrow character. Instead:

- A `›`-shaped inline SVG chevron sits at the tile's right edge, sized with `cqi` so it scales with the tile's own width, colored `currentColor`, `aria-hidden`.
- A small one-line content preview sits at the tile's bottom edge, truncated with `text-overflow: ellipsis` at the tile's width. It's generated automatically from the destination screen's menu — `menus.ts`'s `buildPreview()` takes that screen's first few items (excluding Emergency and Back) and joins their labels with `・`, ending in `…`. Nothing is hand-written per tile, so editing `menus.ts` keeps the preview in sync.
- Auditory scan / speech only ever reads `item.label` — the chevron and preview are display-only and never reach `announceScanItem`/`announce`.

## 3. Typography Rules

BIZ UDPGothic (400/700) is bundled via `@fontsource/biz-udpgothic` and imported from `index.tsx`, not loaded from a CDN — requirements.md §8 requires every communication feature to work offline, and a Google Fonts `<link>` breaks that. It is also a universal-design typeface (clear kana/kanji shapes, wide letter spacing), which matters because a generic `system-ui`/`sans-serif` stack falls back to a Chinese-glyph font (e.g. WenQuanYi) on many Linux systems and renders Japanese text with the wrong glyph shapes. `font-family` therefore puts `'BIZ UDPGothic'` first, followed only by other Japanese-capable fallbacks (`Hiragino Sans`, `Hiragino Kaku Gothic ProN`, `Yu Gothic UI`, `Yu Gothic`, `Noto Sans JP`) and finally generic `sans-serif` — never a bare `system-ui`/`-apple-system`/`Segoe UI` ahead of a Japanese-capable font. Text must fit inside tiles on mobile and tablet.

- Message: very large, `clamp(2.35rem, 7vh, 5.4rem)` (not multiplied by `--font-scale` — see "Font size" above)
- Tile label: `calc(var(--font-scale) * clamp(1.05rem, min(4.8vh, 15cqi, 20cqb), 3.4rem))` — the `cqi`/`cqb` terms (each `.tile` is `container-type: size`) shrink the label with the tile's own width *and* height, not just the viewport, so a narrow or short tile on a small screen never overflows
- Tile detail: smaller but bold
- Letter spacing: `0`
- Word breaking (Issue #3): `h1`, `.tile-label`, `.emergency-details`, `.emergency-sub` and `.audio-status-hint` use `word-break: auto-phrase; line-break: strict; overflow-wrap: anywhere;` so Japanese text wraps at phrase boundaries (e.g. "緊急です。" / "来てください", "警告音停止中：" / "画面をタップしてください") instead of mid-word (previously "ゆっく" / "り", "くださ" / "い"), with `overflow-wrap: anywhere` as a safety net on browsers that don't yet support `auto-phrase`.

## 4. Layout Principles

- Message panel stays at the top, flush with the grid below it (no gap, no radius — see §2). The caregiver button and the "alarm audio not unlocked" hint live inside the message panel's top-right corner (a dedicated `grid-template-areas` column, `.message-panel-controls`) rather than floating fixed over the bottom-right of the screen — see §8.
- Tile grid fills the remaining space edge-to-edge; `app-shell` has no padding at all (`0`) on any side, since there's no longer a fixed-position control band to leave clearance for.
- Screens with 8 items or fewer (requirements.md §4.1's "1画面8項目以内" target) use a **fill grid**: `computeGridLayout()` (`frontend/src/lib/gridLayout.ts`, unit-tested for n=2..8 × landscape/portrait/square + real device-size approximations) measures the grid area's real size via `ResizeObserver` and picks `(cols, rows=ceil(n/cols))` by, in order: (0) reject any candidate whose cell would be smaller than a minimum cell size (`minCellWidth`/`minCellHeight`, passed in by App.tsx and scaled up with 文字サイズ — this is what stops a pathological "N columns × 1 row" thin band from ever being chosen); (1) among the survivors, fewest empty cells — only 0 or 1 is ever allowed, candidates needing a span of 3+ are rejected outright; (2) among those, the cell aspect ratio (`width/cols ÷ height/rows`) scored by `|log(aspect)|` (so 2× and 0.5× count as equally bad — plain linear distance was biased), preferring a candidate inside `[0.4, 2.5]` when any reaches it. `--cols`/`--rows` then drive `grid-template-columns/rows: repeat(var(--cols/rows), 1fr)`, so the area divides exactly — no isolated tile, no leftover blank space. If the last row would be short by exactly one cell, that last tile gets `grid-column: span 2` (never more) to fill it instead of leaving an empty cell. If no candidate clears the minimum cell size at all, `computeGridLayout` returns `fill: false` and App.tsx falls back to the scrollable layout below, rather than forcing an unreadably cramped grid.
- Screens with more items (the letter board), or a fill grid that couldn't find a candidate meeting the minimum cell size, fall back to `repeat(auto-fit, minmax(...))` with a scrollable grid and a minimum tile height, same as before Issue #3. That fallback's minimum tile size is multiplied by `--font-scale` too (`minmax(calc(var(--font-scale) * 190px), 1fr)` etc. — PR#16 Opus レビュー 再検証), since it used to stay fixed regardless of 文字サイズ and reproduced the same 3-line-wrap problem the fill-grid path already fixed.
- `computeGridLayout`'s default minimum cell size is `160×96px` (PR#16 Opus レビュー 再検証; raised from an initial `120×88px` during the same pass): at `120×88`, `|log(aspect)|` scoring alone could still pick a technically-in-range-aspect layout like "6 columns × 1 row, 141px wide" over a squarer alternative, because a very short, very wide cell can still land inside `[0.4, 2.5]`. The minimum width/height floor is what actually rules those out; a 720-state real-geometry sweep (`scratchpad/rv16.mjs`, viewport × theme × 文字サイズ × 高コントラスト) caught this after the first review pass had only fixed the earlier "7×1" case.
- No nested cards; no gap between cells (see §2's seamless-grid rule).
- Buttons use stable min-heights so labels do not resize the layout.
- Touch targets should remain large enough for tablet bedside use.
- **PR#16 Opus レビュー must-3** (label overflow at large font sizes): four layers, from proactive to last-resort. (1) `computeGridLayout`'s minimum cell size (above) is raised at 大/特大 文字サイズ so the grid itself never picks more columns than the current font can fit — both in fill mode and in the scrollable fallback (previous bullet). (2) Each `.tile` is `container-type: size`, and `--tile-label-font` (shared by `.tile-label` and `.tile-preview`) clamps on `min(vh, cqi, cqb)` — so the label's font shrinks with the tile's own height as well as its width, not just the viewport. (3) A `navigate` tile (`.tile-nav`, the cell itself, not the label) carries `padding-right`/`padding-bottom` scaled by `--font-scale`, reserving the chevron's/preview's space. This took two wrong attempts first: padding directly on `.tile-label` only grows the label's own centered box symmetrically, so half the reserved space lands on the wrong side and the box still reaches the chevron/preview at larger font sizes; `position: absolute` + `inset` on the label fixed that but introduced a new bug — the label's box gets stretched to fill the whole confined area, so even a 2-character label reports as "4 lines" by height alone. Padding the container instead works because `place-items: center` centers within the padded content box, keeping the label's own box at its true (intrinsic) content size while naturally steering clear of the reserved corners; the chevron/preview, being `position: absolute` within `.tile`, are anchored to its padding box and don't move when `.tile`'s own padding changes. (4) `.tile { overflow: hidden }` is the final safety net if the first three are somehow insufficient. The message panel has an equivalent cap: `max-height: 40dvh` with `align-content: start` (kako-jun's answer to the "特大でメッセージ欄が63%" question) — `start`, not `center`, matters here too: capping height while still centering overflowing content pushes half of the overflow *above* the panel (negative `top`, off-screen), which the review's re-run also caught.

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
| `.caregiver-action:disabled`                  | `--caregiver-action-disabled-bg`   | —                                     | `--caregiver-action-disabled-text`     | Action currently unavailable (e.g. 緊急解除)    |
| `.caregiver-close`                            | `--caregiver-close-bg`             | —                                     | `--caregiver-action-text`              | Closing action, deliberately darker            |
| `.caregiver-voice-options` / `-choice-options` `button` | `--caregiver-status-ok-bg` | `--caregiver-action-bg`               | `--text`                             | Voice mode / font size / theme option, unselected |
| `...button.active`                            | `--caregiver-action-bg`            | `--caregiver-action-bg`               | `--caregiver-action-text`              | Voice mode / font size / theme option, selected |
| `.audio-status-hint`                          | `--caregiver-status-warn-bg`       | `--caregiver-status-warn-border`       | `--caregiver-status-warn-text`         | Alarm audio not yet unlocked                   |
| `.caregiver-button`                           | `--caregiver-button-bg`            | —                                     | `--caregiver-button-text`              | Long-press menu entry point, now inside `.message-panel-controls` (top-right of the message panel, not a fixed corner overlay) |

Every token above is a real custom property — no color is hardcoded in `globals.css` component rules (PR#16 Opus レビュー should-5). `.caregiver-button` is a special case: it sits on top of the message panel, whose background changes with `:root[data-message-tone]` (neutral/positive/urgent), so a single fixed button color can't clear 3:1 against all three. `--caregiver-button-bg`/`-text` default to a light button (`#f3fbf7`/`#052e2b`), which clears 3:1 against the neutral (dark green) and urgent (red) panel backgrounds in both themes (`4.71:1`–`15.75:1`); the one combination where that fails is light theme + positive tone, whose panel is pale mint (`--surface-positive: #c9f0d9`, only `1.18:1` against the light button) — `:root[data-theme='light'][data-message-tone='positive']` flips the pair to a dark button (`11.84:1`) for that one case only.

The warn/OK token pairing is shared by Wake Lock status, offline-ready status, and the alarm-audio hint, so caregivers learn one visual pattern for "this needs your attention" across all of them, in either theme. The 文字サイズ (font size) and 表示 (theme: light/dark/auto) pickers both reuse the same `.caregiver-choice-options` look as the voice-mode picker (`--caregiver-status-ok-bg`/`--caregiver-action-bg` unselected/selected pair); 高コントラスト is a plain checkbox like 聴覚スキャン.
