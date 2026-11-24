// AudioWorklet: converts the mic stream (usually 44.1/48 kHz float32) into
// 16 kHz mono PCM16 chunks of 100 ms and posts them to the main thread together
// with an RMS level for the input meter.
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.chunk = new Int16Array(1600); // 100 ms @ 16 kHz
    this.idx = 0;
    this.acc = 0;   // running sum for box-filter averaging
    this.cnt = 0;
    this.phase = 0;
    this.sq = 0;    // sum of squares for RMS
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.cnt++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.acc / this.cnt));
        this.acc = 0;
        this.cnt = 0;
        this.sq += s * s;
        this.chunk[this.idx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.idx === this.chunk.length) {
          const level = Math.sqrt(this.sq / this.chunk.length);
          this.port.postMessage({ pcm: this.chunk.buffer, level }, [this.chunk.buffer]);
          this.chunk = new Int16Array(1600);
          this.idx = 0;
          this.sq = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
