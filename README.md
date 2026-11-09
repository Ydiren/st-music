# ST Music

A local-file Atari ST music player for the browser, using Arnaud Carré's
[AtariAudio](https://github.com/arnaud-carre/AtariAudio).

## Run

Requirements: Node.js 20+, Git, and Emscripten 7+ (`em++` on your PATH).
On macOS with Homebrew:

```sh
brew install node emscripten
npm run build
npm start
```

Open http://127.0.0.1:5173. Click **Load Comic Bakery**, then **Play**.
Alternatively, select a local SNDH, SND, or YM file. Pause preserves the emulated
position; Stop resets the selected subtune. Volume changes affect output gain,
not the emulated chip registers. Playback never starts automatically.

The Subtune dropdown lists the songs reported by AtariAudio and marks the
file's default. Switching starts the chosen subtune at 0:00: playing continues,
paused stays paused, and stopped stays stopped. Stop keeps your selection.
For single-subtune files, the dropdown shows the sole entry and is disabled.

Try `sndh_lf/Mad_Max/Games/Wings_Of_Death.sndh` for nine selectable subtunes.

The reference button reads the existing file at
`sndh_lf/Mad_Max/Demos/Cuddly_Demos/Comic_Bakery.sndh`; the build does not copy or
bundle any music. The file picker also works without that reference collection.
Selected files are read in memory and are not uploaded or persisted.

No npm dependencies or `npm install` are needed. The first build downloads the
pinned AtariAudio revision into `vendor/AtariAudio`; later builds reuse it and
reject a different revision. Generated engine assets live in `generated/`.
`EMXX` can specify a different compiler executable. `PORT` changes the local
server port.

If an older Node installation shadows Homebrew's, use
`export PATH="$(brew --prefix node)/bin:$PATH"` before running the commands.

## Implementation

- `native/bridge.cpp`: small C interface around the AtariAudio renderer.
- `scripts/build.mjs`: pinned dependency acquisition and WebAssembly compilation.
- `audio-worklet.js`: owns the engine and renders signed 16-bit mono PCM at the
  AudioContext's actual sample rate, converting to browser floating-point audio.
  Its render path reuses the engine's output buffer and does not allocate sample
  arrays per block. Fixed 64 MiB WebAssembly memory avoids growth during rendering.
- `player.js`: transport commands, position reporting, and smoothed output gain.
- `app.js`, `index.html`, `style.css`: local loading, credits, and transport UI.

WebAssembly bytes are fetched on the main thread and transferred to the
AudioWorklet for initialization; the worklet does not fetch resources itself.
Pause suspends the AudioContext after acknowledging the exact render position.
An explicit Play resumes it. Acknowledged Stop resets the engine before the UI
shows zero.

Use localhost or HTTPS: AudioWorklet requires a secure context. The development
server binds to loopback only and exposes files beneath this project directory;
it is not a production hosting configuration. For deployment, publish only app
files and `generated/`, including its third-party notices. Do not publish the
music collection without permission. Static hosting needs JavaScript and
`application/wasm` MIME types. No shared-memory/cross-origin-isolation headers
are required.

## Current scope and verification

This is the initial playback implementation, not the library/explorer release.
It loads the file's default subtune, supports numbered subtune selection, and
permits continuous looping. Queue/duration policies, folder/ZIP indexing,
visualization, mute/solo, and offline app caching are not yet implemented.

Browser smoke checks exercised Comic Bakery at 48 kHz through the actual
AudioWorklet: non-silent varying PCM, pause position preservation, resume, zero
volume producing silence, stop/reset/restart, local file selection, replacement
while paused, invalid-file errors, and recovery by loading a valid file. Desktop
and 390 px mobile layouts were visually checked in Chromium. No audio fidelity
claim is made from those checks; comparison against the STE remains manual.
Subtune browser checks exercised Wings of Death's nine-entry list, selection
while stopped/playing/paused, elapsed reset, audio output, Stop retaining the
selected subtune, and replacement by a single-subtune file. Desktop and mobile
selector layouts were visually checked. The user has additionally confirmed
sampled-sound SNDH, digi drums, and YM sampled playback by listening.
Compatibility with other browsers remains unverified.

AtariAudio is pinned to `5fd4b46b1a2a8fa776f8f0f68f648ef70c03ef10` (1.30).
See `THIRD_PARTY_NOTICES.txt` for engine licenses and credits. Music rights are
separate from software licenses.
