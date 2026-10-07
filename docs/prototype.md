# libra prototype

## Purpose

`libra` is a bedside AAC helper for short, high-signal communication between a patient and nearby family or care staff.

It is not a hospital system replacement and does not replace a nurse call. The prototype is intentionally local, static, and tablet-first.

## Prototype scope

This file records the scope of the first prototype. It is historical; the current specification is `docs/requirements.md` and the implemented feature list is in `docs/features.md`.

- Entry paths: home starts with Emergency, then yes / no, discomfort, comfort / requests, letter board (and optional Morse input)
- Large tiles that can be read at bedside distance
- Phrase display for each choice, with an always-visible message area
- Speech mode switch: off, sound only, short speech, full speech
- Always-on automatic scanning; any key / Bluetooth shutter runs the current scan target, and a direct tap runs the tapped tile
- Number keys 1-9 activate visible tiles only with `?dev` in the URL

## Next candidates

- ~~Persist settings in localStorage~~ (done)
- ~~Add editable phrase sets~~ (done: caregiver menu "フレーズ", #8)
- ~~Add scan speed controls~~ (done: caregiver menu "スキャン間隔")
- ~~Add actual PWA icons~~ (icons done; install copy is still open)
- Add Japanese / English display toggle
