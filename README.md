# libra

**A bedside communication aid with a large, grid-based interface**

`libra` is a lightweight AAC helper for hospital bedside use. It is designed for short, high-signal communication between a patient and nearby family or care staff.

It does not replace a nurse call or hospital system. It sits beside them: a last-mile tool for "I need water", "I am in pain", "please change my position", "yes", and "no".

## Features

- **Large grid UI** — Not fixed to Esuna's 9-grid rule, but keeps the same easy-to-press grid feeling.
- **Urgent / slow paths** — Urgent phrases are one tap away; slower communication can go deeper.
- **Message display** — The selected phrase is shown in large type so the person nearby can read it.
- **Speech modes** — Off, vibration/tone only, short speech, and full speech.
- **Auto scan mode** — Space / Enter can activate the currently highlighted tile, matching Bluetooth shutter button style input.
- **PWA-ready structure** — Same frontend/backend/release shape as Esuna.

## Prototype Scope

| Area | Status |
|---|---|
| Urgent phrases | Working |
| Slow menus | Working |
| Pain / discomfort / mood | Working |
| Letter board | Prototype |
| Speech mode | Prototype |
| Auto scan | Prototype |
| Custom phrase editing | Planned |
| Caregiver confirmation | Planned |
| External switch pairing | Planned |

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
