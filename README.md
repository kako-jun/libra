# libra

**A bedside communication aid with a large, grid-based interface**

`libra` is a lightweight AAC helper for hospital bedside use. It is designed for short, high-signal communication between a patient and nearby family or care staff.

It does not replace a nurse call or hospital system. It sits beside them: a last-mile tool for "I need water", "I am in pain", "please change my position", "yes", and "no".

## Features

- **Two patient input paths only** — Any key press / Bluetooth shutter (arrives as a key press) is a single "on" that runs the current scan target; scanning alone can carry every message. A direct tap on a tile is an additional path that runs the tapped tile itself, regardless of the scan position. Taps on the background (anything that is not a tile) do nothing.
- **Always-on auto scan** — Scanning runs from app startup; there is no start/stop control in the patient's path, since a stopped scan can't be restarted by someone who can't reach a "start" button.
- **Safety-ordered screens** — Home starts with Emergency, followed by "もう一度" (Again: repeats the last transmission so a missed message does not have to be re-selected from scratch), then Yes/No; ordinary sub-screens start with Back, then Emergency; the urgent-detail screen starts with Back followed by the remaining detail choices. Free-text letter board sits behind the structured menus, never in front.
- **Large grid UI** — Not fixed to Esuna's 9-grid rule, but keeps the same easy-to-press grid feeling. Every home item and "Back" carries an icon (same colour as the text, not read aloud).
- **Message display** — The selected phrase is shown in large type so the person nearby can read it.
- **Message and location** — The top of the screen reads: emergency status, then "what was just said", then the current location and screen guidance. A short home-to-screen breadcrumb (home has a house icon) stays visible, and the current screen is also named by its heading, without adding a switch press or delay. Breadcrumb ancestors can be clicked or tapped to jump back to that screen. The "what was just said" area keeps a fixed height from startup and fits the whole text, so the tiles below do not move. A caregiver can step back through the last 50 transmissions (kept in memory only) with left/right arrows, shown only where there is something in that direction; each entry keeps its own background colour.
- **Always-visible guidance for automatic behaviour** — A fixed band at the bottom of every patient screen states what happens on its own and cannot be seen: vibration repeating during an emergency (nothing is shown otherwise). The caregiver menu has no such band; it still closes after 60 s without a tap. Settings-dependent behaviour (ignored presses, minimum press time) is explained right under the setting in the Scan tab. Anything visible on screen is not written. It cannot be hidden.
- **Silent emergency banner** — Selecting Emergency shows a red banner with no confirmation step. No alarm sound is played; the banner stays at the top until a caregiver clears it, or the person themselves selects Emergency, then "Release emergency", then "Release" (any other input leaves it in place). Emergency is restored after a reload or restart until it is cleared.
- **Caregiver menu** ("介助者用メニュー") — A regular click or tap on the "介助者用" (caregiver) button at the top-right of the screen-guidance area opens a menu with a full-width top category tab bar (setup / scan / sound and vibration / display / phrases / Morse / data / about this app; arrows appear when the tabs scroll sideways) showing only the selected category's settings. Close is always visible above the tabs; emergency clear appears, centred, only during an emergency. Sliders have left/right arrows that move one step per press. The setup tab can install the app (a button where the browser accepts installs, short steps otherwise; not verified on real Android or iOS devices). Reset-to-defaults is per tab (confirmed by pressing twice). The display tab can set a favourite picture that is shown left of the caregiver button (stored on the device only, never sent out). The about tab shows usage instructions, links, a usage count (the only network request the app makes; failure never affects communication) and the version. Arrow/Home/End keys (without modifiers) move between tabs without extending the 60 s idle auto-close. Enter or Space on the focused button opens it too, separately from the person's switch input. Settings persist to localStorage.
- **Light/dark theme** — A caregiver setting (light / dark / auto, default auto) instead of a URL query; auto follows the device's `prefers-color-scheme` live. High contrast layers on top of either theme. The tile grid is a seamless, gap-less board (no rounded corners, cells separated only by a thin divider line). The grid is chosen per screen (standard 8 cells: portrait 2x4 / landscape 4x2; home 10 cells: portrait 2x5 / landscape 5x2; letter-board rows 15 cells: portrait 3x5 / landscape 5x3), so every choice on a screen is the same size, and home tiles differ in size from sub-screen tiles. Tiles are never stretched to fill a short menu; leftover cells stay empty and are not selectable (skipped by scanning and taps). Only a screen with more items than cells (a caregiver added phrases) scrolls. The current scan target gets a thick yellow ring drawn just inside its own cell (no scale-up, so it never overlaps a neighboring cell), and the label/preview text is kept inside the ring so it is never hidden. The scanning cell's fill inverts to a dark surface so the single yellow ring clears WCAG 3:1 even on the light theme (decided, #33).
- **Speech modes** — Off, vibration/tone only, short speech, and full speech.
- **PWA-ready structure** — Same frontend/backend/release shape as Esuna.

## Prototype Scope

| Area                                                                   | Status                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Single-switch scanning (any key / BT shutter) + direct tile tap        | Working                                                              |
| Safety-ordered screens (home: Emergency; sub-screens: Back, Emergency) | Working                                                              |
| Emergency (silent)                                                     | Working                                                              |
| Yes / No                                                               | Working                                                              |
| Discomfort / mood / pain location                                      | Working                                                              |
| Letter board (2-stage: row, then character; 46 kana + long-vowel mark) | Working (real-device check pending, #4)                              |
| Speech mode                                                            | Working                                                              |
| Morse input (optional; SOS = emergency)                                | Working (real-device check pending)                                  |
| Haptic feedback (vibration patterns)                                   | Working (Android real-device check pending, #13)                     |
| Caregiver menu (settings)                                              | Working                                                              |
| Offline (Service Worker precache)                                      | Working                                                              |
| Screen Wake Lock                                                       | Working                                                              |
| Custom phrase editing                                                  | Working                                                              |
| Again, message history, release emergency by the person, favourite picture, about tab | Working (checked in Chromium on a production build; real touch / real switch not verified) |
| External switch pairing                                                | Planned (keyboard-event bridge only; native pairing not implemented) |

## For Developers

### Tech Stack

- **Frontend**: Vite + SolidJS + TypeScript + Web Speech API
- **Backend**: Hono on Cloudflare Workers + TypeScript
- **CI**: GitHub Actions, same shape as Esuna
- **Docs**: `docs/` mirrors Esuna's document set

### Local Setup

```bash
git clone https://github.com/kako-jun/libra.git

# Frontend
cd frontend && npm install && npm run dev
# -> http://localhost:5173

# Backend (separate terminal)
cd backend && npm install && npm run dev
# -> http://localhost:8787
```

### Deploy

- **Frontend**: Cloudflare Pages, auto-deploy on push to `main`
- **Backend**: `cd backend && npx wrangler deploy`

## License

MIT — [@kako-jun](https://github.com/kako-jun)
