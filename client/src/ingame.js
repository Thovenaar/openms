import { GameUI } from "./game-ui.js";
import { PortalSystem, PortalTravelGate } from "./portal-system.js";
import { LifeSystem } from "./life-system.js";
import { AudiovisualSystem } from "./audiovisual-system.js";
import { OfflineField } from "./offline-field.js";
import { QuestSystem } from "./quest-system.js";
import { mountNpcDialogue, mountQuestJournal } from "./quest-ui.js";
import { ReactorSystem } from "./reactor-system.js";

/** Candidate fields own resources independently; only committed fields advance. */
class FieldSystems {
  constructor(scene, owner) {
    try {
      this.portals = new PortalSystem(scene, owner.fieldHooks);
      this.reactors = new ReactorSystem(scene, owner.store, {
        onSound: (descriptor) =>
          owner.audio.audio
            .playSound(descriptor, owner.audio.controller.signal)
            .catch(owner.audio.reportBound),
        onChange: owner.profileChanged,
        onError: owner.hooks.onError,
      });
      this.gameplay = new OfflineField(scene, owner.store, {
        ...owner.gameplayHooks,
        onStrike: this.reactors.strike.bind(this.reactors),
      });
      this.life = new LifeSystem(scene, owner.fieldHooks);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  async prepare(signal) {
    await this.gameplay.prepare(signal);
  }
  refresh() {
    this.life.refresh();
    this.reactors.refresh();
  }
  beforePhysics(input) {
    if (!this.gameplay.dead && !this.gameplay.blocksMovement) {
      this.portals.handleInput(input);
    }
  }
  step(ms, input) {
    this.gameplay.step(ms, input);
    this.reactors.step(ms);
  }
  update(ms, input) {
    this.portals.update(ms, input);
    this.life.update(ms);
  }
  snapshot() {
    return {
      portals: this.portals.snapshot(),
      life: this.life.snapshot(),
      gameplay: this.gameplay.snapshot(),
      reactors: this.reactors.snapshot(),
    };
  }
  destroy() {
    this.portals?.destroy();
    this.life?.destroy();
    this.gameplay?.destroy();
    this.reactors?.destroy();
  }
}

/** Screen-owned UI, profile, quests and travel gate survive field replacement. */
export class InGameSystems {
  constructor(app, services, hooks) {
    this.hooks = hooks;
    this.store = null;
    this.quests = null;
    this.travelGate = new PortalTravelGate();
    this.audio = new AudiovisualSystem(app, services, {
      onError: hooks.onError,
    });
    this.playSound = this.playSound.bind(this);
    this.playEffect = this.playEffect.bind(this);
    this.profileChanged = this.profileChanged.bind(this);
    this.ui = new GameUI(app, services, {
      clearInput: hooks.clearInput,
      focusGame: hooks.focusGame,
      onError: hooks.onError,
      onReset: hooks.onReset,
      onSave: hooks.onSave,
      onRecover: () => this.scene?.fieldSystems.gameplay.recover() ?? false,
      onOfferItem: (id) =>
        this.scene?.fieldSystems.reactors.offer(id) ?? {
          accepted: false,
          reason: "No active field",
        },
      playSound: this.playSound,
      onNpcDialogue: (panel, npc) => mountNpcDialogue(panel, npc, this.quests),
      onQuestJournal: (panel) => mountQuestJournal(panel, this.quests),
    });
    this.fieldHooks = {
      travel: hooks.travel,
      travelGate: this.travelGate,
      onError: hooks.onError,
      playSound: this.playSound,
      onInteract: this.ui.showNpc.bind(this.ui),
    };
    this.gameplayHooks = {
      onKill: (templateId) => this.quests.onKill(templateId),
      onEffect: this.playEffect,
      onSound: this.playSound,
      onChange: this.profileChanged,
      onRecover: hooks.onRecover,
    };
  }
  profileChanged() {
    this.ui.refreshProfile();
  }
  playSound(category, name) {
    return this.audio.playSound(category, name).catch(this.audio.reportBound);
  }
  playEffect(name) {
    return this.audio
      .playEffect(name, "offline gameplay")
      .catch(this.audio.reportBound);
  }
  async prepare(catalog, signal, store) {
    this.store = store;
    this.quests = new QuestSystem(catalog.quests, store, {
      onChange: this.profileChanged,
      onEffect: this.playEffect,
    });
    await this.audio.prepare(catalog.audiovisual, signal);
    await this.ui.prepare(catalog.ui, signal);
    this.ui.setProfile(store, this.quests);
    this.restoreSettings();
  }
  restoreSettings() {
    for (const category of ["BGM", "SE"]) {
      const saved = this.store.profile.settings[category];
      this.audio.audio.setVolume(category, saved.volume, saved.mute);
      const root = this.audio.controls.root;
      root.querySelector(`[data-audio-volume="${category}"]`).value =
        saved.volume;
      root.querySelector(`[data-audio-mute="${category}"]`).checked =
        saved.mute;
    }
  }
  checkpointSettings() {
    for (const category of ["BGM", "SE"]) {
      const live = this.audio.audio.settings[category];
      const saved = this.store.profile.settings[category];
      if (live.volume !== saved.volume || live.mute !== saved.mute) {
        saved.volume = live.volume;
        saved.mute = live.mute;
        this.store.markDirty();
      }
    }
  }
  async prepareScene(scene, signal) {
    scene.fieldSystems = new FieldSystems(scene, this);
    await scene.fieldSystems.prepare(signal);
  }
  setScene(scene) {
    this.scene = scene;
    this.ui.setScene(scene);
    this.audio.setScene(scene);
  }
  updateInterface(ms) {
    this.ui.update(ms);
    this.audio.update(ms);
  }
  resize(width, height) {
    this.ui.resize(width, height);
  }
  snapshot() {
    return {
      ui: this.ui.snapshot(),
      audiovisual: this.audio.snapshot(),
      quests: this.quests?.snapshot() ?? null,
    };
  }
  destroy() {
    this.ui.destroy();
    this.audio.destroy();
  }
}
