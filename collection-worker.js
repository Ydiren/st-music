// File objects and directory handles stay in this worker. Song bytes are read
// only on selection, never while discovering a collection.
const sources = new Map();
const supported = /\.(sndh|snd|ym)$/i;
let nextId = 0;
let batch = [];
let scanned = 0;

function flush() {
  self.postMessage({ type: 'entries', entries: batch, scanned });
  batch = [];
}

function discover(path, source) {
  scanned++;
  if (supported.test(path)) {
    const id = nextId++;
    sources.set(id, source);
    batch.push({ id, path });
  }
  // Report progress even in folders containing only unrelated files.
  if (scanned % 100 === 0) flush();
}

async function scanDirectory(root) {
  const pending = [{ directory: root, prefix: '' }];
  while (pending.length) {
    const { directory, prefix } = pending.pop();
    for await (const [name, handle] of directory.entries()) {
      const path = prefix + name;
      if (handle.kind === 'directory') pending.push({ directory: handle, prefix: path + '/' });
      else if (handle.kind === 'file') discover(path, handle);
    }
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'scan') {
    try {
      if (data.directory) {
        await scanDirectory(data.directory);
      } else {
        for (const { file, path: relative } of data.files) {
          // Preserve relative paths explicitly across File structured cloning.
          const path = relative.includes('/') ? relative.slice(relative.indexOf('/') + 1) : relative;
          discover(path, file);
        }
      }
      flush();
      self.postMessage({ type: 'done', scanned });
    } catch (error) {
      flush();
      self.postMessage({ type: 'scan-error', error: error.message });
    }
  } else if (data.type === 'read') {
    try {
      const source = sources.get(data.id);
      if (!source) throw new Error('This collection entry is no longer available.');
      const file = source.kind === 'file' ? await source.getFile() : source;
      const buffer = await file.arrayBuffer();
      self.postMessage({ type: 'read', request: data.request, buffer }, [buffer]);
    } catch (error) {
      self.postMessage({ type: 'read', request: data.request, error: error.message });
    }
  }
};
