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
import { PlayerName } from "./player-name.js";
import { SkillSystem } from "./skill-system.js";
import { CharacterDevelopment } from "./character-development.js";
import { DropSystem } from "./drop-system.js";
import { DropRenderer } from "./drop-renderer.js";

/** Candidate fields own resources independently; only committed fields advance. */
class FieldSystems {
  constructor(scene, owner, context = {}) {
    const store = context.store ?? owner.store;
    const travelGate = context.travelGate ?? owner.travelGate;
    this.scene = scene;
    this.owner = owner;
    this.speechPose = { x: 0, headY: 0 };
    try {
      this.portals = new PortalSystem(scene, {
        ...owner.fieldHooks,
        travelGate,
      });
      this.reactors = new ReactorSystem(scene, store, {
        onSound: (descriptor) =>
          owner.audio.audio
            .playSound(descriptor, owner.audio.controller.signal)
            .catch(owner.audio.reportBound),
        onChange: owner.profileChanged,
        onError: owner.hooks.onError,
      });
      this.skills = this.createSkills(store);
      this.drops = this.createDrops(store);
      this.gameplay = this.createGameplay(store);
      this.life = new LifeSystem(scene, owner.fieldHooks);
      this.speech = new SpeechBubbles(owner.app, owner.services);
      this.speech.setScene(scene);
      this.combat = new CombatPresentation(owner.app, owner.services);
      this.combat.setScene(scene);
      this.name = new PlayerName(scene, store);
      this.name.step(owner.app.renderer.resolution);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  createSkills(store) {
    const scene = this.scene,
      owner = this.owner;
    return new SkillSystem(scene, store, owner.catalog, {
      services: owner.services,
      audio: owner.audio.audio,
      report: owner.hooks.onError,
      isBlocked: () =>
        scene !== owner.scene ||
        owner.hooks.isBlocked() ||
        owner.ui.blocksGameplay(),
      validateCast: () => this.gameplay.skillCastError(),
      supportsAction: (action) => scene.actor.actions.has(action),
      validateAttack: (skill, info) =>
        this.gameplay.skillAttackError(skill, info),
      admitAttack: (skill, info, onHit) =>
        this.gameplay.beginSkillAttack(skill, info, onHit),
      startAction: (action) => this.gameplay.beginSkillPose(action),
    });
  }
  createDrops(store) {
    const owner = this.owner;
    const drops = new DropSystem(
      owner.catalog.drops,
      store,
      this.scene.manifest.physics.footholds,
      {
        items: owner.catalog.ui.items,
        random: owner.hooks.random,
        onSound: (name) => owner.playSound("Game", name),
      },
    );
    this.dropRenderer = new DropRenderer(
      this.scene,
      drops,
      owner.services,
      owner.catalog.ui.dropArtwork,
    );
    return drops;
  }
  createGameplay(store) {
    const scene = this.scene,
      owner = this.owner;
    return new OfflineField(scene, store, {
      ...owner.gameplayHooks,
      onKill: (templateId, mob) => {
        owner.quests.onKill(templateId);
        const result = this.drops.spawn(mob);
        if (!result.ok) owner.ui.status(result.reason);
      },
      skillLevel: this.skills.level.bind(this.skills),
      skillInfo: this.skills.info.bind(this.skills),
      hpGrowth: this.skills.hpGrowth.bind(this.skills),
      derivedStats: this.skills.derived.bind(this.skills),
      onStrike: this.reactors.strike.bind(this.reactors),
      onAttack: () => {
        owner.hooks.onEvent?.("player-attack", scene.actor.id, null);
        owner.audio.onPlayerAttack(scene.manifest.combat.equipment.sfx);
      },
      onPlayerHit: this.playerHit.bind(this),
      onRecovery: (amount, simulation) =>
        this.combat.onRecovery(amount, simulation),
      onMobHit: this.mobHit.bind(this),
      onMobAttack: (mob) => owner.audio.onMobAttack(mob, scene.simulation),
      onPlayerDeath: () => {
        this.skills.onDeath();
        owner.hooks.onEvent?.("player-death", scene.actor.id, null);
        owner.audio.onPlayerDeath();
        owner.showRevival();
      },
    });
  }
  async prepare(signal) {
    await Promise.all([
      this.gameplay.prepare(signal),
      this.speech.prepare(this.owner.catalog, signal),
      this.combat.prepare(this.owner.catalog.audiovisual, signal),
      this.skills.prepare(),
      this.dropRenderer.prepare(signal),
    ]);
  }
  playerHit(hit, simulation) {
    this.owner.hooks.onEvent?.("player-hit", hit.source?.id ?? "", hit.amount);
    this.combat.onPlayerHit(hit, simulation);
    this.owner.audio.onPlayerHit(hit, simulation);
  }
  mobHit(mob, amount) {
    this.owner.hooks.onEvent?.("mob-hit", mob.id, amount);
    if (!mob.alive) this.owner.hooks.onEvent?.("mob-death", mob.id, null);
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
    this.skills.step(ms);
    this.combat.update(ms);
    this.gameplay.step(ms, input);
    this.reactors.step(ms);
    this.drops.step(ms);
  }
  update(ms, input) {
    this.portals.update(ms, input);
    this.life.update(ms);
    const pose = this.scene.presentation;
    this.speechPose.x = pose.x;
    this.speechPose.headY =
      pose.y + this.scene.actor.current.geometry[this.scene.actor.frame].y;
    this.speech.update(ms, this.speechPose, this.scene.camera);
    this.name.step(this.owner.app.renderer.resolution);
    this.dropRenderer.updateDemand();
    this.dropRenderer.draw();
  }
  snapshot() {
    return {
      portals: this.portals.snapshot(),
      life: this.life.snapshot(),
      gameplay: this.gameplay.snapshot(),
      reactors: this.reactors.snapshot(),
      speech: this.speech.snapshot(),
      combatPresentation: this.combat.snapshot(),
      skills: this.skills.snapshot(),
      drops: this.drops.snapshot(),
    };
  }
  destroy() {
    this.dropRenderer?.destroy();
    this.drops?.destroy();
    this.skills?.destroy();
    this.portals?.destroy();
    this.life?.destroy();
    this.gameplay?.destroy();
    this.reactors?.destroy();
    this.speech?.destroy();
    this.combat?.destroy();
    this.name?.destroy();
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
    this.lastSkillResult = null;
    this.travelGate = new PortalTravelGate();
    this.audio = new AudiovisualSystem(app, services, {
      onError: hooks.onError,
      onEnabled: () => this.prepareSkills(),
    });
    this.playSound = this.playSound.bind(this);
    this.playEffect = this.playEffect.bind(this);
    this.profileChanged = this.profileChanged.bind(this);
    this.ui = new GameUI(app, services, {
      now: hooks.now,
      clearInput: hooks.clearInput,
      focusGame: hooks.focusGame,
      onError: hooks.onError,
      onStatus: hooks.onStatus,
      onReset: hooks.onReset,
      onSave: hooks.onSave,
      onChatSubmit: this.submitChat.bind(this),
      onProfileEdit: this.editProfile.bind(this),
      onLearnSkill: this.learnSkill.bind(this),
      skillAllocationError: (id) =>
        this.scene?.fieldSystems.skills.allocationError(
          this.store.profile,
          this.catalog.ui.skills[id],
        ) ?? (this.scene ? null : "No active field"),
      skillAllocationPoints: (id) =>
        this.scene?.fieldSystems.skills.allocationPoints(
          this.store.profile,
          this.catalog.ui.skills[id],
        ) ?? 0,
      isWorldInteractive: this.isWorldInteractive.bind(this),
      isFieldBlocked: hooks.isBlocked,
      onRecover: this.showRevival.bind(this),
      onRevive: hooks.onRevive,
      onOfferItem: (id) =>
        this.scene?.fieldSystems.reactors.offer(id) ?? {
          accepted: false,
          reason: "No active field",
        },
      playSound: this.playSound,
      onNpcDialogue: (panel, npc) => mountNpcDialogue(panel, npc, this.quests),
      onQuestJournal: (panel) => mountQuestJournal(panel, this.quests),
    });
    this.initializeFieldHooks();
  }
  initializeFieldHooks() {
    this.fieldHooks = {
      travel: this.hooks.travel,
      travelGate: this.travelGate,
      onError: this.hooks.onError,
      isBlocked: this.npcBlocked.bind(this),
      playSound: this.playSound,
      onInteract: this.ui.showNpc.bind(this.ui),
    };
    this.gameplayHooks = {
      onEffect: this.playEffect,
      onSound: this.playSound,
      onChange: this.profileChanged,
    };
  }
  profileChanged() {
    this.ui.refreshProfile();
  }
  npcBlocked(id) {
    if (!this.scene || this.hooks.isBlocked() || this.ui.bindingDrag) {
      return true;
    }
    if (!this.ui.blocksGameplay()) return false;
    const modal = this.ui.modal();
    return !(
      id !== undefined &&
      this.ui.dialogMode === "npc" &&
      this.ui.dialogNpc?.id === id &&
      this.ui.quickCapture === null &&
      (!modal || modal.name === "UtilDlgEx")
    );
  }
  showRevival() {
    if (!this.scene?.fieldSystems.gameplay.dead) return false;
    this.hooks.clearInput();
    this.ui.showRevival(this.scene).catch((error) => {
      if (error.name !== "AbortError") this.hooks.onError(error);
    });
    return true;
  }
  prepareSkills() {
    return this.scene?.fieldSystems.skills.prepare();
  }
  async editProfile(patch) {
    if (!this.scene || this.hooks.isBlocked()) {
      throw new Error(
        "Character edit is unavailable during a field/profile transition",
      );
    }
    const store = this.store,
      scene = this.scene;
    this.hooks.onSave?.();
    this.hooks.clearInput();
    await this.characterDevelopment.edit(patch);
    if (this.store !== store || this.scene !== scene) return;
    scene.fieldSystems.gameplay.synchronizeProfile();
    if (!this.showRevival()) this.ui.close("Revive", true);
    await scene.fieldSystems.skills.prepare();
  }
  async learnSkill(id) {
    if (!this.scene || this.hooks.isBlocked()) {
      return { ok: false, reason: "Field/profile transition in progress" };
    }
    const scene = this.scene;
    const result = await scene.fieldSystems.skills.learn(id);
    if (result.ok && this.scene === scene) {
      await scene.fieldSystems.skills.prepare();
    }
    return result;
  }
  activateSkill(id) {
    const result = this.scene.fieldSystems.skills.activate(id);
    this.lastSkillResult = result;
    if (!result.ok) this.ui.status(result.reason);
    else this.hooks.onEvent?.("player-skill", this.scene.actor.id, id);
    return result.ok;
  }
  submitChat(text) {
    if (!this.scene || this.hooks.isBlocked() || this.ui.blocksGameplay()) {
      return false;
    }
    const accepted = this.scene.fieldSystems.speech.show(text);
    if (accepted) this.hooks.onEvent?.("chat", this.scene.actor.id, text);
    return accepted;
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
    if (name === "MiniMap") return this.ui.advanceMinimap();
    if (name === "Attack" || name === "Jump") {
      this.hooks.focusGame();
      this.hooks.tap(name === "Attack" ? "attack" : "jump");
    } else if (name === "Pickup") {
      return this.pickup();
    } else {
      this.ui.activate(name);
    }
    return true;
  }
  pickup() {
    if (!this.scene || this.hooks.isBlocked() || this.ui.blocksGameplay()) {
      return false;
    }
    const scene = this.scene;
    scene.fieldSystems.drops
      .pickup(scene.simulation)
      .then((result) => {
        if (scene !== this.scene) return;
        if (!result.ok) this.ui.status(result.reason);
        else {
          this.hooks.onEvent?.(
            "player-pickup",
            String(result.itemId),
            result.quantity,
          );
        }
      })
      .catch(this.hooks.onError);
    return true;
  }
  async prepare(catalog, signal, store) {
    this.store = store;
    this.catalog = catalog;
    await this.audio.prepare(catalog.audiovisual, signal);
    await this.ui.prepare(catalog.ui, signal);
    this.useProfile(store);
    this.restoreSettings();
  }
  /** Swap validated profile authority without reloading or duplicating HUD resources.
   * Temporary stores and gates belong to an explicit development session. */
  useProfile(store, travelGate = this.travelGate) {
    this.store = store;
    this.travelGate = travelGate;
    this.characterDevelopment = new CharacterDevelopment(store, this.catalog);
    this.quests = new QuestSystem(this.catalog.quests, store, {
      onChange: this.profileChanged,
      onEffect: this.playEffect,
      hpGrowth: (profile) =>
        this.scene?.fieldSystems.skills.hpGrowth(profile) ?? 0,
    });
    this.ui.setProfile(store, this.quests);
    const bindings = new KeyBindings(store, this.catalog, {
      onAction: (name) => this.activateBinding(name),
      onSkill: this.activateSkill.bind(this),
      onSound: this.playSound,
      isBlocked: () =>
        !this.scene || this.hooks.isBlocked() || this.ui.blocksGameplay(),
      now: () => this.hooks.now?.() ?? performance.now(),
      report: (message) => this.ui.status(message),
    });
    this.bindings?.destroy();
    this.bindings = bindings;
    this.ui.setBindings(bindings);
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
    this.ui.chat.applySettings(this.store.profile.settings.chat);
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
    const chat = this.ui.chat;
    const saved = this.store.profile.settings.chat;
    if (saved.state !== chat.state || saved.height !== chat.height) {
      saved.state = chat.state;
      saved.height = chat.height;
      this.store.markDirty();
    }
  }
  async prepareScene(scene, signal, context = {}) {
    scene.fieldSystems = new FieldSystems(scene, this, context);
    await scene.fieldSystems.prepare(signal);
  }
  setScene(scene) {
    scene.fieldSystems.skills.inherit(this.scene?.fieldSystems.skills);
    this.scene = scene;
    this.ui.setScene(scene);
    this.audio.setScene(scene);
    this.showRevival();
  }
  updateInterface(ms) {
    this.ui.update(ms);
    this.audio.update(ms);
  }
  resize(width, height) {
    this.ui.resize(width, height);
    this.scene?.fieldSystems.name.step(this.app.renderer.resolution);
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
