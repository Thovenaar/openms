import {
  TARGET_SKILLS,
  MAX_MESO_PILES,
  MAX_MESO_LINES,
  HYPNOTIZE_HIT_MS,
  mesoExplosionDamage,
  mesoTouches,
  hypnotizeTarget,
  hypnotizeDamage,
} from "./skill-target-rules.js";
import { hasMobStatus, MOB_STATUS } from "../combat/mob-skill-status.js";
import { skillNumber } from "./skill-costs.js";
import { placeBody } from "../world/life-geometry-numeric.js";
import {
  rectangleState,
  overlaps,
  compileActions,
  setMobAction,
  MOB_POLICY,
} from "../combat/offline-mobs.js";
import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

const MAX_FORMS = 32;
const FORM_OPTIONS = Object.freeze({
  follow: true,
  loop: false,
  durationMs: Infinity,
});
const DESTROY = Object.freeze({ children: true });

/** DropSystem commits meso removal; SkillAttack/OfflineField alone change mob HP/status. */
export class SkillTargetController {
  constructor(system) {
    this.system = system;
    this.field = null;
    this.mobs = [];
    this.piles = Array.from({ length: MAX_MESO_PILES }, () => ({
      x: 0,
      y: 0,
      quantity: 0,
    }));
    this.selected = new Array(MAX_MESO_PILES).fill(null);
    this.randoms = new Uint32Array(7);
    this.rectangle = rectangleState();
    this.count = 0;
    this.pending = false;
    this.onHit = system.hit.bind(system);
    this.doom = null;
    this.doomSequence = null;
    this.states = new Map();
    this.stateList = [];
    this.formOwner = null;
    this.formBodies = [];
    this.formAbort = null;
    this.doomActions = null;
    this.doomSpeed = 0;
  }

  handles(id) {
    return TARGET_SKILLS.has(id);
  }

  async prepare(skills) {
    this.prepareField();
    for (const skill of skills) {
      if (!this.handles(skill.id)) continue;
      const rank = this.system.level(skill.id);
      if (!rank) continue;
      this.field.prepareSkillCombat(
        skill,
        this.system.info(skill.id, rank),
        rank,
      );
      if (skill.id !== 2311005) continue;
      this.doom = skill;
      this.doomSequence = await this.system.resources.acquireSequence(
        skill,
        "mob",
        MAX_FORMS,
      );
      await this.prepareForms();
      for (const slot of this.doomSequence.slots) {
        this.system.scene.addWorldContainer(slot.animation.container, 239991);
      }
    }
  }

  async prepareForms() {
    if (this.formOwner) return;
    const descriptor = this.system.fullCatalog.ui.skillCombat?.targets?.doom;
    if (!descriptor) {
      throw new Error("Original Doom mob100101 bundle is absent");
    }
    this.doomActions = compileActions(descriptor);
    this.doomSpeed =
      (MOB_POLICY.walkPixelsPerSecondAtSpeedZero * (100 + descriptor.speed)) /
      100;
    this.formAbort = new AbortController();
    this.formOwner = await loadVisualBundle(
      descriptor.bundle,
      this.system.hooks.services,
      this.formAbort.signal,
    );
    for (let index = 0; index < MAX_FORMS; index++) {
      const animation = new EntityAnimation(
        this.formOwner.manifest.entities[0],
        this.formOwner.textures,
      );
      animation.container.visible = false;
      this.system.scene.addWorldContainer(animation.container, 239991);
      this.formBodies.push({ animation, mob: null, age: 0 });
    }
  }

  prepareField() {
    const field = this.system.hooks.gameplay();
    if (this.field === field) return;
    this.destroy();
    this.field = field;
    this.mobs = field.worldSkills().mobs;
    for (const mob of this.mobs) {
      const state = {
        mob,
        receivedMs: 0,
        deaths: mob.deaths,
        form: null,
        body: null,
        actions: mob.actions,
        defaultAction: mob.defaultAction,
        speed: mob.speed,
        movement: mob.movement,
        movementType: mob.movementType,
        flight: mob.flight,
      };
      mob.skillStatus.doomInfo =
        this.system.fullCatalog.ui.skillCombat?.targets?.doom?.info ?? null;
      this.states.set(mob, state);
      this.stateList.push(state);
    }
  }

  admissionError(skill, info) {
    const attackError = this.field.skillAttackError(skill, info);
    if (attackError) return attackError;
    if (skill.id === 2311005) return this.doomAdmission(info);
    if (skill.id !== 4211006) return null;
    if (this.pending) return "Meso Explosion is already awaiting impact";
    const record = this.field.skillCombat.prepared.get(skill.id);
    if (!record?.rectangle) return "Meso Explosion rectangle is not prepared";
    placeBody(
      this.rectangle,
      record.rectangle,
      this.field.simulation,
      this.field.simulation.facing > 0,
    );
    this.count = this.system.hooks
      .drops()
      .selectExplosion(
        this.rectangle,
        this.selected,
        Math.min(MAX_MESO_PILES, Math.max(1, skillNumber(info.attackCount, 1))),
      );
    return this.count
      ? null
      : "No loose mesos are available in the explosion rectangle";
  }

  doomAdmission(info) {
    if (!this.doomSequence || !this.formOwner) {
      return "Doom form artwork is not prepared";
    }
    let occupied = 0;
    for (const state of this.stateList) if (state.body) occupied++;
    return occupied + skillNumber(info.mobCount, 1) > MAX_FORMS
      ? "Doom form presentation capacity exhausted"
      : null;
  }

  /** Synchronous admission/debit/cast: there must be no await between these calls. */
  cast(skill, info, rank) {
    if (skill.id === 4211006) {
      if (!this.count) {
        throw new Error("Meso Explosion cast without drop admission");
      }
      for (let index = 0; index < this.count; index++) {
        const source = this.selected[index],
          pile = this.piles[index];
        pile.x = source.x;
        pile.y = source.y;
        pile.quantity = source.quantity;
      }
      this.system.hooks.drops().consumeExplosion(this.selected, this.count);
      this.pending = true;
    }
    this.field.beginTargetSkill(skill, info, this.onHit, this);
    return rank > 0;
  }

  handleImpact(record, combat) {
    if (record.skill.id !== 4211006) return false;
    if (!this.pending) return true;
    const limit = Math.min(
      15,
      Math.max(1, skillNumber(record.info.mobCount, 1)),
    );
    let affected = 0;
    for (const mob of this.mobs) {
      if (
        !combat.eligible(mob, record.skill) ||
        !mob.body.active ||
        affected >= limit
      ) {
        continue;
      }
      let shot = null;
      for (
        let index = 0;
        index < Math.min(this.count, MAX_MESO_LINES);
        index++
      ) {
        const pile = this.piles[index];
        if (!mesoTouches(pile, mob.body)) continue;
        if (!shot) {
          shot = combat.reserveShot(record, mob, this.field.simulation);
          shot.count = 0;
          shot.summon = false;
          for (let roll = 0; roll < 7; roll++) {
            this.randoms[roll] = this.field.damageGenerator.next();
          }
        }
        shot.damage[shot.count] = mesoExplosionDamage(
          pile.quantity,
          skillNumber(record.info.x),
          this.randoms[(shot.count * 2 + 1) % 7],
        );
        shot.critical[shot.count++] = 0;
      }
      if (shot) {
        affected++;
        combat.resolve(shot);
      }
    }
    this.pending = false;
    this.count = 0;
    return true;
  }

  targetFor(mob) {
    if (!hasMobStatus(mob, "inert") || !mob.alive) return null;
    let target = null,
      distance = Infinity;
    for (const candidate of this.mobs) {
      if (!hypnotizeTarget(mob, candidate)) continue;
      const next = (mob.x - candidate.x) ** 2 + (mob.y - candidate.y) ** 2;
      if (next >= distance) continue;
      distance = next;
      target = candidate;
    }
    return target;
  }

  attack(mob, target, action = null) {
    if (!hasMobStatus(mob, "inert") || !hypnotizeTarget(mob, target)) {
      return null;
    }
    if (this.hypnotizeBlocked(mob)) return null;
    const state = this.states.get(target);
    if (
      state.receivedMs > 0 ||
      !overlaps(action ? mob.attackBody : mob.body, target.body)
    ) {
      return null;
    }
    state.receivedMs = HYPNOTIZE_HIT_MS;
    return hypnotizeDamage(
      mob.skillStatus.projected,
      target.skillStatus.projected,
      !!action?.properties?.magic,
      this.field.damageGenerator,
    );
  }

  hypnotizeBlocked(mob) {
    return (
      hasMobStatus(mob, "doom") ||
      hasMobStatus(mob, "stun") ||
      hasMobStatus(mob, "freeze") ||
      hasMobStatus(mob, "web")
    );
  }

  step(ms) {
    for (const state of this.stateList) {
      const mob = state.mob;
      if (state.deaths !== mob.deaths) {
        state.receivedMs = 0;
        state.deaths = mob.deaths;
      }
      state.receivedMs = Math.max(0, state.receivedMs - ms);
      this.stepForm(mob, state, ms);
    }
  }

  stepForm(mob, state, ms) {
    const active = mob.alive && hasMobStatus(mob, "doom");
    if (!active && state.body) this.endForm(state);
    if (active && !state.body && this.doomSequence) this.beginForm(mob, state);
    if (!state.body) return;
    state.body.age += ms;
    if (state.form && state.body.age >= 1200) {
      this.system.resources.stop(state.form);
      state.form = null;
    }
    this.presentForm(mob, state);
  }

  presentForm(mob, state) {
    const animation = state.body.animation;
    animation.setPosition(mob.x, mob.y);
    animation.container.scale.x = mob.facing > 0 ? -1 : 1;
    animation.container.visible = mob.visible && state.body.age >= 1200;
    animation.container.alpha = mob.opacity;
    const action = animation.actions.has(mob.action) ? mob.action : "stand";
    animation.setAction(action, mob.state === "hit" ? "once" : "loop");
    animation.seek(mob.actionMs);
    this.placeFormDepth(mob, state);
  }

  placeFormDepth(mob, state) {
    const animation = state.body.animation;
    const foothold = mob.foothold;
    const depth = foothold
      ? 29991 + (foothold.layer * 3000 - foothold.group) * 10
      : 239991;
    if (animation.container.zIndex !== depth) {
      this.system.scene.addWorldContainer(animation.container, depth);
    }
    if (state.form && state.body.age < 1200) {
      const transitionDepth = state.movementType === 3 ? 270100 : depth;
      state.form.animation.container.visible = mob.visible;
      if (state.form.animation.container.zIndex !== transitionDepth) {
        this.system.scene.addWorldContainer(
          state.form.animation.container,
          transitionDepth,
        );
      }
    }
  }

  beginForm(mob, state) {
    for (const body of this.formBodies) {
      if (body.mob) continue;
      body.mob = mob;
      body.age = 0;
      state.body = body;
      mob.actions = this.doomActions;
      mob.defaultAction = "stand";
      mob.speed = this.doomSpeed;
      //0100101 replaces controller3; absent ground contact keeps the existing local policy.
      mob.movementType = 1;
      mob.flight = null;
      mob.movement = "stationary-special";
      const authored = mob.record.authored;
      if (
        mob.foothold?.dx > 0 &&
        Number.isFinite(authored.rx0) &&
        Number.isFinite(authored.rx1)
      ) {
        mob.movement = "ground-patrol";
      }
      mob.pendingAttack = null;
      mob.state = "idle";
      mob.stateMs = 0;
      mob.action = null;
      setMobAction(mob, "stand");
      state.form = this.system.resources.playSequence(
        this.doomSequence,
        mob,
        FORM_OPTIONS,
      );
      if (!state.form) {
        throw new Error("Admitted Doom transition pool exhausted");
      }
      return;
    }
    throw new Error("Admitted Doom actor pool exhausted");
  }

  endForm(state) {
    const mob = state.mob;
    this.system.resources.stop(state.form);
    state.form = null;
    state.body.animation.container.visible = false;
    state.body.mob = null;
    state.body = null;
    mob.actions = state.actions;
    mob.defaultAction = state.defaultAction;
    mob.speed = state.speed;
    mob.movement = state.movement;
    mob.movementType = state.movementType;
    mob.flight = state.flight;
    if (mob.flight) mob.foothold = null;
    if (mob.alive) {
      mob.state = "idle";
      mob.stateMs = 0;
      mob.pendingAttack = null;
    }
    mob.action = null;
    setMobAction(
      mob,
      mob.alive || !mob.actions.die1 ? mob.defaultAction : "die1",
    );
  }

  hidesBody(mob) {
    return (
      !!this.states.get(mob)?.body &&
      mob.skillStatus.remaining[MOB_STATUS.doom] > 0
    );
  }

  cancel(id) {
    if (id === 4211006 || id === undefined) {
      this.pending = false;
      this.count = 0;
    }
  }

  destroy() {
    this.cancel();
    this.formAbort?.abort();
    for (const state of this.stateList) if (state.body) this.endForm(state);
    if (this.doomSequence) {
      for (const slot of this.doomSequence.slots) {
        this.system.scene.removeWorldContainer(slot.animation.container);
      }
    }
    for (const body of this.formBodies) {
      this.system.scene.removeWorldContainer(body.animation.container);
      body.animation.container.destroy(DESTROY);
    }
    this.formBodies.length = 0;
    this.formOwner?.destroy();
    this.formOwner = null;
    this.states.clear();
    this.stateList.length = 0;
  }
}
