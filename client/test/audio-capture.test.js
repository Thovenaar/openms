import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../src/audio-capture-worklet.js", import.meta.url),
  "utf8",
);

function processor() {
  const messages = [];
  let Processor;
  runInNewContext(source, {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (message) => messages.push(message) };
      }
    },
    registerProcessor(name, implementation) {
      Processor = implementation;
    },
  });
  const tap = new Processor();
  const input = [
    new Float32Array([0.25, -0.25]),
    new Float32Array([0.5, -0.5]),
  ];
  const output = [new Float32Array(2), new Float32Array(2)];
  return { tap, messages, input, output };
}

test("malformed PCM request rejects without killing live audio or the next capture", () => {
  const { tap, messages, input, output } = processor();
  tap.receive({ data: null });
  expect(messages[0].error).toBeDefined();
  tap.receive({ data: { frames: 2 } });
  tap.process([input], [output]);
  expect(Array.from(output[0])).toEqual([0.25, -0.25]);
  expect(Array.from(new Float32Array(messages[1].buffer))).toEqual([
    0.25, 0.5, -0.25, -0.5,
  ]);
});

test("overlap rejection cancels that capture instead of publishing a stale completion", () => {
  const { tap, messages, input, output } = processor();
  tap.receive({ data: { frames: 2 } });
  tap.receive({ data: { frames: 2 } });
  tap.process([input], [output]);
  expect(messages).toHaveLength(1);
  expect(messages[0].error).toBeDefined();
  tap.receive({ data: { frames: 2 } });
  tap.process([input], [output]);
  expect(Array.from(new Float32Array(messages[1].buffer))).toEqual([
    0.25, 0.5, -0.25, -0.5,
  ]);
});
