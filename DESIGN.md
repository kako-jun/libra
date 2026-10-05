# DESIGN.md

libra — Design System

## 1. Visual Theme & Atmosphere

Bedside communication UI. The upper area separates the unresolved emergency state, the current screen guidance, and the last completed transmission; a grid of big, easy-to-press tiles remains the main operation area.

The design should feel related to Esuna: simple, direct, high-contrast, and built around large touch targets. It is not bound to Esuna's fixed 9-grid operation model. Libra may use more or fewer tiles depending on the task.

Theme: green-based, calm, medical-adjacent, and readable. Urgent actions may use red.

## 2. Color Palette & Roles (Issue #3)

Border-first tiles were retired, then (再レビュー) gap/radius/shadow were retired too: the grid is now a seamless, edge-to-edge board. Cells carry no gap between them, no rounded corners, no drop shadow — only a background fill color and a thin divider line on each cell's right and bottom edge (`box-shadow: inset`, so it never doubles up with the neighbor's own line). The message panel and the letter-board input strip use the same seamless treatment (`border-bottom` in the divider color) so the whole screen reads as one continuous plate. Every color is a CSS custom property on `:root` in `frontend/src/styles/globals.css` (the source of truth); component CSS never hardcodes a color.

Two themes — 明るい (light, daytime ward) and 夜間 (dark, night ward) — are a caregiver setting (`Settings.theme`: `'light' | 'dark' | 'auto'`, default `'auto'`), not a URL query. `'auto'` follows the device's `prefers-color-scheme` and re-resolves immediately when the OS setting changes (App.tsx subscribes to the `matchMedia` `change` event), so a ward that dims its lights at night can just leave it on auto. App.tsx resolves the setting to the actual `light`/`dark` value and sets `:root[data-theme]` accordingly — CSS only ever sees `data-theme="light"` or `"dark"`, never `"auto"`. Selectors are identical between the two themes — only token values differ.

### Light theme — 明るい (bright, calm; daytime ward)

| Token                        | Value     | Usage                                                                               |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `--bg`                       | `#eafaf1` | App background                                                                      |
| `--surface`                  | `#ffffff` | Neutral tile                                                                        |
| `--surface-calm`             | `#dcf5e6` | Slow / non-urgent actions                                                           |
| `--surface-positive`         | `#c9f0d9` | Yes / okay / thanks                                                                 |
| `--surface-scanning`         | `#fde68a` | Non-urgent tile currently under the scan cursor                                     |
| `--text`                     | `#0f241d` | Body text on light surfaces                                                         |
| `--text-muted`               | `#4b6358` | Tile detail text                                                                    |
| `--message-bg`               | `#0f5132` | Message panel (neutral tone)                                                        |
| `--message-text`             | `#f3fbf7` | Message panel text                                                                  |
| `--urgent-bg`                | `#b3261e` | Emergency tile / message panel (solid fill)                                         |
| `--urgent-text`              | `#ffffff` | Text on urgent fill                                                                 |
| `--scan-ring`                | `#facc15` | Scan-cursor ring (same value in both themes)                                        |
| `--scan-ring-width`          | `6px`     | Ring thickness (`9px` under high contrast)                                          |
| `--scan-ring-outline`        | `#0f241d` | Dark outline pairing the ring on non-urgent tiles (§2 "Scan cursor emphasis" below) |
| `--scan-ring-outline-urgent` | `#ffffff` | Light outline pairing the ring on the emergency tile                                |
| `--grid-line`                | `#cde3d4` | Cell divider line (pale green-gray)                                                 |
| `--grid-line-width`          | `1px`     | Divider line thickness (`3px` under high contrast)                                  |

### Dark theme — 夜間 (dark, night ward)

| Token                        | Value     | Usage                                                                                                |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `--bg`                       | `#07140f` | App background (near-black green)                                                                    |
| `--surface`                  | `#17362a` | Neutral tile                                                                                         |
| `--surface-calm`             | `#123a29` | Slow / non-urgent actions                                                                            |
| `--surface-positive`         | `#1a4a32` | Yes / okay / thanks                                                                                  |
| `--surface-scanning`         | `#6b5510` | Non-urgent tile currently under the scan cursor                                                      |
| `--text`                     | `#eafaf1` | Body text on dark surfaces                                                                           |
| `--text-muted`               | `#9fc4b0` | Tile detail text                                                                                     |
| `--message-bg`               | `#0a2318` | Message panel (neutral tone)                                                                         |
| `--message-text`             | `#eafaf1` | Message panel text                                                                                   |
| `--urgent-bg`                | `#d7263d` | Emergency tile / message panel (solid fill)                                                          |
| `--urgent-text`              | `#ffffff` | Text on urgent fill                                                                                  |
| `--scan-ring-width`          | `6px`     | Ring thickness (`9px` under high contrast)                                                           |
| `--scan-ring-outline`        | `#eafaf1` | Light outline pairing the ring (clears 3:1 against both this theme's fills, so urgent reuses it too) |
| `--scan-ring-outline-urgent` | `#eafaf1` | Same as `--scan-ring-outline` above                                                                  |
| `--grid-line`                | `#2d5a41` | Cell divider line (lighter green than the dark bg/tile fill, so it stays visible on both)            |

The emergency tile and the dedicated emergency-status area use a solid deep-red fill (`--urgent-bg`) with white text in both themes. The ordinary message panel uses its own transmission tone and never doubles as the unresolved emergency-state display.

### High contrast (caregiver setting, layers on top of either theme)

`:root[data-high-contrast="true"]` thickens `--grid-line-width` to `3px` and `--scan-ring-width` to `9px` (cells still carry no separate border), strengthens `--text-muted` and `--grid-line` so they clear 3:1 against their own theme's surfaces, and pushes text/background toward pure black/white:

| Theme + HC | `--text`  | `--bg`    | `--message-bg` | `--message-text` | `--surface` | `--surface-calm` | `--surface-positive` | `--text-muted` | `--grid-line` |
| ---------- | --------- | --------- | -------------- | ---------------- | ----------- | ---------------- | -------------------- | -------------- | ------------- |
| light      | `#000000` | `#eafaf1` | `#003820`      | `#ffffff`        | `#ffffff`   | `#d7f4e2`        | `#b8ecd0`            | `#33463e`      | `#6b9b83`     |
| dark       | `#ffffff` | `#000000` | `#000000`      | `#ffffff`        | `#000000`   | `#001a10`        | `#00301c`            | `#c9ecd9`      | `#4a8a68`     |

All of these are chosen so the WCAG non-text 3:1 threshold holds against the surface they sit on (computed with a relative-luminance script during the PR#16 review pass) — e.g. `--grid-line` under light+HC is `3.16:1` against `#ffffff`, under dark+HC `5.13:1` against `#000000`.

### Font size (caregiver setting)

Three CSS variables drive this, all set via `:root[data-font-size]` and stored in `localStorage` (`settings.fontSize`): `--font-scale` (`1`/`1.25`/`1.55`), `--label-ratio` (`0.85`/`0.93`/`1.0`), and the breakpoint-varying pair `--label-cqi`/`--label-cqb` (see below). All scale **only the tiles(選択肢)の文字**, never the message heading (`h1`) or the emergency details/sub lines.

**PR#16 4巡目 must-F (rewrite)**: the earlier design multiplied `--font-scale` into a `vh`-based term inside `--tile-label-font`'s `min()` (raising a ceiling the text could grow _toward_), on cells whose actual cap was `cqi`/`cqb` (the tile's own width/height). On any screen where a tile was already roomy enough that `cqi`/`cqb` capped the label below that `vh` ceiling at 標準, raising the font-size setting raised a ceiling the label was never going to hit anyway — a 720-state audit found this made the setting do _nothing visible_ in 27 of 60 sampled screen-size/screen combinations. The fix: `--label-ratio` multiplies directly into the `cqi`/`cqb` term itself. `--font-scale` still appears, but now only inside the `vh`-based term of the `clamp()`'s _upper bound_, as a safety net for unusually large cells, not the primary driver.

**PR#16 4巡目 should-a, reverted in 5巡目 must-G**: should-a's attempt to keep the JS-side label-size _prediction_ (`computeGridLayout`'s `LABEL_WIDTH_FACTOR`/`LABEL_HEIGHT_FACTOR`) in sync with the CSS-side label-size _result_ was to stop the CSS coefficients from varying by breakpoint at all (uniform 15cqi/20cqb everywhere) combined with `--label-ratio: 0.8`. That combination shrank standard-size labels 22–28% at phone widths versus the previous per-breakpoint coefficients (20/22 at ≤720px, 22/24 at ≤480px/≤500px height existed precisely because a phone-width tile is narrower, so a _bigger_ cqi coefficient is needed there to reach the same effective label size as a wider tile at the base coefficient) — an unacceptable regression caught in review. 5巡目's must-G restores the per-breakpoint coefficients, but keeps them in sync with JS the way should-a should have: as real CSS custom properties, read back into JS instead of hardcoded on either side:

```
--label-cqi: 15;   /* :root base; 20 at ≤720px; 22 at ≤480px/≤500px height */
--label-cqb: 20;   /* :root base; 22 at ≤720px; 24 at ≤480px/≤500px height */

--tile-label-font: clamp(
  1.05rem,
  calc(var(--label-ratio) * min(calc(var(--label-cqi) * 1cqi), calc(var(--label-cqb) * 1cqb))),
  min(calc(var(--font-scale) * 4.8vh), 3.4rem)
);
```

`App.tsx`'s `ResizeObserver` callback on `.grid-board` also calls `getComputedStyle(gridBoardEl)` to read `--label-cqi`/`--label-cqb` back out (dividing by 100 to get the same `0.15`/`0.20`-scale factor `computeGridLayout` expects) and passes them into `computeGridLayout` as `labelWidthFactor`/`labelHeightFactor` options — so the JS-side scoring and the CSS-side rendered size always use the _same_ coefficient at every breakpoint, without either side hardcoding a value the other must independently match. `gridLayout.ts` still exports `DEFAULT_LABEL_WIDTH_FACTOR`/`DEFAULT_LABEL_HEIGHT_FACTOR` (`0.15`/`0.20`) as fallbacks for callers (tests, or a render before the first `ResizeObserver` tick) that don't supply the live CSS-derived values.

The `1.05rem` floor is absolute (never multiplied), so on a cell small enough that even `--label-ratio: 1` computes below it, all three font-size settings render identically — this is the one case where the setting has no visible effect, and it's intentional (there's no room to grow into). `.tile-preview` follows the same `--label-ratio` (its own `0.85rem` floor is now `calc(var(--label-ratio) * 0.85rem)`, matching how it already referenced `--tile-label-font` for its main 50%-of-label term). (`cqi`/`cqb` are computed off `.tile`'s content-box — after its own padding — which is what `computeGridLayout`'s `cellWidth`/`cellHeight` approximate, not exactly, since `computeGridLayout` doesn't know about `.tile`'s padding; the two agree closely enough in practice that no correction term was added.)

**Issue #22 (heading fits on one line)**: `h1` shows the message on a single line at the largest size that fits, up to the existing clamp's upper bound. The clamp is now exposed as `--h1-max` (with `--h1-min`, the clamp's floor: `2.35rem`, or `1.5rem` at the narrow breakpoint). `frontend/src/lib/fitHeading.ts` holds the pure sizing (`fitHeadingSize`, unit-tested) and a thin DOM helper (`applyHeadingFit`) that measures the column width with `max-width` lifted, estimates a size from the text width at 100px (`canvas.measureText`), then re-measures at that candidate size (same font) and steps down 0.1px until it fits — Chromium rounds glyph advances to whole pixels at the real size, so the linear estimate alone overflows by a few px — giving up (wrap) below `--h1-min`; `App.tsx` re-runs it (rAF-coalesced, never per frame) on message change, panel width change, resize/orientationchange and Web font load (not on the font-size setting: `h1` ignores `--font-scale`). If it fits at `--h1-min` or larger, `data-fit="single"` + `--h1-fit` are set (`white-space: nowrap`, `max-width: none`); otherwise nothing is set and the old `max-width: 16ch` wrapping applies. No transition on the size, so it never steps visibly. The size still ignores `--font-scale` (see below). The caregiver button is labelled 「介助者用」 and is auto-width (the `.message-panel-controls` column already reserves ≥128px).

**PR#16 3巡目 must-1 (should-b を撤回)**: the previous round (PR#16's 2巡目 re-review) had `--font-scale` apply to `h1` too, reasoning that "the message should always be the largest text on screen" would otherwise break at 特大. That created a chain the 3巡目 re-review caught: growing `h1` grows the message panel, which shrinks the grid area available to the tile grid below it, which can flip which `(cols, rows)` candidate `computeGridLayout` picks, which can shrink the tile labels — so raising the font-size setting could make _both_ the heading grow **and** the tile labels shrink, and even at 標準 (`--font-scale: 1`) the heading came out 23–29% smaller than its old, layout-independent size, because the message panel's height was now entangled with tile-grid sizing through a chain that had nothing to do with the font-size setting at all. The message panel's height (and therefore how much area the grid below it gets) must **not** depend on the font-size setting. `h1` (and `.emergency-details`/`.emergency-sub`) are excluded from `--font-scale` again, back to their original, size-setting-independent formula (`clamp(2.35rem, min(7vh, 14cqi), 5.4rem)` — the `14cqi` term is a safety net against overflow on very narrow message columns, not a font-scale mechanism). At 特大, a tile's own label can now legitimately render _larger_ than the heading; that's accepted, since a person's ability to read and press the option they need takes priority over the heading staying nominally "the biggest text on screen" (`docs/user-guide.md` says this outright: 文字サイズ設定は選択肢(タイル)の文字に効く).

### Scan cursor emphasis

The current scan target gets a surface-color shift (`--surface-scanning`) on non-urgent tiles, plus a ring drawn with an absolutely-positioned `::after` inset a few pixels from the cell's own edges — so it stays fully inside that cell and never overlaps the seamless-grid divider line or the neighboring cell. Scale-up is intentionally not used here (Issue #3 再レビュー): in a gap-less grid, enlarging the scanning cell would overlap its neighbors. The emergency tile keeps its solid red fill even while scanning — only the ring is added on top.

**PR#16 Opus レビュー must-2**: a plain yellow ring (`--scan-ring`) alone only reaches `1.53:1` against a white tile, well under WCAG's `3:1` non-text contrast floor. The ring is now a double outline: the yellow `border` (`--scan-ring-width`, `6px`/`9px` under high contrast) plus a `box-shadow` line on both its outer and inner edge, in `--scan-ring-outline`. That outline color is theme-dependent because a single fixed color can't clear 3:1 against every fill the ring can sit on: light theme's non-urgent fill (`--surface-scanning: #fde68a`) needs a _dark_ outline (`#0f241d`, `13.07:1`), but light theme's urgent fill (`--urgent-bg: #b3261e`) needs a _light_ one instead (`--scan-ring-outline-urgent: #ffffff`, `6.54:1` — the dark outline only reaches `2.49:1` there). Dark theme's own fills are both already dark, so one light outline (`#eafaf1`) clears 3:1 against both (`9.90:1` non-urgent, `4.59:1` urgent) and `--scan-ring-outline-urgent` just reuses it.

The emergency tile also gets a permanent (not just while scanning) `2px` inset `::before` outline in `--urgent-text` (white), so it's distinguishable by shape, not only by its red fill (kako-jun's colorblind-accessibility answer during the PR#16 review). **PR#16 再レビュー nit**: at `85%` opacity and `2px` it was hard to tell apart from the scanning ring's own white outline component when the emergency tile happened to be the one currently scanning; it's now `1px` at `50%` opacity — thin/faint enough to read as a permanent "this is the emergency tile" cue without competing with the scan ring's stronger emphasis.

### Cell divider lines

Instead of a border on every side (which would double up between adjacent cells), each `.tile` draws a single `box-shadow: inset` line on its own right and bottom edge only (`--grid-line` color, `--grid-line-width` thickness). This means the outermost left/top edge of the whole grid has no line, while every internal seam and the outer right/bottom edge do — a uniform rule applied to every cell, not a special case per edge.

### Navigate tiles: chevron + content preview (Issue #3 追加指示)

A tile that navigates to a sub-screen no longer ends its label with an arrow character. Instead:

- A `›`-shaped inline SVG chevron sits at the tile's right edge, sized with `cqi` so it scales with the tile's own width, colored `currentColor`, `aria-hidden`.
- A small one-line content preview sits at the tile's bottom edge, truncated with `text-overflow: ellipsis` at the tile's width. It's generated automatically from the destination screen's menu — `menus.ts`'s `buildPreview()` takes that screen's first few items (excluding Emergency and Back) and joins their labels with `・`, ending in `…`. Nothing is hand-written per tile, so editing `menus.ts` keeps the preview in sync.
- Auditory scan / speech only ever reads `item.label` — the chevron and preview are display-only and never reach `announceScanItem`/`announce`.

## 3. Typography Rules

BIZ UDPGothic (400/700) is bundled via `@fontsource/biz-udpgothic` and imported from `index.tsx`, not loaded from a CDN — requirements.md §8 requires every communication feature to work offline, and a Google Fonts `<link>` breaks that. It is also a universal-design typeface (clear kana/kanji shapes, wide letter spacing), which matters because a generic `system-ui`/`sans-serif` stack falls back to a Chinese-glyph font (e.g. WenQuanYi) on many Linux systems and renders Japanese text with the wrong glyph shapes. `font-family` therefore puts `'BIZ UDPGothic'` first, followed only by other Japanese-capable fallbacks (`Hiragino Sans`, `Hiragino Kaku Gothic ProN`, `Yu Gothic UI`, `Yu Gothic`, `Noto Sans JP`) and finally generic `sans-serif` — never a bare `system-ui`/`-apple-system`/`Segoe UI` ahead of a Japanese-capable font. Text must fit inside tiles on mobile and tablet.

- Message: `clamp(2.35rem, min(calc(var(--font-scale) * 7vh), 14cqi), calc(var(--font-scale) * 5.4rem))` — `--font-scale` raises the `vh`-based ceiling and the upper bound (see "Font size" above), but the `14cqi` term (`.message-panel` is `container-type: inline-size`) caps it to the message panel's own width regardless of the font-size setting, so it stays within the `40dvh` cap
- Tile label: `--tile-label-font: clamp(1.05rem, min(calc(var(--font-scale) * 4.8vh), 15cqi, 20cqb), calc(var(--font-scale) * 3.4rem))` — the `cqi`/`cqb` terms (each `.tile` is `container-type: size`) cap the label to the tile's own width _and_ height, not just the viewport, so a narrow or short tile on a small screen never overflows; `--font-scale` only raises the `vh` ceiling and the upper bound, never the `cqi`/`cqb` cap
- Tile detail: smaller but bold
- Letter spacing: `0`
- Word breaking (Issue #3): `h1`, `.tile-label`, `.emergency-details`, `.emergency-sub` and `.audio-status-hint` use `word-break: auto-phrase; line-break: strict; overflow-wrap: anywhere;` so Japanese text wraps at phrase boundaries (e.g. "緊急です。" / "来てください", "警告音停止中：" / "画面をタップしてください") instead of mid-word (previously "ゆっく" / "り", "くださ" / "い"), with `overflow-wrap: anywhere` as a safety net on browsers that don't yet support `auto-phrase`.

## 4. Layout Principles

- The top stack has separate, seamless sections: unresolved emergency status (only while active), current-screen guidance (always), and the last completed transmission (only when one exists). The caregiver button and the "alarm audio not unlocked" hint live in the current-screen guidance section's top-right `.message-panel-controls`, rather than in the transmission or emergency-status section — see §8.
- Tile grid fills the remaining space edge-to-edge; `app-shell` has no padding at all (`0`) on any side, since there's no longer a fixed-position control band to leave clearance for.
- Screens with 8 items or fewer (requirements.md §4.1's "1画面8項目以内" target) **always** use a **fill grid** and never scroll, regardless of 文字サイズ (**PR#16 再レビュー must-A/B, 方針転換**; see below for why). `computeGridLayout()` (`frontend/src/lib/gridLayout.ts`, unit-tested for n=1..8 × landscape/portrait/square + real device-size approximations) measures the grid area's real size via `ResizeObserver` and picks `(cols, rows=ceil(n/cols))` by, in order: (0) reject any candidate whose cell would be smaller than a minimum cell size (`minCellWidth`/`minCellHeight`, defaulting to `160×84px`); (1) reject candidates needing 2+ empty cells (span 3+); (2) **PR#16 4巡目 must-E**: reject "bands" outright — `cols === 1` with `rows >= 5`, or `rows === 1` with `cols >= 5` — even if they'd otherwise pass the minimum-cell-size floor (that floor is an absolute px check, so on a big enough screen a 1-column, 7-row stack can individually clear it while still reading as a degenerate band); (3) among the survivors, maximize `min(labelWidthFactor × cellWidth, labelHeightFactor × cellHeight) − 0.5 × emptyCells` — `labelWidthFactor`/`labelHeightFactor` default to `0.15`/`0.20` (`DEFAULT_LABEL_WIDTH_FACTOR`/`DEFAULT_LABEL_HEIGHT_FACTOR`) but are normally supplied live by `App.tsx` from `--label-cqi`/`--label-cqb` (see "Font size" above), so this is always the _same_ coefficient `--tile-label-font` is using at the current breakpoint, not a hardcoded value that could silently diverge from it. The unpenalized score _is_ therefore the resulting label font-size in px, and the small per-empty-cell penalty only breaks near-ties, it doesn't override a genuinely bigger label.

  **PR#16 5巡目 should-B**: if no candidate clears the minimum-cell-size floor even after the band/empty-cell filters, `findCandidates` is retried once more with the height floor relaxed from the caller's `minCellHeight` down to `RELAXED_MIN_CELL_HEIGHT` (`50px`) — a last-resort fallback for extreme landscape-orientation, short-viewport screens (e.g. `568×320` with the message panel eating most of the height) where the default `84px` floor left zero fill candidates and the screen fell back to scroll even though it has 8 or fewer items. This only lowers the floor for the retry; the label-maximizing scoring itself is unchanged, so a taller candidate is still picked whenever one exists — `50px` is a floor of last resort, not a target. `--cols`/`--rows` then drive `grid-template-columns/rows: repeat(var(--cols/rows), 1fr)`, so the area divides exactly — no isolated tile, no leftover blank space. If the last row would be short by exactly one cell, that last tile gets `grid-column: span 2` (never more) to fill it instead of leaving an empty cell.

  This scoring has been rewritten twice. **PR#16 3巡目 must-2** first replaced an `|log(aspect)|` metric (reward a cell for being close to square) with the label-maximizing score above, because squarish-but-small cells were sometimes preferred over a cell that was actually bigger to read in — enlarging the message heading shrank the grid area, which flipped which candidate counted as "most square", which shrank the tile labels even though nothing about the tiles themselves should have changed. But that pass ranked **empty-cell count before the label score** (0-empty candidates always beat 1-empty ones, regardless of how much bigger the 1-empty candidate's label would be), and for an item count whose only 0-empty column count is 1 (e.g. `n=7`), that meant the label-maximizing score never got a chance to prefer a squarer candidate — a single full-width column always won outright. **PR#16 4巡目 must-E** caught this as "the 7-item screen is back to a 1×7/7×1 band" and fixed it two ways: the explicit band rejection above (a hard rule, not a scoring preference), and swapping empty-cell-count from a hard first sort key to the small penalty folded into the score itself, so a much-bigger label can now outweigh accepting one empty cell.

- Screens with more than 8 items (only the letter board, at Emergency + Back + 10 letters + backspace + commit = 14 items, as of this writing — `docs/features.md` documents this 10-letter set as a deliberate placeholder ahead of the full 46-character, two-stage 行→文字 board from requirements.md §4.6, which is Issue #4's job) use a scrollable grid instead: `repeat(auto-fit, minmax(220px, 1fr))` with a minimum tile height, same as before Issue #3. Unlike `--tile-label-font` (which does scale with 文字サイズ, capped by `cqi`/`cqb`), this column-width floor is fixed regardless of 文字サイズ (**PR#16 3巡目 must-2 再検証**: multiplying it by `--font-scale` let a bigger font-size setting change the column count here too, reproducing the same "grid shape flips, label shrinks" chain as the fill-mode bug it was fixed alongside — e.g. at `1280×720`, 標準→大 shrank the label from `27.5px` to `25.5px`). Because this is the only screen that scrolls, and scrolling could carry the always-first Emergency tile out of view as the scan cursor moves down through the letters, the Emergency tile (`.grid-board:not(.grid-fill) .tile:first-child`) is `position: sticky; top: 0` here, so it stays visible throughout the scroll, with a `z-index` above the currently-scanning tile (**PR#16 3巡目 should-a**: the sticky tile's own `z-index` used to be higher than `.tile.scanning`'s, so it could visually cover the top of a scanning tile scrolling underneath it) and a `scroll-margin-top` on every tile equal to the sticky tile's height, so `scrollIntoView` never parks a tile half-hidden behind the sticky one. (A proper two-tier redesign of the letter board that keeps Emergency in a separate, always-visible area is deferred to Issue #4; the sticky tile is the stopgap for the current single-grid letter board.) **PR#16 5巡目 nit**: a `scroll-margin-bottom: 8px` was added alongside `scroll-margin-top`, so `scrollIntoView` also leaves clearance at the _bottom_ of the viewport, not just below the sticky header. This was investigated at `844×390` with 特大 文字サイズ, where the scanning tile's bottom edge was found clipped ~7%: at that specific extreme combination, the sticky Emergency tile (~130px) plus the scanning tile's own height (~130px) exceeds the board's available height (~251.6px) by a handful of px, so no scroll position can show both fully — a genuine physical constraint, not a bug. `scroll-margin-bottom` doesn't change that one case (top-priority — keeping Emergency visible — wins there, as instructed), but it does bring other, less extreme viewport/font combinations to ~99.6–100% scanning-tile visibility that previously landed a couple of px short at the bottom.
- **PR#16 再レビュー must-A/B (方針転換)**: `computeGridLayout`'s minimum cell size used to be raised for 大/特大 文字サイズ (App.tsx passed larger `minCellWidth`/`minCellHeight` in), on the theory that if a font-scaled label wouldn't fit in a small cell, the grid should pick fewer/bigger columns, and if even that didn't fit, fall back to the scrollable layout above. In practice this pushed most 8-item-or-fewer screens into scroll mode at 大/特大 on phone-sized viewports (47 of the 720 audited states), and scrolling could carry the Emergency tile off-screen while the cursor scanned lower items — unacceptable, since Emergency must always be one press away. The fix inverts the direction: the minimum cell size stays fixed at its default (`160×84px`) regardless of 文字サイズ, so an 8-item-or-fewer screen always finds a fill candidate and never scrolls; instead, `--tile-label-font` (see "Typography Rules" above) shrinks the _text_ to whatever the resulting cell actually allows, via its `cqi`/`cqb` terms in `min()`. The font-size setting still raises how large the text is _allowed_ to grow (the `vh`-term ceiling), it just no longer gets to grow the cells themselves.
- `computeGridLayout`'s default minimum cell size is `160×84px` (width originally raised from `120` to `160` during the PR#16 review pass — at `120×88`, `|log(aspect)|` scoring alone could still pick a technically-in-range-aspect layout like "6 columns × 1 row, 141px wide" over a squarer alternative, because a very short, very wide cell can still land inside `[0.4, 2.5]`; the minimum width floor is what actually rules those out. Height was `96` for the same pass, then lowered to `84` in PR#16's re-review: at `320×568` with 特大 文字サイズ, an 8-item screen's grid area measures only `348px` tall — `96` never lets `2×4` (`384px` needed) clear the floor there, so that one screen size/font-size combination fell back to scroll even though every other screen size found a fill candidate fine; `84` (`348 ÷ 4 = 87px` per cell) fixes that specific case without changing what any roomier screen picks, since this is a floor, not a target). A 720-state real-geometry sweep (`scratchpad/rv16.mjs` and its later variants, viewport × theme × 文字サイズ × 高コントラスト) is the standard way this whole area gets re-verified after a change.
- No nested cards; no gap between cells (see §2's seamless-grid rule).
- Buttons use stable min-heights so labels do not resize the layout.
- Touch targets should remain large enough for tablet bedside use.
- **PR#16 Opus レビュー must-3** (label overflow at large font sizes), revised by **PR#16 再レビュー must-A/B and should-c**: (1) `--tile-label-font`'s `min(calc(var(--font-scale) * 4.8vh), 15cqi, 20cqb)` is the primary defense now — the `cqi`/`cqb` terms are never multiplied by `--font-scale`, so no matter how large 文字サイズ is set, the label's font is capped at what the tile's own `container-type: size` box can actually hold. (`computeGridLayout`'s minimum cell size deliberately does _not_ grow with 文字サイズ any more — see "Grid layout" above — so this per-tile cap is what keeps large-font labels legible instead of the grid picking fewer columns.) (2) A `navigate` tile reserves space for its chevron/preview on the **label itself** (`.tile-nav .tile-label { max-width; margin-right; margin-bottom }`, scaled by `--font-scale`), not on the tile/container. This took three earlier wrong attempts: padding directly on `.tile-label` only grows the label's own centered box symmetrically, so half the reserved space lands on the wrong side and the box still reaches the chevron/preview at larger font sizes; `position: absolute` + `inset` on the label fixed that but stretched the label's box to fill the whole confined area, so even a 2-character label reported as "4 lines" by height alone; padding on `.tile-nav` (the container) itself fixed both of those, but — caught in PR#16's re-review (should-c) — since `.tile` is `container-type: size`, padding on the container shrinks _its own_ content-box, which is the very basis `cqi`/`cqb` are computed from, so a `navigate` tile's `--tile-label-font` ended up capped smaller than a sibling non-`navigate` tile's in the same screen even at the same cell size. Reserving the space on the label's own box (`max-width`/`margin`) instead leaves the container's cq-basis untouched — `place-items: center` on `.tile` then centers the label within `.tile`'s full box, and the label's own asymmetric margins are what nudge it away from the chevron/preview corners. (3) `.tile { overflow: hidden }` is the final safety net if the first two are somehow insufficient. The message panel has an equivalent cap: `max-height: 40dvh` with `align-content: start` (kako-jun's answer to the "特大でメッセージ欄が63%" question) — `start`, not `center`, matters here too: capping height while still centering overflowing content pushes half of the overflow _above_ the panel (negative `top`, off-screen), which the review's re-run also caught.

## 5. Interaction

Source of truth: `docs/requirements.md`.

- The patient has exactly one input: a single "on" (tap anywhere / any key / Bluetooth shutter) timed to an automatic scan cursor.
- Scanning runs from startup and never requires the patient to start or stop it.
- As implemented at Issue #44, Home and ordinary child screens start with Emergency; ordinary child screens put Back second. The emergency-detail screen is the exception: it starts with Back and omits a duplicate Emergency tile because the emergency state is already active. Issue #40 has an approved but not-yet-implemented change to reverse ordinary child screens to Back then Emergency.
- Caregiver menu opens with a 2-second long press on the button in the current-screen guidance area's top-right corner; it is not in the scan cycle.
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
- Do not mix screen guidance, unresolved emergency state, selected emergency details, and the last completed transmission into one undifferentiated message. Each has its dedicated upper region (Issue #44); technical voice-mode/scan-position counters remain excluded from the patient UI.

## 7. Icon

Decided at planning time (2026-05-07, corrected 2026-09-24): an abstract balance-scale (libra = the zodiac Libra) motif, single-color green (`#064e3b`) on the app background (`#f3fbf7`). `frontend/public/icon.svg` is the source; PWA icons and the favicon are generated from it.

The motif is exactly these shapes, all in `#064e3b`:

1. Two equal-sized, upward-pointing (roughly equilateral) triangles side by side, bases at the same height. **Outline only — never filled.** The stroke is thick enough to survive a 16–32px favicon (≈28–36px at the 512×512 canvas scale) with rounded joins/caps.
2. A filled circle sitting on each triangle's apex (one per triangle — two circles total).
3. A single horizontal bar that only connects the two circles — it runs from the right edge of the left circle to the left edge of the right circle, ending flush with (or barely overlapping) each circle. It never pierces through either circle, and it stays perfectly level (never tilted).

No pans, no hanging strings, no other motif (e.g. a speech bubble, grid, or a single triangle+circle+bar) — do not swap this for a different icon concept without an explicit decision, since this was chosen deliberately over the app's own tile-grid visual language. All shapes stay within the maskable safe zone (the centered 80% circle of the 512×512 canvas) so launchers that crop to a circle/squircle never cut into the scale.

## 8. Caregiver UI

The caregiver panel (long-press menu) reuses the same palette as the patient screen via tokens, as flat status/action colors rather than tile tones. Values below are the light theme; the dark theme substitutes its own `--caregiver-*` tokens (see `globals.css`) but the roles are identical:

| Element                                                 | Background (token)               | Border (token)                   | Text (token)                       | Meaning                                                                                                           |
| ------------------------------------------------------- | -------------------------------- | -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.caregiver-status` (normal)                            | `--caregiver-status-ok-bg`       | `--caregiver-status-ok-border`   | `--text`                           | Wake Lock / offline-ready: OK                                                                                     |
| `.caregiver-status.warn`                                | `--caregiver-status-warn-bg`     | `--caregiver-status-warn-border` | `--caregiver-status-warn-text`     | Wake Lock / offline-ready: needs attention                                                                        |
| `.caregiver-action`                                     | `--caregiver-action-bg`          | —                                | `--caregiver-action-text`          | Primary action button (fullscreen, close…)                                                                        |
| `.caregiver-action:disabled`                            | `--caregiver-action-disabled-bg` | —                                | `--caregiver-action-disabled-text` | Action currently unavailable (e.g. 緊急解除)                                                                      |
| `.caregiver-close`                                      | `--caregiver-close-bg`           | —                                | `--caregiver-action-text`          | Closing action, deliberately darker                                                                               |
| `.caregiver-voice-options` / `-choice-options` `button` | `--caregiver-status-ok-bg`       | `--caregiver-action-bg`          | `--text`                           | Voice mode / font size / theme option, unselected                                                                 |
| `...button.active`                                      | `--caregiver-action-bg`          | `--caregiver-action-bg`          | `--caregiver-action-text`          | Voice mode / font size / theme option, selected                                                                   |
| `.audio-status-hint`                                    | `--caregiver-status-warn-bg`     | `--caregiver-status-warn-border` | `--caregiver-status-warn-text`     | Alarm audio not yet unlocked                                                                                      |
| `.caregiver-button`                                     | `--caregiver-button-bg`          | —                                | `--caregiver-button-text`          | Long-press menu entry point inside `.message-panel-controls` at the top-right of the current-screen guidance area |

Every token above is a real custom property — no color is hardcoded in `globals.css` component rules (PR#16 Opus レビュー should-5). Since Issue #44, `.caregiver-button` sits in the current-screen guidance area rather than the transmission panel; its existing theme tokens remain the source of its foreground/background colors.

The warn/OK token pairing is shared by Wake Lock status, offline-ready status, and the alarm-audio hint, so caregivers learn one visual pattern for "this needs your attention" across all of them, in either theme. The 文字サイズ (font size) and 表示 (theme: light/dark/auto) pickers both reuse the same `.caregiver-choice-options` look as the voice-mode picker (`--caregiver-status-ok-bg`/`--caregiver-action-bg` unselected/selected pair); 高コントラスト is a plain checkbox like 聴覚スキャン.

**PR#16 4巡目 nit-b, relocated by Issue #44**: `.audio-status-hint` only renders while the `AudioContext` hasn't yet resumed. Its `.message-panel-controls` column keeps a `min-width` matching the hint's width (`200px` base, `128px` at the narrow breakpoint), so appearing/disappearing does not change the current-screen guidance width or the grid geometry. Issue #44 moved that complete controls column from the transmission panel to the guidance area.

**PR#16 5巡目 should-A, retained after the Issue #44 relocation**: the hint remains absolutely positioned below the caregiver button and does not contribute to row height. The controls column reserves its full width, so the hint cannot cross into the guidance text. Overlap checks must continue to use actual painted visibility (`document.elementFromPoint`) rather than rectangle intersection alone.
