# ST Music

A local-file Atari ST music player for the browser, using Arnaud Carré's
[AtariAudio](https://github.com/arnaud-carre/AtariAudio).

## Run

Requirements: Node.js 20+, Git, and Emscripten 7+ (`em++` on your PATH).
On macOS with Homebrew:

```sh
brew install node emscripten
npm ci
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

Run `npm ci` to install the pinned ZIP reader from the lockfile. The first build
downloads the pinned AtariAudio revision into `vendor/AtariAudio`; later builds
reuse it and reject a different revision. Generated engine and ZIP assets,
including redistribution notices, live in `generated/`.
`EMXX` can specify a different compiler executable. `PORT` changes the local
server port.

If an older Node installation shadows Homebrew's, use
`export PATH="$(brew --prefix node)/bin:$PATH"` before running the commands.

## Browse a collection

In **Your collection**, use **Choose folder** for direct read-only directory
access when the browser provides it. Alternatively use **Select a folder
(compatible mode)**, which uses the browser's directory file input and is also
available when direct folder access is unsupported.

The scanner discovers `.sndh`, `.snd`, and `.ym` files in subfolders and inside
`.zip` archives, ignoring extension case. Each result shows embedded title,
composer, year, subtune count, and its source path. Archived tracks additionally
show the archive path and full member path; both participate in search/sorting.
Missing metadata is shown as Unknown; unreadable tracks remain listed with a
warning.

Search is case-insensitive and requires every whitespace-separated word to
match somewhere in the title, composer, year, subtune count, or path. Sort by
source path, title, composer, year, or subtune count, in either direction.
Numeric portions sort naturally, missing values stay last in both directions,
and ties use source path. Changing search or sort returns to the first page.
Results update while indexing continues, with at most 100 matches per page.
Select a result to load it into the existing transport, then press Play.
Browsing, searching, sorting, and indexing do not stop current playback;
explicitly loading a different track does.

Indexing and queries run in a dedicated Web Worker. It reads one file at a time
and uses a separate AtariAudio instance to parse metadata without initializing
or executing the music's replay code. Temporary file bytes and parser data are
released after inspection; only metadata and source references are indexed.
Selecting a track reads its bytes again for playback. ZIPs are read by byte
ranges, not buffered as whole archives; music members are extracted individually
for inspection and re-extracted on selection. Extracted bytes are discarded
after use, not cached or written into persistent browser storage. The app does
not upload music or retain the collection across visits. Reselect the folder
after refreshing. Deduplication and catalog persistence remain separate features.

Nested ZIPs are not traversed. Password-protected members remain visible but
cannot be played. Corrupt archives report their source paths and do not stop
other files from being indexed; member CRC failures appear as metadata/playback
errors rather than feeding damaged bytes into AtariAudio. Extraction checks
declared and actual output size and rejects members larger than the fixed audio
engine memory capacity.

## Implementation

- `native/bridge.cpp`: small C interface around the AtariAudio renderer.
- `scripts/build.mjs`: pinned dependency acquisition and WebAssembly compilation.
- `audio-worklet.js`: owns the engine and renders signed 16-bit mono PCM at the
  AudioContext's actual sample rate, converting to browser floating-point audio.
  Its render path reuses the engine's output buffer and does not allocate sample
  arrays per block. Fixed 64 MiB WebAssembly memory avoids growth during rendering.
- `player.js`: transport commands, position reporting, and smoothed output gain.
- `app.js`, `index.html`, `style.css`: local loading, credits, and transport UI.
- `collection.js`: folder selection, search/sort controls, paginated metadata
  results, and handoff to the transport. Stable entry IDs retain source identity
  after sorting; query revisions reject stale responses.
- `collection-worker.js`: recursive discovery, AtariAudio metadata inspection,
  cached filtering/sorting, and on-demand playback reads. Only the current page
  is sent to the UI. Fallback relative paths are sent explicitly because
  nonstandard File properties are not a reliable structured-cloning contract.
- `zip-archive.js`: range-based ZIP enumeration and bounded, CRC-checked member
  extraction, using zip.js 2.24.0 inside the existing collection worker.
- `scripts/zip-assets.mjs`: copies the self-contained ZIP module and license
  notices into `generated/`; no CDN or nested ZIP workers are required.

For playback, WebAssembly bytes are fetched on the main thread and transferred
to the AudioWorklet for initialization; the worklet does not fetch resources.
The collection worker independently loads the same generated engine for
metadata inspection, with separate state and memory from the audio renderer.
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
session-only searchable, sortable library of loose and ZIP-contained music.
Deduplication, persistence, queue/duration policies, visualization, mute/solo, and
offline app caching are not yet implemented.

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

Metadata-library smoke checks in Chromium indexed a 3,008-file fixture containing
real Mad Max, Count Zero, AN Cool, and YM music, plus malformed and missing-tag
examples. Checks covered live multi-word/case-insensitive search, numeric subtune
sorting (1, 9, 17), unknown values last, natural source-path ordering, pagination,
rapid replacement queries, empty results/clearing search, and correct result-to-
track/subtune loading. The isolated indexing run kept audio running with
non-silent PCM, at most 100 DOM rows, and no main-thread tasks over 50 ms.
Direct directory-handle metadata lookup and the FileList fallback were both
exercised; a 390 px layout was visually checked without horizontal overflow.

ZIP browser smoke checks indexed a 3,007-track mixed fixture containing stored
and deflated music, Unicode member paths, an unreadable archive, a bad-CRC
member, and a password-protected member. Healthy tracks remained searchable
and playable; identical member paths in different archives loaded the correct
music and subtunes. Tests verified nested ZIP exclusion, recovery after a
damaged track, FileList and real directory-handle paths, and a 390 px layout.
Indexing preserved running audio/non-silent PCM and recorded no main-thread
tasks over 50 ms. Browser-only fixtures were removed after verification.

Run `npm test` for the ZIP regression suite (Emscripten is not needed for these
tests). Independent fixtures cover stored/deflated members, Unicode names,
reading after enumeration closes, CRC corruption, output-capacity boundaries,
forged sizes, and truncated archives.

AtariAudio is pinned to `5fd4b46b1a2a8fa776f8f0f68f648ef70c03ef10` (1.30).
See `THIRD_PARTY_NOTICES.txt` for engine licenses and credits. Music rights are
separate from software licenses.
