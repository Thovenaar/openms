import { profileError } from "./profile-validation.js";
import { consumeItem } from "./inventory-model.js";
import { admitItem, selectedItem } from "./inventory-action-rules.js";

const MAX_REACTORS = 4096;
const MAX_STATES = 256;
const MAX_EVENTS = 256;

function validRectangle(rect) {
  return (
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    rect.left <= rect.right &&
    rect.top <= rect.bottom
  );
}

/** 00736091 uses bit0=facing-left, bit1=foothold contact; lower nonnegative rank wins. */
function hitRank(type, facing, grounded) {
  if (type === 0) return grounded ? 1 : 2;
  if (type === 1 && facing > 0) return grounded ? 0 : 1;
  if (type === 2 && facing < 0) return grounded ? 0 : 1;
  return -1;
}

/** 00735ab7 offsets event rectangles by reactor placement, without sprite flipping. */
function containsEvent(record, event, x, y) {
  if (!event.lt || !event.rb) return false;
  return (
    x >= record.placement.x + event.lt.x &&
    x < record.placement.x + event.rb.x &&
    y >= record.placement.y + event.lt.y &&
    y < record.placement.y + event.rb.y
  );
}

function validateEvent(event) {
  if (
    !Number.isSafeInteger(event.type) ||
    !Number.isSafeInteger(event.state) ||
    !Array.isArray(event.skills) ||
    event.skills.length > MAX_EVENTS ||
    !Number.isFinite(event.hitMs) ||
    event.hitMs < 0
  ) {
    throw new Error("Invalid reactor event");
  }
}

function validateState(state, states) {
  if (
    !Number.isSafeInteger(state.id) ||
    states.has(state.id) ||
    !Array.isArray(state.events) ||
    state.events.length > MAX_EVENTS ||
    !Number.isFinite(state.timeoutMs) ||
    state.timeoutMs < 0 ||
    !Number.isFinite(state.hitMs) ||
    state.hitMs < 0
  ) {
    throw new Error("Invalid reactor state");
  }
  for (const event of state.events) {
    validateEvent(event);
  }
}

function compileTemplate(template) {
  if (
    !template ||
    !Array.isArray(template.states) ||
    !template.states.length ||
    template.states.length > MAX_STATES
  ) {
    throw new Error("Invalid reactor template");
  }
  const states = new Map();
  for (const state of template.states) {
    validateState(state, states);
    states.set(state.id, state);
  }
  if (!states.has(0)) throw new Error("Reactor initial state unavailable");
  return { descriptor: template, states };
}

function createRecord(placement, template) {
  if (
    !template ||
    typeof placement.id !== "string" ||
    !Number.isFinite(placement.x) ||
    !Number.isFinite(placement.y) ||
    !Number.isFinite(placement.respawnMs) ||
    placement.respawnMs < 0
  ) {
    throw new Error("Invalid reactor placement");
  }
  return {
    placement,
    template,
    state: template.states.get(0),
    nextState: null,
    animation: null,
    action: null,
    phase: "idle",
    phaseMs: 0,
    hitMs: 0,
    enteredMs: 0,
    respawnAt: Infinity,
    transitions: 0,
    lastOutcome: "local-data-state",
  };
}

/** Artwork stays in bounded StreamScene regions. State survives region eviction, not field exit.
 * All WZ state/item/timeOut/respawn authority is provisional local policy, never script rewards. */
export class ReactorSystem {
  constructor(scene, store, hooks = {}) {
    const manifest = scene.manifest.reactors;
    if (
      manifest?.schemaVersion !== 1 ||
      !Array.isArray(manifest.placements) ||
      manifest.placements.length > MAX_REACTORS ||
      !manifest.templates
    ) {
      throw new Error("Invalid reactor manifest");
    }
    this.scene = scene;
    this.store = store;
    this.hooks = hooks;
    this.elapsedMs = 0;
    this.destroyed = false;
    this.pending = null;
    const templates = new Map(),
      seen = new Set();
    const entries = Object.entries(manifest.templates);
    if (entries.length > MAX_REACTORS) {
      throw new Error("Reactor template count exceeds bound");
    }
    for (const [id, template] of entries) {
      templates.set(id, compileTemplate(template));
    }
    this.records = manifest.placements.map((placement) => {
      if (seen.has(placement.id)) {
        throw new Error("Duplicate reactor placement");
      }
      seen.add(placement.id);
      return createRecord(placement, templates.get(placement.templateId));
    });
    this.refresh();
  }

  /** Rebind before draw after region changes, without retaining evicted sprite/texture ownership. */
  refresh() {
    if (this.destroyed) return;
    for (const record of this.records) {
      const animation = record.placement.entityId
        ? this.scene.byId.get(record.placement.entityId)
        : null;
      if (record.animation === animation) continue;
      record.animation = animation ?? null;
      if (!animation) continue;
      animation.gameplayOwned = true;
      this.present(record);
      if (record.action) animation.advance(record.phaseMs);
    }
  }

  present(record) {
    const animation = record.animation;
    if (!animation) return;
    const action = record.phase === "hit" ? record.action : record.state?.idle;
    animation.container.visible = Boolean(action);
    if (!action) return;
    record.action = action;
    const playback =
      record.phase === "idle" && record.state.repeat ? "loop" : "once";
    animation.setAction(action, playback);
    animation.seek(0);
  }

  /** At most one authored state transition per record per executed physics tick. */
  step(ms) {
    if (this.destroyed) return;
    if (
      !Number.isFinite(ms) ||
      ms < 0 ||
      !Number.isFinite(this.elapsedMs + ms)
    ) {
      throw new Error("Invalid reactor clock");
    }
    this.elapsedMs += ms;
    this.refresh();
    for (const record of this.records) {
      this.stepRecord(record, ms);
    }
  }

  stepRecord(record, ms) {
    if (this.pending?.record === record) return;
    record.phaseMs += ms;
    if (record.animation && record.action) record.animation.advance(ms);
    if (record.phase === "hit") {
      if (record.phaseMs >= record.hitMs) {
        this.enterState(record, record.nextState);
      }
      return;
    }
    if (this.elapsedMs >= record.respawnAt) {
      this.enterState(record, record.template.states.get(0));
      return;
    }
    this.stepTimeout(record);
  }

  stepTimeout(record) {
    if (
      !record.state ||
      record.state.timeoutMs <= 0 ||
      this.elapsedMs - record.enteredMs < record.state.timeoutMs
    ) {
      return;
    }
    for (const event of record.state.events) {
      if (event.type === 101 && event.status === "local-data-transition") {
        this.transition(record, event);
        break;
      }
    }
  }

  enterState(record, state) {
    record.state = state;
    record.nextState = null;
    record.phase = "idle";
    record.phaseMs = 0;
    record.enteredMs = this.elapsedMs;
    record.action = state?.idle ?? null;
    const terminal = !state || state.events.length === 0;
    record.respawnAt =
      terminal && record.placement.respawnMs > 0
        ? this.elapsedMs + record.placement.respawnMs
        : Infinity;
    this.present(record);
  }

  eligible(record) {
    if (record.phase !== "idle" || !record.state) return false;
    const quest = record.template.descriptor.quest;
    if (
      quest !== null &&
      this.store.profile.quests[String(quest)]?.state !== 1
    ) {
      record.lastOutcome = "local-policy-requires-active-authored-quest";
      return false;
    }
    return true;
  }

  transition(record, event) {
    const target = this.targetState(record, event);
    const sound = record.template.descriptor.sounds?.[record.state?.id];
    if (target === undefined) return false;
    this.applyTransition(record, event, target);
    this.publishTransition(sound);
    return true;
  }

  targetState(record, event) {
    if (event.status !== "local-data-transition") return undefined;
    return event.state < 0 ? null : record.template.states.get(event.state);
  }

  publishTransition(sound) {
    if (sound && this.hooks.onSound) this.hooks.onSound(sound);
    if (this.hooks.onChange) this.hooks.onChange();
  }

  applyTransition(record, event, target) {
    const hit = event.hit ?? record.state.hit;
    const hitMs = event.hit ? event.hitMs : record.state.hitMs;
    record.transitions++;
    record.lastOutcome = record.template.descriptor.action
      ? "local-transition-script-reward-unavailable"
      : "local-data-transition";
    if (hit && hitMs > 0) {
      record.phase = "hit";
      record.phaseMs = 0;
      record.nextState = target;
      record.action = hit;
      record.hitMs = hitMs;
      this.present(record);
    } else this.enterState(record, target);
  }

  matchesSkillEvent(record, event, skillId) {
    const sim = this.scene.simulation;
    return (
      event.type === 5 &&
      skillId > 0 &&
      event.skills.includes(skillId) &&
      containsEvent(record, event, Math.trunc(sim.x), Math.trunc(sim.y))
    );
  }

  selectStrikeEvent(record, rect, facing, skillId) {
    const sim = this.scene.simulation;
    let best = null,
      rank = Infinity;
    for (const event of record.state.events) {
      if (event.status !== "local-data-transition") continue;
      let score = hitRank(event.type, facing, Boolean(sim.footholdId));
      if (this.matchesSkillEvent(record, event, skillId)) {
        score = 0;
      } else if (!this.overlaps(record, rect)) {
        continue;
      }
      if (score >= 0 && score < rank) {
        best = event;
        rank = score;
      }
    }
    return best;
  }

  overlaps(record, rect) {
    const animation = record.animation;
    if (!animation || !animation.container.visible) return false;
    const geometry = animation.current.geometry[animation.frame];
    const x = record.placement.x,
      y = record.placement.y;
    const left = record.placement.flip
      ? x - geometry.x - geometry.width
      : x + geometry.x;
    return (
      rect.left < left + geometry.width &&
      rect.right > left &&
      rect.top < y + geometry.y + geometry.height &&
      rect.bottom > y + geometry.y
    );
  }

  validateStrike(rect, facing, skillId) {
    if (
      !validRectangle(rect) ||
      (facing !== -1 && facing !== 1) ||
      !Number.isSafeInteger(skillId) ||
      skillId < 0
    ) {
      throw new Error("Invalid reactor strike");
    }
  }

  /** Real combat impact calls this once; nearest overlap is explicit deterministic local selection. */
  strike(rect, facing, skillId = 0) {
    if (this.pending) return false;
    if (this.destroyed) return false;
    this.validateStrike(rect, facing, skillId);
    this.refresh();
    const sim = this.scene.simulation;
    let selected = null,
      selectedEvent = null,
      nearest = Infinity;
    for (const record of this.records) {
      if (!this.eligible(record)) continue;
      const best = this.selectStrikeEvent(record, rect, facing, skillId);
      const distance = Math.abs(record.placement.x - sim.x);
      if (best && distance < nearest) {
        selected = record;
        selectedEvent = best;
        nearest = distance;
      }
    }
    return selected ? this.transition(selected, selectedEvent) : false;
  }

  admitOfferItem(request) {
    if (request?.actorId !== this.store.id) {
      throw profileError(
        "invalid-actor",
        "Only the current local character may offer this item.",
      );
    }
    const item = selectedItem(this.store.profile, request.uid);
    admitItem(this.store.profile, item);
    if (item.slot < 0) {
      throw profileError(
        "item-equipped",
        "Unequip the item before offering it.",
      );
    }
    return item;
  }

  /** Native inventory Offer nearby: exact authored item/count, accepted atomically, no reward scripts. */
  async offer(request) {
    if (this.destroyed) {
      return { accepted: false, ok: false, code: "field-destroyed" };
    }
    if (
      this.pending ||
      this.store.profileTransactionPending ||
      this.hooks.isBusy?.()
    ) {
      return { accepted: false, ok: false, code: "reactor-busy" };
    }
    try {
      const item = this.admitOfferItem(request);
      for (const record of this.records) {
        if (!this.eligible(record)) continue;
        const event = this.selectOfferEvent(record, item.id);
        if (event) {
          return await this.acceptOffer(record, event, {
            uid: item.uid,
            actorId: request.actorId,
          });
        }
      }
      return {
        accepted: false,
        ok: false,
        code: "no-nearby-reactor-accepts-item",
      };
    } catch (error) {
      return {
        accepted: false,
        ok: false,
        code: error.code ?? "reactor-failed",
        reason: error.message,
      };
    }
  }

  selectOfferEvent(record, itemId) {
    const sim = this.scene.simulation;
    for (const event of record.state.events) {
      if (
        event.type === 100 &&
        event.itemId === itemId &&
        event.status === "local-data-transition" &&
        containsEvent(record, event, Math.trunc(sim.x), Math.trunc(sim.y))
      ) {
        return event;
      }
    }
    return null;
  }

  consumeOffer(draft, offer) {
    const { request, record, event, state } = offer;
    if (
      request.actorId !== this.store.id ||
      this.destroyed ||
      record.state !== state ||
      this.selectOfferEvent(record, event.itemId) !== event ||
      !this.eligible(record)
    ) {
      throw profileError(
        "reactor-changed",
        "The actor or reactor is no longer eligible for this offer.",
      );
    }
    const item = selectedItem(draft, request.uid);
    admitItem(draft, item);
    if (item.id !== event.itemId || item.slot < 0) {
      throw profileError("item-changed", "The offered item changed.");
    }
    consumeItem(draft, item.uid, event.count);
  }

  async acceptOffer(record, event, request) {
    if (
      !Number.isSafeInteger(event.count) ||
      event.count <= 0 ||
      event.itemOption !== 1
    ) {
      return {
        accepted: false,
        ok: false,
        code: "unsupported-authored-item-condition",
      };
    }
    const target = this.targetState(record, event);
    if (target === undefined) {
      return { accepted: false, ok: false, code: "unavailable-target-state" };
    }
    const offer = { record, event, request, state: record.state };
    const sound = record.template.descriptor.sounds?.[offer.state.id];
    const consume = (draft) => this.consumeOffer(draft, offer);
    consume(structuredClone(this.store.profile));
    const pending = { record, promise: null };
    this.pending = pending;
    try {
      pending.promise = this.store.commitProfile(consume);
      await pending.promise;
      try {
        this.applyTransition(record, event, target);
      } catch (error) {
        this.lastPublicationError = error.message;
      }
    } finally {
      this.pending = null;
    }
    try {
      this.publishTransition(sound);
    } catch (error) {
      this.lastPublicationError = error.message;
    }
    return {
      accepted: true,
      ok: true,
      code: "reactor-accepted",
      reason: record.lastOutcome,
      consumed: event.count,
    };
  }

  waitForIdle() {
    return this.pending?.promise ?? Promise.resolve();
  }

  snapshot() {
    return {
      mode: "provisional-local-reactors-no-script-rewards",
      records: this.records.map((record) => ({
        id: record.placement.id,
        templateId: record.placement.templateId,
        state: record.state?.id ?? -1,
        phase: record.phase,
        resident: record.animation !== null,
        transitions: record.transitions,
        lastOutcome: record.lastOutcome,
        script: record.template.descriptor.action,
        events:
          record.state?.events.map((event) => ({
            id: event.id,
            type: event.type,
            target: event.state,
            status: event.status,
          })) ?? [],
      })),
    };
  }

  destroy() {
    if (this.pending) {
      throw profileError(
        "reactor-busy",
        "Await the reactor offer before destroying this field.",
      );
    }
    if (this.destroyed) return;
    this.destroyed = true;
    for (const record of this.records) record.animation = null;
  }
}
