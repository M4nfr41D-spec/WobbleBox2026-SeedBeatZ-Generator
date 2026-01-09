# WobbleBox v6 (LFO Upgrade)

Browser-based, seed-driven drum machine + wobble/acid bass for **Acid / Acid Trance / Dark Trance / Dark Techno**.

## Run
- **Standalone:** open `dist/wobblebox-single.html` (works via `file://`).
- **Modular (recommended):** serve this folder with any static server and open `index.html`
  - Example: `python -m http.server` then open `http://localhost:8000/`

## New in v6
- **LFO Wave** (sine/triangle/square/saw)
- **LFO Filter** (smoothing LPF for the modulation signal)
- **LFO Target** (filter / amp / both)

## Exports
- WAV mixdown (offline render)
- MIDI (GM-ish mapping)
- Project JSON (seed stack + patterns + settings)

## Notes
- First press of **Play** must be a user gesture to unlock AudioContext in modern browsers.
- Seeds are reproducible; edit Layer seeds and offsets to stack ideas.
