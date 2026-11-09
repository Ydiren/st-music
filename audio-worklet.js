import createAtariAudio from './generated/atari-audio.js';

class AtariProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = null;
    this.loaded = false;
    this.playing = false;
    this.frames = 0;
    this.reportFrames = 0;
    this.port.onmessage = ({ data }) => this.command(data);
  }

  async command({ id, command, buffer, subtune }) {
    try {
      let result;
      switch (command) {
        case 'initialize':
          this.engine = await createAtariAudio({ wasmBinary: buffer });
          break;
        case 'load': {
          this.playing = false;
          this.loaded = false;
          this.frames = 0;
          this.reportFrames = 0;
          const bytes = new Uint8Array(buffer);
          const pointer = this.engine._malloc(bytes.length);
          if (!pointer) throw new Error('Not enough engine memory for this file.');
          try {
            this.engine.HEAPU8.set(bytes, pointer);
            if (!this.engine._load_song(pointer, bytes.length, sampleRate)) {
              throw new Error('AtariAudio could not load this SNDH/YM file.');
            }
          } finally {
            this.engine._free(pointer);
          }
          this.loaded = true;
          result = {
            title: this.engine.UTF8ToString(this.engine._song_title()),
            author: this.engine.UTF8ToString(this.engine._song_author()),
            year: this.engine.UTF8ToString(this.engine._song_year()),
            subtuneCount: this.engine._subtune_count(),
            defaultSubtune: this.engine._default_subtune(),
          };
          break;
        }
        case 'select-subtune':
          if (!this.loaded || !Number.isInteger(subtune) || !this.engine._select_subtune(subtune)) {
            throw new Error('Could not select that subtune.');
          }
          this.frames = 0;
          this.reportFrames = 0;
          break;
        case 'play':
          if (!this.loaded) throw new Error('Load a music file first.');
          this.playing = true;
          break;
        case 'pause':
          this.playing = false;
          break;
        case 'stop':
          this.playing = false;
          if (!this.loaded || !this.engine._reset_song()) throw new Error('Could not reset the song.');
          this.frames = 0;
          this.reportFrames = 0;
          break;
        default:
          throw new Error(`Unknown audio command: ${command}`);
      }
      this.port.postMessage({ id, result, position: this.frames / sampleRate });
    } catch (error) {
      this.playing = false;
      this.port.postMessage({ id, error: error.message });
    }
  }

  process(inputs, outputs) {
    const channels = outputs[0];
    if (!this.playing || !channels.length) return true;
    const count = channels[0].length;
    try {
      const pointer = this.engine._render_audio(count);
      if (!pointer) throw new Error('Audio rendering failed.');
      const offset = pointer >>> 1;
      for (const channel of channels) {
        for (let i = 0; i < count; i++) channel[i] = this.engine.HEAP16[offset + i] / 32768;
      }
      this.frames += count;
      this.reportFrames += count;
      if (this.reportFrames >= sampleRate / 10) {
        this.reportFrames = 0;
        this.port.postMessage({ position: this.frames / sampleRate });
      }
    } catch (error) {
      this.playing = false;
      for (const channel of channels) channel.fill(0);
      this.port.postMessage({ error: error.message });
    }
    return true;
  }
}

registerProcessor('atari-audio', AtariProcessor);
