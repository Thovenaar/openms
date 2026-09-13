import { validateSkillMacros } from "../profile/profile-domains.js";
import {
  prepareMacroWords,
  filterMacroName,
} from "../skills/skill-macro-name.js";
import { unsupported } from "./native-source.js";

const TICK_MS = 30;
const ADMISSION_TIMEOUT_MS = 4000; // Original0063196b clears only after elapsed >4000.

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
    this.queue = null;
    this.debt = 0;
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
    this.running = true;
    this.queue = {
      record: structuredClone(record),
      slot: 0,
      elapsed: 0,
      pending: false,
      generation: ++this.generation,
      fieldEpoch: this.owner.state.fieldEpoch,
    };
    this.debt = 0;
    this.changed();
    return { ok: true };
  }
  observeState() {
    if (!this.queue) return;
    if (
      this.owner.state?.self.hp <= 0 ||
      this.owner.state?.fieldEpoch !== this.queue.fieldEpoch
    ) {
      this.interrupt();
    }
  }
  update(ms) {
    this.observeState();
    if (!this.queue) return;
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      {throw new Error("Invalid macro elapsed time");}
    this.debt += ms;
    const ticks = Math.floor(this.debt / TICK_MS);
    this.debt %= TICK_MS;
    if (!ticks) return;
    this.queue.elapsed += ticks * TICK_MS;
    if (this.queue.elapsed > ADMISSION_TIMEOUT_MS) {
      this.owner.report("Macro admission timed out.");
      this.interrupt();
      return;
    }
    if (!this.queue.pending) this.attempt(this.queue);
  }
  attempt(queue) {
    while (
      queue.slot < queue.record.skills.length &&
      !queue.record.skills[queue.slot]
    )
      {queue.slot++;}
    if (queue.slot === queue.record.skills.length) {
      this.finish(queue);
      return;
    }
    queue.pending = true;
    this.owner
      .request({ kind: "skill.cast", skillId: queue.record.skills[queue.slot] })
      .then((result) => {
        if (queue.generation !== this.generation) return;
        if (result.ok) {
          queue.slot++;
          queue.elapsed = 0;
        }
      })
      .catch((error) => this.owner.report(error))
      .finally(() => {
        queue.pending = false;
      });
  }
  finish(queue) {
    this.interrupt();
    if (
      queue.record.shout &&
      this.owner.state?.self.hp > 0 &&
      this.owner.state.fieldEpoch === queue.fieldEpoch
    ) {
      this.owner
        .submitChat(queue.record.name, 7)
        .catch((error) => this.owner.report(error));
    }
  }
  interrupt() {
    this.generation++;
    this.queue = null;
    this.running = false;
    this.debt = 0;
    this.changed();
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
