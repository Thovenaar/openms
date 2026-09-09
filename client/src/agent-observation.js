import { LIMITS } from "./stream-validation.js";
import { PROFILE_LIMITS } from "./profile-validation.js";
import { snapshotSimulation } from "./physics/simulation.js";

/** Browser observation policies, not recovered game constants. */
const EVENT_CAPACITY = 256;
const EVENT_FIELDS = 16;
const TEXT_LIMIT = 512;
const PAGE_LIMIT = 128;
const ID_LIMIT = 64;
const FIELD_LIMIT = 4096;
const CAPTURE_PIXELS = 2560 * 1440 * 16;
const VISIBILITY =
  "Resident Pixi render bounds intersect the logical viewport; not pixel visibility, collision bounds, or UI occlusion. Background coordinates may be parallax/repeated. Pagination is live, not an atomic multi-call snapshot.";
const RESIDENCY =
  "Only currently resident artwork is listed. Unloaded regions, pending artwork, hidden entities, and portals without artwork are absent. Unknown requested IDs may belong to unloaded region descriptors; no offline descriptor search is performed.";
const CAPTURE_SCOPE =
  "Actual Pixi canvas only; DOM HUD, windows, chat, permission/Stop controls and other page UI are excluded. Use a full browser screenshot for the complete player-visible surface and visual proof.";
const PROFILE_FIELDS = [
  "schemaVersion",
  "name",
  "level",
  "job",
  "exp",
  "meso",
  "fame",
  "hp",
  "maxHP",
  "mp",
  "maxMP",
  "str",
  "dex",
  "int",
  "luk",
];

/** Validate a bounded caller-supplied integer, never silently clamp it. */
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid observation ${name}`);
  }
  return value;
}

/** Validate JSON option records before reading their fields. */
function optionsRecord(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Observation options must be an object");
  }
  let count = 0;
  for (const name in value) {
    if (
      ++count > names.length ||
      !Object.hasOwn(value, name) ||
      !names.includes(name)
    ) {
      throw new TypeError(`Unknown observation option: ${name}`);
    }
  }
  return value;
}

/** Page bounds apply to output; residency scanning is separately asset-bounded. */
function pageOptions(value = {}) {
  optionsRecord(value, ["offset", "limit"]);
  return {
    offset: integer(value.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, "offset"),
    limit: integer(value.limit ?? 32, 1, PAGE_LIMIT, "limit"),
  };
}

/** Return a page of already validated small plain records, with no live aliases. */
function pageArray(values, options, maximum) {
  if (values.length > maximum) {
    throw new RangeError("Observation collection bound exceeded");
  }
  const end = Math.min(values.length, options.offset + options.limit);
  const items = [];
  for (let index = options.offset; index < end; index++) {
    items.push(structuredClone(values[index]));
  }
  return {
    ...options,
    total: values.length,
    nextOffset: end < values.length ? end : null,
    items,
  };
}

/** Flat immutable scalars permit allocation-free copying into the event ring. */
function eventScalar(value) {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= TEXT_LIMIT)
  );
}

/** Validate at most EVENT_FIELDS fields; nested payloads are explicitly rejected. */
function eventValue(value) {
  if (eventScalar(value)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  let count = 0;
  for (const key in value) {
    if (
      ++count > EVENT_FIELDS ||
      key.length > 80 ||
      !Object.hasOwn(value, key)
    ) {
      return false;
    }
    if (!eventScalar(value[key])) return false;
  }
  return true;
}

/** Preallocate fixed payload storage once, outside all simulation paths. */
function eventSlot() {
  return {
    seq: 0,
    tick: 0,
    timeMs: 0,
    epoch: 0,
    type: "",
    entityId: "",
    value: null,
    fields: -1,
    keys: new Array(EVENT_FIELDS).fill(""),
    values: new Array(EVENT_FIELDS).fill(null),
  };
}

/** Clone a single retained event only when observation is requested. */
function eventSnapshot(slot) {
  let value = slot.value;
  if (slot.fields >= 0) {
    value = {};
    for (let index = 0; index < slot.fields; index++) {
      Object.defineProperty(value, slot.keys[index], {
        value: slot.values[index],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return {
    seq: slot.seq,
    epoch: slot.epoch,
    tick: slot.tick,
    timeMs: slot.timeMs,
    type: slot.type,
    entityId: slot.entityId,
    value,
  };
}

/** EntityAnimation's current pose, without all actions, parts or texture descriptors. */
function animationSnapshot(entity) {
  if (!entity) return null;
  const node = entity.container;
  return {
    id: entity.id,
    kind: entity.kind,
    action: entity.action,
    frame: entity.frame,
    playback: entity.playback,
    completed: entity.completed,
    holdFrame: entity.holdFrame,
    actionTimeMs: entity.actionTimeMs,
    elapsedMs: entity.elapsedMs,
    x: entity.background ? entity.baseX : node.x,
    y: entity.background ? entity.baseY : node.y,
    z: node.zIndex,
    flip: node.scale.x < 0,
    visible: node.visible,
    opacity: node.alpha,
  };
}

/** Include gameplay-owned facts only for the returned resident entity. */
function entitySnapshot(scene, entity, bounds) {
  const result = animationSnapshot(entity);
  result.renderBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  const life = scene.fieldSystems?.life;
  const slot = life?.byId.get(entity.id);
  if (slot) {
    result.name = slot.template.name;
    result.templateId = slot.template.originalId;
    result.interactable = life.canInteract(entity.id);
  }
  const mob = scene.offlineField?.byId.get(entity.id);
  if (mob) {
    result.gameplay = {
      hp: mob.hp,
      maxHP: mob.maxHP,
      alive: mob.alive,
      state: mob.state,
    };
  }
  return result;
}

/** Pixi global bounds are logical screen pixels after the scene camera transform. */
function visibleBounds(entity, viewport) {
  const node = entity.container;
  if (node.destroyed || !node.isRenderable) return null;
  const bounds = node.getBounds();
  if (!finiteBounds(bounds)) return null;
  return bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x < viewport.width &&
    bounds.y < viewport.height &&
    bounds.x + bounds.width > 0 &&
    bounds.y + bounds.height > 0
    ? bounds
    : null;
}

function finiteBounds(bounds) {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
  );
}

function validEvent(type, entityId, value) {
  if (typeof type !== "string" || !type || type.length > 80) return false;
  const idValid =
    typeof entityId === "string"
      ? entityId.length <= TEXT_LIMIT
      : typeof entityId === "number" && Number.isFinite(entityId);
  return idValid && eventValue(value);
}

/** Scan the existing bounded resident list, allocating records only for this page. */
function entityPage(scene, options) {
  const result = {
    ...options,
    total: 0,
    resident: scene?.entities.length ?? 0,
    nextOffset: null,
    items: [],
    visibility: VISIBILITY,
  };
  if (!scene) return result;
  if (scene.entities.length > LIMITS.entities) {
    throw new RangeError("Resident entity bound exceeded");
  }
  for (const entity of scene.entities) {
    const bounds = visibleBounds(entity, scene.viewport);
    if (!bounds) continue;
    const index = result.total++;
    if (index >= options.offset && result.items.length < options.limit) {
      result.items.push(entitySnapshot(scene, entity, bounds));
    }
  }
  const next = options.offset + result.items.length;
  if (next < result.total) result.nextOffset = next;
  return result;
}

/** Requested IDs distinguish resident, known life not resident, and unknown ownership. */
function requestedEntities(scene, ids = []) {
  if (!Array.isArray(ids) || ids.length > ID_LIMIT) {
    throw new RangeError("Observation ID limit exceeded");
  }
  const result = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id || id.length > TEXT_LIMIT) {
      throw new TypeError("Invalid observation entity ID");
    }
    result.push(requestedEntity(scene, id));
  }
  return result;
}

function requestedEntity(scene, id) {
  if (!scene) return { id, state: "unknown", visible: false };
  const entity = scene.byId.get(id);
  const known = scene.fieldSystems.life.byId.has(id);
  return {
    id,
    state: entity ? "resident" : known ? "not-resident" : "unknown",
    visible: Boolean(entity && visibleBounds(entity, scene.viewport)),
  };
}

/** Counts disclose missing artwork without copying placements or offline manifests. */
function residencySnapshot(scene) {
  if (!scene) return { available: false, limitation: RESIDENCY };
  const slots = scene.fieldSystems.life.slots;
  if (slots.length > FIELD_LIMIT || scene.regions.size > LIMITS.regions) {
    throw new RangeError("Observation residency bound exceeded");
  }
  let missingLife = 0;
  let readyRegions = 0;
  for (const slot of slots) if (!scene.byId.has(slot.record.id)) missingLife++;
  for (const region of scene.regions.values()) if (region.ready) readyRegions++;
  return {
    available: true,
    residentEntities: scene.entities.length,
    residentSprites: scene.spriteCount,
    readyRegions,
    totalRegions: scene.manifest.regions.length,
    pendingLoads: scene.pendingLoads,
    missingLife,
    totalLife: slots.length,
    ...mobResidency(scene.offlineField),
    limitation: RESIDENCY,
  };
}

function mobResidency(field) {
  return {
    mobArtworkPending: field?.renderer.pending ?? 0,
    mobArtworkError: field?.renderer.error ?? null,
  };
}

/** Profile data is explicit and paginated, never the full save or quest dictionary. */
function profileSnapshot(store, options) {
  const profile = store?.profile;
  if (!profile) return null;
  const result = {};
  for (const key of PROFILE_FIELDS) result[key] = profile[key];
  result.location = structuredClone(profile.location);
  result.settings = structuredClone(profile.settings);
  result.save = store.snapshot();
  result.inventory = pageArray(
    profile.inventory,
    options,
    PROFILE_LIMITS.inventory,
  );
  if (profile.equipment.length > PROFILE_LIMITS.equipment) {
    throw new RangeError("Equipment observation bound exceeded");
  }
  result.equipment = profile.equipment.slice();
  return result;
}

/** Reuse the native UI's demand-only snapshot: it includes save metadata, not the profile. */
function uiSnapshot(systems) {
  const ui = systems?.ui;
  if (!ui) return null;
  return structuredClone(ui.snapshot());
}

/** Screen dimensions distinguish backing pixels, logical pixels and CSS coordinates. */
function canvasSnapshot(canvas, scene) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    width: canvas.width,
    height: canvas.height,
    logicalWidth: scene?.viewport.width ?? null,
    logicalHeight: scene?.viewport.height ?? null,
    css: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

/** Demand-only inspection owner; tick and record never allocate arrays or records.
 * Getter hooks must return the current owners, not cached owners from a previous map.
 * status() returns a concise cloneable status (buildId/loading/paused/control/scenario).
 * render() must synchronously render the real current Pixi stage into canvas().
 * @param {{scene:Function, systems:Function, input:Function, status:Function, canvas:Function, render:Function}} hooks
 */
export class AgentObservation {
  constructor(hooks) {
    for (const key of [
      "scene",
      "systems",
      "input",
      "status",
      "canvas",
      "render",
    ]) {
      if (typeof hooks?.[key] !== "function") {
        throw new TypeError(`Missing observation hook: ${key}`);
      }
    }
    this.hooks = hooks;
    this.ring = Array.from({ length: EVENT_CAPACITY }, eventSlot);
    this.seq = 0;
    this.count = 0;
    this.timeMs = 0;
    this.ticks = 0;
    this.epoch = 0;
    this.rejected = 0;
    this.destroyed = false;
  }

  // Event payload validation is shared and allocation-free.
  /** Only actual accepted gameplay events belong here, never proposed command results.
   * Values are null/scalars or flat objects of <=16 scalars; strings <=512 chars.
   * Invalid/oversize input returns false and increments rejected, never breaks play.
   * Retention rollover is normal and is reported by observe().events.
   * @param {string} type @param {string|number} [entityId] @param {any} [value]
   * @returns {boolean}
   */
  record(type, entityId = "", value = null) {
    if (this.destroyed) return false;
    if (
      !validEvent(type, entityId, value) ||
      this.seq >= Number.MAX_SAFE_INTEGER
    ) {
      if (this.rejected < Number.MAX_SAFE_INTEGER) this.rejected++;
      return false;
    }
    const slot = this.ring[this.seq % EVENT_CAPACITY];
    slot.keys.fill("");
    slot.values.fill(null);
    slot.seq = ++this.seq;
    slot.type = type;
    slot.entityId = entityId;
    slot.timeMs = this.timeMs;
    slot.tick = this.ticks;
    slot.epoch = this.epoch;
    const scalar = eventScalar(value);
    slot.value = scalar ? value : null;
    slot.fields = scalar ? -1 : 0;
    if (slot.fields === 0) {
      for (const key in value) {
        slot.keys[slot.fields] = key;
        slot.values[slot.fields++] = value[key];
      }
    }
    this.count = Math.min(EVENT_CAPACITY, this.count + 1);
    return true;
  }

  /** Advance only by actually executed simulation milliseconds, once per fixed tick.
   * @param {number} ms Nonnegative finite executed duration in milliseconds.
   */
  tick(ms) {
    this.assertLive();
    if (
      !Number.isFinite(ms) ||
      ms < 0 ||
      !Number.isFinite(this.timeMs + ms) ||
      this.ticks >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError("Invalid observation tick");
    }
    this.timeMs += ms;
    this.ticks++;
  }

  /** Cursor is the last seen seq, exclusive. Limit is 1..128; default 64.
   * @param {{since?:number,limit?:number}} [options]
   */
  events(options = {}) {
    optionsRecord(options, ["since", "limit"]);
    const oldest = this.seq - this.count + 1;
    const since = integer(
      options.since ?? oldest - 1,
      0,
      this.seq,
      "event cursor",
    );
    const limit = integer(options.limit ?? 64, 1, PAGE_LIMIT, "event limit");
    const first = Math.max(oldest, since + 1);
    const end = Math.min(this.seq + 1, first + limit);
    const items = [];
    for (let seq = first; seq < end; seq++) {
      items.push(eventSnapshot(this.ring[(seq - 1) % EVENT_CAPACITY]));
    }
    const next = items.length ? end - 1 : since;
    return {
      capacity: EVENT_CAPACITY,
      retained: this.count,
      oldestSeq: this.count ? oldest : null,
      latestSeq: this.seq,
      since,
      nextSince: next,
      hasMore: next < this.seq,
      dropped: Math.max(0, oldest - since - 1),
      discardedTotal: this.seq - this.count,
      rejectedTotal: this.rejected,
      truncated: next < this.seq,
      items,
    };
  }

  /** All returned data is detached from live owners; no full maple.snapshot call.
   * @param {{entities?:{offset?:number,limit?:number},inventory?:{offset?:number,limit?:number},events?:{since?:number,limit?:number},ids?:string[]}} [options]
   */
  observe(options = {}) {
    this.assertLive();
    optionsRecord(options, ["entities", "inventory", "events", "ids"]);
    const entities = pageOptions(options.entities);
    const inventory = pageOptions(options.inventory);
    const scene = this.hooks.scene();
    const systems = this.hooks.systems();
    const input = this.hooks.input();
    const gameplay = scene?.offlineField;
    return {
      schemaVersion: 1,
      epoch: this.epoch,
      tick: this.ticks,
      timeMs: this.timeMs,
      status: structuredClone(this.hooks.status()),
      currentMap: scene?.manifest.id ?? null,
      player: scene?.simulation ? snapshotSimulation(scene.simulation) : null,
      animation: animationSnapshot(scene?.actor),
      gameplay: gameplay
        ? {
            phase: gameplay.phase,
            dead: gameplay.dead,
            blocksMovement: gameplay.blocksMovement,
            status: gameplay.lastStatus,
            lastDamage: gameplay.lastDamage,
            hitTimerMs: gameplay.hitTimerMs,
          }
        : null,
      input: input ? structuredClone(input.state) : null,
      ui: uiSnapshot(systems),
      profile: profileSnapshot(systems?.store, inventory),
      camera: scene ? { x: scene.camera.x, y: scene.camera.y } : null,
      canvas: canvasSnapshot(this.hooks.canvas(), scene),
      entities: entityPage(scene, entities),
      requestedEntities: requestedEntities(scene, options.ids),
      residency: residencySnapshot(scene),
      events: this.events(options.events),
    };
  }

  /** Render before reading the actual PNG backing store; readback failures propagate.
   * @returns {{mimeType:string,dataUrl:string,width:number,height:number,scope:string}}
   */
  capture() {
    this.assertLive();
    const canvas = this.hooks.canvas();
    if (
      !canvas ||
      !this.hooks.scene() ||
      canvas.width < 1 ||
      canvas.height < 1
    ) {
      throw new Error("No drawable agent canvas is ready");
    }
    if (canvas.width * canvas.height > CAPTURE_PIXELS) {
      throw new RangeError("Agent capture pixel bound exceeded");
    }
    this.hooks.render();
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("Canvas did not produce a PNG");
    }
    return {
      mimeType: "image/png",
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      scope: CAPTURE_SCOPE,
    };
  }

  /** Discard retention and reset the local clock, preserving globally monotonic seq.
   * Cursors before reset report dropped history; epoch identifies a new timeline.
   */
  reset() {
    this.assertLive();
    if (this.epoch >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Observation epoch exhausted");
    }
    this.epoch++;
    this.timeMs = 0;
    this.ticks = 0;
    this.count = 0;
    for (const slot of this.ring) {
      slot.type = "";
      slot.entityId = "";
      slot.value = null;
      slot.keys.fill("");
      slot.values.fill(null);
    }
  }

  /** Reject observation after teardown instead of exposing stale simulation owners. */
  assertLive() {
    if (this.destroyed) throw new Error("Agent observation is destroyed");
  }

  /** Release owner references and retained payloads. Idempotent. */
  destroy() {
    if (this.destroyed) return;
    this.reset();
    this.destroyed = true;
    this.hooks = null;
    this.ring.length = 0;
  }
}
