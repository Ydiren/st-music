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

## Browse a collection

In **Your collection**, use **Choose folder** for direct read-only directory
access when the browser provides it. Alternatively use **Select a folder
(compatible mode)**, which uses the browser's directory file input and is also
available when direct folder access is unsupported.

The scanner discovers `.sndh`, `.snd`, and `.ym` files recursively, ignoring
extension case. The list shows paths relative to the selected root, in discovery
order, with 100 tracks per page. Select a track to load its metadata and subtunes
into the existing player, then press Play. Browsing or scanning does not stop
current playback; explicitly loading a different track does.

Discovery runs in a dedicated Web Worker. The worker retains file references
and reads song bytes only when selected. The app does not upload music, copy it
into browser storage, or retain the collection across visits. Reselect the folder
after refreshing. ZIP discovery, metadata search/sorting, deduplication, and
catalog persistence remain separate features.

## Implementation

- `native/bridge.cpp`: small C interface around the AtariAudio renderer.
- `scripts/build.mjs`: pinned dependency acquisition and WebAssembly compilation.
- `audio-worklet.js`: owns the engine and renders signed 16-bit mono PCM at the
  AudioContext's actual sample rate, converting to browser floating-point audio.
  Its render path reuses the engine's output buffer and does not allocate sample
  arrays per block. Fixed 64 MiB WebAssembly memory avoids growth during rendering.
- `player.js`: transport commands, position reporting, and smoothed output gain.
- `app.js`, `index.html`, `style.css`: local loading, credits, and transport UI.
- `collection.js`: folder selection, paginated source-path browsing, and handoff
  to the transport.
- `collection-worker.js`: recursive discovery, file reference indexing, and
  on-demand music reads. Fallback relative paths are sent explicitly because
  nonstandard File properties are not a reliable structured-cloning contract.

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

Playback supports numbered subtune selection and continuous looping, with a
session-only folder browser. Metadata search/sorting, ZIP indexing,
deduplication, persistence, queue/duration policies, visualization, mute/solo,
and offline app caching are not yet implemented.

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

Collection smoke checks in Chromium used a 3,004-track nested fixture with real
browser FileSystemDirectoryHandles and a FileList fallback. Both paths loaded
Wings of Death with its nine subtunes. During scanning, playback remained running,
only 100 rows were mounted, and no main-thread tasks over 50 ms were recorded.
Checks also covered extension case, ignoring non-music files, pagination,
replacement, empty collections, picker cancellation, the direct-API-absent
fallback, and a 390 px layout without horizontal overflow. The directory-handle
fixture used temporary origin-private storage; the FileList fixture was supplied
programmatically. Native OS chooser interaction and Firefox/Safari remain manual
verification items; these checks do not claim to exercise those permission UIs.

AtariAudio is pinned to `5fd4b46b1a2a8fa776f8f0f68f648ef70c03ef10` (1.30).
See `THIRD_PARTY_NOTICES.txt` for engine licenses and credits. Music rights are
separate from software licenses.
