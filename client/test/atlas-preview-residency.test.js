import { expect, test } from "bun:test";
import { AtlasStore } from "../src/rendering/stream-atlas.js";
import { OnlineLogin } from "../src/online/login.js";

const ATLAS_SIDE = 2048;
const ATLAS_BYTES = ATLAS_SIDE * ATLAS_SIDE * 4;
const RESIDENCY_BYTES = 192 * 1024 * 1024;
// A preview atlas large enough that two resident copies exceed the reservation.
const PREVIEW_SIDE = 5120;
const PREVIEW_BYTES = PREVIEW_SIDE * PREVIEW_SIDE * 4;

/** The real AtlasStore guard with injected decode/upload/network doubles. */
function budgetStore() {
  const store = Object.create(AtlasStore.prototype);
  Object.assign(store, {
    records: new Map(),
    cpuBytes: 0,
    gpuBytes: 0,
    evictions: 0,
    backpressure: 0,
    destroyed: false,
  });
  store.network = { activity: null, load: async () => new Uint8Array(4) };
  store.decoder = {
    decode: async () => ({ close() {} }),
    gate: { active: 0, queue: [] },
  };
  store.uploads = { add: async () => {}, queue: [], destroy() {} };
  return store;
}

function atlasInfo(index, side = ATLAS_SIDE) {
  return {
    sha256: index.toString(16).padStart(64, "0"),
    width: side,
    height: side,
  };
}

/** Mirrors VisualTextures: a preview owns one atlas until its own destroy runs,
 * so aborting a caller request never releases an already-completed preview. */
function previewVisuals(store, side = PREVIEW_SIDE) {
  let serial = 0;
  return {
    calls: 0,
    peak: 0,
    active: 0,
    async preparePreview({ signal }) {
      this.calls++;
      const controller = new AbortController();
      const info = atlasInfo(0x400000 + serial++, side);
      const lease = store.acquire(info, controller.signal);
      this.active++;
      this.peak = Math.max(this.peak, this.active);
      let destroyed = false;
      const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        this.active--;
        controller.abort();
        lease.release();
      };
      const cancel = () => destroy();
      signal.addEventListener("abort", cancel, { once: true });
      await lease.ready;
      signal.removeEventListener("abort", cancel);
      return { root: {}, pose() {}, destroy };
    },
  };
}

function previewSlot() {
  return {
    element: { clientWidth: 100, clientHeight: 200 },
    view: { removeChildren() {}, addChild() {} },
    plane: { sync() {} },
    controller: null,
    prepared: null,
    generation: 0,
    pose: { action: "stand1", facing: -1, state: "ground" },
  };
}

function loginOwner(overrides = {}) {
  const owner = Object.create(OnlineLogin.prototype);
  Object.assign(
    owner,
    {
      destroyed: false,
      visible: true,
      previews: [],
      createSlot: null,
      report: () => {},
      placePreview: () => {},
      draftProfile: () => ({}),
      hooks: { report: () => {} },
    },
    overrides,
  );
  return owner;
}

async function withWindow(run) {
  const previous = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    return await run();
  } finally {
    globalThis.window = previous;
  }
}

/** Reserve atlases as a committed field does, returning their releases. */
async function retain(store, count) {
  const held = [];
  for (let index = 0; index < count; index++) {
    const controller = new AbortController();
    const lease = store.acquire(atlasInfo(index), controller.signal);
    await lease.ready;
    held.push(lease);
  }
  return held;
}

test("retained field atlases exhaust the reservation and releasing them admits the same atlas", async () => {
  const store = budgetStore();
  const held = await retain(store, 12);
  expect(store.snapshot().cpuDecodedBytes).toBe(12 * ATLAS_BYTES);
  expect(() =>
    store.acquire(atlasInfo(999), new AbortController().signal),
  ).toThrow("Atlas residency backpressure: current map retained");
  expect(store.snapshot().backpressure).toBe(1);

  for (const lease of held) lease.release();
  expect(store.snapshot().cpuDecodedBytes).toBe(0);
  const controller = new AbortController();
  const lease = store.acquire(atlasInfo(999), controller.signal);
  await lease.ready;
  expect(store.snapshot().atlases).toBe(1);
  lease.release();
  expect(store.snapshot().cpuDecodedBytes).toBe(0);
  expect(store.snapshot().backpressure).toBe(1);
});

test("a hidden login surface prepares no preview after the field commits", async () => {
  await withWindow(async () => {
    const store = budgetStore();
    // Lith Harbour's committed field retains nearly the whole reservation; the
    // next preview atlas cannot fit until the field leaves.
    const field = await retain(store, 12);
    expect(12 * ATLAS_BYTES + ATLAS_BYTES).toBeGreaterThan(RESIDENCY_BYTES);
    const visuals = previewVisuals(store);
    const slot = previewSlot();
    const character = { id: "created" };
    slot.character = character;
    const owner = loginOwner({ visuals, visible: false });
    owner.previews.push(slot);

    // enter() runs setPending(false) after the snapshot commits, which re-renders
    // the roster over a login the committed field has already replaced.
    let portraits = 0;
    owner.renderPortrait = () => {
      portraits++;
    };
    owner.renderRosterPreview(slot, character);
    expect(portraits).toBe(0);
    await owner.showPreview(slot, { hair: 30030 });
    expect(visuals.calls).toBe(0);
    expect(store.snapshot().backpressure).toBe(0);
    expect(store.snapshot().cpuDecodedBytes).toBe(12 * ATLAS_BYTES);

    // The same preview succeeds once the field releases the reservation and the
    // login surface becomes the presentation owner again.
    for (const lease of field) lease.release();
    owner.visible = true;
    await owner.showPreview(slot, { hair: 30030 });
    expect(visuals.calls).toBe(1);
    expect(store.snapshot().backpressure).toBe(0);
    expect(store.snapshot().atlases).toBe(1);
    owner.releasePreview();
    expect(store.snapshot().cpuDecodedBytes).toBe(0);
  });
});

test("repeated appearance changes hold one preview at a time and stay within budget", async () => {
  await withWindow(async () => {
    const store = budgetStore();
    const visuals = previewVisuals(store);
    const slot = previewSlot();
    const owner = loginOwner({ visuals });
    owner.previews.push(slot);
    // Two concurrent previews exceed the reservation, so the retired preview must
    // release before the replacement reserves its atlas.
    expect(2 * PREVIEW_BYTES).toBeGreaterThan(RESIDENCY_BYTES);
    const appearances = [
      { hair: 30030, face: 20000 },
      { hair: 30020, face: 20001 },
      { hair: 30000, face: 20002 },
      { hair: 30030, face: 20000 },
    ];
    for (const appearance of appearances) {
      await owner.showPreview(slot, appearance);
    }
    expect(store.snapshot().backpressure).toBe(0);
    expect(visuals.peak).toBe(1);
    expect(store.snapshot().atlases).toBe(1);
    expect(store.snapshot().cpuDecodedBytes).toBe(PREVIEW_BYTES);

    owner.releasePreview();
    expect(store.snapshot().atlases).toBe(0);
    expect(store.snapshot().cpuDecodedBytes).toBe(0);
    expect(visuals.active).toBe(0);
  });
});

test("entering the world releases the hidden login preview's atlases", async () => {
  await withWindow(async () => {
    const store = budgetStore();
    const visuals = previewVisuals(store);
    const slot = previewSlot();
    const owner = loginOwner({
      visuals,
      host: { hidden: false },
      clearSecrets: () => {},
      resetRegistration: () => {},
      stopBackdrop: () => {},
    });
    owner.previews.push(slot);
    await owner.showPreview(slot, { hair: 30030 });
    expect(store.snapshot().atlases).toBe(1);

    owner.status({ status: "active" });
    expect(owner.visible).toBe(false);
    expect(store.snapshot().atlases).toBe(0);
    expect(store.snapshot().cpuDecodedBytes).toBe(0);
  });
});

test("returning to the login surface releases the retained field before artwork loads", () => {
  const order = [];
  const owner = loginOwner({
    visible: false,
    host: {},
    controller: new AbortController(),
    selectionReset: () => order.push("selectionReset"),
    startBackdrop: () => {
      order.push("startBackdrop");
      return Promise.resolve();
    },
    playTitleBgm: () => order.push("playTitleBgm"),
    setStatus: () => order.push("setStatus"),
    hooks: {
      report: () => {},
      releaseField: () => order.push("releaseField"),
    },
  });
  owner.status({ status: "disconnected", code: "CONNECTION_LOST" });
  expect(owner.visible).toBe(true);
  expect(order.slice(0, 3)).toEqual([
    "selectionReset",
    "releaseField",
    "startBackdrop",
  ]);
});
