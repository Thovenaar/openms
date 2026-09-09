import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { check, aborted } from "./stream-network.js";
import { AudioEngine } from "./audio-engine.js";

const MAX_EFFECTS = 32;
const MAX_SOUND_NAMES = 512;
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
    Object.keys(index.maps).length > 512 ||
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
  validateEffects(index.effects);
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

/** Browser controls are clearly reconstruction controls, not fabricated original UI artwork. */
function makeControls() {
  const root = document.createElement("section");
  root.dataset.audiovisualControls = "true";
  root.append(button("Enable audio (user gesture)", "enable"));
  for (const category of ["BGM", "SE"]) {
    const label = document.createElement("label");
    label.style.cssText = "display:block;margin:6px 0";
    label.append(`${category} backend volume `);
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "128";
    range.step = "1";
    range.value = "64";
    range.dataset.audioVolume = category;
    range.setAttribute("aria-label", `${category} volume`);
    const mute = document.createElement("input");
    mute.type = "checkbox";
    mute.dataset.audioMute = category;
    mute.setAttribute("aria-label", `${category} mute`);
    label.append(range, mute, "Mute");
    root.append(label);
  }
  const advanced = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Original effect previews / live audio capture";
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
  status.textContent =
    "Audio requires a gesture. Effect activation/placement previews are non-authoritative.";
  root.append(status);
  document.querySelector("#audio-controls").append(root);
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
    this.loadingEffect = false;
    this.lastError = null;
    this.controls = makeControls();
    this.reportBound = this.report.bind(this);
    this.clickBound = this.click.bind(this);
    this.inputBound = this.input.bind(this);
    this.keyBound = this.key.bind(this);
    this.audio = new AudioEngine(services.network, this.reportBound);
    this.controls.root.addEventListener("click", this.clickBound);
    this.controls.root.addEventListener("input", this.inputBound);
    this.controls.root.addEventListener("keydown", this.keyBound);
    this.controls.root.addEventListener("keyup", this.keyBound);
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
      await this.audio.enable();
      if (!this.destroyed) {
        this.controls.status.textContent =
          "Original MP3 playback enabled. Independent original backend volume curve.";
      }
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
  }
  setScene(scene) {
    if (this.destroyed) return;
    this.controller.abort();
    this.controller = new AbortController();
    this.sceneGeneration++;
    this.clearEffect();
    this.scene = scene;
    const record = this.index?.maps[scene?.manifest.id];
    if (scene && !record) {
      this.report(new Error("Committed map missing audiovisual metadata"));
      return;
    }
    this.setMapAudio(record?.bgm ?? null, this.sceneGeneration);
    this.controls.status.textContent = record?.effect
      ? `Authored map effect: ${record.effect}. Preview placement/trigger is local, not original live activation.`
      : "Original map BGM selected. Server-driven effects are local previews only.";
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
  /** Missing authored nodes are silence; accepted events never queue across an audio gesture. */
  combatSound(category, id, name, percent = 100) {
    const record = this.index?.combat?.sounds[category]?.[id]?.[name];
    if (!record || this.destroyed) return;
    if (!record.available) {
      this.report(new Error(`${record.source}: ${record.reason}`));
      return;
    }
    this.audio
      .playSound(record.descriptor, this.controller.signal, percent)
      .catch(this.reportBound);
  }
  onPlayerAttack(sfx) {
    this.combatSound("Weapon", sfx, "Attack");
  }
  onMobHit(mob, damage, simulation) {
    if (damage <= 0) return;
    this.combatSound(
      "Mob",
      mob.templateId,
      mob.alive ? "Damage" : "Die",
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
  /** One bounded effect slot; gameplay and inspection triggers share resource ownership. */
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
      scene.overlays.addChild(animation.container);
      this.effect = { name, owner, animation, remaining: record.durationMs };
      owner = null;
      this.controls.status.textContent = `${name}: original frames/timing; ${trigger} trigger is local policy.`;
    } finally {
      if (owner) owner.destroy();
      if (generation === this.effectGeneration) this.loadingEffect = false;
    }
  }
  update(ms) {
    const effect = this.effect;
    if (!effect) return;
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid audiovisual elapsed time");
    }
    effect.remaining -= ms;
    if (effect.remaining <= 0) {
      this.clearEffect();
      return;
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
      lastError: this.lastError,
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
    this.controller.abort();
    this.clearEffect();
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
