import { GameUI } from "./ui/game-ui.js";
import { PortalSystem, PortalTravelGate } from "./world/portal-system.js";
import { LifeSystem } from "./world/life-system.js";
import { NpcWorldPresentation } from "./npc/npc-world-presentation.js";
import { AudiovisualSystem } from "./audio/audiovisual-system.js";
import { GameplayEffects } from "./audio/gameplay-effects.js";
import { OfflineField } from "./combat/offline-field.js";
import { mountQuestJournal } from "./ui/ui-quest-window.js";
import { ReactorSystem } from "./world/reactor-system.js";
import { KeyBindings } from "./input/key-bindings.js";
import { SpeechBubbles } from "./rendering/speech-bubbles.js";
import { CombatPresentation } from "./combat/combat-presentation.js";
import { PlayerName } from "./character/player-name.js";
import { SkillSystem } from "./skills/skill-system.js";
import { DropSystem } from "./world/drop-system.js";
import { DropRenderer } from "./world/drop-renderer.js";
import {
  CharacterBindings,
  EXPRESSION_NAMES,
} from "./input/character-bindings.js";
import {
  updateEquipmentMovement,
  updateSkillMovement,
} from "./physics/skill-movement.js";
import { NativeInterfaces, nativeInterfaceHooks } from "./ingame-interfaces.js";
import { AvatarVisuals } from "./character/avatar-visuals.js";
import {
  prepareFieldAvatar,
  admitAvatarReplacement,
  publishFieldAvatar,
} from "./character/field-avatar.js";
import { NativeAvatarPortrait } from "./ui/ui-avatar-portrait.js";
import { LocalTradeSession } from "./social/local-trade.js";
import { PickupEffects } from "./world/pickup-effects.js";
import { QuestReadyNotification } from "./ui/ui-quest-ready-notification.js";
import { DevelopmentMonsterSpawner } from "./development/monster-spawner.js";

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
    this.tutorials = null;
    this.profileServices = owner.nativeByStore.get(store);
    if (!this.profileServices) {
      throw new Error(
        "Prepare the profile's native interfaces before its field",
      );
    }
    this.profileServices.references++;
    this.destroyed = false;
    try {
      this.portals = this.createPortals(store, travelGate);
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
      this.monsterSpawner = new DevelopmentMonsterSpawner(this);
      this.operations = Object.freeze([
        this.drops,
        this.reactors,
        this.skills.utilityController.pets,
        this.skills.utilityController.enhancement,
        this.monsterSpawner,
      ]);
      this.gameplay = this.createGameplay(store);
      this.life = new LifeSystem(scene, owner.fieldHooks);
      this.npcWorld = this.createNpcWorld();
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
  createPortals(store, travelGate) {
    return new PortalSystem(this.scene, {
      ...this.owner.fieldHooks,
      travelGate,
      getProfile: () => store.profile,
      showTutorial: this.showTutorial.bind(this),
      hasLevel30Character: this.profileServices.hasLevel30Character.bind(
        this.profileServices,
      ),
      openTutorialNpc: this.profileServices.npc.openPortal.bind(
        this.profileServices.npc,
      ),
    });
  }
  createNpcWorld() {
    return new NpcWorldPresentation(this.life, this.profileServices.quests, {
      app: this.owner.app,
      services: this.owner.services,
      random: this.owner.hooks.random,
      isTalking: this.profileServices.npc.owns.bind(this.profileServices.npc),
    });
  }
  createSkills(store) {
    const scene = this.scene,
      owner = this.owner;
    return new SkillSystem(scene, store, owner.catalog, {
      services: owner.services,
      audio: owner.audio.audio,
      report: owner.hooks.onError,
      gameplay: () => this.gameplay,
      drops: () => this.drops,
      travelDoor: owner.hooks.travelDoor,
      prepareEnhancement: () => owner.ui.preloadWindow("EnchantSkill"),
      prepareAppearance: (draft) => owner.prepareAppearance(draft),
      publishAppearance: (prepared) => owner.publishAppearance(prepared),
      releaseAppearance: (prepared) => prepared.destroy(),
      isCurrent: () =>
        !this.destroyed && scene === owner.scene && owner.store === store,
      enhancementError: () => owner.ui.preloadedWindowError("EnchantSkill"),
      openEnhancement: () =>
        owner.ui.open("EnchantSkill").catch(owner.hooks.onError),
      isBlocked: () =>
        scene !== owner.scene ||
        owner.hooks.isBlocked() ||
        owner.ui.blocksGameplay(),
      validateCast: (skill) => this.gameplay.skillCastError(skill),
      supportsAction: (action) =>
        scene.actor.actions.has(action) ||
        this.skills?.worldController.supportsAction(action),
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
        mesoUp: () => this.skills.derived().mesoUp,
        prepareItemDrop: (item, slot) =>
          this.dropRenderer.prepareDrop(item, slot),
        publishItemDrop: (art, slot) =>
          this.dropRenderer.publishDrop(art, slot),
        releaseItemDrop: (art) => this.dropRenderer.releaseDrop(art),
        confirmItemDrop: (source) =>
          owner.ui.prompt({
            kind: "confirm",
            text: source.dropWarning,
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
        owner.hooks.onEvent?.("mob-death", mob.id, null);
        owner.audio.onMobDeath(mob, scene.simulation);
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
      ...this.skillGameplayHooks(),
      onStrike: this.reactors.strike.bind(this.reactors),
      canStrike: this.reactors.canStrike.bind(this.reactors),
      onAttack: (sfx) => {
        owner.hooks.onEvent?.("player-attack", scene.actor.id, null);
        owner.audio.onPlayerAttack(sfx);
      },
      onPlayerHit: this.playerHit.bind(this),
      onProjectile: (shot) => this.combat.onProjectile(shot),
      projectileAdmissionError: (count) =>
        this.combat.projectileAdmissionError(count),
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
  skillGameplayHooks() {
    const owner = this.owner;
    return {
      skillLevel: this.skills.level.bind(this.skills),
      skillInfo: this.skills.info.bind(this.skills),
      activateSkill: (id) => this.skills.activate(id),
      growth: this.skills.growth.bind(this.skills),
      items: owner.catalog.ui.items,
      mobSkills: owner.catalog.ui.skillCombat.mobSkills,
      derivedStats: this.skills.derived.bind(this.skills),
      random: owner.hooks.random,
      setSkillStateValue: (id, key, value) =>
        this.skills.stateController.setValue(id, key, value),
      cancelSkillFamily: (family) =>
        this.skills.stateController.cancelFamily(family),
      transformed: () => Boolean(this.skills.worldController.forms.current),
      worldSkillActive: (id) => this.skills.worldController.active(id),
      onSkillHit: (id, target) => this.skills.hit(id, target),
      onSkillProjectile: (shot) =>
        this.skills.combatController.projectile(shot),
      onSkillDamageLine: (target, amount, presentation) =>
        this.combat.onSkillDamageLine(target, amount, presentation),
      onMagnetResult: (mob, success) =>
        this.combat.onMagnetResult(mob, success),
      skillTargetController: () => this.skills.combatController.targets,
      resolveSkillId: (id) => this.skills.activationId(id),
      eventSkillError: (skill) =>
        this.skills.utilityController.events.error(skill),
      consumeEventSkill: (skill) =>
        this.skills.utilityController.events.consume(skill),
      onEventAttack: (skill, target, sequence) =>
        this.skills.utilityController.events.onAttack(skill, target, sequence),
      onEventDamage: () => this.skills.utilityController.events.onDamage(),
      chakraDamagePercent: () =>
        this.skills.utilityController.chakraDamagePercent(),
      interruptChakra: () => this.skills.utilityController.interruptChakra(),
      targetFor: (mob, target) =>
        this.skills.worldController.targetFor(mob, target),
      interceptContact: (mob, action) =>
        this.skills.worldController.interceptContact(mob, action),
      protects: (x, y) => this.skills.worldController.protects(x, y),
      damageForm: (amount) => this.skills.worldController.damageForm(amount),
      absorbDamage: this.skills.absorbDamage.bind(this.skills),
    };
  }

  async prepare(signal) {
    await Promise.all([
      this.gameplay.prepare(signal),
      this.owner.audio.prepareMobSounds(this.gameplay.mobs, signal),
      this.prepareTutorials(signal),
      this.npcWorld.prepare(this.owner.catalog, signal),
      this.speech.prepare(this.owner.catalog, signal),
      this.combat.prepare(
        this.owner.catalog.audiovisual,
        signal,
        this.owner.catalog.ui.avatar.projectiles,
      ),
      this.skills.prepare(),
      this.owner.ui.temporaryStats.prepareEffects(this.skills),
      this.dropRenderer.prepare(signal),
    ]);
    this.combat.prepareSkillCapacity(this.skills, this.gameplay.mobs.length);
  }
  async prepareTutorials(signal) {
    let names = null;
    for (const record of this.portals.records) {
      if (!record.tutorialProgram?.branches.length) continue;
      names ??= new Set();
      for (const branch of record.tutorialProgram.branches) {
        names.add(branch.path);
      }
    }
    if (!names) return;
    this.tutorials = new GameplayEffects(this.owner.services);
    await this.tutorials.prepare(this.owner.catalog.audiovisual, signal, [
      ...names,
    ]);
  }
  showTutorial(path, options) {
    options.signal.throwIfAborted();
    if (this.destroyed || !this.tutorials) {
      throw new Error("Original tutorial field presentation is unavailable");
    }
    //009388f2 ->004ad42b/00439750: the original unflipped actor-owned generic layer.
    this.tutorials.play(path, this.scene);
  }
  playerHit(hit, simulation) {
    this.owner.hooks.onEvent?.("player-hit", hit.source?.id ?? "", hit.amount);
    this.combat.onPlayerHit(hit, simulation);
    this.owner.audio.onPlayerHit(hit, simulation);
  }
  mobHit(mob, amount) {
    this.owner.hooks.onEvent?.("mob-hit", mob.id, amount);
    this.combat.onMobHit(mob, amount);
    this.owner.audio.onMobHit(mob, amount, this.scene.simulation);
  }
  refresh() {
    this.life.refresh();
    this.reactors.refresh();
  }
  updateMovement() {
    updateEquipmentMovement(
      this.scene.simulation,
      this.gameplay.store.profile.equipment,
      this.owner.catalog.ui.items,
    );
    updateSkillMovement(this.scene.simulation, this.skills.derived());
  }
  beforePhysics(input) {
    this.skills.utilityController.input(input);
    this.character.beforePhysics(input);
    this.updateMovement();
    if (!this.gameplay.dead && !this.gameplay.blocksMovement) {
      if (input.upPressed && this.skills.worldController.useDoor()) {
        input.upPressed = false;
      } else {
        this.portals.handleInput(input);
      }
    }
  }
  step(ms, input) {
    this.skills.step(ms);
    this.combat.update(ms);
    this.gameplay.step(ms, input);
    this.character.beforePhysics(input);
    this.updateMovement();
    this.reactors.step(ms);
    this.drops.step(ms);
    this.profileServices.macros.step(ms);
  }
  update(ms, input) {
    this.portals.update(ms, input);
    this.life.update(ms);
    this.scene.actor.container.alpha = this.skills.derived().darkSight
      ? 128 / 255
      : 1;
    this.skills.present(ms);
    const pose = this.scene.presentation;
    this.speechPose.x = pose.x;
    this.speechPose.headY =
      pose.y - this.scene.actor.avatar.speechHeights[this.scene.actor.action];
    this.speech.update(ms, this.speechPose, this.scene.camera);
    this.tutorials?.update(ms);
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
      tutorialEffects: this.tutorials?.snapshot() ?? [],
      combatPresentation: this.combat.snapshot(),
      skills: this.skills.snapshot(),
      drops: this.drops.snapshot(),
      character: this.character.snapshot(),
    };
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.owner.hooks.onSceneReleased?.(this.scene);
    this.destroyDrops();
    this.skills?.destroy();
    this.portals?.destroy();
    this.tutorials?.destroy();
    this.life?.destroy();
    this.gameplay?.destroy();
    this.reactors?.destroy();
    this.speech?.destroy();
    this.combat?.destroy();
    this.name?.destroy();
    this.owner.releaseNative(this.profileServices);
  }

  destroyDrops() {
    this.monsterSpawner?.destroy();
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
    this.questReadyNotification = new QuestReadyNotification(this.ui);
    this.refreshQuestReady = this.refreshQuestReady.bind(this);
    this.unsubscribeQuestReady = null;
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
      onConjureItem: this.conjureItem.bind(this),
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
      onErrorNotification: this.notifyError.bind(this),
      getAudioSettings: () => structuredClone(this.audio.audio.settings),
      onNpcDialogue: (panel, npc) => this.native.npc.mount(panel, npc),
      onQuestJournal: (panel) => mountQuestJournal(panel, this.quests),
    });
  }
  async notifyError() {
    const outcome = await this.audio.notifyError();
    if (outcome.status === "failed") {
      this.ui.recordError(outcome.error, { notify: false });
    }
  }
  initializeFieldHooks() {
    this.fieldHooks = {
      travel: this.hooks.travel,
      travelMarket: this.hooks.travelMarket,
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
      for (const operation of field.operations) {
        if (operation !== excluded && operation.pending) return true;
      }
    }
    return item !== excluded && !!item?.pending;
  }

  ownsOperation(controller) {
    if (!controller) return false;
    const field = this.scene?.fieldSystems;
    return (
      controller === this.bindings?.items ||
      field?.operations.includes(controller) ||
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
    this.refreshQuestReady();
  }
  refreshQuestReady() {
    if (this.quests) this.questReadyNotification.refresh(this.quests);
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
      (!modal ||
        ["UtilDlgEx", "Shop", "Trunk", "NativePrompt"].includes(modal.name))
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
    if (skills === this.scene?.fieldSystems.skills) {
      const field = this.scene.fieldSystems;
      field.combat.prepareSkillCapacity(skills, field.gameplay.mobs.length);
    }
  }
  assertBindingEditAvailable(patch) {
    if (!Object.hasOwn(patch, "keyBindings")) return;
    if (
      this.bindings?.editing ||
      this.bindings?.saving ||
      this.ui.quickCaptureDraft ||
      this.ui.bindingDrag
    ) {
      throw new Error(
        "Finish or discard the native KeyConfig / quick-slot edit or carry before applying preset bindings",
      );
    }
  }
  async editProfile(patch, options) {
    if (!this.scene || this.hooks.isBlocked()) {
      throw new Error(
        "Character edit is unavailable during a field/profile transition",
      );
    }
    this.assertBindingEditAvailable(patch);
    const store = this.store,
      scene = this.scene;
    this.hooks.onSave?.();
    this.hooks.clearInput();
    await this.characterDevelopment.edit(patch, options);
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
    const accepted = this.scene.fieldSystems.speech.show(
      text,
      this.store.profile.name,
    );
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
    return this.audio.playGameplayEffect(name).catch(this.audio.reportBound);
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
  async conjureItem(request) {
    if (
      !this.scene ||
      this.hooks.isBlocked() ||
      this.cashStage ||
      this.isOperationPending() ||
      this.ui.blocksGameplay()
    ) {
      return {
        ok: false,
        code: "field-blocked",
        reason: "Close the current operation before conjuring an item.",
      };
    }
    return this.scene.fieldSystems.drops.conjureItem(
      request,
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
        if (!result.ok) {
          if (result.reason) this.ui.status(result.reason);
        } else {
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
    await this.questReadyNotification.prepare(signal);
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
    this.unsubscribeQuestReady?.();
    this.unsubscribeQuestReady = store.subscribe(this.refreshQuestReady);
    this.refreshQuestReady();
    for (const native of this.nativeByStore.values()) {
      if (native.controls) native.controls.root.hidden = native !== this.native;
    }
    this.ui.setProfile(store, this.quests);
    this.native.activate();
    const bindings = new KeyBindings(store, this.catalog, {
      onAction: (name) => this.activateBinding(name),
      onSkill: this.activateSkill.bind(this),
      onSkillRelease: (id) => this.scene?.fieldSystems.skills.release(id),
      onSkillCancel: (id) => this.scene?.fieldSystems.skills.cancelHold(id),
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
    let changed = false;
    // Native SysOpt previews audio live; only OK may publish that draft into the save.
    const settings =
      this.ui.windows.get("SysOpt")?.settingsOriginal ??
      this.audio.audio.settings;
    for (const category of ["BGM", "SE"]) {
      const live = settings[category];
      const saved = this.store.profile.settings[category];
      if (live.volume !== saved.volume || live.mute !== saved.mute) {
        saved.volume = live.volume;
        saved.mute = live.mute;
        this.store.markDirty();
        changed = true;
      }
    }
    const chat = this.ui.chat;
    const saved = this.store.profile.settings.chat;
    if (saved.state !== chat.state || saved.height !== chat.height) {
      saved.state = chat.state;
      saved.height = chat.height;
      this.store.markDirty();
      changed = true;
    }
    return changed;
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
    this.questReadyNotification.update(ms);
    this.audio.update(ms);
    this.native?.flushDeferred();
  }
  resize(width, height) {
    this.ui.resize(width, height);
    this.questReadyNotification.resize();
    this.scene?.fieldSystems.name.step(this.app.renderer.resolution);
    this.scene?.fieldSystems.speech.syncDensity(this.app.renderer.resolution);
  }
  snapshot() {
    return {
      ui: this.ui.snapshot(),
      audiovisual: this.audio.snapshot(),
      quests: this.quests?.snapshot() ?? null,
      questReadyNotification: this.questReadyNotification.snapshot(),
      accountStorage: this.store?.storageSnapshot() ?? null,
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
    this.unsubscribeQuestReady?.();
    this.questReadyNotification.destroy();
    this.ui.destroy();
    this.bindings?.destroy();
    this.audio.destroy();
  }
}
