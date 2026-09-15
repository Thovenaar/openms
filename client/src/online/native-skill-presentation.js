import { LocalSkillFeedback } from "./local-skill-feedback.js";
import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { composeRiding } from "../skills/skill-riding-composition.js";
import { PROTOCOL } from "../../../shared/protocol.js";

const MAX_VISIBLE = 4096;
const MAX_SOUNDS = 8192;
const DESTROY = Object.freeze({ children: true });
const EMPTY_ROWS = Object.freeze([]);
/** Server entity/visual publications land every third field tick. */
const PUBLISH_MS = PROTOCOL.TICK_MS * 3;
/** 0093780b native effect layer shared by every other online effect owner.
 *  Server skill sequences publish their authored intra-effect z, not an absolute world z. */
const EFFECT_LAYER = 398500;

/** Skill artwork draws above map objects and actors, in its authored effect order. */
export function skillEffectDepth(depth) {
  return EFFECT_LAYER + (Number.isSafeInteger(depth) ? depth : 0);
}

/** One native resource/display owner for observed server controllers; never executes a cast. */
export class NativeSkillPresentation {
  constructor(owner) {
    this.owner = owner;
    this.scene = null;
    this.generation = 0;
    this.visuals = new Map();
    this.sounds = new Map();
    this.voices = new Map();
    this.controller = new AbortController();
    this.selfDoor = null;
    this.local = new LocalSkillFeedback(this);
    this.observation = {
      retained: new Set(),
      retainedVoices: new Set(),
      pending: [],
    };
  }
  setScene(scene) {
    if (scene === this.scene) return;
    this.destroy();
    this.scene = scene;
    this.controller = new AbortController();
    this.local = new LocalSkillFeedback(this);
  }
  predict(skillId, operationId) {
    this.setScene(this.owner.scene);
    return this.local.begin(skillId, operationId);
  }
  async publish() {
    this.setScene(this.owner.scene);
    if (!this.scene) return;
    const source = this.owner.state;
    if (source) {
      await this.observe([source.self.entity, ...this.owner.entities]);
    }
  }
  async observe(entities) {
    this.setScene(this.owner.scene);
    if (!this.scene) return;
    const observation = this.observation;
    observation.retained.clear();
    observation.retainedVoices.clear();
    const pending = observation.pending;
    // Only synchronous reconciliation borrows this scratch; Promise.all captures its inputs.
    pending.length = 0;
    for (const entity of entities) {
      if (entity.kind === "player") this.observePlayer(entity, observation);
    }
    this.reconcileObservation(observation);
    const completed = Promise.all(pending);
    pending.length = 0;
    await completed;
  }
  observePlayer(entity, observation) {
    if (entity.id === this.owner.store.id) {
      this.selfDoor = entity.skillDoor ?? null;
    }
    const base = this.owner.hooks.scene()?.views.get(entity.id)?.animation;
    if (base && entity.combatState) {
      base.container.renderable = entity.combatState.actorVisible;
      base.container.alpha = entity.combatState.opacity;
    }
    for (const visual of entity.skillVisuals ?? EMPTY_ROWS) {
      observation.retained.add(visual.id);
      observation.pending.push(this.visual({ actorId: entity.id, visual }));
    }
    for (const voice of entity.skillVoices ?? EMPTY_ROWS) {
      observation.retainedVoices.add(voice.voiceId);
      observation.pending.push(
        this.sound({
          actorId: entity.id,
          ...voice,
          loop: true,
          stopped: false,
        }),
      );
    }
  }
  reconcileObservation(observation) {
    for (const [id, entry] of this.visuals) {
      if (!observation.retained.has(id)) this.releaseVisual(entry);
    }
    for (const [voiceId, record] of this.voices) {
      if (record.loop && !observation.retainedVoices.has(voiceId)) {
        observation.pending.push(this.sound({ voiceId, stopped: true }));
      }
    }
  }
  async visual(event) {
    this.setScene(this.owner.scene);
    if (!this.scene) return;
    if (this.local.visualEcho(event)) return;
    const state = event.visual;
    const rider = state.riding
      ? this.owner.hooks.scene()?.views.get(event.actorId)?.owner?.resource
      : null;
    const entry = this.retainVisual(event, rider);
    await entry.pending;
    if (entry.disposed || entry.generation !== this.generation) return;
    this.applyVisual(entry);
  }
  retainVisual(event, rider) {
    const state = event.visual;
    let entry = this.visuals.get(state.id);
    if (
      entry &&
      (entry.state.bundle.sha256 !== state.bundle.sha256 ||
        entry.rider !== rider)
    ) {
      this.releaseVisual(entry);
      entry = null;
    }
    if (!entry) {
      if (this.visuals.size >= MAX_VISIBLE) {
        throw new Error("Observed skill actor budget exceeded");
      }
      entry = {
        id: state.id,
        actorId: event.actorId,
        state,
        animation: null,
        owners: [],
        pending: null,
        generation: this.generation,
        disposed: false,
        rider,
      };
      this.visuals.set(state.id, entry);
      entry.pending = this.prepareVisual(entry);
    }
    entry.state = state;
    return entry;
  }
  async prepareVisual(entry) {
    try {
      const state = entry.state;
      const owner = await loadVisualBundle(
        state.bundle,
        this.owner.services,
        this.controller.signal,
      );
      entry.owners.push(owner);
      const prepared = state.riding
        ? await this.prepareRiding(entry, owner)
        : {
            entity: owner.manifest.entities.find(
              (entity) => entity.id === state.entityId,
            ),
            textures: owner.textures,
          };
      if (!prepared.entity) {
        throw new Error("Authoritative skill actor has no original entity");
      }
      if (entry.disposed || entry.generation !== this.generation) {
        this.releaseOwners(entry);
        return;
      }
      entry.animation = new EntityAnimation(prepared.entity, prepared.textures);
      this.scene.addWorldContainer(
        entry.animation.container,
        skillEffectDepth(state.depth),
      );
    } catch (error) {
      this.releaseVisual(entry);
      throw error;
    }
  }
  async prepareRiding(entry, mount) {
    const state = entry.state;
    let saddle = null;
    if (state.riding.saddle) {
      saddle = await loadVisualBundle(
        state.riding.saddle,
        this.owner.services,
        this.controller.signal,
      );
      entry.owners.push(saddle);
    }
    const rider = entry.rider;
    if (!rider) {
      throw new Error(
        "Observed riding actor lacks its current avatar resource",
      );
    }
    const entity = composeRiding(
      mount.manifest.metadata.riding,
      saddle?.manifest.metadata.riding,
      rider.entity,
      state.riding.anchor,
    );
    const textures = new Map(rider.textures);
    for (const [id, texture] of mount.textures) textures.set(id, texture);
    for (const [id, texture] of saddle?.textures ?? []) {
      textures.set(id, texture);
    }
    return { entity, textures };
  }
  applyVisual(entry) {
    const state = entry.state,
      animation = entry.animation;
    if (!animation) return;
    animation.setAction(state.action, state.playback);
    animation.seek(
      state.sourceFrame === null
        ? state.elapsedMs
        : state.sourceFrame === 0
          ? 0
          : animation.current.ends[state.sourceFrame - 1],
    );
    animation.holdFrame = state.sourceFrame !== null;
    this.positionVisual(entry);
    animation.setTint(state.tint);
    animation.container.scale.x = state.scaleX;
    animation.container.scale.y = state.scaleY;
    animation.container.rotation = state.rotation;
    animation.container.alpha = state.opacity;
    animation.container.visible = true;
    // A mount/morph visual replaces its actor and shares the actor's world depth;
    // every other effect draws on the native effect layer above characters.
    const actorDepth = state.replacesActor
      ? this.actorDepth(entry.actorId)
      : null;
    animation.container.zIndex =
      actorDepth === null ? skillEffectDepth(state.depth) : actorDepth;
  }
  /** Chase samples within one playback; a pooled restart starts at its new origin. */
  positionVisual(entry) {
    const { state, animation } = entry;
    if (entry.positioned && entry.playbackId === state.playbackId) {
      entry.fromX = animation.container.position.x;
      entry.fromY = animation.container.position.y;
      entry.chaseMs = 0;
    } else {
      entry.positioned = true;
      entry.playbackId = state.playbackId;
      entry.chaseMs = PUBLISH_MS;
      animation.setPosition(state.position.x, state.position.y);
    }
    entry.targetX = state.position.x;
    entry.targetY = state.position.y;
  }
  actorDepth(actorId) {
    const depth = this.owner.hooks?.scene?.()?.views?.get(actorId)?.animation
      ?.container?.zIndex;
    return Number.isSafeInteger(depth) ? depth : null;
  }
  /** Advance one chased visual by the render delta; never a simulation step. */
  chase(entry, ms) {
    const animation = entry.animation;
    if (
      !animation ||
      entry.chaseMs === undefined ||
      entry.chaseMs >= PUBLISH_MS
    ) {
      return;
    }
    entry.chaseMs = Math.min(PUBLISH_MS, entry.chaseMs + ms);
    const fraction = entry.chaseMs / PUBLISH_MS;
    animation.setPosition(
      entry.fromX + (entry.targetX - entry.fromX) * fraction,
      entry.fromY + (entry.targetY - entry.fromY) * fraction,
    );
  }
  async prepareSound(skillId, leaf) {
    const audio = this.owner.audio.audio;
    if (audio.context?.state !== "running") {
      // A cast is a trusted gesture: enable once and keep the cue instead of dropping it.
      await Promise.resolve(this.owner.audio.enableAudio?.()).catch(() => {});
    }
    if (audio.context?.state !== "running") return null;
    const sound = this.owner.catalog.ui.skills[skillId]?.sounds.leaves[leaf];
    if (!sound?.available) return null;
    const key = `${skillId}:${leaf}`;
    let entry = this.sounds.get(key);
    if (!entry) {
      if (this.sounds.size >= MAX_SOUNDS) {
        throw new Error("Observed skill sound budget exceeded");
      }
      entry = { entry: null, pending: null };
      const generation = this.generation;
      this.sounds.set(key, entry);
      entry.pending = audio
        .acquire(sound.descriptor, this.controller.signal)
        .then((value) => {
          if (generation !== this.generation) {
            value.users--;
            return null;
          }
          entry.entry = value;
          return value;
        });
    }
    return entry.pending;
  }
  async sound(event) {
    if (this.local.soundEcho(event)) return;
    const previous = this.voices.get(event.voiceId);
    if (event.stopped) {
      if (previous) {
        previous.stopped = true;
        if (previous.voice) this.owner.audio.audio.stopVoice(previous.voice);
      }
      this.voices.delete(event.voiceId);
      return;
    }
    if (previous) return;
    const generation = this.generation;
    const record = { voice: null, stopped: false, loop: event.loop };
    this.voices.set(event.voiceId, record);
    const entry = await this.prepareSound(event.skillId, event.leaf);
    if (!entry || record.stopped || generation !== this.generation) {
      if (this.voices.get(event.voiceId) === record) {
        this.voices.delete(event.voiceId);
      }
      return;
    }
    entry.users++;
    record.voice = this.owner.audio.audio.start(entry, "SE", event.loop);
  }
  async cast(event) {
    if (!this.owner.catalog.ui.skills[event.skillId]?.levels[event.rank]) {
      throw new Error("Server cast rank unavailable in original catalog");
    }
    // The server publishes the Use voice event; warm the decoded entry, never start it here.
    await this.prepareSound(event.skillId, "Use");
  }
  async enableAudio() {
    if (!this.owner.store.profile || !this.scene) return;
    for (const [id, rank] of Object.entries(this.owner.store.profile.skills)) {
      if (rank.level > 0) await this.prepareSound(Number(id), "Use");
    }
  }
  enterDoor() {
    const door = this.selfDoor,
      position = this.owner.scene?.presentation;
    if (
      !door?.ready ||
      !position ||
      Math.abs(position.x - door.position.x) >= 20 ||
      Math.abs(position.y - door.position.y) >= 50
    ) {
      return false;
    }
    this.owner
      .request({ kind: "skill.door" })
      .then((result) => {
        if (!result.ok) this.owner.report(result.reason);
      })
      .catch((error) => this.owner.report(error));
    return true;
  }
  update(ms) {
    if (this.scene !== this.owner.scene) {
      this.setScene(this.owner.scene);
      return;
    }
    this.local.draw(ms);
    for (const entry of this.visuals.values()) {
      this.chase(entry, ms);
      if (!entry.animation || entry.state.sourceFrame !== null) continue;
      entry.animation.advance(ms);
      if (entry.animation.completed && entry.state.playback === "once") {
        entry.animation.container.visible = false;
      }
    }
    for (const [id, record] of this.voices) {
      if (record.voice?.ended) this.voices.delete(id);
    }
  }
  /** Detached read-only effect origins for appearance checks; bounded by MAX_VISIBLE. */
  snapshot() {
    const result = [];
    for (const entry of this.visuals.values()) {
      const animation = entry.animation;
      result.push({
        id: entry.id,
        actorId: entry.actorId,
        sourceId: entry.state.sourceId,
        elapsedMs: entry.state.elapsedMs,
        playbackId: entry.state.playbackId,
        frame: animation?.frame ?? null,
        visible: animation?.container.visible ?? false,
        position: animation
          ? { x: animation.container.x, y: animation.container.y }
          : null,
        target: { ...entry.state.position },
      });
    }
    return result;
  }
  releaseOwners(entry) {
    for (const owner of entry.owners) owner.destroy();
    entry.owners.length = 0;
  }
  releaseVisual(entry) {
    if (entry.disposed) return;
    entry.disposed = true;
    if (entry.animation) {
      this.scene?.removeWorldContainer(entry.animation.container);
      entry.animation.container.destroy(DESTROY);
    }
    this.releaseOwners(entry);
    if (this.visuals.get(entry.id) === entry) this.visuals.delete(entry.id);
  }
  destroy() {
    this.local.destroy();
    this.generation++;
    this.controller.abort();
    for (const entry of this.visuals.values()) this.releaseVisual(entry);
    for (const voice of this.voices.values()) {
      voice.stopped = true;
      if (voice.voice) this.owner.audio.audio.stopVoice(voice.voice);
    }
    this.voices.clear();
    for (const sound of this.sounds.values()) {
      if (sound.entry) sound.entry.users--;
    }
    this.sounds.clear();
    this.observation.retained.clear();
    this.observation.retainedVoices.clear();
    this.observation.pending.length = 0;
    this.selfDoor = null;
    this.scene = null;
  }
}
