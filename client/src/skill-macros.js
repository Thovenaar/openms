import {
  PROFILE_DOMAIN_LIMITS,
  validateSkillMacros,
} from "./profile-domains.js";
import { prepareMacroWords, filterMacroName } from "./skill-macro-name.js";

const GROUPS = PROFILE_DOMAIN_LIMITS.macros;
const SLOTS = PROFILE_DOMAIN_LIMITS.macroSkills;
const MAX_SKILLS = 4096;
const MAX_RANKS = 256; // Extraction/CPU safety bound, not a learned-rank entitlement.
const TICK_MS = 30;
// 0063196b: failed admission adds30; the queue is cleared only when elapsed >4000.
const ADMISSION_TIMEOUT_MS = 4000;
const OK = Object.freeze({ ok: true });
// 004fb08f (keydown skills), then the additional movement exclusions at004fb292.
const EXCLUDED = new Set([
  1121001, 1221001, 1321001, 2121001, 2221001, 2321001, 3121004, 3221001,
  5101004, 5201002, 5221004, 13111002, 14111006, 15101003, 22121000, 22151001,
  2101002, 2201002, 2301001, 12101003, 22101001, 4111006, 4211006, 11101005,
  14101004,
]);

function denied(code, reason) {
  return { ok: false, code, reason };
}

function validIndex(index, count = GROUPS) {
  return Number.isInteger(index) && index >= 0 && index < count;
}

/** 00631b81 and004fb292 classify the thousands digit, not the current job book. */
function activeId(id) {
  const digit = Math.trunc(id / 1000) % 10;
  return id > 0 && digit !== 0 && digit !== 9;
}

function copyMacros(records) {
  return records.map((record) => ({
    name: record.name,
    skills: record.skills.slice(),
    shout: record.shout,
  }));
}

/** 004fb112 checks cooltime at EVERY authored rank;00760354 stores it at level+1bc. */
function cooldownSkill(skill) {
  const levels = Object.values(skill.levels);
  if (levels.length > MAX_RANKS) {
    throw new Error("Macro skill rank budget exceeded");
  }
  return levels.some((level) => level.cooltime > 0);
}

function hasMacroData(store, catalog) {
  return !!store?.profile?.skillMacros && !!catalog?.ui?.skills;
}

/** Queue ownership never grants skills, fabricates casts, or duplicates the SkillSystem clock. */
export class SkillMacros {
  constructor(store, catalog, hooks) {
    if (
      !hasMacroData(store, catalog) ||
      typeof hooks?.skillSystem !== "function" ||
      typeof hooks?.isBusy !== "function" ||
      typeof hooks?.onChat !== "function"
    ) {
      throw new TypeError(
        "SkillMacros requires a profile, skill catalog and live authority hooks",
      );
    }
    validateSkillMacros(store.profile.skillMacros);
    this.store = store;
    this.catalog = catalog.ui.skills;
    this.nameWords = prepareMacroWords(catalog.ui.skillMacroRules);
    this.hooks = hooks;
    this.listeners = new Set();
    this.cooldownSkills = new Set();
    this.queue = new Uint32Array(SLOTS);
    this.queueShout = new Uint8Array(SLOTS);
    this.draft = null;
    this.checkpoint = null;
    this.saving = false;
    this.destroyed = false;
    this.index = -1;
    this.cursor = 0;
    this.count = 0;
    this.waitMs = 0;
    this.authority = null;
    this.lastResult = OK;
    const skills = Object.values(this.catalog);
    if (skills.length > MAX_SKILLS) {
      throw new Error("Macro skill catalog budget exceeded");
    }
    for (const skill of skills) {
      if (cooldownSkill(skill)) this.cooldownSkills.add(skill.id);
    }
    this.unsubscribe = store.subscribe(this.changed.bind(this));
  }

  subscribe(listener) {
    if (typeof listener !== "function" || this.listeners.size >= 32) {
      throw new TypeError("Invalid macro observer/budget");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed() {
    if (this.destroyed) return;
    for (const listener of this.listeners) listener();
    this.hooks.onChange?.();
  }

  snapshot() {
    return {
      records: copyMacros(this.draft ?? this.store.profile.skillMacros),
      editing: this.draft !== null,
      saving: this.saving,
      running: this.index >= 0,
      index: this.index,
      next: this.cursor,
      count: this.count,
      waitingMs: this.waitMs,
      result: this.lastResult,
    };
  }

  begin() {
    if (this.destroyed || this.saving) {
      return denied("busy", "Macro editor is unavailable");
    }
    if (this.draft) return OK;
    this.draft = copyMacros(this.store.profile.skillMacros);
    this.checkpoint = JSON.stringify(this.store.profile.skillMacros);
    this.changed();
    return OK;
  }

  editError(index) {
    if (this.destroyed || this.saving || this.store.profileTransactionPending) {
      return "A profile operation is pending";
    }
    if (!this.draft) return "Macro editor is not open";
    return validIndex(index) ? null : "Invalid macro group";
  }

  assignmentError(id) {
    if (!Number.isSafeInteger(id) || !this.catalog[id]) {
      return "Original skill data is unavailable";
    }
    if (!activeId(id)) return "Passive skills cannot be assigned to a macro";
    if (EXCLUDED.has(id)) {
      return "This original movement or held-key skill cannot be assigned to a macro";
    }
    if (this.cooldownSkills.has(id)) {
      return "Skills with a cooldown cannot be assigned to a macro";
    }
    if (!this.hooks.skillSystem()?.level(id)) {
      return "Skill has no current learned rank";
    }
    return null;
  }

  /** source is an optional same-draft {index,slot}; mutation occurs only after all admission. */
  assign(index, slot, id, source = null) {
    const error = this.editError(index) ?? this.assignmentError(id);
    if (error) return denied("assignment", error);
    if (!validIndex(slot, SLOTS)) {
      return denied("slot", "Invalid macro skill slot");
    }
    if (
      source &&
      (!validIndex(source.index) ||
        !validIndex(source.slot, SLOTS) ||
        this.draft[source.index].skills[source.slot] !== id)
    ) {
      return denied("stale-source", "The carried macro skill changed");
    }
    if (source) this.draft[source.index].skills[source.slot] = 0;
    this.draft[index].skills[slot] = id;
    this.changed();
    return OK;
  }

  /** 00631a99 clears exactly one cell; later skills do not shift left. */
  remove(index, slot) {
    const error = this.editError(index);
    if (error) return denied("edit", error);
    if (!validIndex(slot, SLOTS)) {
      return denied("slot", "Invalid macro skill slot");
    }
    this.draft[index].skills[slot] = 0;
    this.changed();
    return OK;
  }

  name(index, text) {
    const error = this.editError(index);
    if (error) return denied("edit", error);
    if (
      typeof text !== "string" ||
      text.length > PROFILE_DOMAIN_LIMITS.macroName ||
      /[^\x20-\x7e\u0080-\u{10ffff}]/u.test(text)
    ) {
      return denied(
        "name",
        "A skill macro name must be at most12 characters on one line",
      );
    }
    this.draft[index].name = text;
    this.changed();
    return OK;
  }

  shout(index, enabled) {
    const error = this.editError(index);
    if (error) return denied("edit", error);
    if (typeof enabled !== "boolean") {
      return denied("shout", "Invalid macro shout setting");
    }
    this.draft[index].shout = enabled;
    this.changed();
    return OK;
  }

  async save() {
    const error = this.editError(0);
    if (error) return denied("edit", error);
    const records = copyMacros(this.draft);
    const checkpoint = this.checkpoint;
    this.saving = true;
    this.changed();
    try {
      validateSkillMacros(records);
      for (const record of records) {
        record.name = filterMacroName(record.name, this.nameWords);
      }
      await this.store.commitProfile((profile) => {
        if (this.destroyed) throw new Error("Macro editor was destroyed");
        if (JSON.stringify(profile.skillMacros) !== checkpoint) {
          throw new Error("Saved macros changed while this draft was open");
        }
        profile.skillMacros = copyMacros(records);
      });
      this.draft = copyMacros(records);
      this.checkpoint = JSON.stringify(records);
      this.lastResult = OK;
      return OK;
    } catch (failure) {
      this.lastResult = denied("save", failure.message);
      this.hooks.onError?.(failure);
      return this.lastResult;
    } finally {
      this.saving = false;
      this.changed();
    }
  }

  /** Cancel is editor rollback only; interruption owns the independent running queue. */
  cancel() {
    if (this.saving) return denied("busy", "Macro save is pending");
    this.draft = null;
    this.checkpoint = null;
    this.changed();
    return OK;
  }

  /** 0094f438 passes native type8 ID unchanged: group0..4, including valid ID0. */
  activate(index) {
    if (!validIndex(index) || this.destroyed) {
      return denied("index", "Invalid macro group");
    }
    if (this.index >= 0) {
      return denied("running", "A skill macro is already running");
    }
    const authority = this.hooks.skillSystem();
    if (
      !authority ||
      authority.destroyed ||
      this.store.profile.hp <= 0 ||
      this.store.profileTransactionPending ||
      this.hooks.isBusy()
    ) {
      return denied("blocked", "Character or skill authority is unavailable");
    }
    this.fillQueue(this.store.profile.skillMacros[index]);
    if (!this.count) {
      return denied("empty", "The macro has no eligible active skills");
    }
    this.authority = authority;
    this.index = index;
    this.cursor = 0;
    this.waitMs = 0;
    this.lastResult = OK;
    this.changed();
    return OK;
  }

  /** 00631b81 leaves the first-eligible marker consumed even if its cooldown filters it out. */
  fillQueue(record) {
    this.count = 0;
    let first = true;
    for (let slot = 0; slot < SLOTS; slot++) {
      const id = record.skills[slot];
      if (!activeId(id)) continue;
      const shout = first;
      first = false;
      if (this.cooldownSkills.has(id)) continue;
      this.queue[this.count] = id;
      this.queueShout[this.count] = Number(shout);
      this.count++;
    }
  }

  /** Call once AFTER the real field/action and SkillSystem tick; never from render time. */
  step(ms) {
    if (this.destroyed || this.index < 0) return;
    if (ms !== TICK_MS) {
      throw new Error("Skill macros require one original30-ms quantum");
    }
    const authority = this.hooks.skillSystem();
    if (
      authority !== this.authority ||
      authority.destroyed ||
      this.store.profile.hp <= 0
    ) {
      this.interrupt("Character died or changed fields");
      return;
    }
    const id = this.queue[this.cursor];
    const skill = this.catalog[id];
    const reason = this.hooks.isBusy()
      ? "Input is owned by an editor or modal operation"
      : authority.castError(skill, authority.info(id));
    if (reason) {
      this.waitForAdmission(reason);
      return;
    }
    const result = authority.activate(id);
    if (!result.ok) {
      this.waitForAdmission(result.reason);
      return;
    }
    this.publishCast();
  }

  waitForAdmission(reason) {
    this.waitMs += TICK_MS;
    // A refusal is not a consumed cast: unlearned/expired/unsupported skills hold the queue.
    if (this.waitMs > ADMISSION_TIMEOUT_MS) {
      this.interrupt(reason, "admission-timeout");
    }
  }

  publishCast() {
    const record = this.store.profile.skillMacros[this.index];
    const shout = this.queueShout[this.cursor] && record.shout && record.name;
    this.cursor++;
    this.waitMs = 0;
    if (this.cursor === this.count) {
      // Native removes the last queue entry on admission; its real action continues independently.
      this.index = -1;
      this.authority = null;
    }
    if (shout) this.publishShout(record.name);
    this.changed();
  }

  async publishShout(name) {
    // Retire the accepted cast before awaiting actual local chat delivery.
    try {
      const outcome = await this.hooks.onChat(name);
      if (this.destroyed) return;
      if (!outcome?.accepted) {
        this.lastResult = denied(
          "shout",
          outcome?.reason ?? "Skill-name chat was not admitted",
        );
      }
      this.changed();
    } catch (error) {
      if (this.destroyed) return;
      this.lastResult = denied("shout", error.message);
      this.hooks.onError?.(error);
    }
  }

  /** 0094f3d5 nonmacro actions,0094cda2 left/right,00a0900a transitions clear pending work. */
  interrupt(reason = "Macro interrupted", code = "interrupted") {
    if (this.index < 0) return false;
    this.index = -1;
    this.count = 0;
    this.cursor = 0;
    this.waitMs = 0;
    this.authority = null;
    this.lastResult = denied(code, reason);
    this.changed();
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.interrupt("Macro owner destroyed");
    this.destroyed = true;
    this.unsubscribe();
    this.listeners.clear();
    this.draft = null;
    this.authority = null;
  }
}
