import { validateSkillMacros } from "../profile/profile-domains.js";
import {
  prepareMacroWords,
  filterMacroName,
} from "../skills/skill-macro-name.js";
import { unsupported } from "./native-source.js";

/** Detached native editor drafts; Save and each macro cast are closed server requests. */
export class NativeMacros {
  constructor(owner) {
    this.owner = owner;
    this.store = owner.store;
    this.draft = null;
    this.saving = false;
    this.generation = 0;
    this.running = false;
    this.listeners = new Set();
    this.words = prepareMacroWords(owner.catalog.ui.skillMacroRules);
  }
  subscribe(listener) {
    if (this.listeners.size >= 32) {
      throw new Error("Macro observer budget exceeded");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  begin() {
    if (this.saving) return unsupported("macro editing while saving");
    this.draft ??= structuredClone(this.store.profile.skillMacros);
    this.changed();
    return { ok: true };
  }
  edit(index, operation) {
    if (
      !this.draft ||
      this.saving ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= 5
    ) {
      return unsupported("this macro edit");
    }
    operation(this.draft[index]);
    this.changed();
    return { ok: true };
  }
  assign(index, slot, id, source = null) {
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= 3 ||
      !this.store.profile.skills[id]?.level
    ) {
      return unsupported("this macro skill assignment");
    }
    if (source) {
      if (this.draft?.[source.index]?.skills[source.slot] !== id) {
        return unsupported("a stale macro carry");
      }
      this.edit(source.index, (record) => {
        record.skills[source.slot] = 0;
      });
    }
    return this.edit(index, (record) => {
      record.skills[slot] = id;
    });
  }
  remove(index, slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 3) {
      return unsupported("this macro slot");
    }
    return this.edit(index, (record) => {
      record.skills[slot] = 0;
    });
  }
  name(index, value) {
    if (typeof value !== "string" || value.length > 12) {
      return unsupported("this macro name");
    }
    return this.edit(index, (record) => {
      record.name = value;
    });
  }
  shout(index, value) {
    if (typeof value !== "boolean") return unsupported("this shout setting");
    return this.edit(index, (record) => {
      record.shout = value;
    });
  }
  async save() {
    if (!this.draft || this.saving) return unsupported("macro saving now");
    const skillMacros = structuredClone(this.draft);
    validateSkillMacros(skillMacros);
    for (const record of skillMacros) {
      record.name = filterMacroName(record.name, this.words);
    }
    this.saving = true;
    this.changed();
    try {
      const result = await this.owner.request({
        kind: "skill-macros.save",
        skillMacros,
      });
      if (result.ok) this.draft = null;
      return result;
    } finally {
      this.saving = false;
      this.changed();
    }
  }
  cancel() {
    if (this.saving) return unsupported("cancelling a pending macro save");
    this.draft = null;
    this.changed();
    return { ok: true };
  }
  activate(index) {
    const record = this.store.profile.skillMacros[index];
    if (!record || this.running || !record.skills.some((id) => id > 0)) {
      return unsupported("this macro activation");
    }
    const generation = ++this.generation;
    this.run(record, generation).catch((error) => this.owner.report(error));
    return { ok: true };
  }
  async run(record, generation) {
    this.running = true;
    try {
      for (const skillId of record.skills) {
        if (generation !== this.generation) return;
        if (!skillId) continue;
        const result = await this.owner.request({
          kind: "skill.cast",
          skillId,
        });
        if (!result.ok) {
          this.owner.report(result.reason);
          return;
        }
      }
      if (record.shout && generation === this.generation) {
        await this.owner.submitChat(record.name, 7);
      }
    } finally {
      this.running = false;
      this.changed();
    }
  }
  interrupt() {
    this.generation++;
  }
  snapshot() {
    return {
      records: structuredClone(this.draft ?? this.store.profile.skillMacros),
      editing: Boolean(this.draft),
      saving: this.saving,
      running: this.running,
    };
  }
  destroy() {
    this.interrupt();
    this.listeners.clear();
  }
}
