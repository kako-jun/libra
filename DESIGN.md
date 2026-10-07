# DESIGN.md

libra — Design System

## 1. Visual Theme & Atmosphere

Bedside communication UI. The upper area separates the unresolved emergency state, the current screen guidance, and the last completed transmission; a grid of big, easy-to-press tiles remains the main operation area.

The design should feel related to Esuna: simple, direct, high-contrast, and built around large touch targets. It is not bound to Esuna's fixed 9-grid operation model. Libra may use more or fewer tiles depending on the task.

Theme: green-based, calm, medical-adjacent, and readable. Red is reserved for the top message region only (Issue #36); no tile is red.

## 2. Color Palette & Roles (Issue #3)

Border-first tiles were retired, then (再レビュー) gap/radius/shadow were retired too: the grid is now a seamless, edge-to-edge board. Cells carry no gap between them, no rounded corners, no drop shadow — only a background fill color and a thin divider line on each cell's right and bottom edge (`box-shadow: inset`, so it never doubles up with the neighbor's own line). The message panel and the letter-board input strip use the same seamless treatment (`border-bottom` in the divider color) so the whole screen reads as one continuous plate. Every color is a CSS custom property on `:root` in `frontend/src/styles/globals.css` (the source of truth); component CSS never hardcodes a color.

Two themes — 明るい (light, daytime ward) and 夜間 (dark, night ward) — are a caregiver setting (`Settings.theme`: `'light' | 'dark' | 'auto'`, default `'auto'`), not a URL query. `'auto'` follows the device's `prefers-color-scheme` and re-resolves immediately when the OS setting changes (App.tsx subscribes to the `matchMedia` `change` event), so a ward that dims its lights at night can just leave it on auto. App.tsx resolves the setting to the actual `light`/`dark` value and sets `:root[data-theme]` accordingly — CSS only ever sees `data-theme="light"` or `"dark"`, never `"auto"`. Selectors are identical between the two themes — only token values differ.

### Light theme — 明るい (bright, calm; daytime ward)

| Token                               | Value                 | Usage                                                                                           |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `--bg`                              | `#eafaf1`             | App background                                                                                  |
| `--surface`                         | `#ffffff`             | Neutral tile                                                                                    |
| `--surface-calm`                    | `#dcf5e6`             | Slow / non-urgent actions                                                                       |
| `--surface-positive`                | `#c9f0d9`             | Yes / okay / thanks                                                                             |
| `--surface-scanning`                | `#0f241d`             | Tile under the scan cursor (inverted to a dark fill so the single yellow ring clears 3:1)       |
| `--text`                            | `#0f241d`             | Body text on light surfaces                                                                     |
| `--text-muted`                      | `#4b6358`             | Tile detail text                                                                                |
| `--message-bg`                      | `#0f5132`             | Message panel (neutral tone)                                                                    |
| `--message-text`                    | `#f3fbf7`             | Message panel text                                                                              |
| `--urgent-bg`                       | `#b3261e`             | Red. Message panel in urgent tone and the emergency-status band ONLY; never a tile              |
| `--urgent-text`                     | `#ffffff`             | Text on the red message panel / band                                                            |
| `--scan-ring`                       | `#facc15`             | Scan-cursor ring (same value in both themes)                                                    |
| `--scan-ring-width`                 | `6px`                 | Ring thickness (`9px` under high contrast; `7px` on short or narrow-and-low viewports, see §11) |
| `--scan-text` / `--scan-text-muted` | `#f3fbf7` / `#c9ecd9` | Label / detail+preview text on the scanning (dark) fill                                         |
| `--grid-line`                       | `#cde3d4`             | Cell divider line (pale green-gray)                                                             |
| `--grid-line-width`                 | `1px`                 | Divider line thickness (`3px` under high contrast)                                              |

### Dark theme — 夜間 (dark, night ward)

| Token                               | Value                 | Usage                                                                                     |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `--bg`                              | `#07140f`             | App background (near-black green)                                                         |
| `--surface`                         | `#17362a`             | Neutral tile                                                                              |
| `--surface-calm`                    | `#123a29`             | Slow / non-urgent actions                                                                 |
| `--surface-positive`                | `#1a4a32`             | Yes / okay / thanks                                                                       |
| `--surface-scanning`                | `#6b5510`             | Tile under the scan cursor (dark amber fill)                                              |
| `--text`                            | `#eafaf1`             | Body text on dark surfaces                                                                |
| `--text-muted`                      | `#9fc4b0`             | Tile detail text                                                                          |
| `--message-bg`                      | `#0a2318`             | Message panel (neutral tone)                                                              |
| `--message-text`                    | `#eafaf1`             | Message panel text                                                                        |
| `--urgent-bg`                       | `#d7263d`             | Red. Message panel in urgent tone and the emergency-status band ONLY; never a tile        |
| `--urgent-text`                     | `#ffffff`             | Text on the red message panel / band                                                      |
| `--scan-ring-width`                 | `6px`                 | Ring thickness (`9px` under high contrast)                                                |
| `--scan-text` / `--scan-text-muted` | `#eafaf1` / `#c9ecd9` | Text on the scanning fill                                                                 |
| `--grid-line`                       | `#2d5a41`             | Cell divider line (lighter green than the dark bg/tile fill, so it stays visible on both) |

**Red role (Issue #36, kako-jun: "red only for the title bar; do not redden frames")**: `--urgent-bg` is used only by the top message region: the `.emergency-status` band while an emergency is latched, and `.message-panel` when a message with the urgent tone is shown (e.g. pain "とても"). No tile (not the Emergency entry tile, not urgent-detail items, not "とても") is filled or framed red, so ordinary choices are never swamped in red. This is about the patient screen: the caregiver menu keeps its own warning tokens (e.g. `--caregiver-status-warn-text`), which are out of scope. Urgency is never carried by color alone, and the Emergency entry tile is deliberately **not** decorated (no inverted fill, no frame): it is identified by its label "緊急", its fixed position (first on home, second on sub-screens), and the text of the top emergency band ("緊急です。来てください。"). The ordinary message panel uses its own transmission tone and never doubles as the unresolved emergency-state display.

### High contrast (caregiver setting, layers on top of either theme)

`:root[data-high-contrast="true"]` thickens `--grid-line-width` to `3px` and `--scan-ring-width` to `9px` (`7px` when `max-height: 500px`, or `max-width: 480px` together with `max-height: 700px`, see §11; cells still carry no separate border), strengthens `--text-muted` and `--grid-line` so they clear 3:1 against their own theme's surfaces, and pushes text/background toward pure black/white:

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

--ring-extra: calc(var(--scan-ring-inset) - 12px);   /* 0 at the standard 12px band */

--tile-label-font: clamp(
  min(1.05rem, max(13px, calc((100cqb + 2 * var(--ring-extra)) / 2.4))),
  calc(
    var(--label-ratio) *
      min(
        calc(var(--label-cqi) * 1cqi + var(--label-cqi) * 0.02 * var(--ring-extra)),
        calc(var(--label-cqb) * 1cqb + var(--label-cqb) * 0.02 * var(--ring-extra))
      )
  ),
  min(calc(var(--font-scale) * 4.8vh), 3.4rem)
);
```

The cqi/cqb coefficients (`--label-cqi`/`--label-cqb`) now live only in CSS: since Issue #47 the grid shape no longer depends on label scoring, so `App.tsx` no longer reads them and `gridLayout.ts` has no label-factor options.

The floor (`1.05rem`, lowered only per the Issue #34 exception below) is never multiplied. (Issue #34 exception: when a cell's content height cannot hold two lines the floor is lowered to `max(13px, content height / 2.4)`, never below 13px; see §11.) So on a cell small enough that even `--label-ratio: 1` computes below it, all three font-size settings render identically — this is the one case where the setting has no visible effect, and it's intentional (there's no room to grow into). `.tile-preview` follows the same `--label-ratio` (its own `0.85rem` floor is now `calc(var(--label-ratio) * 0.85rem)`, matching how it already referenced `--tile-label-font` for its main 50%-of-label term). (`cqi`/`cqb` are computed off `.tile`'s content-box, i.e. after its padding (`--scan-ring-inset`). The coefficients are compensated by `--ring-extra` so a thicker ring band under high contrast does not shrink the label; see "Fixed grid" below.)

**Issue #22 (heading fits on one line)**: `h1` shows the message on a single line at the largest size that fits, up to the existing clamp's upper bound. The clamp is now exposed as `--h1-max` (with `--h1-min`, the clamp's floor: `2.35rem`, or `1.5rem` at the narrow breakpoint). `frontend/src/lib/fitHeading.ts` holds the pure sizing (`fitHeadingSize`, unit-tested) and a thin DOM helper (`applyHeadingFit`) that measures the column width with `max-width` lifted, estimates a size from the text width at 100px (`canvas.measureText`), then re-measures at that candidate size (same font) and steps down 0.1px until it fits — Chromium rounds glyph advances to whole pixels at the real size, so the linear estimate alone overflows by a few px — giving up (wrap) below `--h1-min`; `App.tsx` re-runs it (rAF-coalesced, never per frame) on message change, panel width change, resize/orientationchange and Web font load (not on the font-size setting: `h1` ignores `--font-scale`). If it fits at `--h1-min` or larger, `data-fit="single"` + `--h1-fit` are set (`white-space: nowrap`, `max-width: none`); otherwise nothing is set and the old `max-width: 16ch` wrapping applies. No transition on the size, so it never steps visibly. The size still ignores `--font-scale` (see below). The caregiver button is labelled 「介助者用」, is auto-width (the `.message-panel-controls` column already reserves ≥128px), and opens with a regular click/tap or Enter/Space when focused; it remains outside the person's scan input path.

**PR#16 3巡目 must-1 (should-b を撤回)**: the previous round (PR#16's 2巡目 re-review) had `--font-scale` apply to `h1` too, reasoning that "the message should always be the largest text on screen" would otherwise break at 特大. That created a chain the 3巡目 re-review caught: growing `h1` grows the message panel, which shrinks the grid area available to the tile grid below it, which can flip which `(cols, rows)` candidate `computeGridLayout` picks, which can shrink the tile labels — so raising the font-size setting could make _both_ the heading grow **and** the tile labels shrink, and even at 標準 (`--font-scale: 1`) the heading came out 23–29% smaller than its old, layout-independent size, because the message panel's height was now entangled with tile-grid sizing through a chain that had nothing to do with the font-size setting at all. The message panel's height (and therefore how much area the grid below it gets) must **not** depend on the font-size setting. `h1` (and `.emergency-details`/`.emergency-sub`) are excluded from `--font-scale` again, back to their original, size-setting-independent formula (`clamp(2.35rem, min(7vh, 14cqi), 5.4rem)` — the `14cqi` term is a safety net against overflow on very narrow message columns, not a font-scale mechanism). At 特大, a tile's own label can now legitimately render _larger_ than the heading; that's accepted, since a person's ability to read and press the option they need takes priority over the heading staying nominally "the biggest text on screen" (`docs/user-guide.md` says this outright: 文字サイズ設定は選択肢(タイル)の文字に効く).

### Scan cursor emphasis

The current scan target inverts to a dark fill (`--surface-scanning`, with `--scan-text*` for its text) plus one yellow ring (`--scan-ring`) drawn with an absolutely-positioned `::after` inset a few pixels from the cell's own edges — so it stays fully inside that cell and never overlaps the seamless-grid divider line or the neighboring cell. Scale-up is intentionally not used here (Issue #3 再レビュー): in a gap-less grid, enlarging the scanning cell would overlap its neighbors. The Emergency tile is an ordinary tile, so it scans exactly like the others.

**Issue #34 (ring never hides text)**: the ring occupies a band of `--scan-ring-inset` (`4px` offset + `--scan-ring-width` + `2px` inner margin = `12px`; `15px` under high contrast, `13px` for the 7px ring on short viewports) along the cell's edges. Tile padding, the chevron (`right`) and the content preview (`left/right/bottom`) all use that same token, so the label, preview and chevron sit inside the band whether or not the tile is scanning — the ring appearing never covers text and nothing moves or resizes when the cursor arrives (the ring is absolutely positioned and takes no layout space). Previously the padding was 18/12/12px (or 8/6/5px on short viewports) and the preview sat 6px from the bottom, i.e. inside the ring.

**Issue #33 (one yellow ring, no white edge)**: earlier versions wrapped the ring in `box-shadow` outlines on both edges (`--scan-ring-outline`, white on dark/urgent fills) and drew an extra 1px `::before` frame inside the red Emergency tile, which read as a white edge and a double frame. Both are gone: `.tile.scanning::after` is now only the yellow border, and `.tile-urgent::before` no longer exists (`tile-urgent` survives only as a semantic class in the DOM with no CSS rule). Yellow alone is 1.53:1 against white, so instead of outlining it the scanning tile inverts to a dark fill, against which the ring clears 3:1 by a wide margin. The ring band (`--scan-ring-inset`) keeps its width, so text placement (#34) is unchanged. The scanning fill is never the same as any other tile's fill (static check in `VisualCleanup.test.tsx`, live check `scan-ring-surface` in `e2e/offline.e2e.mjs`).

**Decision for kako-jun (open)**: inverting the scanning tile's fill goes beyond the literal "one yellow ring" wording of #33; it is an extra cue added only to keep the ring at 3:1 (WCAG 1.4.11). Alternatives: **A (current)** the scanning tile inverts to a dark fill and carries one yellow ring; **B** keep the tile fill and draw the yellow ring alone (simplest, but 1.53:1 against white on the light themes, which fails WCAG 1.4.11); **C** keep the ring plus a thin dark outline (3:1 met, but it brings back a double frame, the thing #33 asked to remove). A live A/B comparison in a real browser has not been done yet and needs kako-jun's eyes before this is signed off.

Measured contrast (real Chromium 1243, `scan-ring-surface` in `e2e/offline.e2e.mjs`: 4 themes x 4 viewports 390x844 / 568x320 / 844x390 / 320x568 x 6 states [home, discomfort, pain, pain intensity, emergency-active home, emergency detail]; every tile forced to the scanning state in turn; 640 tile measurements; the settings are asserted via `data-theme` / `data-high-contrast`; no `box-shadow` on the ring, no `::before` content, no red tile, and the scanning fill differs from every other tile fill, on any of them):

| Theme                             | Ring vs own fill                 | Label vs scanning fill | Detail / preview vs scanning fill | Scanning fill vs ordinary tile fills |
| --------------------------------- | -------------------------------- | ---------------------- | --------------------------------- | ------------------------------------ |
| Light (and light + high contrast) | 10.63:1 (`#facc15` on `#0f241d`) | 15.46:1                | 12.77:1                           | 12.36:1 or more                      |
| Dark                              | 4.68:1 (on `#6b5510`)            | 6.63:1                 | 5.62:1                            | 1.42:1 or more                       |
| Dark + high contrast              | 4.68:1                           | 6.63:1                 | 5.62:1                            | 2.04:1 or more                       |

On the dark theme the scanning fill is close in luminance to the ordinary tile fills (1.42:1 at the lowest, against `--surface-positive`; 2.04:1 on the high-contrast black), but it differs in hue (amber vs green) and the yellow ring (4.68:1 on the scanning fill) carries the cursor; the ring lies inside the tile on its own fill, not against the neighbours. Detail and preview text use `--scan-text-muted`, a step dimmer than the label (`--scan-text`) while staying above 4.5:1.

### Cell divider lines

Instead of a border on every side (which would double up between adjacent cells), each `.tile` draws a single `box-shadow: inset` line on its own right and bottom edge only (`--grid-line` color, `--grid-line-width` thickness). This means the outermost left/top edge of the whole grid has no line, while every internal seam and the outer right/bottom edge do — a uniform rule applied to every cell, not a special case per edge.

### Navigate tiles: chevron + content preview (Issue #3 追加指示)

A tile that navigates to a sub-screen no longer ends its label with an arrow character. Instead:

- A `›`-shaped inline SVG chevron sits at the tile's right edge, sized with `cqi` so it scales with the tile's own width, colored `currentColor`, `aria-hidden`.
- A small one-line content preview sits at the tile's bottom edge, truncated with `text-overflow: ellipsis` at the tile's width. It's generated automatically from the destination screen's menu — `menus.ts`'s `buildPreview()` takes that screen's first few items (excluding Emergency and Back) and joins their labels with `・`, ending in `…`. Nothing is hand-written per tile, so editing `menus.ts` keeps the preview in sync.
- Auditory scan / speech only ever reads `item.label` — the chevron and preview are display-only and never reach `announceScanItem`/`announce`.

## 3. Typography Rules

BIZ UDPGothic (400/700) is bundled via `@fontsource/biz-udpgothic` and imported from `index.tsx`, not loaded from a CDN — requirements.md §8 requires every communication feature to work offline, and a Google Fonts `<link>` breaks that. It is also a universal-design typeface (clear kana/kanji shapes, wide letter spacing), which matters because a generic `system-ui`/`sans-serif` stack falls back to a Chinese-glyph font (e.g. WenQuanYi) on many Linux systems and renders Japanese text with the wrong glyph shapes. `font-family` therefore puts `'BIZ UDPGothic'` first, followed only by other Japanese-capable fallbacks (`Hiragino Sans`, `Hiragino Kaku Gothic ProN`, `Yu Gothic UI`, `Yu Gothic`, `Noto Sans JP`) and finally generic `sans-serif` — never a bare `system-ui`/`-apple-system`/`Segoe UI` ahead of a Japanese-capable font. Text must fit inside tiles on mobile and tablet.

- Message (`h1`): `--h1-max: clamp(2.35rem, min(7vh, 14cqi), 5.4rem)` (at the narrow breakpoint `clamp(1.5rem, min(5.5vh, 16cqi), 2.4rem)`) with floor `--h1-min`; it ignores `--font-scale` (see "Font size" and Issue #22 above). The `14cqi` term (`.message-panel` is `container-type: inline-size`) caps it to the message panel's own width, so it stays within the `24dvh` cap
- Tile label: `--tile-label-font` as defined in §2 "Font size" (`--label-ratio` x the tile's own `cqi`/`cqb` cap, floor `min(1.05rem, max(13px, ...))`, ceiling from `--font-scale`). Each `.tile` is `container-type: size`, so a narrow or short tile on a small screen never overflows; `--font-scale` only multiplies the `4.8vh` term of the upper bound (the `3.4rem` cap is not scaled), never the `cqi`/`cqb` cap
- Tile detail: smaller but bold
- Letter spacing: `0`
- Punctuation (Issue #46, canonical rule: requirements.md §4.1.3): **body text** — anything read as a sentence (message-area transmissions and status sentences, the emergency main line, screen guidance, the always-on notes, caregiver notes and warnings, the Morse legend, default phrase texts) — ends with a full-width `。` and uses `、` inside; **short labels** — buttons, tiles, tabs, menu items, headings, setting names, breadcrumbs — carry no punctuation (tile "はい" → message "はい。"). Questions end in `？` with no `。`; use `…` (one character), never `...`. The emergency-detail read-aloud (`announce(EMERGENCY_MESSAGE + label)`) is speech-only and keeps its current wording. Lines that end in a code or symbol (the Morse legend) wrap the symbol in parentheses and put `。` after the closing bracket, never right after the symbol ("短く押す＝短点（・）、…＝長点（－）。"). A trailing period adds one full-width character, so no band height or tile measurement in §9–§11 changes; verified at 568x320, 320x568 and 390x844 (the only difference is the Morse legend wrapping one more line at 568x320, inside its fixed panel).
- Word breaking (Issue #3): `h1`, `.tile-label`, `.emergency-details`, and `.emergency-sub` use `word-break: auto-phrase; line-break: strict; overflow-wrap: anywhere;` so Japanese text wraps at phrase boundaries (e.g. "緊急です。" / "来てください。") instead of mid-word (previously "ゆっく" / "り", "くださ" / "い"), with `overflow-wrap: anywhere` as a safety net on browsers that don't yet support `auto-phrase`.

## 4. Layout Principles

- The top stack has separate sections: unresolved emergency status (only while active), current-screen guidance with a home-to-screen breadcrumb, a compact accepted-selection confirmation (only for non-transmission choices), and the last completed transmission (only when one exists). The breadcrumb is derived from `PARENT_SCREEN`; pain intensity and letter-row paths include the selected dynamic value. The confirmation never duplicates a completed transmission or emergency details and adds no scan step or wait. Both additions stay compact so the tile grid remains the main operation area. The caregiver button lives in the current-screen guidance section's top-right `.message-panel-controls`, rather than in the transmission or emergency-status section — see §8.
- Always-visible guidance (Issue #58): one fixed band at the **bottom edge of every patient screen** (`.screen-notes`, the last row of `.app-shell`; not rendered when there is nothing to say) and one fixed band at the **top of the caregiver menu** (`.caregiver-notes`, between the header and the tab list; it does not move when tabs change). Never move it per screen and never offer a way to hide it. It lists only the automatic behaviours that apply in the current state/settings (undo shown for one lap, undo hidden during an emergency, periodic emergency vibration and its device/restart caveats, debounce, minimum press time / release-to-activate, auditory-scan reading not being interrupted, head hold; in the caregiver menu: the 60 s tap timeout, outside tap / key closing, scan and Morse time stopping); wording and conditions live in `frontend/src/lib/guidance.ts`. See §10.
- Tile grid fills the remaining space edge-to-edge; `app-shell` has no padding at all (`0`) on any side, since there's no longer a fixed-position control band to leave clearance for.
- **Fixed grid (Issue #47)**: every normal scan screen (8 items or fewer, requirements.md §4.1) uses **one grid chosen by the viewport orientation only**, shared by all screens, so every choice has the same size and a short menu leaves **empty cells** instead of stretching its last tile. `computeGridLayout(itemCount, viewportWidth, viewportHeight)` (`frontend/src/lib/gridLayout.ts`) returns `2 columns x 4 rows` when `height >= width` (portrait, squares included — the same boundary as CSS `@media (orientation: portrait)`) and `4 columns x 2 rows` when `width > height` (landscape); both have 8 cells, so the largest normal screen (8 items: home with undo, 不快, 痛い, 快・要望) fills it exactly. Emergency, Back and ordinary choices are all the same size; there is no per-screen exception. Screens never scroll at 8 items or fewer, regardless of 文字サイズ.
  - Why 8 cells, and why two shapes: the items-per-screen ceiling is 8 (requirements.md §4.1 "1画面8項目以内"; the only screen with 8 that also gains a tile is home + undo, 7 + Morse/undo). Fewer cells would split a screen into pages; more would shrink every tile for no screen's benefit. A single shape for both orientations is impossible (2x4 on 844x390 would be `422x~75` strips and 4x2 on 390x844 would be `~97x360` towers), so the shape follows the orientation, and nothing else.
  - Why the viewport, not the measured grid area: the grid area's aspect ratio changes with the emergency band, the last-transmission panel, the selection-confirmation row and the guidance band, so using it would switch the shape between screens (and between "before/after tapping はい"). The viewport only changes on rotation/resize. `App.tsx` listens to `resize` (and the grid's `ResizeObserver` tick) to refresh it.
  - Empty cells: `.tile-empty`, `aria-hidden`, `pointer-events: none`, plain `--bg` background with no divider line, no ring, no number. They are not in `currentMenu()`, so they are outside scan order, direct tap, key actions and spoken scanning. Tapping one is the same as tapping the background (nothing happens).
  - The old per-item-count search (label-size scoring, minimum cell sizes, band rejection, relaxed height/width fallbacks, `lastSpan`) was removed in Issue #47. It also had no answer for `568x320` with an emergency band and a message, where some counts scrolled inside the grid; a fixed `4x2` always fits (see the measurements in §11).

- Screens with more than 8 items (currently the letter board's row-selection stage: Back + Emergency + 10 rows + commit + backspace + はい/いいえ = 15 items; the two-stage 46-character 行→文字 board in requirements.md §4.6 is implemented) use a scrollable grid: `repeat(auto-fit, minmax(220px, 1fr))` with a minimum tile height, same as before Issue #3. Unlike `--tile-label-font` (which does scale with 文字サイズ, capped by `cqi`/`cqb`), this column-width floor is fixed regardless of 文字サイズ (**PR#16 3巡目 must-2 再検証**: multiplying it by `--font-scale` let a bigger font-size setting change the column count here too, reproducing the same "grid shape flips, label shrinks" chain as the fill-mode bug it was fixed alongside — e.g. at `1280×720`, 標準→大 shrank the label from `27.5px` to `25.5px`). Scrolling could carry the Emergency tile out of view as the scan cursor moves through the letter-board items, so the tile itself (`.grid-board:not(.grid-fill) .tile-emergency`) is `position: sticky; top: 0`. With Issue #40, ordinary sub-screens place Back first and Emergency second; home keeps Emergency first, and urgent-detail has no duplicate Emergency tile. The sticky tile stays visible throughout scrolling, while a higher `z-index` on the currently-scanning tile keeps it from being covered if it scrolls underneath the sticky tile. Every tile also has a `scroll-margin-top` equal to the sticky tile's height, so `scrollIntoView` does not park a tile half-hidden behind it. A `scroll-margin-bottom: 8px` also leaves clearance at the bottom of the viewport. At `844×390` with 特大 文字サイズ, the sticky Emergency tile (~130px) plus the scanning tile (~130px) exceeds the board's available height (~251.6px) by a few pixels, so no scroll position can show both fully; keeping Emergency visible takes priority there. The bottom margin improves visibility in other viewport/font combinations, where the scanning tile previously landed a couple of pixels short.
- **Font size (文字サイズ) never changes the cells** (PR#16 再レビュー must-A/B, kept): 標準/大/特大 only raise how large the label is _allowed_ to grow inside its tile (`--label-ratio`, the `vh` ceiling), capped by the tile's own `cqi`/`cqb`. Cells themselves are fixed by orientation.
- No nested cards; no gap between cells (see §2's seamless-grid rule).
- Buttons use stable min-heights so labels do not resize the layout.
- Touch targets should remain large enough for tablet bedside use.
- **PR#16 Opus レビュー must-3** (label overflow at large font sizes), revised by **PR#16 再レビュー must-A/B and should-c**: (1) `--tile-label-font`'s `cqi`/`cqb` cap (in the PR#16-era formula `min(calc(var(--font-scale) * 4.8vh), 15cqi, 20cqb)`; the current formula is in §2 "Font size") is the primary defense now — the `cqi`/`cqb` terms are never multiplied by `--font-scale`, so no matter how large 文字サイズ is set, the label's font is capped at what the tile's own `container-type: size` box can actually hold. (The cells deliberately do _not_ grow with 文字サイズ — see "Fixed grid" above — so this per-tile cap is what keeps large-font labels legible instead of the grid picking fewer columns.) (2) A `navigate` tile reserves space for its chevron/preview on the **label itself** (`.tile-nav .tile-label { max-width; margin-right; margin-bottom }`, scaled by `--font-scale`), not on the tile/container. This took three earlier wrong attempts: padding directly on `.tile-label` only grows the label's own centered box symmetrically, so half the reserved space lands on the wrong side and the box still reaches the chevron/preview at larger font sizes; `position: absolute` + `inset` on the label fixed that but stretched the label's box to fill the whole confined area, so even a 2-character label reported as "4 lines" by height alone; padding on `.tile-nav` (the container) itself fixed both of those, but — caught in PR#16's re-review (should-c) — since `.tile` is `container-type: size`, padding on the container shrinks _its own_ content-box, which is the very basis `cqi`/`cqb` are computed from, so a `navigate` tile's `--tile-label-font` ended up capped smaller than a sibling non-`navigate` tile's in the same screen even at the same cell size. Reserving the space on the label's own box (`max-width`/`margin`) instead leaves the container's cq-basis untouched — `place-items: center` on `.tile` then centers the label within `.tile`'s full box, and the label's own asymmetric margins are what nudge it away from the chevron/preview corners. (3) `.tile { overflow: hidden }` is the final safety net if the first two are somehow insufficient. The message panel has an equivalent cap: `max-height: 24dvh` with `align-content: start` (kako-jun's answer to the "特大でメッセージ欄が63%" question) — `start`, not `center`, matters here too: capping height while still centering overflowing content pushes half of the overflow _above_ the panel (negative `top`, off-screen), which the review's re-run also caught.

## 5. Interaction

Source of truth: `docs/requirements.md`.

- Scanning (any key / Bluetooth shutter = a single "on" timed to the automatic scan cursor) alone carries every message. A direct tap on a tile is an additional path that runs the tapped tile; taps on the background do nothing.
- Scanning runs from startup and never requires the patient to start or stop it.
- Home starts with Emergency. Ordinary child screens start with Back and put Emergency second. The emergency-detail screen starts with Back and omits a duplicate Emergency tile because the emergency state is already active. Back follows the explicit parent-screen tree in `docs/requirements.md`; returning from emergency detail keeps the unresolved emergency state visible.
- A short breadcrumb shows the current path from Home; the latest accepted navigation, Back, or character choice gets a compact confirmation until another choice. Completed transmissions and emergency details use their dedicated regions.
- Caregiver menu opens with a regular click or tap on the button in the current-screen guidance area's top-right corner. Enter or Space on the focused button opens it too without reaching the patient's scan input; other keys remain available as the patient's normal any-key input. The menu is not in the scan cycle.
- Nothing happens implicitly: automatic behaviours (undo appearing for one lap, undo hidden during an emergency, repeated emergency vibration, ignored presses, head hold, the caregiver menu's 60 s auto-close and the Morse clock pausing while it is open) are stated in the fixed guidance bands (§10). The Morse legend stays as the Morse screen's own list of operations (§9).
- Number keys 1-9 are a developer/caregiver aid only and hidden by default.
- Speech can be OFF, tone-only, short, or full. No emergency alarm sound is played; an active emergency stays as a silent visual banner until a caregiver clears it.

## 6. Do's and Don'ts

### Do

- Keep tiles large and readable.
- Prefer green variants for normal actions.
- Use red only for the top message region (urgent state / urgent message) of the patient screen. Never fill or frame a tile red, and do not decorate the Emergency tile: it is identified by its label, fixed position and the top band text.
- Keep current message visible at all times.
- Preserve Esuna-like directness without copying its 9-grid rule.

### Don't

- Do not make Libra a general portal.
- Do not mix urgent actions with deep setup flows.
- Do not rely on small icons or dense text.
- Do not make the app dependent on backend availability for core communication.
- Do not round tile corners or add per-cell shadows/gaps (Issue #3 再レビュー) — the grid is a single seamless plate, divided only by thin lines (§2).
- Do not mix screen guidance, current location, accepted selection, unresolved emergency state, selected emergency details, and the last completed transmission into one undifferentiated message. Each has its dedicated upper region (Issues #37/#44); technical voice-mode/scan-position counters remain excluded from the patient UI.

## 7. Icon

Decided at planning time (2026-05-07, corrected 2026-09-24): an abstract balance-scale (libra = the zodiac Libra) motif, single-color green (`#064e3b`) on the app background (`#f3fbf7`). `frontend/public/icon.svg` is the source; PWA icons and the favicon are generated from it.

The motif is exactly these shapes, all in `#064e3b`:

1. Two equal-sized, upward-pointing (roughly equilateral) triangles side by side, bases at the same height. **Outline only — never filled.** The stroke is thick enough to survive a 16–32px favicon (≈28–36px at the 512×512 canvas scale) with rounded joins/caps.
2. A filled circle sitting on each triangle's apex (one per triangle — two circles total).
3. A single horizontal bar that only connects the two circles — it runs from the right edge of the left circle to the left edge of the right circle, ending flush with (or barely overlapping) each circle. It never pierces through either circle, and it stays perfectly level (never tilted).

No pans, no hanging strings, no other motif (e.g. a speech bubble, grid, or a single triangle+circle+bar) — do not swap this for a different icon concept without an explicit decision, since this was chosen deliberately over the app's own tile-grid visual language. All shapes stay within the maskable safe zone (the centered 80% circle of the 512×512 canvas) so launchers that crop to a circle/squircle never cut into the scale.

## 8. Caregiver UI

The caregiver panel (click/tap menu) reuses the same palette as the patient screen via tokens, as flat status/action colors rather than tile tones. Values below are the light theme; the dark theme substitutes its own `--caregiver-*` tokens (see `globals.css`) but the roles are identical:

| Element                                                 | Background (token)               | Border (token)                   | Text (token)                       | Meaning                                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------- | -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.caregiver-status` (normal)                            | `--caregiver-status-ok-bg`       | `--caregiver-status-ok-border`   | `--text`                           | Wake Lock / offline-ready: OK                                                                                                                                           |
| `.caregiver-status.warn`                                | `--caregiver-status-warn-bg`     | `--caregiver-status-warn-border` | `--caregiver-status-warn-text`     | Wake Lock / offline-ready: needs attention                                                                                                                              |
| `.caregiver-action`                                     | `--caregiver-action-bg`          | —                                | `--caregiver-action-text`          | Primary action button (fullscreen, close…)                                                                                                                              |
| `.caregiver-action:disabled`                            | `--caregiver-action-disabled-bg` | —                                | `--caregiver-action-disabled-text` | Action currently unavailable (e.g. 緊急解除)                                                                                                                            |
| `.caregiver-close`                                      | `--caregiver-close-bg`           | —                                | `--caregiver-action-text`          | Closing action, deliberately darker                                                                                                                                     |
| `.caregiver-voice-options` / `-choice-options` `button` | `--caregiver-status-ok-bg`       | `--caregiver-action-bg`          | `--text`                           | Voice mode / font size / theme option, unselected                                                                                                                       |
| `...button.active`                                      | `--caregiver-action-bg`          | `--caregiver-action-bg`          | `--caregiver-action-text`          | Voice mode / font size / theme option, selected                                                                                                                         |
| `.caregiver-button`                                     | `--caregiver-button-bg`          | —                                | `--caregiver-button-text`          | Click/tap menu entry point inside `.message-panel-controls` at the top-right of the current-screen guidance area; focused Enter/Space is isolated from patient scanning |

**Issue #31 (caregiver menu layout)**: `.caregiver-panel` is a flex column (`min(960px, 100%)` wide, never taller than the viewport): `.caregiver-header` (title + 緊急解除 + 閉じる, never scrolls) → `.caregiver-tablist` (`role="tablist"`, one DOM at every width: `overflow-x: auto` on narrow screens, tabs `flex: 1 0 auto` so they spread evenly when there is room) → `.caregiver-tabpanel` (the only scrolling region). The active `.caregiver-tab` is identified by more than color: inverted colors, heavier weight and a thick inset underline. Tab roving focus and ←/→/Home/End are handled on the tab; App.tsx's menu-open keydown handler exempts only those keys on a focused tab, so every other key (including Enter/Space) still closes the menu as the patient's switch input. The exemption excludes Ctrl/Alt/Meta-modified keys (browser/OS shortcuts) and, like typing in a field, does not extend the 60 s idle timer (pointerdown on a tab does). `.caregiver-tab:focus-visible` draws an inner outline (negative offset, so the scrolling tablist never clips it) and `.caregiver-tabpanel` keeps a `min-height: 6rem` floor. The data tab uses `.settings-backup`, separate from the phrase tab's `.phrase-editor`.

Every token above is a real custom property — no color is hardcoded in `globals.css` component rules (PR#16 Opus レビュー should-5). Since Issue #44, `.caregiver-button` sits in the current-screen guidance area rather than the transmission panel; its existing theme tokens remain the source of its foreground/background colors.

The warn/OK token pairing is shared by Wake Lock status and offline-ready status, so caregivers learn one visual pattern for "this needs your attention" across all of them, in either theme. The 文字サイズ (font size) and 表示 (theme: light/dark/auto) pickers both reuse the same `.caregiver-choice-options` look as the voice-mode picker (`--caregiver-status-ok-bg`/`--caregiver-action-bg` unselected/selected pair); 高コントラスト is a plain checkbox like 聴覚スキャン.

## 9. Morse screen (Issue #57)

The Morse input screen (`.morse-panel`) always shows its full legend (`.morse-legend`): the patient has only a switch and `touch-action: none`, so **every legend item must be visible without scrolling**. Verified at 390x844, 568x320, 844x390 and 320x568 (all items inside the viewport, `.morse-panel` `scrollHeight == clientHeight`).

- Placement: below the large code (`.morse-code`) and confirmed text (`.morse-text`). While `screen() === 'morse'` the shell has `.is-morse`, which hides the breadcrumb, the accepted-selection strip and the last-message panel, and shrinks the screen-guide heading (`clamp(0.95rem, 2.4vh, 1.3rem)`), so the panel gets the room.
- Confirmed text: capped at 3.9em (2.5em on short/narrow viewports), overflow clipped from the top so the tail of the input stays visible; it never pushes the legend out.
- Legend type size: `clamp(0.8rem, 2.6vmin, 1.35rem)` by default; narrow width (<=480px): `clamp(0.8rem, 2.2vh, 1.1rem)`; short height (<=500px): `clamp(0.75rem, 4vh, 1rem)` (12.8px at 320px high). Line-height 1.3 (1.25 compact; 1.2 on short heights <=500px). Full opacity (no dimming) in every case; keywords are `<b>` weight 800.
- Columns: `repeat(auto-fit, minmax(min(100%, 19rem), 1fr))` by default, `15rem` when narrow (<=480px wide) and `10rem` when short (<=500px high). Gap 4px 16px (2px 12px compact; row gap 0 on short heights <=500px so the worst case — 568x320, high contrast + emergency band + minimum press time — keeps >=3px between the last legend line and the panel bottom; guarded by the `morse-legend-fit` e2e check).
- Panel padding/gap: 16px 14px / 12px; compact 6px 12px / 4px. Code size `clamp(2rem, 11vmin, 4.5rem)` (compact `clamp(1.4rem, 7vmin, 2.4rem)`), text `clamp(1.5rem, 7vmin, 3rem)` (compact `clamp(1.1rem, 5vmin, 1.8rem)`).
- Content rules: no emoji; second-counts follow the caregiver settings; the "under N s presses are not counted" line appears only when the minimum press time (#6) is set.
- Unresolved-emergency band (`.emergency-status`) while on the Morse screen: the band is compacted (padding 4px 12px, message `clamp(1rem, 3vh, 1.5rem)`, the detail list hidden — it is visible on the emergency screens), and the screen-guide keeps the heading and the caregiver button on one row (3px block padding when short) so the legend still fits.
- `.morse-panel` is `overflow: hidden` — no scrolling is ever relied on; fit is guaranteed by the measurements in §10.

## 10. Guidance band measurements (Issue #58)

The bottom guidance band (`.screen-notes`) and the caregiver band (`.caregiver-notes`) are described in §4. This section holds their measurements, including the Morse screen rows (the Morse legend must stay visible beside the band; see §9 for the legend rules).

Re-measured after Issue #58 (short-viewport spacing tightened to make room for the bottom guidance band, §4). Measured with real Chromium (playwright-core): bottom of the last legend item vs viewport height; `.morse-panel` `scrollHeight == clientHeight` in every cell.

| State                                                                     | Band height         | Fit (with band; 568x320 grid height, [without band])                                            |
| ------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| Home, default                                                             | 45 / 18 / 18 / 36   | fill at all four sizes (251 [269])                                                              |
| Home after a transmission (undo shown), default                           | 64 / 31 / 18 / 50   | fill at all four sizes (194 [225], 4x2)                                                         |
| Emergency + message, home, default                                        | 102 / 31 / 31 / 65  | fill at all four sizes (139 [169])                                                              |
| Emergency + message, home, WORST (7 notes)                                | 159 / 57 / 44 / 122 | fill at all four sizes (113 [169]; 320x568 grid 232)                                            |
| Emergency + message, tap 不快 (8 items, confirmation row), default        | 64 / 31 / 18 / 50   | fill at all four sizes (119 [149])                                                              |
| Emergency + message, tap 不快 (8 items), WORST (5 notes)                  | 121 / 44 / 31 / 93  | fill at all four sizes (106 [149])                                                              |
| Emergency + message, tap 快・要望 (8 items), default                      | 64 / 31 / 18 / 50   | fill at all four sizes (119 [149])                                                              |
| Emergency + message, tap 快・要望 (8 items), WORST                        | 121 / 44 / 31 / 93  | fill at all four sizes (106 [149]; 320x568 grid 216)                                            |
| Emergency + message, tap 不快 > 痛い / その他, WORST                      | 121 / 44 / 31 / 93  | fill at all four sizes (106 [149])                                                              |
| No emergency, after 「はい」, tap 不快 (confirmation row), default        | 45 / 18 / 18 / 36   | fill at all four sizes (568x320: 187 [205]; 4 columns x 2 rows since Issue #47)                 |
| Letter board (15 items, scrolling grid by design), tap 文字盤             | 45 / 18 / 18 / 36   | scrolls inside the grid as before (also with no band); the band stays at the bottom             |
| Morse, default (no band)                                                  | -                   | no clipping; legend bottom 430 / 237 / 272 / 293                                                |
| Morse WORST: emergency + min press 0.5 s + letter gap 3.0 s, tap モールス | 26 / 18 / 18 / 21   | no clipping; legend bottom 490 / 296 / 299 / 339 (all above the band top 818 / 302 / 372 / 547) |
| Caregiver menu band (3 notes, Morse enabled)                              | 63 / 35 / 36 / 77   | panel inside the viewport; tab panel height 214 / 87 / 156 / 194 (it scrolls)                   |

Taps in the procedure wait 800 ms between presses (default debounce is 0.5 s; an earlier run tapped after 350 ms and the second tap of a two-step path was silently ignored, which is how the "no emergency, after はい" row had been mis-measured).

History: before the layout fixes, `568x320` with an emergency, a shown message and default settings left the grid only 68px (105px without the band), and tapping 不快/快・要望 there (confirmation row shown) gave 92px / no fill; "home + message" and "emergency + discomfort" scrolled even with no band. After the fixes (guidance-frame row, short-viewport frame padding, grid width fallback) every row above fills at all four sizes except the letter board, which scrolls by design. The earlier 108 vs 95 and 296 vs 281 discrepancies came from mixing states (tap path vs restored state, band measured on different notes); the table above is one procedure, one run.

## 11. Fixed tile grid measurements (Issue #47, Issue #34)

Measured with real Chromium (playwright-core, chromium-1243) against `vite preview` of the built app. The measurement script guards that the settings really took effect (it reads `data-font-size` / `data-high-contrast` and the stored settings back and aborts otherwise; an earlier run of this section had a script bug where the guidance-band setting was never applied, so all of its numbers were discarded and redone).

Matrix: 8 viewports (390x844, 844x390, 568x320, 320x568, 768x1024, 1024x768, 360x640, 375x667) x 標準/特大 文字サイズ x high contrast OFF/ON x guidance band at its maximum OFF/ON (minimum press time 0.5 s, auditory scan, voice full, release-to-activate; states are reached by 700 ms press-and-release taps in that mode) x 22 states = **1408 measurements**. Each state is reached by tapping tiles (`libra:emergency` cleared before every load). Morse was enabled, so home has 7 items (8 with undo). The states include an emergency with **all five emergency details selected** plus a transmitted long message (the longest emergency band). For every tile the text boxes of `.tile-label`, `.tile-detail`, `.tile-preview` and the chevron were compared with the tile rectangle shrunk by `--scan-ring-inset`; the smallest `.tile-label` font size on the screen was recorded.

Result: **0 violations** (every tile and empty cell the same size within 1px rounding; `grid-board` has no scroll and the page has no scroll; no text outside its tile; no text inside the ring band; smallest label >= 13px). The letter board (15 items) scrolls by design and is excluded. The invariant is the label floor: **the label never goes below 13px**.

- Smallest label: **13.00px**, exactly at the floor, with no margin: 320x568, all five emergency details selected + transmitted message + 不快 / 快・要望 > 要望, high contrast, maximum guidance band (cell **160x55**, the guidance band is 95px tall). The next smallest are 13.67px (same state, home) and 14.56px (emergency + message + 快・要望, cell 160x59). At 568x320 the smallest is 15.52px (cell **142x61**), with 2-line labels such as 痰を取ってほしい / 静かにしてほしい / 体の向きを変えたい inside the ring band.
- Smallest cell: **160x55** (above). Any further reduction of cell height at 320x568 (more guidance text, a longer emergency band) would push the label under 13px or into the ring band; that is the remaining constraint of this design, and it was reached only by selecting every emergency detail with the maximum guidance band.
- High contrast vs standard: at the same cell size the label is never smaller. High contrast cells are up to about 15px shorter in tight states (thicker 3px divider lines and thicker guidance wraps), so the label measured on the _screen_ can be up to 1.28px smaller (never below 13px).
- Short viewports (`max-height: 500px`): the emergency band is one line (28-30px high in every measured state, including all five details). The details are cut with an ellipsis when they do not fit (`.emergency-details` is `white-space: nowrap; text-overflow: ellipsis`); their full text is on the emergency detail screen. The band's main sentence is a little smaller there (about 17.6px instead of 19.2px at 568x320).
- Where the cell is bound by the label floor (the tightest cells), a one-line label is also lowered toward 13px: CSS cannot tell a one-line label from a two-line one, so the floor is lowered by cell height alone. Normal cells are unaffected.
- 特大 and 標準 give the same minimum (13.00px) because those cells are bound by the label floor, not by the font-size setting.
- 390x844 home labels: 標準 21.80px, 特大 25.65px, identical with high contrast OFF and ON (and with the guidance band at its maximum).

Table: items + empty cells per state; each cell is `tile width x tile height (range over the four high contrast x guidance-band combinations, 標準 and 特大 identical) / smallest label px over all 8 combinations (標準/特大 x high contrast x guidance band)`.

| State (items+empty)                   | 390x844               | 844x390               | 568x320              | 320x568              | 768x1024              | 1024x768              | 360x640              | 375x667               |
| ------------------------------------- | --------------------- | --------------------- | -------------------- | -------------------- | --------------------- | --------------------- | -------------------- | --------------------- |
| home (7+1)                            | 195x166-181 / 21.8px  | 211x152-161 / 18.72px | 142x111-126 / 16.8px | 160x104-115 / 16.8px | 384x215-225 / 32.44px | 256x315-334 / 29.58px | 180x121-133 / 16.8px | 188x127-139 / 17.43px |
| home+undo(はい後) (8+0)               | 195x146-162 / 20.73px | 211x129-138 / 17.83px | 142x87-97 / 16.8px   | 160x86-99 / 16.8px   | 384x186-197 / 27.49px | 256x267-279 / 29.58px | 180x102-119 / 16.8px | 188x108-125 / 16.8px  |
| 緊急詳細 (6+2)                        | 195x151-167 / 21.61px | 211x137-146 / 18.72px | 142x96-105 / 16.8px  | 160x84-96 / 16.8px   | 384x188-199 / 27.88px | 256x286-297 / 29.58px | 180x107-123 / 16.8px | 188x112-130 / 16.8px  |
| 不快 (8+0)                            | 195x161-176 / 21.8px  | 211x141-151 / 18.72px | 142x100-116 / 16.8px | 160x98-110 / 16.8px  | 384x207-218 / 31.07px | 256x300-319 / 29.58px | 180x115-128 / 16.8px | 188x121-134 / 16.8px  |
| 不快>その他 (7+1)                     | 195x161-176 / 21.8px  | 211x141-151 / 18.72px | 142x100-116 / 16.8px | 160x98-110 / 16.8px  | 384x207-218 / 31.07px | 256x300-319 / 29.58px | 180x115-128 / 16.8px | 188x121-134 / 16.8px  |
| 不快>痛い (8+0)                       | 195x166-182 / 21.8px  | 211x141-151 / 18.72px | 142x100-116 / 16.8px | 160x98-110 / 16.8px  | 384x207-218 / 31.07px | 256x300-319 / 29.58px | 180x115-128 / 16.8px | 188x121-134 / 16.8px  |
| 不快>痛い>頭>強さ (6+2)               | 195x161-176 / 21.8px  | 211x141-151 / 18.72px | 142x100-116 / 16.8px | 160x98-110 / 16.8px  | 384x207-218 / 31.07px | 256x300-319 / 29.58px | 180x115-128 / 16.8px | 188x121-134 / 16.8px  |
| 快要望 (8+0)                          | 195x161-176 / 21.8px  | 211x141-151 / 18.72px | 142x100-116 / 16.8px | 160x92-104 / 16.8px  | 384x207-218 / 31.07px | 256x300-319 / 29.58px | 180x115-128 / 16.8px | 188x121-134 / 16.8px  |
| 快要望>要望 (8+0)                     | 195x161-176 / 21.8px  | 211x141-151 / 18.72px | 142x100-116 / 16.8px | 160x98-110 / 16.8px  | 384x207-218 / 31.07px | 256x300-319 / 29.58px | 180x115-128 / 16.8px | 188x121-134 / 16.8px  |
| 快要望>気分 (5+3)                     | 195x161-176 / 21.8px  | 211x141-151 / 18.72px | 142x100-116 / 16.8px | 160x98-110 / 16.8px  | 384x207-218 / 31.07px | 256x300-319 / 29.58px | 180x115-128 / 16.8px | 188x121-134 / 16.8px  |
| 文字盤(scroll) (15+0)                 | scrolls               | scrolls               | scrolls              | scrolls              | scrolls               | scrolls               | scrolls              | scrolls               |
| 緊急中 home (7+1)                     | 195x138-154 / 19.39px | 211x130-140 / 18.1px  | 142x89-105 / 16.8px  | 160x81-96 / 16.8px   | 384x183-194 / 27.06px | 256x271-282 / 29.58px | 180x100-113 / 16.8px | 188x106-119 / 16.8px  |
| 緊急中+伝達 home (7+1)                | 195x123-139 / 16.8px  | 211x107-118 / 16.8px  | 142x66-83 / 16.8px   | 160x67-83 / 16.8px   | 384x154-166 / 22.12px | 256x223-235 / 29.58px | 180x85-99 / 16.8px   | 188x91-105 / 16.8px   |
| 緊急中+伝達 不快 (8+0)                | 195x122-139 / 16.8px  | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x65-78 / 16.8px   | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x80-98 / 16.8px   | 188x85-103 / 16.8px   |
| 緊急中+伝達 不快>痛い (8+0)           | 195x128-144 / 17.61px | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x65-78 / 16.8px   | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x80-98 / 16.8px   | 188x85-103 / 16.8px   |
| 緊急中+伝達 快要望 (8+0)              | 195x122-139 / 16.8px  | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x59-72 / 14.56px  | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x80-98 / 16.8px   | 188x85-103 / 16.8px   |
| 緊急中+伝達 快要望>要望 (8+0)         | 195x122-139 / 16.8px  | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x65-78 / 16.8px   | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x80-98 / 16.8px   | 188x85-103 / 16.8px   |
| 緊急中+痰伝達 不快 (8+0)              | 195x122-139 / 16.8px  | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x65-79 / 16.8px   | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x80-98 / 16.8px   | 188x85-104 / 16.8px   |
| 緊急中+痰伝達 快要望>要望 (8+0)       | 195x122-139 / 16.8px  | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x65-79 / 16.8px   | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x80-98 / 16.8px   | 188x85-104 / 16.8px   |
| 緊急詳細全件+痰伝達 home (7+1)        | 195x108-125 / 16.8px  | 211x107-118 / 16.8px  | 142x66-83 / 16.8px   | 160x57-73 / 13.67px  | 384x154-166 / 22.12px | 256x223-235 / 29.58px | 180x74-88 / 16.8px   | 188x79-93 / 16.8px    |
| 緊急詳細全件+痰伝達 不快 (8+0)        | 195x108-124 / 16.8px  | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x55-68 / 13px     | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x69-86 / 16.8px   | 188x74-92 / 16.8px    |
| 緊急詳細全件+痰伝達 快要望>要望 (8+0) | 195x108-124 / 16.8px  | 211x103-114 / 16.8px  | 142x61-73 / 15.52px  | 160x55-68 / 13px     | 384x151-163 / 21.56px | 256x208-220 / 29.58px | 180x69-86 / 16.8px   | 188x74-92 / 16.8px    |

How the label stays >= 13px in the tight states (Issue #34 review fixes; nothing here changes standard-size labels in normal cells):

- The label floor is `min(1.05rem, max(13px, (100cqb + 2 * --ring-extra) / 2.4))`: it only drops below `1.05rem` when the cell's content height cannot hold two lines, never below 13px, and `--ring-extra` (ring band minus the standard 12px; 0 normally) keeps high contrast from being smaller than standard for the same cell. The same `--ring-extra` is added to the `cqi`/`cqb` cap.
- Cell height is made up on short viewports instead of shrinking text (`@media (max-height: 500px)`): the emergency band becomes one line (`緊急です。来てください。` and `伝えた状態: …` side by side, about 24px saved). At 568x320 emergency + message + 不快 (8 items) the cell went from 142x49 (label 8.0px in a broken first attempt, high contrast + maximum guidance band) to 142x61 (15.52px).
- The high contrast ring is 7px (band 13px) when `max-height: 500px`, or when `max-width: 480px` together with `max-height: 700px` (320x568, 360x640, 375x667); 9px (band 15px) otherwise, including 390x844 and tablets. The single yellow ring on the dark scanning fill keeps its contrast; 7px is still thicker than the standard 6px.
- Custom (caregiver-edited) labels longer than the defaults (up to the phrase label limit) were not measured and may wrap to three lines in the tightest cells; they are clipped by the tile (`overflow: hidden`), not drawn over neighbours.

Known behaviour (pre-existing, not changed here): the selectors `:root, :root[data-theme='light']` (specificity 0,2,0) beat the breakpoint rules `:root { --label-cqi: ...; --label-cqb: ... }` (0,1,0), so with the light theme on a phone the `cqi`/`cqb` coefficients stay at the base 15/20 while the dark theme gets the intended 22/24 (20/22 at <=720px). Label size therefore differs by theme on small screens. This was left alone because fixing it changes every measurement here; it needs a separate decision.

Orientation boundary: JS (`gridLayout.ts`) and CSS (`@media (orientation: portrait)`, the message panel's `min-height`) agree: height >= width is portrait, so a square viewport is portrait in both. Known behaviour: the grid is chosen from `innerWidth`/`innerHeight`, so a soft keyboard or split view that shrinks the viewport can flip a short viewport to landscape and change the grid. The patient screen has no text input (the only inputs live in the caregiver menu), so this only happens while the caregiver menu is in use; the grid follows the next `resize`.

Item counts not reachable with real screens (1, 3, 9) are covered by `gridLayout.test.ts` (the grid does not depend on the item count). Reachable counts measured: 5, 6, 7, 8, and 15 (scrolling). Automated guard: `npm run e2e` (`checkTightScreenLabelsAndRing`) checks 568x320 + high contrast + maximum guidance band + emergency + message, with one and with all five emergency details (one-line emergency band, no ring intrusion, label >= 13px), and 390x844 / 768x1024 home (high contrast not smaller than standard, 0.5px tolerance).
