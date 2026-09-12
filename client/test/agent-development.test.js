import { expect, test } from "bun:test";
import { AgentDevelopment } from "../src/development/agent-development.js";
import { ProfileStore } from "../src/profile/profile-store.js";
import { createProfile } from "../src/profile/profile-validation.js";

function replayFixture(failEntry) {
  const profile = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  const store = ProfileStore.memory(profile, { id: "retained" });
  const retained = {
    alive: true,
    destroy() {
      this.alive = false;
    },
  };
  const state = { scene: retained, store, loading: false, paused: false };
  const view = { dialog: "retained draft", focused: "retained input" };
  const operation = new AbortController();
  const cleanup = { cancelled: false, retired: false, store: null };
  const teardownError = new Error("temporary renderer teardown failure");
  const candidate = {
    destroy() {
      cleanup.cancelled = operation.signal.aborted;
      cleanup.retired = true;
      view.dialog = null;
      view.focused = "temporary canvas";
      throw teardownError;
    },
  };
  const fixture = {
    state,
    view,
    retained,
    store,
    cleanup,
    teardownError,
    operation,
    candidate,
  };
  fixture.development = new AgentDevelopment(replayHooks(fixture, failEntry));
  return fixture;
}

function replayHooks(fixture, failEntry) {
  const { state, view, cleanup, candidate, operation } = fixture;
  const profile = fixture.store.profile;
  const bindings = { items: { lastUse: 42 } };
  const ui = {
    windows: new Map(),
    pending: new Set(),
    bindings,
    chat: { checkpoint: () => ({ draft: "retained draft" }) },
    async requestCloseAll() {
      throw new Error("temporary modal cannot close");
    },
  };
  const hooks = {
    state: () => state,
    systems: () => ({ ui, bindings, isOperationPending: () => false }),
    localReplay: () => true,
    pause(value) {
      state.paused = value;
    },
    normalize: async () => ({ spec: { profile }, manifest: {} }),
    async suspend() {
      view.dialog = "temporary dialog";
    },
    prepare: async () => candidate,
    assertControl() {},
    install(scene, temporaryStore) {
      state.scene = scene;
      state.store = temporaryStore;
      cleanup.store = temporaryStore;
      if (failEntry) {
        throw new Error("temporary install failure");
      }
    },
    async cancelReplayOperations() {
      operation.abort();
    },
    restoreIsolation(baseline) {
      state.scene = baseline.scene;
      state.store = baseline.store;
    },
    async releaseIsolation() {
      view.dialog = "retained draft";
      view.focused = "retained input";
      state.paused = false;
    },
    restoreView() {
      view.focused = "canvas";
    },
    resetObservation() {},
    notify() {},
    cancelLoading() {},
  };
  return hooks;
}

function expectRetained(fixture) {
  expect(fixture.state.scene).toBe(fixture.retained);
  expect(fixture.state.store).toBe(fixture.store);
  expect(fixture.retained.alive).toBe(true);
  expect(fixture.cleanup.cancelled).toBe(true);
  expect(fixture.cleanup.retired).toBe(true);
  expect(fixture.cleanup.store.status).toBe("closed");
  expect(() => fixture.cleanup.store.markDirty()).toThrow();
  expect(fixture.view).toEqual({
    dialog: "retained draft",
    focused: "retained input",
  });
  expect(fixture.state.paused).toBe(false);
  expect(fixture.development.baseline).toBeNull();
  expect(fixture.development.session).toBeNull();
}

test("failed local replay entry drains temporary work and preserves retained state through teardown failure", async () => {
  const fixture = replayFixture(true);
  try {
    await expect(fixture.development.enter({})).rejects.toBe(
      fixture.teardownError,
    );
    expectRetained(fixture);
    expect(fixture.development.pending).toBeNull();
  } finally {
    await fixture.store.destroy();
  }
});

test("local replay exit cancels pending work and restores retained drafts after temporary cleanup throws", async () => {
  const fixture = replayFixture(false);
  try {
    await fixture.development.enter({});
    await expect(fixture.development.exit()).rejects.toBe(
      fixture.teardownError,
    );
    expectRetained(fixture);
  } finally {
    await fixture.store.destroy();
  }
});
