class DSQualityProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = Math.max(1, sampleRate / 32768);
    this.phase = [];
    this.held = [];
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] || input[0];
      let phase = this.phase[channel] || 0;
      let held = this.held[channel] || 0;
      for (let i = 0; i < output[channel].length; i++) {
        phase += 1;
        if (phase >= this.step) {
          phase -= this.step;
          held = source[i] || 0;
        }
        output[channel][i] = Math.round(held * 2047) / 2047;
      }
      this.phase[channel] = phase;
      this.held[channel] = held;
    }
    return true;
  }
}

registerProcessor("ds-quality", DSQualityProcessor);
