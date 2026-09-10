import { ProfileStore } from "./profile-store.js";
import { validateProfile } from "./profile-validation.js";
import { PortalTravelGate } from "./portal-system.js";

/** Owns one suspended baseline and one temporary world; never an alternate gameplay engine.
 * Hooks prepare/commit through Main's existing scene, input and renderer owners.
 * @param {object} hooks Explicit application lifecycle callbacks.
 */
export class AgentDevelopment {
  constructor(hooks) {
    this.hooks = hooks;
    this.baseline = null;
    this.session = null;
    this.pending = null;
    this.destroyed = false;
  }

  /** Main's single fixed integration clock also advances temporary UI/portal deadlines. */
  tick(ms) {
    if (this.session) this.session.clockMs += ms;
  }

  /** Native takeover aborts uncommitted setup and resumes normal human ticks immediately. */
  interrupt() {
    if (this.pending || this.session) this.hooks.pause(false);
    this.pending?.abort();
  }

  /** Prepare in isolation. Only a complete candidate can replace the visible field. */
  async enter(spec) {
    if (this.destroyed || this.pending || this.baseline) {
      throw new Error("Development session is busy");
    }
    const baseline = this.captureBaseline();
    const controller = new AbortController();
    this.pending = controller;
    this.hooks.pause(true);
    let candidate = null;
    let store = null;
    try {
      this.hooks.checkpoint();
      await baseline.store.flush();
      controller.signal.throwIfAborted();
      const { spec: normalized, manifest } = await this.hooks.normalize(
        spec,
        controller.signal,
      );
      store = ProfileStore.memory(normalized.profile);
      const session = {
        spec: normalized,
        manifest,
        store,
        clockMs: 0,
        gate: null,
      };
      session.gate = new PortalTravelGate(() => session.clockMs);
      candidate = await this.hooks.prepare(session, controller.signal);
      controller.signal.throwIfAborted();
      this.hooks.assertControl();
      this.baseline = baseline;
      this.session = session;
      this.hooks.install(candidate, store, session.gate);
      baseline.scene.fieldSystems.life.controls.root.hidden = true;
      this.hooks.systems().ui.chat.resetSession();
      this.hooks.resetObservation();
      this.hooks.notify();
      return normalized;
    } catch (error) {
      if (this.baseline) this.restoreBaseline();
      candidate?.destroy();
      await store?.destroy();
      if (!controller.signal.aborted) this.hooks.pause(baseline.paused);
      throw error;
    } finally {
      this.pending = null;
    }
  }

  /** Closed UI prevents silently discarding human key drafts, dialogue or in-progress chat. */
  captureBaseline() {
    const state = this.hooks.state();
    const ui = this.hooks.systems().ui;
    if (
      !state.scene ||
      state.loading ||
      ui.windows.size ||
      ui.saving ||
      ui.resetting ||
      ui.pending.size ||
      ui.bindings.editing ||
      ui.chat.state !== 1 ||
      ui.chat.composing
    ) {
      throw new Error(
        "Close game windows/chat and finish loading before beginning an experiment",
      );
    }
    return {
      ...state,
      chat: ui.chat.checkpoint(),
      uiStatus: ui.lastStatus,
      itemLastUse: ui.bindings.items.lastUse,
    };
  }

  /** Reversal is explicit and remains available after permission loss. */
  async exit() {
    if (this.pending) {
      throw new Error("Wait for interrupted scenario preparation to settle");
    }
    if (!this.baseline) return;
    const temporary = this.hooks.state().scene;
    const store = this.session.store;
    await this.hooks.systems().ui.chat.waitForIdle();
    if (!(await this.hooks.systems().ui.requestCloseAll())) {
      throw new Error(
        "Finish the active native operation before leaving the experiment",
      );
    }
    this.hooks.cancelLoading();
    this.restoreBaseline();
    temporary.destroy();
    this.hooks.resetObservation();
    this.hooks.notify();
    await store.destroy();
  }

  restoreBaseline() {
    const baseline = this.baseline;
    this.session = null;
    this.hooks.install(baseline.scene, baseline.store, baseline.gate);
    this.hooks.systems().bindings.items.lastUse = baseline.itemLastUse;
    baseline.scene.fieldSystems.life.controls.root.hidden = false;
    this.hooks.systems().ui.chat.restore(baseline.chat);
    this.hooks.systems().ui.status(baseline.uiStatus ?? "", { record: false });
    this.hooks.restoreView(baseline);
    this.baseline = null;
  }

  /** All persistent progress was checkpointed before entry; temporary teardown cannot save it. */
  destroy() {
    this.destroyed = true;
    this.pending?.abort();
    if (!this.baseline) return;
    this.baseline.scene.destroy();
    this.baseline.store.destroy().catch(this.hooks.report);
    this.baseline = null;
  }
}

/** Reject cross-map explicit profiles rather than silently rewriting a requested starting state. */
export function scenarioProfile(spec, source, manifest) {
  const profile = structuredClone(spec.profile ?? source);
  if (profile.location.mapId !== manifest.id) {
    if (spec.profile) {
      throw new Error("Scenario profile location and mapId must match");
    }
    const actor = manifest.actors.find((entity) => entity.kind === "character");
    profile.location = {
      mapId: manifest.id,
      x: actor.x,
      y: actor.y,
      facing: 1,
    };
  }
  validateProfile(profile);
  return profile;
}
