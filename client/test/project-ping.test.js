import { expect, test } from "bun:test";
import {
  formatProjectPing,
  pingQuality,
  setProjectPing,
} from "../src/browser/project-ping.js";

test("an unmeasured heartbeat reads as a placeholder, never a fake zero", () => {
  expect(formatProjectPing(0)).toBe("Ping: —");
  expect(formatProjectPing(null)).toBe("Ping: —");
  expect(formatProjectPing(Number.NaN)).toBe("Ping: —");
  expect(formatProjectPing(42.4)).toBe("Ping: 42 ms");
});

test("quality bands turn green, orange then red as the round trip grows", () => {
  expect(pingQuality(0)).toBe("unknown");
  expect(pingQuality(30)).toBe("good");
  expect(pingQuality(100)).toBe("good");
  expect(pingQuality(101)).toBe("fair");
  expect(pingQuality(200)).toBe("fair");
  expect(pingQuality(201)).toBe("poor");
});

test("the project bar node carries both the text and its quality", () => {
  const element = { textContent: "", dataset: {} };
  const previous = globalThis.document;
  globalThis.document = {
    querySelector: (selector) =>
      selector === "#project-ping" ? element : null,
  };
  try {
    setProjectPing(55);
    expect(element.textContent).toBe("Ping: 55 ms");
    expect(element.dataset.quality).toBe("good");
    setProjectPing(150);
    expect(element.dataset.quality).toBe("fair");
    setProjectPing(0);
    expect(element.textContent).toBe("Ping: —");
    expect(element.dataset.quality).toBe("unknown");
  } finally {
    globalThis.document = previous;
  }
});
