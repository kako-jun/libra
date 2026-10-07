# libra prototype

## Purpose

`libra` is a bedside AAC helper for short, high-signal communication between a patient and nearby family or care staff.

It is not a hospital system replacement and does not replace a nurse call. The prototype is intentionally local, static, and tablet-first.

## Prototype scope (historical)

This is the scope of the first prototype, kept as a record. It is not the current specification; see `docs/requirements.md` and `docs/features.md`.

- Two entry paths: urgent and slow
- Large tiles that can be read at bedside distance
- One-tap phrase display for urgent messages
- Slow menus for pain location, discomfort, mood, and a small letter board
- Speech mode switch: off, sound only, short speech, full speech
- Automatic scanning with Space / Enter activation
- Keyboard shortcuts: number keys activate visible tiles, Escape goes back

Current state: home starts with Emergency, then yes / no, discomfort, comfort / requests, letter board (and optional Morse input). Any key / Bluetooth shutter runs the current scan target and a direct tap runs the tapped tile. Number keys 1-9 work only with `?dev` in the URL, and Escape is an ordinary key (a switch press), not "back".

## Next candidates

- ~~Persist settings in localStorage~~ (done)
- ~~Add editable phrase sets~~ (done: caregiver menu "フレーズ", #8)
- ~~Add scan speed controls~~ (done: caregiver menu "スキャン間隔")
- ~~Add actual PWA icons~~ (icons done; install copy is still open)
- ~~Add caregiver confirmation mode~~ (dropped: Emergency takes no confirmation step, requirements §4.3)
- Add Japanese / English display toggle
