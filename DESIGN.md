# DESIGN.md

libra — Design System

## 1. Visual Theme & Atmosphere

Bedside communication UI. The screen is dominated by a large message panel and a grid of big, easy-to-press tiles.

The design should feel related to Esuna: simple, direct, high-contrast, and built around large touch targets. It is not bound to Esuna's fixed 9-grid operation model. Libra may use more or fewer tiles depending on the task.

Theme: green-based, calm, medical-adjacent, and readable. Urgent actions may use red.

## 2. Color Palette & Roles

| Role          | Value     | Usage                                                        |
| ------------- | --------- | ------------------------------------------------------------ |
| Background    | `#f3fbf7` | App background                                               |
| Primary       | `#064e3b` | Message panel                                                |
| Primary dark  | `#052e2b` | Text / strong borders                                        |
| Tile border   | `#065f46` | Normal tile border                                           |
| Calm tile     | `#dcfce7` | Slow / non-urgent actions                                    |
| Positive tile | `#d1fae5` | Yes / okay / thanks                                          |
| Urgent tile   | `#fee2e2` | Emergency actions                                            |
| Urgent border | `#991b1b` | Emergency border                                             |
| Scan outline  | `#facc15` | Current scan target                                          |
| Urgent text   | `#fee2e2` | Text on the emergency message-panel background[^urgent-text] |

[^urgent-text]: Used for the accumulated emergency-detail list and the "latest during emergency" line. Reuses the Urgent tile value, which reads clearly on the emergency panel's `#7f1d1d` background.

## 3. Typography Rules

BIZ UDPGothic (400/700) is bundled via `@fontsource/biz-udpgothic` and imported from `index.tsx`, not loaded from a CDN — requirements.md §8 requires every communication feature to work offline, and a Google Fonts `<link>` breaks that. It is also a universal-design typeface (clear kana/kanji shapes, wide letter spacing), which matters because a generic `system-ui`/`sans-serif` stack falls back to a Chinese-glyph font (e.g. WenQuanYi) on many Linux systems and renders Japanese text with the wrong glyph shapes. `font-family` therefore puts `'BIZ UDPGothic'` first, followed only by other Japanese-capable fallbacks (`Hiragino Sans`, `Hiragino Kaku Gothic ProN`, `Yu Gothic UI`, `Yu Gothic`, `Noto Sans JP`) and finally generic `sans-serif` — never a bare `system-ui`/`-apple-system`/`Segoe UI` ahead of a Japanese-capable font. Text must fit inside tiles on mobile and tablet.

- Message: very large, `clamp(2.35rem, 7vh, 5.4rem)`
- Tile label: `clamp(1.55rem, 4.8vh, 3.4rem)`
- Tile detail: smaller but bold
- Letter spacing: `0`

## 4. Layout Principles

- Message panel stays at the top.
- Tile grid fills the remaining space.
- Grid is responsive: `repeat(auto-fit, minmax(...))`.
- No nested cards.
- Buttons use stable min-heights so labels do not resize the layout.
- Touch targets should remain large enough for tablet bedside use.

## 5. Interaction

Source of truth: `docs/requirements.md`.

- The patient has exactly one input: a single "on" (tap anywhere / any key / Bluetooth shutter) timed to an automatic scan cursor.
- Scanning runs from startup and never requires the patient to start or stop it.
- The first scan item of every screen is Emergency.
- Caregiver menu opens with a 2-second long press on a corner button; it is not in the scan cycle.
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
