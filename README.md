# libra

**A bedside communication aid with a large, grid-based interface**

`libra` is a lightweight AAC helper for hospital bedside use. It is designed for short, high-signal communication between a patient and nearby family or care staff.

It does not replace a nurse call or hospital system. It sits beside them: a last-mile tool for "I need water", "I am in pain", "please change my position", "yes", and "no".

## Features

- **Two patient input paths only** — Any key press / Bluetooth shutter (arrives as a key press) is a single "on" that runs the current scan target; scanning alone can carry every message. A direct tap on a tile is an additional path that runs the tapped tile itself, regardless of the scan position. Taps on the background (anything that is not a tile) do nothing.
- **Always-on auto scan** — Scanning runs from app startup; there is no start/stop control in the patient's path, since a stopped scan can't be restarted by someone who can't reach a "start" button.
- **Safety-ordered screens** — Home starts with Emergency; ordinary sub-screens start with Back, then Emergency; the urgent-detail screen starts with Back followed by the remaining detail choices. Free-text letter board sits behind the structured menus, never in front.
- **Large grid UI** — Not fixed to Esuna's 9-grid rule, but keeps the same easy-to-press grid feeling.
- **Message display** — The selected phrase is shown in large type so the person nearby can read it.
- **Location** — A short home-to-screen breadcrumb stays visible, and the current screen is also named by its heading, without adding a switch press or delay. Breadcrumb ancestors can be clicked or tapped to jump back to that screen. Completed transmissions and emergency details remain in their own areas.
- **Always-visible guidance for automatic behaviour** — A fixed band at the bottom of every patient screen (and at the top of the caregiver menu) states, with reasons, whatever happens on its own: undo appearing for one lap, vibration repeating during an emergency, ignored presses / minimum press time, the head hold, the menu closing after 60 s. It cannot be hidden and only shows what applies in the current state and settings.
- **Silent emergency banner** — Selecting Emergency shows a red banner with no confirmation step. No alarm sound is played; the banner stays at the top until a caregiver clears it. Emergency is restored after a reload or restart until a caregiver clears it.
- **Caregiver menu** — A regular click or tap on the "介助者用" (caregiver) button at the top-right of the screen-guidance area (breadcrumb and screen purpose; not a floating bottom bar) opens a menu with a full-width top category tab bar (status / scan / input method / feedback / display / phrases / data; horizontally scrollable on phones, evenly spread on wide screens) showing only the selected category's settings, with emergency clear and close always visible above the tabs. Arrow/Home/End keys (without modifiers) move between tabs without extending the 60 s idle auto-close. Enter or Space on the focused button opens it too, separately from the person's switch input. The data tab offers settings export / import and reset-to-defaults (both confirmed by pressing twice). Settings persist to localStorage.
- **Light/dark theme** — A caregiver setting (light / dark / auto, default auto) instead of a URL query; auto follows the device's `prefers-color-scheme` live. High contrast layers on top of either theme. The tile grid is a seamless, gap-less board (no rounded corners, cells separated only by a thin divider line) that uses one fixed grid per screen orientation (portrait 2 columns x 4 rows, landscape 4 columns x 2 rows) on every screen, so every choice is the same size — tiles are never stretched to fill a short menu; leftover cells stay empty and are not selectable (skipped by scanning and taps). The current scan target gets a thick yellow ring drawn just inside its own cell (no scale-up, so it never overlaps a neighboring cell), and the label/preview text is kept inside the ring so it is never hidden. The scanning cell's fill inverts to a dark surface so the single yellow ring clears WCAG 3:1 even on the light theme (decided, #33).
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
