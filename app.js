import { Player } from './player.js';

const elements = {
  status: document.querySelector('#status'),
  title: document.querySelector('#track-title'),
  file: document.querySelector('#track-file'),
  author: document.querySelector('#track-author'),
  year: document.querySelector('#track-year'),
  elapsed: document.querySelector('#elapsed'),
  play: document.querySelector('#play'),
  pause: document.querySelector('#pause'),
  stop: document.querySelector('#stop'),
  volume: document.querySelector('#volume'),
  volumeValue: document.querySelector('#volume-value'),
  subtune: document.querySelector('#subtune'),
  fileInput: document.querySelector('#music-file'),
  reference: document.querySelector('#load-reference'),
  error: document.querySelector('#error'),
};

const state = {
  status: 'stopped',
  position: 0,
  hasTrack: false,
  track: null,
  subtune: 0,
  busy: '',
  error: '',
};

let player;

function formatTime(seconds) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function render() {
  const unavailable = Boolean(state.busy) || !player;
  const ready = state.hasTrack && !unavailable;
  elements.play.disabled = !ready || !['stopped', 'paused'].includes(state.status);
  elements.pause.disabled = !ready || state.status !== 'playing';
  elements.stop.disabled = !ready || !['playing', 'paused'].includes(state.status);
  elements.fileInput.disabled = unavailable;
  elements.reference.disabled = unavailable;
  elements.volume.disabled = unavailable;
  elements.subtune.disabled = !ready || state.status === 'error' || state.track.subtuneCount < 2;
  if (!state.busy) elements.subtune.value = state.subtune ? String(state.subtune) : '';
  elements.elapsed.textContent = formatTime(state.position);

  const statusLabels = {
    playing: 'Playing',
    paused: 'Paused',
    stopped: 'Stopped',
    loading: 'Loading…',
    error: 'Unable to play',
  };
  const status = state.busy || (state.status === 'error'
    ? statusLabels.error
    : state.hasTrack ? statusLabels[state.status] : 'No track loaded');
  // Do not repeatedly update the live region as the playback clock advances.
  if (elements.status.textContent !== status) elements.status.textContent = status;

  elements.title.textContent = state.track?.title || 'Your next listen';
  elements.file.textContent = state.track?.filename || 'Choose a local file or try the reference track.';
  elements.author.textContent = state.track?.author || '—';
  elements.year.textContent = state.track?.year || '—';
  elements.error.textContent = state.error;
  elements.error.hidden = !state.error;
}

function reportError(error) {
  state.status = 'error';
  state.error = error instanceof Error && error.message
    ? error.message
    : typeof error === 'string' && error ? error : 'Something went wrong. Please load the track again.';
  render();
}

function onState({ status, position, error }) {
  state.status = status;
  if (Number.isFinite(position)) state.position = Math.max(0, position);
  if (status === 'error') {
    reportError(error || 'Playback failed. Please load the track again.');
    return;
  }
  render();
}

async function runOperation(label, operation) {
  if (state.busy || !player) return;
  state.busy = label;
  state.error = '';
  render();
  try {
    await operation();
  } catch (error) {
    reportError(error);
  } finally {
    state.busy = '';
    render();
  }
}

function metadataText(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

async function loadTrack(filename, readBuffer) {
  await runOperation('Loading…', async () => {
    if (state.hasTrack) await player.stop();
    state.hasTrack = false;
    state.subtune = 0;
    elements.subtune.replaceChildren();
    state.position = 0;
    state.status = 'loading';
    state.track = { filename, title: filename, author: '', year: '' };
    render();
    const buffer = await readBuffer();
    const metadata = await player.load(buffer);
    state.track = {
      filename,
      title: metadataText(metadata.title) || filename,
      author: metadataText(metadata.author),
      year: metadataText(metadata.year),
      subtuneCount: metadata.subtuneCount,
    };
    for (let subtune = 1; subtune <= metadata.subtuneCount; subtune++) {
      const option = document.createElement('option');
      option.value = String(subtune);
      option.textContent = `Subtune ${subtune} of ${metadata.subtuneCount}${subtune === metadata.defaultSubtune ? ' (default)' : ''}`;
      elements.subtune.append(option);
    }
    state.subtune = metadata.defaultSubtune;
    state.hasTrack = true;
    state.status = 'stopped';
    state.position = 0;
  });
}

const transports = [
  [elements.play, 'Starting…', 'playing', () => player.play()],
  [elements.pause, 'Pausing…', 'paused', () => player.pause()],
  [elements.stop, 'Stopping…', 'stopped', () => player.stop()],
];

for (const [button, label, status, operation] of transports) {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    void runOperation(label, async () => {
      await operation();
      state.status = status;
      if (status === 'stopped') state.position = 0;
    });
  });
}

elements.subtune.addEventListener('change', () => {
  const subtune = Number(elements.subtune.value);
  if (subtune === state.subtune) return;
  void runOperation('Switching subtune…', async () => {
    await player.selectSubtune(subtune);
    state.subtune = subtune;
  });
});

elements.fileInput.addEventListener('change', () => {
  const file = elements.fileInput.files[0];
  elements.fileInput.value = '';
  if (!file) return;
  void loadTrack(file.name, () => file.arrayBuffer());
});

elements.reference.addEventListener('click', () => {
  void loadTrack('Comic_Bakery.sndh', async () => {
    const response = await fetch(new URL('./sndh_lf/Mad_Max/Demos/Cuddly_Demos/Comic_Bakery.sndh', import.meta.url));
    if (!response.ok) throw new Error(`Could not load Comic Bakery (HTTP ${response.status}).`);
    return response.arrayBuffer();
  });
});

elements.volume.addEventListener('input', () => {
  const volume = Number(elements.volume.value);
  elements.volumeValue.textContent = `${Math.round(volume * 100)}%`;
  try {
    player.setVolume(volume);
  } catch (error) {
    reportError(error);
  }
});

try {
  player = new Player(onState);
  player.setVolume(0.7);
} catch (error) {
  reportError(error);
}
render();
