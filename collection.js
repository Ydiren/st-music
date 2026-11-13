const PAGE_SIZE = 100;

export class CollectionBrowser {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this.entries = [];
    this.total = 0;
    this.matched = 0;
    this.page = 0;
    this.scanned = 0;
    this.unavailable = 0;
    this.scanning = false;
    this.waiting = false;
    this.busy = false;
    this.picking = false;
    this.sequence = 0;
    this.revision = 0;
    this.pending = new Map();
    this.renderedRows = '';
    this.elements = Object.fromEntries([
      'choose-folder', 'folder-files', 'collection-status', 'collection-error',
      'collection-list', 'collection-previous', 'collection-next', 'collection-page',
      'collection-search', 'collection-sort', 'collection-order', 'collection-empty',
    ].map(id => [id, document.getElementById(id)]));

    this.elements['choose-folder'].hidden = typeof window.showDirectoryPicker !== 'function';
    this.elements['choose-folder'].addEventListener('click', () => this.chooseFolder());
    this.elements['folder-files'].addEventListener('change', event => {
      const files = Array.from(event.target.files, file => ({
        file, path: file.webkitRelativePath || file.name,
      }));
      event.target.value = '';
      if (!files.length) return;
      const root = files[0].path.includes('/') ? files[0].path.split('/')[0] : 'Selected folder';
      this.start(root, { files });
    });
    this.elements['collection-search'].addEventListener('input', () => this.requestView(0));
    for (const id of ['collection-sort', 'collection-order']) {
      this.elements[id].addEventListener('change', () => this.requestView(0));
    }
    this.elements['collection-previous'].addEventListener('click', () => this.requestView(this.page - 1));
    this.elements['collection-next'].addEventListener('click', () => this.requestView(this.page + 1));
    this.elements['collection-list'].addEventListener('click', event => {
      const button = event.target.closest('button[data-entry]');
      if (!button || button.disabled) return;
      const entry = this.entries.find(entry => entry.id === Number(button.dataset.entry));
      if (!entry) return;
      const worker = this.worker;
      void this.onSelect(entry.path, () => this.read(entry.id, worker));
    });
    this.render();
  }

  setBusy(busy) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.updateControls();
  }

  updateControls() {
    this.elements['choose-folder'].disabled = this.busy || this.picking;
    this.elements['folder-files'].disabled = this.busy || this.picking;
    this.elements['collection-previous'].disabled = this.waiting || this.page === 0;
    this.elements['collection-next'].disabled = this.waiting || (this.page + 1) * PAGE_SIZE >= this.matched;
    this.elements['collection-list'].setAttribute('aria-busy', String(this.waiting));
    for (const button of this.elements['collection-list'].querySelectorAll('button')) {
      button.disabled = this.busy || this.waiting || !this.worker;
    }
  }

  showError(message = '') {
    this.elements['collection-error'].textContent = message;
    this.elements['collection-error'].hidden = !message;
  }

  async chooseFolder() {
    if (this.busy || this.picking) return;
    this.picking = true;
    this.updateControls();
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read' });
      this.start(directory.name, { directory });
    } catch (error) {
      if (error.name !== 'AbortError') this.showError(`${error.message} You can also use the folder selection below.`);
    } finally {
      this.picking = false;
      this.updateControls();
    }
  }

  start(root, source) {
    this.worker?.terminate();
    this.rejectReads(new Error('The collection was replaced. Select a track from the new folder.'));
    this.entries = [];
    this.total = 0;
    this.matched = 0;
    this.page = 0;
    this.scanned = 0;
    this.unavailable = 0;
    this.archiveErrors = [];
    this.root = root;
    this.scanning = true;
    this.failed = false;
    this.renderedRows = '';
    this.elements['collection-list'].replaceChildren();
    this.showError();
    const worker = new Worker(new URL('./collection-worker.js', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;
      if (data.type === 'view') {
        // A previous search or page response must never replace newer results.
        if (data.revision !== this.revision) return;
        this.waiting = false;
        this.entries = data.entries;
        this.total = data.total;
        this.matched = data.matched;
        this.page = data.page;
        this.scanned = data.scanned;
        this.unavailable = data.unavailable;
        this.scanning = data.scanning;
        this.failed = data.failed;
        this.scheduleRender();
      } else if (data.type === 'scan-error') {
        this.showError(`Could not finish indexing the folder: ${data.error}`);
      } else if (data.type === 'archive-error') {
        this.archiveErrors.push(`Could not index ZIP ${data.path}: ${data.error}`);
        this.showError(this.archiveErrors.join('\n'));
      } else if (data.type === 'read') {
        const request = this.pending.get(data.request);
        if (!request) return;
        this.pending.delete(data.request);
        if (data.error) request.reject(new Error(data.error));
        else request.resolve(data.buffer);
      }
    };
    worker.onerror = event => {
      if (worker !== this.worker) return;
      event.preventDefault();
      this.scanning = false;
      this.waiting = false;
      this.failed = true;
      const error = new Error(event.message || 'The collection worker stopped unexpectedly. Select the folder again.');
      this.showError(error.message);
      this.rejectReads(error);
      worker.terminate();
      this.worker = null;
      this.scheduleRender();
    };
    worker.postMessage({ type: 'scan', ...source });
    this.requestView(0);
  }

  requestView(page) {
    if (!this.worker) return;
    this.waiting = true;
    this.worker.postMessage({
      type: 'query', revision: ++this.revision, page,
      text: this.elements['collection-search'].value,
      sort: this.elements['collection-sort'].value,
      direction: this.elements['collection-order'].value,
    });
    this.render();
  }

  read(id, worker) {
    if (!worker || worker !== this.worker) return Promise.reject(new Error('Select a track from an available collection.'));
    return new Promise((resolve, reject) => {
      const request = ++this.sequence;
      this.pending.set(request, { resolve, reject });
      worker.postMessage({ type: 'read', id, request });
    });
  }

  rejectReads(error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  render() {
    const status = !this.root ? 'No folder selected.'
      : this.scanning ? `Indexing ${this.root}: ${this.scanned} files checked, ${this.total} unique tracks indexed…`
      : this.failed ? `${this.root}: indexing incomplete; ${this.total} unique tracks available.`
      : this.total ? `${this.root}: ${this.total} unique tracks indexed.`
      : `${this.root}: no SNDH, SND, or YM files found.`;
    const summary = this.unavailable ? `${status} Metadata unavailable for ${this.unavailable} file${this.unavailable === 1 ? '' : 's'}.` : status;
    const statusElement = this.elements['collection-status'];
    if (statusElement.textContent !== summary) statusElement.textContent = summary;
    const signature = this.entries.map(entry => `${entry.id}:${entry.locations.length}`).join(',');
    if (signature !== this.renderedRows) {
      const fragment = document.createDocumentFragment();
      for (const entry of this.entries) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.entry = String(entry.id);
        const title = document.createElement('span');
        title.className = 'collection-track-title';
        title.textContent = entry.title || 'Unknown title';
        const credits = document.createElement('span');
        credits.className = 'collection-track-metadata';
        credits.textContent = `Composer: ${entry.author || 'Unknown'} · Year: ${entry.year || 'Unknown'} · Subtunes: ${entry.subtuneCount ?? 'Unknown'}`;
        const path = document.createElement('span');
        path.className = 'collection-track-path';
        path.textContent = entry.locations.map(location => location.archivePath
          ? `ZIP: ${location.archivePath}\nFile: ${location.memberPath}` : location.path).join('\n');
        if (entry.locations.length > 1) {
          const count = document.createElement('span');
          count.className = 'collection-track-metadata';
          count.textContent = `${entry.locations.length} source locations`;
          button.append(count);
        }
        button.append(title, credits, path);
        if (entry.metadataError) {
          const warning = document.createElement('span');
          warning.className = 'collection-track-warning';
          warning.textContent = 'Metadata unavailable';
          warning.title = entry.metadataError;
          button.append(warning);
        }
        item.append(button);
        fragment.append(item);
      }
      this.elements['collection-list'].replaceChildren(fragment);
      this.renderedRows = signature;
    }
    const start = this.page * PAGE_SIZE;
    this.elements['collection-page'].textContent = this.matched
      ? `${start + 1}–${start + this.entries.length} of ${this.matched} matches (${this.total} unique tracks)`
      : `0 matches (${this.total} unique tracks)`;
    this.elements['collection-empty'].hidden = !this.root || this.entries.length > 0 || this.waiting;
    this.elements['collection-empty'].textContent = this.scanning
      ? 'No matches yet. Metadata indexing is still running.' : 'No matching music files.';
    this.updateControls();
  }
}
