/* AudioWorklet global scope; the tap passes the actual post-gain output unchanged. */
const MAX_CAPTURE_SECONDS = 5;
class RuntimePCMTap extends globalThis.AudioWorkletProcessor {
  constructor() {
    super();
    this.capture = null;
    this.offset = 0;
    this.port.onmessage = this.receive.bind(this);
  }
  receive(event) {
    const frames = event?.data?.frames;
    if (
      !Number.isInteger(frames) ||
      frames < 1 ||
      frames > globalThis.sampleRate * MAX_CAPTURE_SECONDS ||
      this.capture
    ) {
      this.capture = null;
      this.offset = 0;
      this.port.postMessage({ error: "Invalid or overlapping PCM capture" });
      return;
    }
    this.capture = new Float32Array(frames * 2);
    this.offset = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0],
      output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      if (input[channel]) output[channel].set(input[channel]);
      else output[channel].fill(0);
    }
    if (!this.capture) return true;
    const count = Math.min(
      output[0].length,
      this.capture.length / 2 - this.offset,
    );
    for (let frame = 0; frame < count; frame++) {
      this.capture[(this.offset + frame) * 2] = output[0][frame];
      this.capture[(this.offset + frame) * 2 + 1] =
        output[1]?.[frame] ?? output[0][frame];
    }
    this.offset += count;
    if (this.offset * 2 === this.capture.length) {
      const buffer = this.capture.buffer;
      this.capture = null;
      this.port.postMessage(
        { buffer, sampleRate: globalThis.sampleRate, channels: 2 },
        [buffer],
      );
    }
    return true;
  }
}
globalThis.registerProcessor("runtime-pcm-tap", RuntimePCMTap);
