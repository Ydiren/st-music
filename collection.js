const PAGE_SIZE = 100;

export class CollectionBrowser {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this.entries = [];
    this.page = 0;
    this.scanned = 0;
    this.scanning = false;
    this.busy = false;
    this.picking = false;
    this.sequence = 0;
    this.pending = new Map();
    this.renderedPage = -1;
    this.renderedLength = -1;
    this.elements = Object.fromEntries([
      'choose-folder', 'folder-files', 'collection-status', 'collection-error',
      'collection-list', 'collection-previous', 'collection-next', 'collection-page',
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
    this.elements['collection-previous'].addEventListener('click', () => {
      if (this.page > 0) { this.page--; this.render(); }
    });
    this.elements['collection-next'].addEventListener('click', () => {
      if ((this.page + 1) * PAGE_SIZE < this.entries.length) { this.page++; this.render(); }
    });
    this.elements['collection-list'].addEventListener('click', event => {
      const button = event.target.closest('button[data-entry]');
      if (!button || this.busy) return;
      const entry = this.entries[Number(button.dataset.entry)];
      const worker = this.worker;
      void this.onSelect(entry.path, () => this.read(entry.id, worker));
    });
    this.render();
  }

  setBusy(busy) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.updateControls();
    for (const button of this.elements['collection-list'].querySelectorAll('button')) button.disabled = busy;
  }

  updateControls() {
    this.elements['choose-folder'].disabled = this.busy || this.picking;
    this.elements['folder-files'].disabled = this.busy || this.picking;
    this.elements['collection-previous'].disabled = this.page === 0;
    this.elements['collection-next'].disabled = (this.page + 1) * PAGE_SIZE >= this.entries.length;
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
    this.page = 0;
    this.scanned = 0;
    this.root = root;
    this.scanning = true;
    this.failed = false;
    this.renderedPage = -1;
    this.showError();
    const worker = new Worker(new URL('./collection-worker.js', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;
      if (data.type === 'entries') {
        this.entries.push(...data.entries);
        this.scanned = data.scanned;
        this.scheduleRender();
      } else if (data.type === 'done' || data.type === 'scan-error') {
        this.scanning = false;
        this.failed = data.type === 'scan-error';
        if (this.failed) this.showError(`Could not finish reading the folder: ${data.error}`);
        this.scheduleRender();
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
      this.failed = true;
      const error = new Error(event.message || 'The collection worker stopped unexpectedly. Select the folder again.');
      this.showError(error.message);
      this.rejectReads(error);
      worker.terminate();
      this.worker = null;
      this.scheduleRender();
    };
    worker.postMessage({ type: 'scan', ...source });
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
    const count = this.entries.length;
    const status = !this.root ? 'No folder selected.'
      : this.scanning ? `Scanning ${this.root}: ${this.scanned} files checked, ${count} music files found…`
      : this.failed ? `${this.root}: scan incomplete; ${count} music files available.`
      : count ? `${this.root}: ${count} music files found.`
      : `${this.root}: no SNDH, SND, or YM files found.`;
    const statusElement = this.elements['collection-status'];
    if (statusElement.textContent !== status) statusElement.textContent = status;
    const start = this.page * PAGE_SIZE;
    const length = Math.min(PAGE_SIZE, count - start);
    if (this.renderedPage !== this.page || this.renderedLength !== length) {
      const fragment = document.createDocumentFragment();
      for (let index = start; index < start + length; index++) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.entry = String(index);
        button.textContent = this.entries[index].path;
        button.disabled = this.busy;
        item.append(button);
        fragment.append(item);
      }
      this.elements['collection-list'].replaceChildren(fragment);
      this.renderedPage = this.page;
      this.renderedLength = length;
    }
    this.elements['collection-page'].textContent = count ? `${start + 1}–${start + length} of ${count}` : '0 files';
    this.updateControls();
  }
}
