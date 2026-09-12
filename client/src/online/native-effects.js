/** Immutable server effects with disposable countdown presentation, never local buff authority. */
export class NativeEffects {
  constructor(owner) {
    this.owner = owner;
    this.records = [];
    this.generation = 0;
    this.effects = { revision: 0, find: (source) => this.records.find((entry) => entry.source === source) };
  }
  async publish(effects) {
    const generation = ++this.generation;
    const records = effects.map((entry) => ({ ...entry, wireId: entry.id, id: entry.templateId, source: entry.kind === "item" ? -entry.templateId : entry.templateId, noShadow: entry.duration === null, segmentMs: entry.duration === null ? 0 : Math.trunc(entry.duration / 16), remaining: entry.expiresAt === null ? 0 : Math.max(0, entry.expiresAt - Date.now()) }));
    for (const record of records) await this.owner.ui.temporaryStats.prepareSource(record.kind, record.id);
    if (generation !== this.generation || this.owner.destroyed) return;
    this.records = records;
    this.effects.revision++;
    this.owner.ui.temporaryStats.bind(this);
  }
  effectCount() { return this.records.length; }
  effectAt(index) { return this.records[index]; }
  level(id) { return this.owner.store.profile?.skills[id]?.level ?? 0; }
  cancelEffect(kind, id) {
    const effect = this.records.find((entry) => entry.kind === kind && entry.id === id);
    if (!effect?.cancelable) return false;
    this.owner.command({ kind: "buff.cancel", effectId: effect.wireId }).catch((error) => this.owner.report(error));
    return true;
  }
  update() {
    const now = Date.now();
    for (const record of this.records) record.remaining = record.expiresAt === null ? 0 : Math.max(0, record.expiresAt - now);
  }
  destroy() { this.generation++; this.records.length = 0; }
}
