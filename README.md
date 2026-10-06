# libra

**A bedside communication aid with a large, grid-based interface**

`libra` is a lightweight AAC helper for hospital bedside use. It is designed for short, high-signal communication between a patient and nearby family or care staff.

It does not replace a nurse call or hospital system. It sits beside them: a last-mile tool for "I need water", "I am in pain", "please change my position", "yes", and "no".

## Features

- **Single-switch input only** — The patient has exactly one input: a tap anywhere on the screen, any key (Bluetooth shutter buttons arrive as key presses), or a Bluetooth shutter itself. All of these are the same "on" signal.
- **Always-on auto scan** — Scanning runs from app startup; there is no start/stop control in the patient's path, since a stopped scan can't be restarted by someone who can't reach a "start" button.
- **Safety-ordered screens** — Home starts with Emergency; ordinary sub-screens start with Back, then Emergency; the urgent-detail screen starts with Back followed by the remaining detail choices. Free-text letter board sits behind the structured menus, never in front.
- **Large grid UI** — Not fixed to Esuna's 9-grid rule, but keeps the same easy-to-press grid feeling.
- **Message display** — The selected phrase is shown in large type so the person nearby can read it.
- **Location and selection confirmation** — A short home-to-screen breadcrumb stays visible, and the last accepted navigation/character choice is confirmed without adding a switch press or delay. Completed transmissions and emergency details remain in their own areas.
- **Emergency alarm** — Selecting Emergency shows a red banner with no confirmation step and sounds a Web Audio alarm (works even with speech OFF) until a caregiver clears it. Emergency is restored after a reload or restart until a caregiver clears it.
- **Caregiver menu** — A regular click or tap on the "介助者用" (caregiver) button at the top-right of the message panel (not a floating bottom bar) opens a menu with a full-width top category tab bar (status / scan / input method / feedback / display / phrases / data; horizontally scrollable on phones, evenly spread on wide screens) showing only the selected category's settings, with emergency clear and close always visible above the tabs. Arrow/Home/End keys move between tabs. Enter or Space on the focused button opens it too, separately from the person's switch input. Settings persist to localStorage.
- **Light/dark theme** — A caregiver setting (light / dark / auto, default auto) instead of a URL query; auto follows the device's `prefers-color-scheme` live. High contrast layers on top of either theme. The tile grid is a seamless, gap-less board (no rounded corners, cells separated only by a thin divider line) that always fills its screen area edge to edge — column/row count is computed from the item count and the grid area's own aspect ratio, never leaving empty cells or a blank strip. The current scan target gets a thick yellow ring drawn just inside its own cell (no scale-up, so it never overlaps a neighboring cell).
- **Speech modes** — Off, vibration/tone only, short speech, and full speech.
- **PWA-ready structure** — Same frontend/backend/release shape as Esuna.

## Prototype Scope

| Area                                                                   | Status                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Single-switch scanning (tap / any key / BT shutter)                    | Working                                                              |
| Safety-ordered screens (home: Emergency; sub-screens: Back, Emergency) | Working                                                              |
| Emergency + alarm                                                      | Working                                                              |
| Yes / No                                                               | Working                                                              |
| Discomfort / mood / pain location                                      | Working                                                              |
| Letter board                                                           | Prototype (simplified entry; full 2-stage kana keyboard is planned)  |
| Speech mode                                                            | Working                                                              |
| Caregiver menu (settings)                                              | Working                                                              |
| Offline (Service Worker precache)                                      | Working                                                              |
| Screen Wake Lock                                                       | Working                                                              |
| Custom phrase editing                                                  | Planned                                                              |
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
