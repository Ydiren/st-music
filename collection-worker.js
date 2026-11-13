import createAtariAudio from './generated/atari-audio.js';
import { archiveEntries, readArchiveEntry } from './zip-archive.js';

const PAGE_SIZE = 100;
const sources = new Map();
const entries = [];
const identities = new Map();
const supported = /\.(sndh|snd|ym)$/i;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
let engine;
let scanned = 0;
let unavailable = 0;
let scanning = false;
let failed = false;
let lastPublish = 0;
let query = { revision: 0, text: '', sort: 'path', direction: 'asc', page: 0 };
let cachedView;

function matchesAndSorts() {
  const key = JSON.stringify([query.text, query.sort, query.direction, entries.length]);
  if (cachedView?.key === key) return cachedView.entries;
  const terms = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = entries.filter(entry => terms.every(term => entry.search.includes(term)));
  const field = query.sort;
  const direction = query.direction === 'desc' ? -1 : 1;
  matches.sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    const aMissing = av === null || av === '';
    const bMissing = bv === null || bv === '';
    // Unknown values stay last in both directions, rather than looking like 0.
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    const comparison = aMissing ? 0 : field === 'subtuneCount' ? av - bv : collator.compare(av, bv);
    return comparison * direction || collator.compare(a.path, b.path) || a.id - b.id;
  });
  cachedView = { key, entries: matches };
  return matches;
}

function publish() {
  const matches = matchesAndSorts();
  const page = Math.min(query.page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
  const start = page * PAGE_SIZE;
  self.postMessage({
    type: 'view', revision: query.revision, page,
    total: entries.length, matched: matches.length, scanned, scanning, failed, unavailable,
    entries: matches.slice(start, start + PAGE_SIZE).map(({ search, ...entry }) => entry),
  });
  lastPublish = performance.now();
}

async function initializeEngine() {
  const response = await fetch(new URL('./generated/atari-audio.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Could not load the metadata engine (${response.status}). Run npm run build first.`);
  engine = await createAtariAudio({ wasmBinary: await response.arrayBuffer() });
}

async function getFile(source) {
  return source.kind === 'file' ? source.getFile() : source;
}

async function sourceBytes(source) {
  if (source.zipEntry) return readArchiveEntry(source.zipEntry, engine.HEAPU8.byteLength);
  if (source.archive) {
    let memberIndex = 0;
    for await (const entry of archiveEntries(await getFile(source.archive))) {
      if (memberIndex++ === source.memberIndex && !entry.directory && entry.filename === source.memberPath) {
        return readArchiveEntry(entry, engine.HEAPU8.byteLength);
      }
    }
    throw new Error('The ZIP member is no longer available.');
  }
  return new Uint8Array(await (await getFile(source)).arrayBuffer());
}

async function contentId(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function metadata(bytes) {
  const pointer = engine._malloc(bytes.length);
  if (!pointer) throw new Error('Not enough engine memory to inspect this file.');
  try {
    engine.HEAPU8.set(bytes, pointer);
    if (!engine._inspect_song(pointer, bytes.length, 48000)) throw new Error('Metadata unavailable: unrecognized music data.');
    return {
      title: engine.UTF8ToString(engine._song_title()).trim(),
      author: engine.UTF8ToString(engine._song_author()).trim(),
      year: engine.UTF8ToString(engine._song_year()).trim(),
      subtuneCount: engine._subtune_count() || null,
    };
  } finally {
    engine._unload_song();
    engine._free(pointer);
  }
}

async function discover(path, source, provenance = {}) {
  scanned++;
  if (!provenance.archivePath && /\.zip$/i.test(path)) {
    try {
      let memberIndex = 0;
      for await (const entry of archiveEntries(await getFile(source))) {
        // Nested ZIPs and non-music members are deliberately not extracted.
        if (!entry.directory && supported.test(entry.filename)) {
          await discover(`${path} :: ${entry.filename}`, { zipEntry: entry, archive: source, memberPath: entry.filename, memberIndex }, {
            archivePath: path, memberPath: entry.filename,
          });
        }
        memberIndex++;
      }
    } catch (error) {
      self.postMessage({ type: 'archive-error', path, error: error.message });
    }
  }
  if (supported.test(path)) {
    let bytes;
    let identity;
    let info;
    let metadataError = '';
    try {
      bytes = await sourceBytes(source);
      identity = await contentId(bytes);
    } catch (error) {
      // Unreadable content has no identity; never merge it by path or metadata.
      metadataError = error.message;
    }
    const location = { path, ...provenance };
    const playbackSource = source.zipEntry
      ? { archive: source.archive, memberPath: source.memberPath, memberIndex: source.memberIndex } : source;
    const duplicate = identities.get(identity);
    if (duplicate) {
      duplicate.locations.push(location);
      duplicate.search += '\n' + path.toLowerCase();
      sources.get(duplicate.id).locations.push({ path, source: playbackSource });
      cachedView = undefined;
    } else {
      const id = entries.length;
      try {
        if (!bytes) throw new Error(metadataError);
        info = metadata(bytes);
      } catch (error) {
        // Keep unreadable tracks discoverable without assigning a false identity.
        info = { title: '', author: '', year: '', subtuneCount: null };
        metadataError = error.message;
        unavailable++;
      }
      const entry = { id, path, ...info, metadataError, locations: [location] };
      entry.search = [entry.title, entry.author, entry.year, entry.subtuneCount ?? '', path].join('\n').toLowerCase();
      entries.push(entry);
      sources.set(id, { identity, locations: [{ path, source: playbackSource }] });
      if (identity) identities.set(identity, entry);
    }
  }
  if (performance.now() - lastPublish >= 100) publish();
  // Allow queries and read requests through even in mostly non-music folders.
  if (scanned % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
}

async function scanDirectory(root) {
  const pending = [{ directory: root, prefix: '' }];
  while (pending.length) {
    const { directory, prefix } = pending.pop();
    for await (const [name, handle] of directory.entries()) {
      const path = prefix + name;
      if (handle.kind === 'directory') pending.push({ directory: handle, prefix: path + '/' });
      else if (handle.kind === 'file') await discover(path, handle);
    }
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'scan') {
    scanning = true;
    publish();
    try {
      await initializeEngine();
      if (data.directory) {
        await scanDirectory(data.directory);
      } else {
        for (const { file, path: relative } of data.files) {
          // Preserve relative paths explicitly across File structured cloning.
          const path = relative.includes('/') ? relative.slice(relative.indexOf('/') + 1) : relative;
          await discover(path, file);
        }
      }
    } catch (error) {
      failed = true;
      self.postMessage({ type: 'scan-error', error: error.message });
    } finally {
      scanning = false;
      publish();
    }
  } else if (data.type === 'query') {
    query = { revision: data.revision, text: data.text, sort: data.sort, direction: data.direction, page: data.page };
    publish();
  } else if (data.type === 'read') {
    try {
      const track = sources.get(data.id);
      if (!track) throw new Error('This collection entry is no longer available.');
      let buffer;
      const errors = [];
      for (const { path, source } of track.locations) {
        try {
          const bytes = await sourceBytes(source);
          if (track.identity && await contentId(bytes) !== track.identity) {
            throw new Error('Contents changed since indexing. Reselect the folder to index this version.');
          }
          buffer = bytes.buffer;
          break;
        } catch (error) {
          errors.push(`${path}: ${error.message}`);
        }
      }
      if (!buffer) throw new Error(`No source could be loaded:\n${errors.join('\n')}`);
      self.postMessage({ type: 'read', request: data.request, buffer }, [buffer]);
    } catch (error) {
      self.postMessage({ type: 'read', request: data.request, error: error.message });
    }
  }
};
