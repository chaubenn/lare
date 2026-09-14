// AudioContext runs at 16 kHz; the browser resamples device input before this tap.
class MicrophonePcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.paused = true;
    this.buffer = new Float32Array(4096);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data.paused) this.flush();
      this.paused = event.data.paused;
      if (event.data.flush) this.port.postMessage({ flushed: true });
    };
  }
  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage(samples, [samples.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!this.paused && channels && channels.length) {
      for (let i = 0; i < channels[0].length; i++) {
        let sample = 0;
        for (const channel of channels) sample += channel[i] / channels.length;
        this.buffer[this.offset++] = sample;
        if (this.offset === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("microphone-pcm", MicrophonePcm);
