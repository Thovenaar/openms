import { STATE_SKILLS } from "./skill-state-rules.js";
import {
  configureTemporaryState,
  temporaryState,
  TEMPORARY_STATS,
} from "./temporary-stats.js";
import { recalculateVitals } from "../character/character-stats.js";
import { weaponType } from "../combat/weapon-usage.js";
import { SkillShadowPresentation } from "./skill-shadow-presentation.js";
import { SkillComboPresentation } from "./skill-combo-presentation.js";
import {
  MORPH_SKILLS,
  RIDING_SKILLS,
  DASH_SKILLS,
  STATIONARY_SUMMONS,
  CIRCLE_SUMMONS,
  FOLLOW_SUMMONS,
} from "./skill-world-rules.js";

const BLOOD_INTERVAL_MS = 4000; // Cosmic Character.prepareDragonBlood7582..7597.
const SCALAR_FIELDS = new Set([
  "pad",
  "pdd",
  "mad",
  "mdd",
  "acc",
  "eva",
  "speed",
  "jump",
]);
const BEHOLDER_IDS = [1320008, 1320009];
const EVENT_REPEAT = Object.freeze({ follow: true, loop: true });
const COMBO_COST_STATES = new Set([1121010, 21100005, 21120007]);
const MORPH_SPEC = Object.freeze({
  family: "morph",
  fields: { morph: "morph", morphSTR: "str" },
});
const RIDING_SPEC = Object.freeze({
  family: "riding",
  fields: { monsterRiding: "id" },
});
const DASH_SPEC = Object.freeze({
  family: "dash",
  fields: { dashSpeed: "x", dashJump: "y" },
});
const PUPPET_SPEC = Object.freeze({ family: "puppet", fields: { puppet: 1 } });
const SUMMON_SPEC = Object.freeze({ family: "summon", fields: { summon: 1 } });
function stateSpec(id) {
  const state = STATE_SKILLS.get(id);
  if (state) return state;
  if (MORPH_SKILLS.has(id)) return MORPH_SPEC;
  if (RIDING_SKILLS.has(id)) return RIDING_SPEC;
  if (DASH_SKILLS.has(id)) return DASH_SPEC;
  if (STATIONARY_SUMMONS.has(id)) return PUPPET_SPEC;
  if (CIRCLE_SUMMONS.has(id) || FOLLOW_SUMMONS.has(id)) return SUMMON_SPEC;
  return null;
}
const EMPTY_SPEC = Object.freeze({});
function equippedWeapon(profile) {
  for (const item of profile.equipment) {
    if (item.slot === -11) return weaponType(item.id);
  }
  return 0;
}
function mappedValue(value, skill, info) {
  if (value === "id") return skill.id;
  if (value === "packed") return (info.x << 8) | info.y;
  return typeof value === "number" ? value : (info[value] ?? 0);
}

function stateFieldValue(field, spec, skill, info) {
  let value = 0;
  if (SCALAR_FIELDS.has(field) && spec?.family !== "charge") {
    value = info[field] ?? 0;
  }
  if (spec?.family === "dark-sight" && field === "speed") value = 0;
  const mapped = spec?.fields[field];
  return mapped === undefined ? value : mappedValue(mapped, skill, info);
}

function configureStateValues(state, spec, skill, info) {
  for (let index = 0; index < TEMPORARY_STATS.length; index++) {
    const value = stateFieldValue(TEMPORARY_STATS[index], spec, skill, info);
    state.values[index] = value;
    if (value !== 0) state.statCount++;
  }
}

/** Convert authored skill values into a detached effect for an authority transaction. */
export function skillBuffSpecification(skill, info) {
  const definition = stateSpec(skill.id);
  if (!definition) throw new Error("Skill has no temporary state definition");
  const state = temporaryState("skill", skill.id);
  configureStateValues(state, definition, skill, info);
  const values = {};
  for (let index = 0; index < TEMPORARY_STATS.length; index++) {
    if (state.values[index]) {
      values[TEMPORARY_STATS[index]] = state.values[index];
    }
  }
  return { family: definition.family, values };
}

/** Timed values use the existing source/mask authority; no independent buff clock. */
export class SkillStateController {
  constructor(system) {
    this.system = system;
    this.shadow = new SkillShadowPresentation(system);
    this.comboPresentation = new SkillComboPresentation(system);
    this.eventVisuals = new Map();
    this.eventRecords = [];
    for (const [id, spec] of STATE_SKILLS) {
      if (spec.family.startsWith("event-")) {
        const event = { id, sequence: null, slot: null };
        this.eventVisuals.set(id, event);
        this.eventRecords.push(event);
      }
    }
    this.bloodElapsed = 0;
    this.bloodSource = null;
    this.beholderElapsed = new Float64Array(2);
    this.beholderState = temporaryState("skill", 1320009);
    if (system.catalog[1320009]) system.states.set(1320009, this.beholderState);
    this.vitalHP = 0;
    this.vitalMP = 0;
    this.vitalProfile = null;
    this.maximumHP = 0;
    this.maximumMP = 0;
  }

  hasSource(id) {
    return id === 1320009 || stateSpec(id) !== null;
  }

  learningError(id, rank) {
    if (id !== 1320009 || rank < 1 || !this.system.effects.find(1321007)) {
      return null;
    }
    return this.system.effects.canStart(id)
      ? null
      : "Beholder Hex requires a temporary source slot";
  }

  /** Rank may come from an admitted draft; reserve before any asynchronous preparation. */
  syncBeholderReservation(rank = this.system.level(1320009)) {
    const effects = this.system.effects;
    if (effects.find(1321007) && rank > 0) {
      effects.reserveSource(1320009, 1321007);
    } else {
      effects.releaseOwner(1321007);
    }
  }

  async prepare(learnedSkills) {
    await this.shadow.prepare(learnedSkills);
    await this.comboPresentation.prepare(learnedSkills);
    for (const skill of learnedSkills) {
      const event = this.eventVisuals.get(skill.id);
      if (event) {
        event.sequence = await this.system.resources.acquireSequence(
          skill,
          "repeat",
          1,
        );
      }
    }
  }

  present(ms) {
    this.shadow.present(ms);
    this.comboPresentation.present(ms);
    this.presentEvents();
  }

  destroy() {
    this.shadow.destroy();
    this.comboPresentation.destroy();
    for (const event of this.eventVisuals.values()) {
      this.system.resources.stop(event.slot);
    }
    if (!this.system.transferredEffects) {
      this.system.effects.releaseOwner(1321007);
    }
  }

  presentEvents() {
    for (let index = 0; index < this.eventRecords.length; index++) {
      const event = this.eventRecords[index];
      const active = this.system.effects.find(event.id)?.remaining > 0;
      if (active && !event.slot && event.sequence) {
        event.slot = this.system.resources.playSequence(
          event.sequence,
          this.system.scene.simulation,
          EVENT_REPEAT,
        );
      } else if (!active && event.slot) {
        this.system.resources.stop(event.slot);
        event.slot = null;
      }
    }
  }

  admissionError(skill, info) {
    const spec = STATE_SKILLS.get(skill.id);
    if (!spec) return "Skill has no active state controller";
    if (
      !Number.isSafeInteger(info.time * 1000) ||
      info.time * 1000 < 16 ||
      info.time * 1000 > 2147483647
    ) {
      return "Invalid original state duration";
    }
    if (!this.system.effects.canStart(skill.id)) {
      return "Active buff budget exceeded";
    }
    const event = this.eventVisuals.get(skill.id);
    if (event && !event.sequence) {
      return "Original event repeat artwork is not prepared";
    }
    if (
      spec.weapons &&
      !spec.weapons.includes(equippedWeapon(this.system.store.profile))
    ) {
      return "Skill requires its original weapon family";
    }
    return this.combatAdmissionError(skill, info);
  }

  combatAdmissionError(skill, info) {
    const gameplay = this.system.hooks.gameplay?.();
    if (
      COMBO_COST_STATES.has(skill.id) &&
      (typeof gameplay?.skillStateError !== "function" ||
        typeof gameplay?.skillStateCast !== "function")
    ) {
      return "Combo combat state authority unavailable";
    }
    return gameplay?.skillStateError?.(skill, info) ?? null;
  }

  cast(skill, info, rank) {
    this.system.hooks.gameplay?.()?.skillStateCast?.(skill, info);
    this.system.startBuff(skill, rank, info);
    if (skill.actions.length) this.system.hooks.startAction(skill.actions[0]);
  }

  /** Called by SkillSystem.startBuff; also used by source-backed passive schedule publication. */
  configure(skill, rank, info) {
    const system = this.system;
    const spec = stateSpec(skill.id);
    const state =
      system.states.get(skill.id) ??
      (skill.id === 1320009 ? this.beholderState : null);
    if (!state) throw new Error("Unprepared temporary skill source");
    if (spec && spec.family !== "derived-stats") {
      this.cancelFamily(spec.family, false);
    }
    configureTemporaryState(
      state,
      EMPTY_SPEC,
      info.time * 1000,
      skill.properties.noShadow,
    );
    configureStateValues(state, spec, skill, info);
    state.rank = rank;
    state.expiresAt = system.store.profile.skills[skill.id]?.expiresAt ?? null;
    system.effects.start(state);
    this.syncVitals();
  }

  cancelFamily(family, publish = true) {
    const effects = this.system.effects;
    for (let index = effects.count - 1; index >= 0; index--) {
      const source = effects.sources[index];
      if (source.kind === "skill" && stateSpec(source.id)?.family === family) {
        effects.remove(source.source);
      }
    }
    if (publish) this.system.recompute();
  }

  setValue(id, field, value) {
    const index = TEMPORARY_STATS.indexOf(field);
    const state = this.system.effects.find(id);
    if (!state || index < 0 || !Number.isFinite(value)) return false;
    if (state.values[index] === 0 && value !== 0) state.statCount++;
    if (state.values[index] !== 0 && value === 0) state.statCount--;
    state.values[index] = value;
    this.system.recompute();
    return true;
  }

  cancel(id) {
    const removed = this.system.effects.remove(id);
    if (removed) this.system.recompute();
    this.syncVitals();
    return removed;
  }

  /** Same-store profile replacement/equipment changes never compound transient max percentages. */
  syncVitals() {
    const system = this.system;
    const profile = system.store.profile;
    const derived = system.derived();
    if (system.store.profileTransactionPending) return;
    if (
      this.vitalProfile === profile &&
      this.vitalHP === derived.hyperBodyHP &&
      this.vitalMP === derived.hyperBodyMP &&
      this.maximumHP === profile.maxHP &&
      this.maximumMP === profile.maxMP
    ) {
      return;
    }
    this.vitalProfile = profile;
    this.vitalHP = derived.hyperBodyHP;
    this.vitalMP = derived.hyperBodyMP;
    recalculateVitals(profile, system.fullCatalog.ui.items, derived);
    this.maximumHP = profile.maxHP;
    this.maximumMP = profile.maxMP;
  }

  step(ms) {
    if (this.system.store.profileTransactionPending) return;
    this.cancelInvalidWeapons();
    this.advanceBlood(ms);
    if (this.system.level(1320009) < 1) {
      this.system.effects.releaseOwner(1321007);
    }
    this.advanceBeholder(ms);
    this.syncVitals();
  }

  cancelInvalidWeapons() {
    const effects = this.system.effects;
    const weapon = equippedWeapon(this.system.store.profile);
    let changed = false;
    for (let index = effects.count - 1; index >= 0; index--) {
      const state = effects.sources[index];
      const weapons =
        state.kind === "skill" ? STATE_SKILLS.get(state.id)?.weapons : null;
      if (weapons && !weapons.includes(weapon)) {
        changed = effects.remove(state.source) || changed;
      }
    }
    if (changed) this.system.recompute();
  }

  advanceBlood(ms) {
    const source = this.system.effects.find(1311008);
    if (source !== this.bloodSource || source?.remaining === source?.totalMs) {
      this.bloodElapsed = 0;
    }
    this.bloodSource = source;
    if (!source) return;
    this.bloodElapsed += this.activeMilliseconds(source, ms);
    const ticks = Math.floor(this.bloodElapsed / BLOOD_INTERVAL_MS);
    this.bloodElapsed %= BLOOD_INTERVAL_MS;
    if (!ticks) return;
    const profile = this.system.store.profile;
    profile.hp = Math.max(
      0,
      profile.hp - ticks * this.system.info(1311008, source.rank).x,
    );
    this.system.store.markDirty();
    if (!profile.hp) this.system.onDeath();
  }

  activeMilliseconds(source, ms) {
    const expiry = source.expiresAt;
    const until =
      expiry === null
        ? source.remaining
        : Math.max(0, expiry - this.system.wallTime - 1);
    return Math.min(ms, source.remaining, until);
  }

  advanceBeholder(ms) {
    if (!this.system.worldController?.active(1321007)) {
      this.beholderElapsed.fill(0);
      return;
    }
    const activeMs = Math.min(
      ms,
      this.system.worldController.remainingMs(1321007),
    );
    for (let index = 0; index < BEHOLDER_IDS.length; index++) {
      const id = BEHOLDER_IDS[index];
      const rank = this.system.level(id);
      if (!rank) {
        this.beholderElapsed[index] = 0;
        continue;
      }
      const info = this.system.info(id, rank);
      const interval = info.x * 1000;
      const expiresAt = this.system.store.profile.skills[id].expiresAt;
      const remaining =
        expiresAt === null
          ? activeMs
          : Math.max(0, expiresAt - this.system.wallTime - 1);
      const elapsed = Math.min(activeMs, remaining);
      this.beholderElapsed[index] += elapsed;
      const ticks = Math.floor(this.beholderElapsed[index] / interval);
      this.beholderElapsed[index] %= interval;
      if (!ticks) continue;
      this.beholderTick(id, rank, info, ticks);
      if (id === 1320009) {
        const source = this.system.effects.find(id);
        if (source) source.remaining += elapsed - this.beholderElapsed[index];
      }
    }
  }

  beholderTick(id, rank, info, ticks) {
    const system = this.system;
    if (id === 1320009) {
      if (!system.effects.canStart(id)) {
        throw new Error("Beholder Hex temporary-stat budget exceeded");
      }
      this.configure(system.catalog[id], rank, info);
      system.worldController.beholderEffect(false);
      return;
    }
    const profile = system.store.profile;
    if (profile.hp <= 0) return;
    const hp = Math.min(profile.maxHP, profile.hp + ticks * info.hp);
    if (hp !== profile.hp) {
      profile.hp = hp;
      system.store.markDirty();
    }
    system.worldController.beholderEffect(true);
  }

  inherit(previous) {
    this.bloodElapsed = previous.bloodElapsed;
    this.bloodSource = previous.bloodSource;
    this.beholderElapsed.set(previous.beholderElapsed);
    this.beholderState = previous.beholderState;
    this.syncVitals();
  }

  onDeath() {
    this.bloodElapsed = 0;
    this.bloodSource = null;
    this.beholderElapsed.fill(0);
    this.system.effects.releaseOwner(1321007);
    this.syncVitals();
  }
}
