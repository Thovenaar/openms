import { afterEach, expect, spyOn, test } from "bun:test";
import { Network } from "../src/rendering/stream-network.js";
import { createHash } from "node:crypto";

let fetchMock;
afterEach(() => fetchMock?.mockRestore());

test("original resources remain cached while private and world API resources never use persistent cache", async () => {
  const previousLocation = globalThis.location;
  globalThis.location = { origin: "http://localhost" };
  const bytes = Uint8Array.of(1, 2, 3);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entries = new Map(),
    reads = [],
    writes = [];
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(bytes),
  );
  const network = new Network();
  await network.ready;
  network.cache = {
    async match(url) {
      reads.push(url);
      return entries.has(url) ? new Response(entries.get(url)) : undefined;
    },
    async put(url, response) {
      writes.push(url);
      entries.set(url, await response.arrayBuffer());
    },
  };
  try {
    const signal = new AbortController().signal;
    const original = {
      url: `/generated/atlases/${sha256}.png`,
      bytes: bytes.length,
      sha256,
    };
    for (let count = 0; count < 2; count++) {
      await network.load(original, signal);
    }
    for (const path of ["custom-content/images", "world-content/resources"]) {
      for (let count = 0; count < 2; count++) {
        await network.load(
          { ...original, url: `/api/v1/${path}/${sha256}` },
          signal,
        );
      }
    }
    expect(reads).toHaveLength(2);
    expect(writes).toEqual([`http://localhost${original.url}`]);
    expect(fetchMock.mock.calls).toHaveLength(5);
    expect(network.hits).toBe(1);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});

test("stalled response headers release all four gate slots and admit the queued demand", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise(() => {}),
  );
  const network = new Network({ idleMs: 20, totalMs: 200 });
  const controller = new AbortController();
  const run = () =>
    network.gate.run(
      () => network.fetchBytes("/asset", controller.signal, 64),
      controller.signal,
    );
  const jobs = Array.from({ length: 5 }, run);
  expect(network.gate.active).toBe(4);
  expect(network.gate.queue.length).toBe(1);
  const results = await Promise.allSettled(jobs);
  expect(
    results.every(
      (result) =>
        result.status === "rejected" && result.reason.name === "TimeoutError",
    ),
  ).toBe(true);
  expect(fetchMock.mock.calls.length).toBe(5);
  expect(network.gate.active).toBe(0);
  expect(network.gate.queue.length).toBe(0);
});

test("stalled body times out and cancellation cannot hold the fetch slot", async () => {
  let cancelled = false;
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel: () => {
          cancelled = true;
          return new Promise(() => {});
        },
      }),
    },
  });
  const network = new Network({ idleMs: 20, totalMs: 200 });
  await expect(
    network.fetchBytes("/asset", new AbortController().signal, 64),
  ).rejects.toMatchObject({ name: "TimeoutError" });
  expect(cancelled).toBe(true);
});

test("progress refreshes idle time but a trickling download still hits the total deadline", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        async read() {
          await Bun.sleep(5);
          return { done: false, value: Uint8Array.of(1) };
        },
        cancel: () => Promise.resolve(),
      }),
    },
  });
  const network = new Network({ idleMs: 100, totalMs: 30 });
  await expect(
    network.fetchBytes("/asset", new AbortController().signal, 64),
  ).rejects.toMatchObject({ name: "TimeoutError" });
});

test("bounded downloads complete, oversized bodies reject, and caller cancellation is preserved", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(Uint8Array.of(1, 2, 3)),
  );
  const network = new Network({ idleMs: 100, totalMs: 200 });
  const controller = new AbortController();
  expect(
    new Uint8Array(await network.fetchBytes("/asset", controller.signal, 3)),
  ).toEqual(Uint8Array.of(1, 2, 3));
  await expect(
    network.fetchBytes("/asset", controller.signal, 2),
  ).rejects.toThrow("Network resource limit exceeded");
  controller.abort();
  await expect(
    network.fetchBytes("/asset", controller.signal, 3),
  ).rejects.toMatchObject({ name: "AbortError" });
});
