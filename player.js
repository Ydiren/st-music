export class Player {
  constructor(onState = () => {}) {
    this.onState = onState;
    this.status = 'stopped';
    this.position = 0;
    this.volume = 0.7;
    this.sequence = 0;
    this.pending = new Map();
    this.initializing = null;
  }

  emit(status = this.status, error) {
    this.status = status;
    this.onState({ status, position: this.position, ...(error ? { error } : {}) });
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      this.context = new AudioContext({ latencyHint: 'playback' });
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
      const response = await fetch(new URL('./generated/atari-audio.wasm', import.meta.url));
      if (!response.ok) throw new Error(`Could not load the audio engine (${response.status}). Run npm run build first.`);
      const buffer = await response.arrayBuffer();
      await this.context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.context, 'atari-audio', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      this.node.port.onmessage = ({ data }) => {
        const request = this.pending.get(data.id);
        if (request) {
          this.pending.delete(data.id);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve(data);
        } else if (data.error) {
          this.emit('error', data.error);
        } else if (data.position !== undefined) {
          this.position = data.position;
          this.emit();
        }
      };
      this.node.onprocessorerror = () => {
        const error = new Error('The audio processor stopped unexpectedly. Reload the page to restart it.');
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        this.emit('error', error.message);
      };
      this.node.connect(this.gain);
      await this.request('initialize', { buffer });
    })();
    try {
      await this.initializing;
    } catch (error) {
      this.node?.disconnect();
      await this.context?.close();
      this.initializing = null;
      throw error;
    }
  }

  request(command, { buffer, subtune } = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.node.port.postMessage({ id, command, buffer, subtune }, buffer ? [buffer] : []);
    });
  }

  async load(buffer) {
    this.emit('loading');
    try {
      await this.initialize();
      const { result } = await this.request('load', { buffer });
      this.position = 0;
      this.emit('stopped');
      return result;
    } catch (error) {
      this.emit('error', error.message);
      throw error;
    }
  }

  async play() {
    try {
      if (!this.node) throw new Error('Load a music file first.');
      await this.context.resume();
      await this.request('play');
      this.emit('playing');
    } catch (error) {
      this.emit('error', error.message);
      throw error;
    }
  }

  async pause() {
    try {
      const { position } = await this.request('pause');
      await this.context.suspend();
      this.position = position;
      this.emit('paused');
    } catch (error) {
      this.emit('error', error.message);
      throw error;
    }
  }

  async stop() {
    try {
      await this.request('stop');
      await this.context.suspend();
      this.position = 0;
      this.emit('stopped');
    } catch (error) {
      this.emit('error', error.message);
      throw error;
    }
  }

  async selectSubtune(subtune) {
    try {
      await this.request('select-subtune', { subtune });
      this.position = 0;
      this.emit();
    } catch (error) {
      this.emit('error', error.message);
      throw error;
    }
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gain) this.gain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.01);
  }
}
