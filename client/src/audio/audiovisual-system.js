import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { check, aborted } from "../rendering/stream-network.js";
import { AudioEngine } from "./audio-engine.js";
import { GameplayEffects } from "./gameplay-effects.js";

const MAX_EFFECTS = 32;
const MAX_SOUND_NAMES = 512;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DESTROY_DISPLAY = Object.freeze({ children: true });
const MOB_ATTACK_SOUNDS = Object.freeze({
  attack1: "Attack1",
  attack2: "Attack2",
  attack3: "Attack3",
  attack4: "Attack4",
  attack5: "Attack5",
  attack6: "Attack6",
  attack7: "Attack7",
  attack8: "Attack8",
});

/** 009894f3: distance scalar (not stereo pan); exact doubles retained in combat evidence. */
export function combatSoundVolume(source, listener) {
  const dx = source.x - listener.x,
    dy = source.y - listener.y;
  const distance = Math.sqrt(dx * dx + dy * dy + 0.001);
  if (distance < 250) return 100;
  return distance > 1000 ? 40 : Math.trunc(120 - distance * 0.08);
}

function validateIndex(index) {
  if (
    index?.schemaVersion !== 1 ||
    !index.maps ||
    !index.effects ||
    !index.sounds
  ) {
    throw new Error("Invalid audiovisual catalog");
  }
  if (
    Object.keys(index.maps).length > 1024 ||
    Object.keys(index.effects).length > MAX_EFFECTS
  ) {
    throw new Error("Audiovisual catalog budget exceeded");
  }
  for (const category of ["UI", "Game"]) {
    if (
      !index.sounds[category] ||
      Object.keys(index.sounds[category]).length > MAX_SOUND_NAMES
    ) {
      throw new Error(`Invalid ${category} sound catalog`);
    }
  }
  validateLogin(index.login);
  validateEffects(index.effects);
}

/** Optional login/title music record: absent is valid, a present one must be a sound. */
function validateLogin(login) {
  if (login === undefined) return;
  if (!login?.bgm || !validDescriptor(login.bgm)) {
    throw new Error("Invalid login music descriptor");
  }
}

/** A published sound descriptor always names its exact original source and bytes. */
function validDescriptor(descriptor) {
  return Boolean(
    descriptor &&
    typeof descriptor.url === "string" &&
    descriptor.url.startsWith("/generated/audio/") &&
    HASH_PATTERN.test(descriptor.sha256) &&
    Number.isSafeInteger(descriptor.bytes) &&
    descriptor.bytes > 0 &&
    typeof descriptor.source === "string" &&
    descriptor.source.startsWith("Sound.wz:"),
  );
}

function validateEffects(effects) {
  for (const record of Object.values(effects)) {
    if (
      !record.bundle ||
      record.timingSupported !== true ||
      !Number.isFinite(record.durationMs) ||
      record.durationMs <= 0 ||
      record.durationMs > 60000
    ) {
      throw new Error("Unsupported effect presentation metadata");
    }
  }
}

function button(text, action) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.dataset.audioAction = action;
  return node;
}

function volumeControls(root, category) {
  const name = category === "BGM" ? "Music" : "Sound effects";
  const row = document.createElement("div");
  row.className = "audio-channel";
  const label = document.createElement("label");
  label.textContent = name;
  label.htmlFor = `audio-volume-${category}`;
  const output = document.createElement("output");
  output.dataset.audioLevel = category;
  output.setAttribute("for", label.htmlFor);
  output.value = "50%";
  const range = document.createElement("input");
  range.id = label.htmlFor;
  range.type = "range";
  range.min = "0";
  range.max = "128";
  range.step = "1";
  range.value = "64";
  range.dataset.audioVolume = category;
  range.setAttribute("aria-label", `${name} volume`);
  const muteLabel = document.createElement("label");
  muteLabel.className = "check";
  const mute = document.createElement("input");
  mute.type = "checkbox";
  mute.dataset.audioMute = category;
  mute.setAttribute("aria-label", `${name} mute`);
  muteLabel.append(mute, "Mute");
  row.append(label, output, range, muteLabel);
  root.append(row);
}

/** Browser controls are clearly reconstruction controls, not fabricated original UI artwork. */
function makeControls() {
  const root = document.createElement("section");
  root.dataset.audiovisualControls = "true";
  root.append(button("Enable / resume audio", "enable"));
  for (const category of ["BGM", "SE"]) volumeControls(root, category);
  const advanced = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Effects & audio diagnostics";
  advanced.append(summary);
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Original effect preview");
  advanced.append(
    select,
    button("Preview once (not a server event)", "effect"),
    button("Preview map effect", "map-effect"),
    button("Capture 2 s live PCM", "capture"),
  );
  root.append(advanced);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.className = "hint";
  status.textContent = "Click the game or enable audio to start playback.";
  root.append(status);
  document.querySelector("#audio-controls")?.append(root);
  return { root, select, status };
}

/** Domain owner; owns effects before their shared resource leases and audio output graph. */
export class AudiovisualSystem {
  constructor(app, services, hooks) {
    this.app = app;
    this.services = services;
    this.hooks = hooks;
    this.destroyed = false;
    this.index = null;
    this.scene = null;
    this.sceneGeneration = 0;
    this.effectGeneration = 0;
    this.controller = new AbortController();
    this.effectController = new AbortController();
    this.effect = null;
    this.teleport = null;
    this.gameplayEffects = new GameplayEffects(services);
    this.loadingEffect = false;
    this.lastError = null;
    this.controls = makeControls();
    this.reportBound = this.report.bind(this);
    this.clickBound = this.click.bind(this);
    this.inputBound = this.input.bind(this);
    this.keyBound = this.key.bind(this);
    this.gestureBound = this.onGesture.bind(this);
    this.unlocking = null;
    this.audio = new AudioEngine(services.network, this.reportBound);
    this.controls.root.addEventListener("click", this.clickBound);
    this.controls.root.addEventListener("input", this.inputBound);
    this.controls.root.addEventListener("keydown", this.keyBound);
    this.controls.root.addEventListener("keyup", this.keyBound);
    this.listenForGesture(true);
  }
  /** Observe activation without consuming the human's gameplay or UI event. */
  listenForGesture(attach) {
    const document = this.controls.root.ownerDocument;
    if (attach) {
      document.addEventListener("pointerdown", this.gestureBound, {
        capture: true,
        passive: true,
      });
      document.addEventListener("keydown", this.gestureBound, true);
    } else {
      document.removeEventListener("pointerdown", this.gestureBound, true);
      document.removeEventListener("keydown", this.gestureBound, true);
    }
  }
  onGesture(event) {
    if (
      !event.isTrusted ||
      this.destroyed ||
      navigator.userActivation?.isActive === false
    ) {
      return;
    }
    this.enableAudio().catch(this.reportBound);
  }
  /** One in-flight graph/BGM startup serves the first gesture and explicit control. */
  enableAudio() {
    if (!this.unlocking) this.unlocking = this.finishEnable();
    return this.unlocking;
  }
  async finishEnable() {
    try {
      await this.audio.enable();
      if (this.destroyed) return;
      await this.prepareEventSounds(this.controller.signal);
      const mobs = this.scene?.fieldSystems?.gameplay.mobs;
      if (mobs) await this.prepareMobSounds(mobs, this.controller.signal);
      this.listenForGesture(false);
      this.controls.status.textContent = "Audio ready.";
      await this.hooks.onEnabled?.();
    } finally {
      this.unlocking = null;
    }
  }
  report(error) {
    if (this.destroyed || error.name === "AbortError") return;
    this.lastError = error.message;
    this.controls.status.textContent = error.message;
    this.hooks.onError(error);
  }
  key(event) {
    event.stopPropagation();
  }
  click(event) {
    const action = event.target.closest("[data-audio-action]")?.dataset
      .audioAction;
    if (!action) return;
    event.stopPropagation();
    this.perform(action).catch(this.reportBound);
  }
  async perform(action) {
    if (action === "enable") {
      await this.enableAudio();
    } else if (action === "effect") {
      await this.playEffect(this.controls.select.value);
    } else if (action === "map-effect") {
      const name = this.index?.maps[this.scene?.manifest.id]?.effect;
      if (!name) throw new Error("This map has no authored MapEff binding");
      await this.playEffect(name);
    } else if (action === "capture") {
      const pcm = await this.capturePCM(2);
      if (!this.destroyed) {
        this.controls.status.textContent = `Live PCM: ${pcm.frames} frames, RMS ${pcm.rms.toFixed(6)}, peak ${pcm.peak.toFixed(6)}; ${pcm.audible ? "nonzero real output" : "SILENT — no audible evidence"}.`;
      }
    }
  }
  input(event) {
    const category =
      event.target.dataset.audioVolume ?? event.target.dataset.audioMute;
    if (category !== "BGM" && category !== "SE") return;
    const root = this.controls.root;
    this.audio.setVolume(
      category,
      Number(root.querySelector(`[data-audio-volume="${category}"]`).value),
      root.querySelector(`[data-audio-mute="${category}"]`).checked,
    );
    this.refreshVolumeControls();
  }
  refreshVolumeControls() {
    for (const category of ["BGM", "SE"]) {
      const range = this.controls.root.querySelector(
        `[data-audio-volume="${category}"]`,
      );
      const text = `${Math.round((Number(range.value) * 100) / 128)}%`;
      this.controls.root.querySelector(
        `[data-audio-level="${category}"]`,
      ).value = text;
      range.setAttribute("aria-valuetext", text);
    }
  }
  async prepare(index, signal) {
    check(signal);
    if (this.destroyed) throw aborted();
    validateIndex(index);
    this.controller.abort();
    this.controller = new AbortController();
    this.clearEffect();
    this.index = index;
    this.controls.select.replaceChildren();
    for (const name of Object.keys(index.effects)) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      this.controls.select.append(option);
    }
    check(signal);
    await this.prepareTeleport(signal);
    await this.gameplayEffects.prepare(index, signal);
    await this.prepareEventSounds(signal);
  }
  async prepareEventSounds(signal) {
    if (!this.index) return;
    for (const name of ["LevelUp", "QuestClear"]) {
      const descriptor = this.index.sounds.Game[name];
      if (!descriptor) throw new Error(`Unpackaged original Game/${name}`);
      await this.audio.prepareSound(descriptor, signal);
    }
  }
  /** Retain both original Teleport instances before travel can publish a field. */
  async prepareTeleport(signal) {
    const record = this.index.effects.Teleport;
    if (!record) throw new Error("Original Teleport effect is not packaged");
    const owner = await loadVisualBundle(record.bundle, this.services, signal);
    const animations = [];
    try {
      check(signal);
      if (this.destroyed) throw aborted();
      if (owner.manifest.entities.length !== 1) {
        throw new Error("Teleport bundle must contain one original effect");
      }
      const entity = owner.manifest.entities[0];
      for (let index = 0; index < 2; index++) {
        animations.push(new EntityAnimation(entity, owner.textures));
      }
      this.destroyTeleport();
      this.teleport = {
        owner,
        animations,
        action: entity.action,
        durationMs: record.durationMs,
        remaining: 0,
        scene: null,
      };
    } catch (error) {
      for (const animation of animations) {
        animation.container.destroy(DESTROY_DISPLAY);
      }
      owner.destroy();
      throw error;
    }
  }
  /** BasicEff/Teleport: simultaneous departure/arrival, four authored80ms frames. */
  playTeleport(departure, arrival) {
    if (!this.scene || !this.teleport || this.destroyed) {
      throw new Error("Teleport presentation requires a prepared field");
    }
    for (const point of [departure, arrival]) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
        throw new Error("Invalid teleport presentation position");
      }
    }
    this.clearTeleport();
    const effect = this.teleport;
    effect.scene = this.scene;
    effect.remaining = effect.durationMs;
    for (let index = 0; index < effect.animations.length; index++) {
      const animation = effect.animations[index];
      const point = index === 0 ? departure : arrival;
      animation.setAction(effect.action, "once", true);
      animation.setPosition(point.x, point.y);
      this.scene.addWorldContainer(animation.container, 398500);
    }
  }
  clearTeleport() {
    const effect = this.teleport;
    if (!effect?.scene) return;
    for (const animation of effect.animations) {
      effect.scene.removeWorldContainer(animation.container);
    }
    effect.scene = null;
    effect.remaining = 0;
  }
  destroyTeleport() {
    this.clearTeleport();
    if (!this.teleport) return;
    for (const animation of this.teleport.animations) {
      animation.container.destroy(DESTROY_DISPLAY);
    }
    this.teleport.owner.destroy();
    this.teleport = null;
  }
  /** Login/title music shares the one BGM channel: the request is remembered while
   * audio is still locked, and a committed scene replaces it through setScene. */
  setTitleBgm(descriptor) {
    if (this.destroyed) return Promise.resolve();
    return this.audio.setBGM(descriptor ?? null);
  }

  setScene(scene) {
    if (this.destroyed) return;
    this.controller.abort();
    this.controller = new AbortController();
    this.sceneGeneration++;
    this.clearEffect();
    this.clearTeleport();
    this.gameplayEffects.clear();
    this.scene = scene;
    const record = this.index?.maps[scene?.manifest.id];
    if (scene && !record) {
      this.report(new Error("Committed map missing audiovisual metadata"));
      return;
    }
    this.setMapAudio(record?.bgm ?? null, this.sceneGeneration);
    this.controls.status.textContent = record?.effect
      ? "This map has an effect available in previews."
      : "";
  }
  async setMapAudio(descriptor, generation) {
    try {
      await this.audio.setBGM(descriptor);
    } catch (error) {
      if (generation === this.sceneGeneration) this.report(error);
    }
  }
  /** Exact names only. Caller must supply an accepted client/UI event, never predicted combat. */
  async playSound(category, name) {
    if (this.destroyed) throw aborted();
    if (category !== "UI" && category !== "Game") {
      throw new Error("Unsupported sound category");
    }
    const descriptor = this.index?.sounds[category]?.[name];
    if (!descriptor) {
      throw new Error(`Unpackaged original sound ${category}/${name}`);
    }
    return this.audio.playSound(descriptor, this.controller.signal);
  }
  /**0052310b: original Invite cue; a failed error cue must not report another error. */
  async notifyError() {
    try {
      return await this.playSound("UI", "Invite");
    } catch (error) {
      if (this.destroyed || error.name === "AbortError") {
        return { status: "cancelled" };
      }
      this.lastError = error.message;
      this.controls.status.textContent = error.message;
      return { status: "failed", error: error.message };
    }
  }
  /** Missing authored nodes are silence; accepted events never queue across an audio gesture. */
  combatSound(category, id, name, percent = 100) {
    const family = this.index?.combat?.sounds[category]?.[id];
    if (this.destroyed) return;
    if (!family) {
      this.report(
        new Error(`Unpackaged original ${category} sound family ${id}`),
      );
      return;
    }
    const record = family[name];
    if (!record) return; // The packaged family explicitly has no authored node.
    if (!record.available) {
      this.report(new Error(`${record.source}: ${record.reason}`));
      return;
    }
    this.audio
      .playSound(record.descriptor, this.controller.signal, percent)
      .catch(this.reportBound);
  }
  /** Warm authored death PCM before field activation; no voice and no gesture replay. */
  async prepareMobSounds(mobs, signal) {
    if (!Array.isArray(mobs) || mobs.length > 4096) {
      throw new Error("Invalid field mob sound preparation");
    }
    const ids = new Set();
    for (const mob of mobs) {
      if (ids.has(mob.templateId)) continue;
      ids.add(mob.templateId);
      const family = this.index?.combat?.sounds.Mob[mob.templateId];
      if (!family) {
        throw new Error(
          `Unpackaged original Mob sound family ${mob.templateId}`,
        );
      }
      const record = family.Die;
      if (!record) continue;
      if (!record.available) {
        this.report(new Error(`${record.source}: ${record.reason}`));
        continue;
      }
      await this.audio.prepareSound(record.descriptor, signal);
    }
  }
  onPlayerAttack(sfx) {
    this.combatSound("Weapon", sfx, "Attack");
  }
  onMobHit(mob, damage, simulation) {
    if (damage <= 0 || !mob.alive) return;
    this.combatSound(
      "Mob",
      mob.templateId,
      "Damage",
      combatSoundVolume(mob, simulation),
    );
  }
  /**00989ba1 selector1 is Die; the field calls this once at accepted death entry. */
  onMobDeath(mob, simulation) {
    this.combatSound(
      "Mob",
      mob.templateId,
      "Die",
      combatSoundVolume(mob, simulation),
    );
  }
  onMobAttack(mob, simulation) {
    const name = MOB_ATTACK_SOUNDS[mob.action];
    if (name) {
      this.combatSound(
        "Mob",
        mob.templateId,
        name,
        combatSoundVolume(mob, simulation),
      );
    }
  }
  onPlayerHit(hit, simulation) {
    if (hit.amount <= 0 || !hit.source) return;
    const name =
      hit.attackAction === "attack1"
        ? "CharDam1"
        : hit.attackAction === "attack2"
          ? "CharDam2"
          : null;
    if (name) {
      this.combatSound(
        "Mob",
        hit.source.templateId,
        name,
        combatSoundVolume(hit.source, simulation),
      );
    }
  }
  onPlayerDeath() {
    this.playSound("Game", "Tombstone").catch(this.reportBound);
  }
  /** Committed LevelUp/QuestClear own independent sequences and matching Game sounds. */
  async playGameplayEffect(name, target = null) {
    if (name !== "LevelUp" && name !== "QuestClear") {
      return this.playEffect(name, "offline gameplay");
    }
    if (this.destroyed) throw aborted();
    this.gameplayEffects.play(name, this.scene, target);
    // Start sound at event admission, not after fetching or finishing the visual sequence.
    return this.playSound("Game", name);
  }
  /** Explicit previews share one cancellable slot, separate from committed gameplay events. */
  async playEffect(name, trigger = "inspection") {
    const record = this.index?.effects[name],
      scene = this.scene;
    if (this.destroyed || !scene || !record) {
      throw new Error(`Effect ${name} requires a packaged scene/effect`);
    }
    this.clearEffect();
    this.effectController = new AbortController();
    const generation = this.effectGeneration;
    const signal = this.effectController.signal;
    this.loadingEffect = true;
    let owner;
    try {
      owner = await loadVisualBundle(record.bundle, this.services, signal);
      check(signal);
      if (generation !== this.effectGeneration || scene !== this.scene) {
        throw aborted();
      }
      if (owner.manifest.entities.length !== 1) {
        throw new Error("Effect bundle must have one entity");
      }
      const animation = new EntityAnimation(
        owner.manifest.entities[0],
        owner.textures,
      );
      animation.setPosition(scene.simulation.x, scene.simulation.y);
      // 0093780b supplies native root B+398500 for LevelUp, not a UI overlay.
      // Other explicit previews share this world-effect plane as preview policy.
      scene.addWorldContainer(animation.container, 398500);
      this.effect = {
        scene,
        name,
        owner,
        animation,
        remaining: record.durationMs,
      };
      owner = null;
      this.controls.status.textContent = `${name}: original frames/timing; ${trigger} trigger is local policy.`;
    } finally {
      if (owner) owner.destroy();
      if (generation === this.effectGeneration) this.loadingEffect = false;
    }
  }
  update(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid audiovisual elapsed time");
    }
    this.gameplayEffects.update(ms);
    const teleport = this.teleport;
    if (teleport?.scene) {
      teleport.remaining -= ms;
      if (teleport.remaining <= 0) this.clearTeleport();
      else {
        for (const animation of teleport.animations) animation.advance(ms);
      }
    }
    const effect = this.effect;
    if (!effect) return;
    effect.remaining -= ms;
    if (effect.remaining <= 0) {
      this.clearEffect();
      return;
    }
    if (effect.name === "LevelUp") {
      const pose = effect.scene.presentation ?? effect.scene.simulation;
      effect.animation.setPosition(pose.x, pose.y);
    }
    effect.animation.advance(ms);
  }
  clearEffect() {
    this.effectGeneration++;
    this.effectController.abort();
    this.loadingEffect = false;
    if (!this.effect) return;
    const effect = this.effect;
    this.effect = null;
    effect.scene.removeWorldContainer(effect.animation.container);
    effect.animation.container.destroy(DESTROY_DISPLAY);
    effect.owner.destroy();
  }
  capturePCM(seconds = 2) {
    return this.audio.capturePCM(seconds);
  }
  snapshot() {
    return {
      ...this.audio.snapshot(),
      mapId: this.scene?.manifest.id ?? null,
      mapEffect: this.index?.maps[this.scene?.manifest.id]?.effect ?? null,
      effect: this.effect
        ? {
            name: this.effect.name,
            remainingMs: this.effect.remaining,
            frame: this.effect.animation.frame,
          }
        : null,
      loadingEffect: this.loadingEffect,
      gameplayEffects: this.gameplayEffects.snapshot(),
      lastError: this.lastError,
      teleport: this.teleport?.scene
        ? {
            remainingMs: this.teleport.remaining,
            frames: this.teleport.animations.map(
              (animation) => animation.frame,
            ),
          }
        : null,
      authoritativeEffects: false,
      unsupported: [
        "server event activation",
        "MapEff automatic trigger/placement",
        "original BGM fade interpolation",
        "original settings-slider to backend-volume mapping",
      ],
    };
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listenForGesture(false);
    this.controller.abort();
    this.clearEffect();
    this.destroyTeleport();
    this.gameplayEffects.destroy();
    this.effectController.abort();
    this.scene = null;
    this.index = null;
    this.audio.destroy();
    const root = this.controls.root;
    root.removeEventListener("click", this.clickBound);
    root.removeEventListener("input", this.inputBound);
    root.removeEventListener("keydown", this.keyBound);
    root.removeEventListener("keyup", this.keyBound);
    root.remove();
  }
}
