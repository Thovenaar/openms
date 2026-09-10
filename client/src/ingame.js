import { GameUI } from "./game-ui.js";
import { PortalSystem, PortalTravelGate } from "./portal-system.js";
import { LifeSystem } from "./life-system.js";
import { AudiovisualSystem } from "./audiovisual-system.js";
import { OfflineField } from "./offline-field.js";
import { mountQuestJournal } from "./ui-quest-window.js";
import { ReactorSystem } from "./reactor-system.js";
import { KeyBindings } from "./key-bindings.js";
import { SpeechBubbles } from "./speech-bubbles.js";
import { CombatPresentation } from "./combat-presentation.js";
import { PlayerName } from "./player-name.js";
import { SkillSystem } from "./skill-system.js";
import { DropSystem } from "./drop-system.js";
import { DropRenderer } from "./drop-renderer.js";
import { CharacterBindings, EXPRESSION_NAMES } from "./character-bindings.js";
import { updateSkillMovement } from "./physics/skill-movement.js";
import { NativeInterfaces, nativeInterfaceHooks } from "./ingame-interfaces.js";
import { AvatarVisuals } from "./avatar-visuals.js";
import {
  prepareFieldAvatar,
  admitAvatarReplacement,
  publishFieldAvatar,
} from "./field-avatar.js";
import { NativeAvatarPortrait } from "./ui-avatar-portrait.js";
import { LocalTradeSession } from "./local-trade.js";
import { PickupEffects } from "./pickup-effects.js";

const CHAT_BINDINGS = Object.freeze({
  ChatAll: 7,
  ChatWhisper: 6,
  ChatParty: 2,
  ChatBuddy: 0,
  ChatGuild: 3,
  ChatSpouse: 5,
  ChatAlliance: 4,
});
const USER_TABS = Object.freeze({ Friends: 0, Guild: 2, Party: 1 });
const CHARACTER_BINDINGS = new Set(["Attack", "Jump", "Pickup", "Sit", "Talk"]);

/** Candidate fields own resources independently; only committed fields advance. */
class FieldSystems {
  constructor(scene, owner, context = {}) {
    const store = context.store ?? owner.store;
    const travelGate = context.travelGate ?? owner.travelGate;
    this.scene = scene;
    this.owner = owner;
    this.speechPose = { x: 0, headY: 0 };
    this.profileServices = owner.nativeByStore.get(store);
    if (!this.profileServices) {
      throw new Error(
        "Prepare the profile's native interfaces before its field",
      );
    }
    this.profileServices.references++;
    this.destroyed = false;
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
      this.character = new CharacterBindings(scene, store, this.gameplay, {
        now: owner.hooks.now,
        report: (message) => owner.ui.status(message),
        isBlocked: () =>
          scene !== owner.scene ||
          owner.hooks.isBlocked() ||
          owner.ui.blocksGameplay(),
      });
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
    this.pickupEffects = new PickupEffects({
      store,
      items: owner.catalog.ui.items,
      skills: this.skills,
      view: owner.ui.temporaryStats,
      isCurrent: () =>
        !this.destroyed && this.scene === owner.scene && owner.store === store,
      conditionContext: {
        mapId: Number(this.scene.manifest.id),
        partyHunting: false,
      },
    });
    const drops = new DropSystem(
      owner.catalog.drops,
      store,
      this.scene.manifest.physics.footholds,
      {
        items: owner.catalog.ui.items,
        random: owner.hooks.random,
        monsterBook: owner.catalog.ui.monsterBook,
        isCurrent: () =>
          !this.destroyed &&
          this.scene === owner.scene &&
          owner.store === store,
        preparePickup: this.pickupEffects.prepare.bind(this.pickupEffects),
        applyPickup: this.pickupEffects.apply.bind(this.pickupEffects),
        publishPickup: this.pickupEffects.publish.bind(this.pickupEffects),
        releasePickup: this.pickupEffects.release.bind(this.pickupEffects),
        cardRate: this.pickupEffects.cardRate.bind(this.pickupEffects),
        familyRate: () => this.profileServices.social.familyRate("drop"),
        prepareItemDrop: (item, slot) =>
          this.dropRenderer.prepareDrop(item, slot),
        publishItemDrop: (art, slot) =>
          this.dropRenderer.publishDrop(art, slot),
        releaseItemDrop: (art) => this.dropRenderer.releaseDrop(art),
        confirmItemDrop: () =>
          owner.ui.prompt({
            kind: "confirm",
            text: "This item cannot be recovered once dropped.\r\nDo you really want to drop this item?",
            owner: drops,
          }),
        prepareAppearance: (draft) => owner.prepareAppearance(draft),
        publishAppearance: (prepared) => owner.publishAppearance(prepared),
        releaseAppearance: (prepared) => prepared.destroy(),
        pickupHeight: () =>
          this.scene.actor.current.geometry[this.scene.actor.frame].height,
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
        this.profileServices.quests.applyKill(store.profile, templateId);
        owner.queueFamilyProgress(
          mob.template.info.boss ? "boss" : "kill",
          mob.maxHP,
        );
        const result = this.drops.spawn(mob);
        if (!result.ok) owner.ui.status(result.reason);
      },
      experienceRate: () => this.profileServices.social.familyRate("exp"),
      onExperience: (amount, levels) => {
        owner.publishNotice({ kind: "exp", amount, white: true });
        for (let index = 0; index < levels; index++) {
          owner.queueFamilyProgress("level", 0);
        }
      },
      skillLevel: this.skills.level.bind(this.skills),
      skillInfo: this.skills.info.bind(this.skills),
      hpGrowth: this.skills.hpGrowth.bind(this.skills),
      items: owner.catalog.ui.items,
      derivedStats: this.skills.derived.bind(this.skills),
      random: owner.hooks.random,
      absorbDamage: this.skills.absorbDamage.bind(this.skills),
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
        this.profileServices.macros.interrupt("Character died");
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
      this.owner.ui.temporaryStats.prepareEffects(this.skills),
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
    this.character.beforePhysics(input);
    updateSkillMovement(this.scene.simulation, this.skills.derived());
    if (!this.gameplay.dead && !this.gameplay.blocksMovement) {
      this.portals.handleInput(input);
    }
  }
  step(ms, input) {
    this.skills.step(ms);
    this.combat.update(ms);
    this.gameplay.step(ms, input);
    this.character.beforePhysics(input);
    updateSkillMovement(this.scene.simulation, this.skills.derived());
    this.reactors.step(ms);
    this.drops.step(ms);
    this.profileServices.macros.step(ms);
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
      character: this.character.snapshot(),
    };
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroyDrops();
    this.skills?.destroy();
    this.portals?.destroy();
    this.life?.destroy();
    this.gameplay?.destroy();
    this.reactors?.destroy();
    this.speech?.destroy();
    this.combat?.destroy();
    this.name?.destroy();
    this.owner.releaseNative(this.profileServices);
  }

  destroyDrops() {
    this.pickupEffects?.destroy();
    this.dropRenderer?.destroy();
    this.drops?.destroy();
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
    this.nativeByStore = new Map();
    this.nativeRetirements = new Set();
    this.native = null;
    this.avatars = null;
    this.tradeSession = new LocalTradeSession();
    this.cashStage = false;
    this.stagePending = false;
    this.travelGate = new PortalTravelGate();
    this.audio = new AudiovisualSystem(app, services, {
      onError: hooks.onError,
      onEnabled: () => this.prepareSkills(),
    });
    this.playSound = this.playSound.bind(this);
    this.playEffect = this.playEffect.bind(this);
    this.profileChanged = this.profileChanged.bind(this);
    this.ui = this.createUI();
    this.initializeFieldHooks();
  }

  createUI() {
    const hooks = this.hooks;
    return new GameUI(this.app, this.services, {
      ...nativeInterfaceHooks(this),
      now: hooks.now,
      clearInput: hooks.clearInput,
      keyDown: hooks.keyDown,
      inputGeneration: hooks.inputGeneration,
      onAction: this.activateBinding.bind(this),
      focusGame: hooks.focusGame,
      onError: hooks.onError,
      onStatus: hooks.onStatus,
      onReset: hooks.onReset,
      onSave: hooks.onSave,
      onChatSubmit: this.submitChat.bind(this),
      onDropMesos: this.dropMesos.bind(this),
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
      onOfferItem: (uid) =>
        this.scene?.fieldSystems.reactors.offer({
          uid,
          actorId: this.store.id,
        }) ?? { accepted: false, reason: "No active field" },
      playSound: this.playSound,
      onNpcDialogue: (panel, npc) => this.native.npc.mount(panel, npc),
      onQuestJournal: (panel) => mountQuestJournal(panel, this.quests),
    });
  }
  initializeFieldHooks() {
    this.fieldHooks = {
      travel: this.hooks.travel,
      travelGate: this.travelGate,
      onError: this.hooks.onError,
      isBlocked: this.npcBlocked.bind(this),
      playSound: this.playSound,
      onInteract: (record) => this.native.npc.open(record),
    };
    this.gameplayHooks = {
      onEffect: this.playEffect,
      onSound: this.playSound,
      onChange: this.profileChanged,
    };
  }
  async prepareNative(store) {
    const existing = this.nativeByStore.get(store);
    if (existing) {
      await existing.ready;
      return existing;
    }
    const native = new NativeInterfaces(this, store);
    this.nativeByStore.set(store, native);
    native.ready = native.prepare();
    try {
      await native.ready;
      return native;
    } catch (error) {
      this.nativeByStore.delete(store);
      await native.destroy();
      throw error;
    }
  }

  releaseNative(native) {
    if (!native) return;
    native.references--;
    if (native.references === 0 && native !== this.native) {
      this.nativeByStore.delete(native.store);
      const retirement = native.destroy();
      this.nativeRetirements.add(retirement);
      retirement
        .catch(this.hooks.onError)
        .finally(() => this.nativeRetirements.delete(retirement));
    }
  }

  isOperationPending(excluded = null) {
    if (this.stagePending || this.native?.pending(excluded)) return true;
    if (this.fieldOperationPending(excluded)) return true;
    return (
      !this.ownsOperation(excluded) && !!this.store?.profileTransactionPending
    );
  }

  fieldOperationPending(excluded) {
    const field = this.scene?.fieldSystems;
    const item = this.bindings?.items;
    if (field) {
      if (field.drops !== excluded && field.drops?.pending) return true;
      if (field.reactors !== excluded && field.reactors?.pending) return true;
    }
    return item !== excluded && !!item?.pending;
  }

  ownsOperation(controller) {
    if (!controller) return false;
    const field = this.scene?.fieldSystems;
    return (
      controller === this.bindings?.items ||
      controller === field?.drops ||
      controller === field?.reactors ||
      Boolean(this.native?.ownsOperation(controller))
    );
  }

  async prepareAppearance(profile) {
    const scene = this.scene;
    if (!scene || scene.destroyed) {
      throw new Error("The character has no live field appearance");
    }
    const source = scene.manifest.actors.find(
      (entry) => entry.kind === "character",
    );
    const prepared = await prepareFieldAvatar(
      this.avatars,
      profile,
      source,
      this.ui.controller.signal,
    );
    try {
      if (scene !== this.scene) {
        throw new Error(
          "The field changed while preparing the character appearance",
        );
      }
      admitAvatarReplacement(scene, prepared);
      return prepared;
    } catch (error) {
      prepared.destroy();
      throw error;
    }
  }

  publishAppearance(prepared) {
    publishFieldAvatar(prepared);
  }

  async createPortrait(surface, position) {
    const portrait = new NativeAvatarPortrait(surface, this.avatars, position);
    try {
      await portrait.refresh(this.store.profile);
      return portrait;
    } catch (error) {
      portrait.destroy();
      throw error;
    }
  }

  publishNotice(event) {
    if (event.kind !== "inventory-full" && !(event.amount > 0)) return;
    try {
      this.ui.notices.publish(event);
    } catch (error) {
      this.hooks.onError(error);
    }
  }

  /** Original00a081b8 sends card strings0xa24/0xa25 to chat type12, not inventory gain. */
  publishPickupNotice(result) {
    if (result.card) {
      const name = this.catalog.ui.items[result.itemId]?.name;
      if (!result.card.full && !name) return;
      this.ui.chat.receive({
        source: "gameplay",
        text: result.card.full
          ? "This card is already full in the Monster Book. This card will disappear."
          : `[${name}] has been successfully recorded on the Monster Book.`,
        time: this.hooks.now?.() ?? performance.now(),
      });
      return;
    }
    this.publishNotice({
      kind: result.itemId ? "item" : "meso",
      itemId: result.itemId,
      amount: result.quantity,
    });
  }

  publishQuestReward(result) {
    const rewards = result.rewards;
    if (rewards.exp > 0) {
      this.publishNotice({ kind: "exp", amount: rewards.exp, white: true });
    }
    if (rewards.money > 0) {
      this.publishNotice({ kind: "meso", amount: rewards.money });
    }
    for (const item of rewards.items) {
      if (item.count > 0) {
        this.publishNotice({
          kind: "item",
          itemId: item.id,
          amount: item.count,
        });
      }
    }
    for (let index = 0; index < result.levels; index++) {
      this.queueFamilyProgress("level", 0);
    }
  }

  queueFamilyProgress(kind, maxHp) {
    this.native?.queueProgress(kind, maxHp);
  }

  async enterCashStage() {
    if (this.cashStage || this.stagePending || !this.scene) {
      throw new Error("Cash Shop stage is not ready");
    }
    this.stagePending = true;
    try {
      await this.audio.audio.setBGM(this.catalog.ui.cashShop.bgm);
      this.cashStage = true;
      this.scene.container.visible = false;
    } finally {
      this.stagePending = false;
    }
  }

  leaveCashStage() {
    if (!this.cashStage) return;
    this.cashStage = false;
    if (this.scene) {
      this.scene.container.visible = true;
      this.audio.setScene(this.scene);
    }
  }

  profileChanged() {
    this.ui.refreshProfile();
  }
  npcBlocked(id) {
    const owned = id !== undefined && this.native?.npc.owns(id);
    if (
      !this.scene ||
      this.hooks.isTransitioning() ||
      (!owned && this.isOperationPending()) ||
      this.ui.bindingDrag
    ) {
      return true;
    }
    if (!this.ui.blocksGameplay()) return false;
    const modal = this.ui.modal();
    return !(
      owned &&
      (!modal || ["UtilDlgEx", "Shop", "NativePrompt"].includes(modal.name))
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
  async prepareSkills() {
    const skills = this.scene?.fieldSystems.skills;
    if (!skills) return;
    await Promise.all([
      skills.prepare(),
      this.ui.temporaryStats.prepareEffects(skills),
    ]);
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
    await this.prepareSkills();
  }
  async learnSkill(id) {
    if (!this.scene || this.hooks.isBlocked()) {
      return { ok: false, reason: "Field/profile transition in progress" };
    }
    const scene = this.scene;
    const result = await scene.fieldSystems.skills.learn(id);
    if (result.ok && this.scene === scene) {
      await this.prepareSkills();
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
  submitChat(text, channel) {
    return this.native.chat.submit(text, channel);
  }
  submitFieldSpeech(text) {
    if (
      !this.scene ||
      this.hooks.isTransitioning() ||
      this.cashStage ||
      this.isOperationPending(this.native.chat) ||
      this.ui.blocksGameplay()
    ) {
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
    if (CHARACTER_BINDINGS.has(name) || name.startsWith("Expression:")) {
      return this.activateCharacterBinding(name);
    }
    if (name === "MiniMap") return this.ui.advanceMinimap();
    if (Object.hasOwn(CHAT_BINDINGS, name)) {
      this.ui.chat.selector.selectedIndex = CHAT_BINDINGS[name];
      this.ui.chat.open();
      return true;
    }
    if (name === "ExpandChat") {
      this.ui.chat.setState(this.ui.chat.state === 3 ? 1 : 3);
      return true;
    }
    if (Object.hasOwn(USER_TABS, name)) {
      return this.activateUserTab(USER_TABS[name]);
    }
    if (name === "CashShop") {
      this.native.openCash().catch(this.hooks.onError);
      return true;
    }
    return this.ui.toggleWindow(name);
  }
  activateCharacterBinding(name) {
    if (!this.scene || this.hooks.isBlocked() || this.ui.blocksGameplay()) {
      return false;
    }
    const systems = this.scene.fieldSystems;
    if (name.startsWith("Expression:")) {
      return systems.character.emote(EXPRESSION_NAMES.indexOf(name.slice(11)));
    }
    if (name === "Sit") return systems.character.sit();
    if (name === "Talk") return systems.life.talkNearest();
    if (name === "Pickup") return this.pickup();
    this.hooks.focusGame();
    this.hooks.tap(name === "Attack" ? "attack" : "jump");
    return true;
  }
  activateUserTab(index) {
    const panel = this.ui.windows.get("UserList");
    if (panel?.localTab === index || this.ui.pending.has("UserList")) {
      this.ui.close("UserList");
    } else if (panel) {
      panel.selectLocalTab(index);
      this.ui.front(panel);
    } else {
      this.ui
        .open("UserList")
        .then((opened) => {
          if (opened && this.ui.windows.get("UserList") === opened) {
            opened.selectLocalTab(index);
          }
        })
        .catch(this.hooks.onError);
    }
    return true;
  }
  async dropMesos(amount) {
    if (!this.scene || this.hooks.isBlocked()) {
      return {
        ok: false,
        code: "field-blocked",
        reason: "The current field is unavailable.",
      };
    }
    return this.scene.fieldSystems.drops.dropMesos(
      amount,
      this.scene.simulation,
    );
  }
  pickup() {
    if (!this.scene || this.hooks.isBlocked() || this.ui.blocksGameplay()) {
      return false;
    }
    const scene = this.scene;
    scene.fieldSystems.drops
      .pickup(scene.simulation)
      .then((result) => {
        if (result.ok) {
          this.publishPickupNotice(result);
        } else if (result.code === "inventory-full") {
          this.publishNotice({ kind: "inventory-full" });
        }
        return result;
      })
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
    if (!this.avatars) this.avatars = new AvatarVisuals(this.services, catalog);
    await this.audio.prepare(catalog.audiovisual, signal);
    await this.ui.prepare(catalog.ui, signal);
    await this.prepareNative(store);
    this.useProfile(store);
    this.restoreSettings();
  }
  /** Swap validated profile authority without reloading or duplicating HUD resources.
   * Temporary stores and gates belong to an explicit development session. */
  useProfile(store, travelGate = this.travelGate) {
    this.store = store;
    this.travelGate = travelGate;
    this.native = this.nativeByStore.get(store);
    if (!this.native) {
      throw new Error("Native profile interfaces were not prepared");
    }
    this.characterDevelopment = this.native.development;
    this.quests = this.native.quests;
    for (const native of this.nativeByStore.values()) {
      if (native.controls) native.controls.root.hidden = native !== this.native;
    }
    this.native.activate();
    this.ui.setProfile(store, this.quests);
    const bindings = new KeyBindings(store, this.catalog, {
      onAction: (name) => this.activateBinding(name),
      onSkill: this.activateSkill.bind(this),
      onCashExpression: (id) =>
        this.scene?.fieldSystems.character.useCashExpression(id) ?? false,
      onSound: this.playSound,
      macros: () => this.native.macros,
      isBlocked: (excluded = null) =>
        !this.scene ||
        this.hooks.isTransitioning() ||
        this.cashStage ||
        this.isOperationPending(excluded) ||
        this.ui.blocksGameplay(),
      now: () => this.hooks.now?.() ?? performance.now(),
      skillSystem: () => this.scene?.fieldSystems.skills,
      prepareTemporaryStat: (kind, id) =>
        this.ui.temporaryStats.prepareSource(kind, id),
      report: (message) => this.ui.status(message),
    });
    this.bindings?.destroy();
    this.bindings = bindings;
    this.ui.setBindings(bindings);
  }
  applyAudioSettings(settings) {
    for (const category of ["BGM", "SE"]) {
      const saved = settings[category];
      this.audio.audio.setVolume(category, saved.volume, saved.mute);
      const root = this.audio.controls.root;
      root.querySelector(`[data-audio-volume="${category}"]`).value =
        saved.volume;
      root.querySelector(`[data-audio-mute="${category}"]`).checked =
        saved.mute;
    }
    this.audio.refreshVolumeControls();
  }
  restoreSettings() {
    this.applyAudioSettings(this.store.profile.settings);
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
    await this.prepareNative(context.store ?? this.store);
    scene.fieldSystems = new FieldSystems(scene, this, context);
    await scene.fieldSystems.prepare(signal);
  }
  setScene(scene, inheritState = true) {
    if (inheritState) {
      scene.fieldSystems.skills.inherit(this.scene?.fieldSystems.skills);
      scene.fieldSystems.character.inherit(this.scene?.fieldSystems.character);
    }
    this.scene = scene;
    const unavailable = scene.fieldSystems.pickupEffects.refreshConditions();
    if (unavailable) this.ui.status(unavailable);
    this.native.macros.interrupt("Field changed");
    this.ui.setScene(scene);
    this.ui.temporaryStats.bind(scene.fieldSystems.skills);
    this.audio.setScene(scene);
    this.showRevival();
  }
  updateInterface(ms) {
    this.ui.update(ms);
    this.audio.update(ms);
    this.native?.flushDeferred();
  }
  resize(width, height) {
    this.ui.resize(width, height);
    this.scene?.fieldSystems.name.step(this.app.renderer.resolution);
    this.scene?.fieldSystems.speech.syncDensity(this.app.renderer.resolution);
  }
  snapshot() {
    return {
      ui: this.ui.snapshot(),
      audiovisual: this.audio.snapshot(),
      quests: this.quests?.snapshot() ?? null,
    };
  }
  async destroy() {
    if (this.isOperationPending()) {
      throw new Error("Await native operations before destroying the client");
    }
    for (const native of this.nativeByStore.values()) await native.destroy();
    await Promise.all(this.nativeRetirements);
    this.nativeByStore.clear();
    await this.tradeSession.destroy();
    this.ui.destroy();
    this.bindings?.destroy();
    this.audio.destroy();
  }
}
