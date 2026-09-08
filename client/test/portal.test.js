import { expect, test } from "bun:test";
import { PortalTravelGate } from "../src/portal-system.js";

test("portal admission is response-timed and stale completions cannot release a successor", () => {
  let now = 0;
  const gate = new PortalTravelGate(() => now);
  const first = gate.tryBegin(true);
  now = 1000;
  expect(gate.tryBegin(true)).toBeNull();
  gate.complete(first);
  now = 1499;
  expect(gate.tryBegin(true)).toBeNull();
  now = 1500;
  const second = gate.tryBegin(true);
  expect(second).not.toBeNull();
  expect(gate.complete(first)).toBe(false);
  expect(gate.snapshot().pending).toBe(true);
  gate.complete(second, "failed");
  now = 1999;
  expect(gate.tryBegin(true)).toBeNull();
  now = 2000;
  expect(gate.tryBegin(true)).not.toBeNull();
});

test("same-map recovery holds for600ms and explicit cancellation aborts the owned request", () => {
  let now = 0;
  const gate = new PortalTravelGate(() => now);
  const first = gate.tryBegin(false);
  gate.complete(first);
  now = 599;
  expect(gate.tryBegin(false)).toBeNull();
  now = 600;
  const next = gate.tryBegin(false);
  expect(next).not.toBeNull();
  expect(gate.cancel(next)).toBe(true);
  expect(next.signal.aborted).toBe(true);
  expect(gate.snapshot().pending).toBe(false);
  expect(gate.cancel(first)).toBe(false);
});
