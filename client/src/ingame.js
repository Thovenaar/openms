import { GameUI } from "./game-ui.js";
import { PortalSystem, PortalTravelGate } from "./portal-system.js";
import { LifeSystem } from "./life-system.js";
import { AudiovisualSystem } from "./audiovisual-system.js";
import { OfflineField } from "./offline-field.js";
import { QuestSystem } from "./quest-system.js";
import { mountNpcDialogue, mountQuestJournal } from "./quest-ui.js";
import { ReactorSystem } from "./reactor-system.js";
import { KeyBindings } from "./key-bindings.js";
import { SpeechBubbles } from "./speech-bubbles.js";
import { CombatPresentation } from "./combat-presentation.js";

/** Candidate fields own resources independently; only committed fields advance. */
class FieldSystems {
  constructor(scene, owner) {
    this.scene = scene;
    this.owner = owner;
    this.speechPose = { x: 0, headY: 0 };
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
        onAttack: () =>
          owner.audio.onPlayerAttack(scene.manifest.combat.equipment.sfx),
        onPlayerHit: this.playerHit.bind(this),
        onMobHit: this.mobHit.bind(this),
        onMobAttack: (mob) => owner.audio.onMobAttack(mob, scene.simulation),
        onPlayerDeath: owner.audio.onPlayerDeath.bind(owner.audio),
      });
      this.life = new LifeSystem(scene, owner.fieldHooks);
      this.speech = new SpeechBubbles(owner.app, owner.services);
      this.speech.setScene(scene);
      this.combat = new CombatPresentation(owner.app, owner.services);
      this.combat.setScene(scene);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  async prepare(signal) {
    await Promise.all([
      this.gameplay.prepare(signal),
      this.speech.prepare(this.owner.catalog, signal),
      this.combat.prepare(this.owner.catalog.audiovisual, signal),
    ]);
  }
  playerHit(hit, simulation) {
    this.combat.onPlayerHit(hit, simulation);
    this.owner.audio.onPlayerHit(hit, simulation);
  }
  mobHit(mob, amount) {
    this.combat.onMobHit(mob, amount);
    this.owner.audio.onMobHit(mob, amount, this.scene.simulation);
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
    this.combat.update(ms);
    this.gameplay.step(ms, input);
    this.reactors.step(ms);
  }
  update(ms, input) {
    this.portals.update(ms, input);
    this.life.update(ms);
    const pose = this.scene.presentation;
    this.speechPose.x = pose.x;
    this.speechPose.headY =
      pose.y + this.scene.actor.current.geometry[this.scene.actor.frame].y;
    this.speech.update(ms, this.speechPose, this.scene.camera);
  }
  snapshot() {
    return {
      portals: this.portals.snapshot(),
      life: this.life.snapshot(),
      gameplay: this.gameplay.snapshot(),
      reactors: this.reactors.snapshot(),
      speech: this.speech.snapshot(),
      combatPresentation: this.combat.snapshot(),
    };
  }
  destroy() {
    this.portals?.destroy();
    this.life?.destroy();
    this.gameplay?.destroy();
    this.reactors?.destroy();
    this.speech?.destroy();
    this.combat?.destroy();
  }
}

/** Screen-owned UI, profile, quests and travel gate survive field replacement. */
export class InGameSystems {
  constructor(app, services, hooks) {
    this.app = app;
    this.services = services;
    this.catalog = null;
    this.worldPointer = { x: 0, y: 0 };
    this.hooks = hooks;
    this.store = null;
    this.bindings = null;
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
      onStatus: hooks.onStatus,
      onReset: hooks.onReset,
      onSave: hooks.onSave,
      onChatSubmit: this.submitChat.bind(this),
      isWorldInteractive: this.isWorldInteractive.bind(this),
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
  submitChat(text) {
    if (!this.scene || this.hooks.isBlocked() || this.ui.blocksGameplay()) {
      return false;
    }
    return this.scene.fieldSystems.speech.show(text);
  }
  isWorldInteractive(clientX, clientY) {
    if (!this.scene || this.hooks.isBlocked()) return false;
    const events = this.app.renderer.events;
    events.mapPositionToPoint(this.worldPointer, clientX, clientY);
    const target = events.rootBoundary.hitTest(
      this.worldPointer.x,
      this.worldPointer.y,
    );
    return this.scene.fieldSystems.life.isInteractiveTarget(target);
  }
  playSound(category, name) {
    return this.audio.playSound(category, name).catch(this.audio.reportBound);
  }
  playEffect(name) {
    return this.audio
      .playEffect(name, "offline gameplay")
      .catch(this.audio.reportBound);
  }
  activateBinding(name) {
    if (name === "Attack" || name === "Jump") {
      this.hooks.focusGame();
      this.hooks.tap(name === "Attack" ? "attack" : "jump");
    } else {
      this.ui.activate(name);
    }
    return true;
  }
  async prepare(catalog, signal, store) {
    this.store = store;
    this.catalog = catalog;
    this.quests = new QuestSystem(catalog.quests, store, {
      onChange: this.profileChanged,
      onEffect: this.playEffect,
    });
    await this.audio.prepare(catalog.audiovisual, signal);
    await this.ui.prepare(catalog.ui, signal);
    this.ui.setProfile(store, this.quests);
    const bindings = new KeyBindings(store, catalog, {
      onAction: (name) => this.activateBinding(name),
      isBlocked: () =>
        !this.scene || this.hooks.isBlocked() || this.ui.blocksGameplay(),
      now: () => performance.now(),
      report: (message) => this.ui.status(message),
    });
    this.bindings?.destroy();
    this.bindings = bindings;
    this.ui.setBindings(bindings);
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
    this.bindings?.destroy();
    this.audio.destroy();
  }
}
