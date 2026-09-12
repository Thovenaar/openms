import { expect, test } from "bun:test";

function burst(service, count) {
  const responses = [];
  for (let index = 0; index < count; index++) {
    service.fetch({
      request: new Request(
        `https://maple.test/generated/bundles/${index}.json`,
      ),
      clientId: "uninstalled-client",
      respondWith(response) {
        responses.push(response);
      },
    });
  }
  return responses;
}

// Exercise the worker fetch boundary: independent asset owners share admission.
test("a legitimate burst queues behind eight readers instead of returning a synthetic 503", async () => {
  const saved = new Map();
  for (const name of ["self", "caches", "fetch"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  const release = Promise.withResolvers();
  const admitted = Promise.withResolvers();
  let active = 0;
  let peak = 0;
  try {
    globalThis.self = {
      location: { origin: "https://maple.test" },
      clients: {
        async matchAll() {
          return [];
        },
      },
      addEventListener() {},
    };
    globalThis.caches = {
      async open() {
        return {
          async match() {
            return undefined;
          },
        };
      },
    };
    globalThis.fetch = async () => {
      active++;
      peak = Math.max(peak, active);
      if (active === 8) admitted.resolve();
      await release.promise;
      active--;
      return new Response("asset");
    };
    const { OfflineService } = await import("../public/service-worker.js");
    const service = new OfflineService();
    const responses = burst(service, 12);
    await admitted.promise;
    release.resolve();
    const settled = await Promise.all(responses);
    expect(settled.map((response) => response.status)).toEqual(
      Array(12).fill(200),
    );
    expect(
      await Promise.all(settled.map((response) => response.text())),
    ).toEqual(Array(12).fill("asset"));
    expect(peak).toBe(8);
  } finally {
    release.resolve();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
