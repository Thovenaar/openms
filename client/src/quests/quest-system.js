import { awardExperience } from "../character/offline-progression.js";
import { PROFILE_LIMITS } from "../profile/profile-validation.js";
import {
  itemCount,
  isEquipped,
  consumeTemplate,
  grantItem,
} from "../items/inventory-model.js";
import { questObjectives, medalCriteria } from "./quest-journal-model.js";

const MAX_QUESTS = 4096;
const MAX_DIALOGUE_STEPS = 2048;
const MAX_TEXT = 65536;
const PROGRESS_FIELDS = [
  "level",
  "exp",
  "hp",
  "maxHP",
  "mp",
  "maxMP",
  "str",
  "dex",
  "int",
  "luk",
  "meso",
  "fame",
];

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}

function stateOf(profile, id) {
  return profile.quests[id]?.state ?? 0;
}

function quantity(profile, id) {
  return itemCount(profile, id) + (isEquipped(profile, id) ? 1 : 0);
}

/** Original 00721d2c: positive minimum, negative maximum (-count), zero absence. */
function meetsQuantity(actual, required) {
  if (required > 0) return actual >= required;
  if (required < 0) return actual <= -required;
  return actual === 0;
}

function matchesNpc(check, npcId) {
  return !check.npc || check.npc === npcId;
}

function isNpcEndpoint(stage, npcId) {
  return Boolean(
    (stage.check.npc || stage.actionCheck.npc) &&
    matchesNpc(stage.check, npcId) &&
    matchesNpc(stage.actionCheck, npcId),
  );
}

/** Scalar admission runs before stock and progress gates to retain original failure precedence. */
function checkCharacterConditions(check, profile, npcId) {
  if (!matchesNpc(check, npcId)) {
    return fail("npc", `Requires NPC ${check.npc}`);
  }
  if (check.lvmin && profile.level < check.lvmin) {
    return fail("level", `Requires level ${check.lvmin} or higher`);
  }
  if (check.lvmax && profile.level > check.lvmax) {
    return fail("level", `Requires level ${check.lvmax} or lower`);
  }
  if (check.jobs.length && !check.jobs.includes(profile.job)) {
    return fail(
      "job",
      `Job ${profile.job} is not in the original allowed job list`,
      {
        allowedJobs: check.jobs,
      },
    );
  }
  if (check.pop && profile.fame < check.pop) {
    return fail("fame", `Requires fame ${check.pop}`);
  }
  return { ok: true };
}

/** Common local projections of Check/Act gates; unknown fields never reach admission. */
function checkConditions(check, profile, context) {
  const character = checkCharacterConditions(check, profile, context.npcId);
  if (!character.ok) return character;
  if (check.endmeso && profile.meso < check.endmeso) {
    return fail("meso", `Requires ${check.endmeso} mesos`);
  }
  const stock = checkItemConditions(check.items, profile);
  if (!stock.ok) return stock;
  return checkProgressConditions(check, profile, context.questId);
}

function checkItemConditions(items, profile) {
  for (const item of items) {
    const actual = quantity(profile, item.id);
    if (!meetsQuantity(actual, item.count)) {
      return fail(
        "item",
        `Item ${item.id}: ${actual}; original condition ${item.count}`,
      );
    }
  }
  return { ok: true };
}

function checkProgressConditions(check, profile, questId) {
  for (const quest of check.quests) {
    if (stateOf(profile, quest.id) !== quest.state) {
      return fail("quest", `Quest ${quest.id} must have state ${quest.state}`);
    }
  }
  for (const mob of check.mobs) {
    const actual = profile.quests[questId]?.kills[mob.id] ?? 0;
    if (actual < mob.count) {
      return fail("mob", `Monster ${mob.id}: ${actual}/${mob.count}`);
    }
  }
  return { ok: true };
}

/** Original reward job mask 00716926; gender-specific rewards need absent profile gender. */
function eligibleItem(item, profile) {
  if (item.job === undefined || item.job === -1) return true;
  const family = Math.trunc(profile.job / 100);
  return family === 9 || (item.job & (1 << (family & 31))) !== 0;
}

function rewardItems(act, profile, selected) {
  const result = [],
    choices = [];
  for (const item of act.items) {
    if (!eligibleItem(item, profile)) continue;
    if (item.prop === -1) choices.push(item);
    else result.push(item);
  }
  if (choices.length) {
    const chosen = choices.find((item) => item.index === selected);
    if (!chosen) {
      return fail("reward-choice", "Select an original item reward", {
        choices,
      });
    }
    result.push(chosen);
  }
  return { ok: true, items: result, choices };
}

/** Validate every debit against pre-transaction stock, not a reward's net positive offset. */
function checkItemDebits(counts, items) {
  const debits = new Map();
  for (const item of items) {
    if (item.count < 0) {
      debits.set(item.id, (debits.get(item.id) ?? 0) - item.count);
    }
  }
  for (const [id, debit] of debits) {
    if ((counts.get(id) ?? 0) < debit) {
      return fail(
        "item",
        `Cannot consume ${debit} of item ${id}; equipped items are not removed automatically`,
      );
    }
  }
  return { ok: true };
}

function transactItems(draft, items, templates) {
  const counts = new Map();
  for (const item of draft.inventory) {
    counts.set(item.id, (counts.get(item.id) ?? 0) + item.count);
  }
  const debits = checkItemDebits(counts, items);
  if (!debits.ok) return debits;
  for (const item of items) {
    if (item.count < 0) consumeTemplate(draft, item.id, -item.count);
  }
  for (const item of items) {
    if (item.count > 0) grantItem(draft, templates?.[item.id], item.count);
  }
  return { ok: true };
}

function transactQuestStates(draft, actions, completingId) {
  for (const change of actions) {
    const previous = stateOf(draft, change.id);
    if (change.id === completingId || change.state < previous) {
      return fail(
        "quest-action",
        `Quest ${change.id} action would reset or contradict a one-shot quest`,
      );
    }
    if (previous === change.state) continue;
    draft.quests[change.id] = {
      state: change.state,
      kills: { ...(draft.quests[change.id]?.kills ?? {}) },
    };
    if (change.state === 2) draft.quests[change.id].completedAt = Date.now();
  }
  if (Object.keys(draft.quests).length > PROFILE_LIMITS.quests) {
    return fail("quest-capacity", "Local quest record capacity reached");
  }
  return { ok: true };
}

function transaction(profile, record, stage, { selected, growth, items }) {
  const act = record.stages[stage].act;
  const rewards = rewardItems(act, profile, selected);
  if (!rewards.ok) return rewards;
  const draft = profile;
  const inventory = transactItems(draft, rewards.items, items);
  if (!inventory.ok) return inventory;
  draft.meso += act.money;
  draft.fame += act.pop;
  if (
    !Number.isSafeInteger(draft.meso) ||
    draft.meso < 0 ||
    !Number.isSafeInteger(draft.fame)
  ) {
    return fail("economy", "Reward or debit exceeds local economy bounds");
  }
  const states = transactQuestStates(draft, act.quests, record.id);
  if (!states.ok) return states;
  const levels = awardExperience(draft, act.exp, growth, items);
  const kills =
    stage === 0 ? Object.create(null) : { ...profile.quests[record.id].kills };
  draft.quests[record.id] = { state: stage + 1, kills };
  if (stage === 1) draft.quests[record.id].completedAt = Date.now();
  for (const key of PROGRESS_FIELDS) {
    if (!Number.isSafeInteger(draft[key])) {
      return fail("profile", `Reward exceeds safe ${key} bounds`);
    }
  }
  return {
    ok: true,
    draft,
    levels,
    rewards: {
      exp: act.exp,
      money: act.money,
      pop: act.pop,
      items: rewards.items,
    },
    nextQuest: act.nextQuest,
  };
}

/** One durable character; quest transitions publish only after atomic commit. */
export class QuestSystem {
  constructor(catalog, store, hooks = {}) {
    if (catalog?.schemaVersion !== 1 || !catalog.records || !store?.profile) {
      throw new Error("Invalid offline quest catalog/profile");
    }
    this.catalog = catalog;
    this.store = store;
    this.hooks = hooks;
    this.records = Object.values(catalog.records);
    if (this.records.length > MAX_QUESTS) {
      throw new Error("Quest catalog exceeds policy");
    }
    this.byNpc = new Map();
    this.byMob = new Map();
    this.jobs = new Set();
    this.authorized = new WeakSet();
    this.supportedCount = 0;
    this.buildIndexes();
    this.trackerExclusions = new Set();
    this.trackerMinimized = false;
    this.resetReadiness();
  }

  /** Loaded progress is a silent baseline, not a newly received quest-status event.
   * 00a20ef7 updates progress before 00721d2c/00523408; login replay is not proved.
   */
  resetReadiness() {
    this.readyStates = new Map();
    for (const record of this.records) {
      if (this.isReady(record)) this.readyStates.set(record.id, true);
    }
  }

  /** Completion requirements at their authored endpoint, independent of NPC proximity.
   * This is a projection only: dialogue/rewards and durable state are never changed.
   */
  isReady(record, profile = this.store.profile) {
    if (!record?.supported || stateOf(profile, record.id) !== 1) return false;
    const stage = record.stages[1];
    const npcId = stage.check.npc || stage.actionCheck.npc;
    return this.status(record, npcId, profile).ok;
  }

  /** Consume durable event-time edges once. Lost stock, changed gates and quest removal
   * retract the notice and re-arm a later false-to-true transition; refresh alone does not.
   */
  readinessChanges() {
    const ready = [];
    const removed = [];
    for (const record of this.records) {
      const before = this.readyStates.has(record.id);
      const after = this.isReady(record);
      if (before === after) continue;
      if (after) {
        this.readyStates.set(record.id, true);
        ready.push(record);
      } else {
        this.readyStates.delete(record.id);
        removed.push(record.id);
      }
    }
    return { ready, removed };
  }
  mapName(id) {
    return this.hooks.mapName?.(id) ?? "Map name unavailable";
  }

  /**0083da76 passes the selected title's authored NPC into ordinary quest dialogue. */
  medalAdmission(id, stage, profile = this.store.profile) {
    const record = this.catalog.records[id];
    if (!Number.isSafeInteger(id) || !this.isMedalRecord(record)) {
      return fail("medal", "Unknown original medal quest");
    }
    if (stateOf(profile, id) !== stage) {
      return fail("quest", "Quest state changed");
    }
    const endpoint = record.stages[stage];
    const npcId = endpoint.check.npc || endpoint.actionCheck.npc;
    if (!npcId) return fail("npc", "Original medal quest endpoint is absent");
    const admitted = this.status(record, npcId, profile);
    return admitted.ok ? { ok: true, record, npcId } : admitted;
  }

  isMedalRecord(record) {
    return Boolean(
      record &&
      Number.isInteger(record.info?.medalCategory) &&
      record.info.medalCategory >= 0 &&
      record.info.medalCategory <= 3 &&
      record.info.viewMedalItem,
    );
  }

  medalEntries() {
    const result = [];
    for (const record of this.records) {
      if (
        !Number.isInteger(record.info?.medalCategory) ||
        !record.info.viewMedalItem
      ) {
        continue;
      }
      const state = stateOf(this.store.profile, record.id);
      const admission = this.medalAdmission(record.id, Math.min(state, 1));
      const forfeit = record.supported && this.giveUpAdmission(record.id).ok;
      result.push({
        id: record.id,
        questId: record.id,
        itemId: record.info.viewMedalItem,
        name: record.name,
        category: record.info.medalCategory,
        state,
        description: record.info[state] ?? record.info.summary ?? "",
        criteria: medalCriteria(this, record),
        canChallenge: state === 0 && admission.ok,
        canForfeit: forfeit,
        canClaim: state === 1 && admission.ok,
        reason: admission.ok ? null : admission.reason,
      });
    }
    return result;
  }

  /** No physical NPC placement is fabricated: native Title supplies the authored endpoint.
   * Original choices and rewards still use this system's durable dialogue transaction. */
  async medalChallenge(id) {
    return this.medalDialogue(id, 0);
  }

  async medalClaim(id) {
    return this.medalDialogue(id, 1);
  }

  medalDialogue(id, stage) {
    if (this.store.profileTransactionPending) {
      return fail("profile", "Character update is still committing");
    }
    const admission = this.medalAdmission(id, stage);
    if (!admission.ok) return admission;
    return { ok: true, dialogue: this.openDialogue(id, admission.npcId) };
  }

  async medalForfeit(id, confirmed = false) {
    const record = this.catalog.records[id];
    if (
      !record?.supported ||
      !Number.isInteger(record.info?.medalCategory) ||
      !record.info.viewMedalItem
    ) {
      return fail(
        "medal",
        record?.blockers[0]?.reason ?? "Unknown original medal quest",
      );
    }
    return this.giveUp(id, confirmed);
  }

  trackerAdmission(id, automatic = false, profile = this.store.profile) {
    const record = this.catalog.records[id];
    const tracker = profile.settings.questTracker;
    if (!this.isTrackerQuest(record, id, profile)) {
      return fail("quest", "This quest cannot be registered");
    }
    const rows = questObjectives(this, record, profile);
    if (!rows.length || tracker.ids.includes(id) || tracker.ids.length >= 5) {
      return fail(
        "tracker",
        "No objective, already registered, or five quests registered",
      );
    }
    if (
      automatic &&
      (!tracker.auto ||
        this.trackerExclusions.has(id) ||
        !rows.some((row) => row.progress))
    ) {
      return fail("tracker", "Automatic registration conditions are not met");
    }
    return { ok: true };
  }

  isTrackerQuest(record, id, profile) {
    return Boolean(
      record &&
      stateOf(profile, id) === 1 &&
      !(id >= 1200 && id <= 1399) &&
      Number(record.info?.type) !== 51,
    );
  }

  async changeTracker(action, id = null) {
    try {
      await this.store.commitProfile((draft) => {
        const tracker = draft.settings.questTracker;
        if (action === "add" || action === "auto-add") {
          const admitted = this.trackerAdmission(
            id,
            action === "auto-add",
            draft,
          );
          if (!admitted.ok) throw new Error(admitted.reason);
          tracker.ids.push(id);
          tracker.open = true;
        } else if (action === "remove") {
          tracker.ids = tracker.ids.filter((entry) => entry !== id);
        } else if (action === "auto") tracker.auto = !tracker.auto;
        else if (action === "close") {
          tracker.ids = [];
          tracker.open = false;
        } else if (action === "open") tracker.open = true;
        else throw new Error("Unknown quest tracker action");
      });
    } catch (error) {
      return fail(error.code ?? "profile", error.message);
    }
    if (action === "remove") this.trackerExclusions.add(id);
    this.hooks.onChange?.();
    return { ok: true };
  }

  giveUpAdmission(id, profile = this.store.profile) {
    if (stateOf(profile, id) !== 1 || (id >= 1200 && id <= 1399)) {
      return fail("quest", "This quest cannot be given up");
    }
    return { ok: true };
  }

  async giveUp(id, confirmed = false) {
    const admitted = this.giveUpAdmission(id);
    if (!admitted.ok) return admitted;
    if (!confirmed) return fail("confirmation", "Give up this quest?");
    try {
      await this.store.commitProfile((draft) => {
        const current = this.giveUpAdmission(id, draft);
        if (!current.ok) throw new Error(current.reason);
        delete draft.quests[id];
        draft.settings.questTracker.ids =
          draft.settings.questTracker.ids.filter((entry) => entry !== id);
      });
    } catch (error) {
      return fail(error.code ?? "profile", error.message);
    }
    this.hooks.onChange?.();
    return { ok: true };
  }

  /** One event-time commit collects eligible progress without reordering existing entries. */
  async autoRegister() {
    if (
      this.store.profileTransactionPending ||
      !this.store.profile.settings.questTracker.auto
    ) {
      return;
    }
    const ids = [];
    for (const record of this.records) {
      if (this.trackerAdmission(record.id, true).ok) ids.push(record.id);
    }
    if (!ids.length) return;
    try {
      await this.store.commitProfile((draft) => {
        for (const id of ids) {
          if (!this.trackerAdmission(id, true, draft).ok) continue;
          draft.settings.questTracker.ids.push(id);
          draft.settings.questTracker.open = true;
        }
      });
      this.hooks.onChange?.();
    } catch (error) {
      this.hooks.onError?.(error);
    }
  }

  buildIndexes() {
    for (const record of this.records) {
      this.indexEndpoints(record);
      if (!record.supported) continue;
      this.supportedCount++;
      this.indexMobRequirements(record);
    }
  }

  indexEndpoints(record) {
    const endpoints = new Set();
    for (const stage of record.stages) {
      if (stage.check.npc > 0) endpoints.add(stage.check.npc);
      if (stage.actionCheck.npc > 0) endpoints.add(stage.actionCheck.npc);
    }
    for (const npc of endpoints) {
      if (!this.byNpc.has(npc)) this.byNpc.set(npc, []);
      this.byNpc.get(npc).push(record);
    }
    for (const stage of record.stages) {
      for (const job of stage.check.jobs) this.jobs.add(job);
    }
  }

  indexMobRequirements(record) {
    const requirements = new Map();
    for (const mob of record.stages[1].check.mobs) {
      requirements.set(
        mob.id,
        Math.max(requirements.get(mob.id) ?? 0, mob.count),
      );
    }
    for (const [id, count] of requirements) {
      if (!this.byMob.has(id)) this.byMob.set(id, []);
      this.byMob.get(id).push({ questId: record.id, count });
    }
  }

  knownJobs() {
    return [...this.jobs].sort((a, b) => a - b);
  }

  /** Current profile root and nested state are looked up afresh after a local reset. */
  status(record, npcId, profile = this.store.profile) {
    const state = stateOf(profile, record.id);
    if (state === 2) {
      return fail(
        "completed",
        "Already completed; repeat rewards are disabled",
        { state },
      );
    }
    if (!record.supported) {
      return fail(
        "unsupported",
        record.blockers[0]?.reason ?? "Unsupported quest",
        { state, blockers: record.blockers },
      );
    }
    const stage = record.stages[state];
    const context = { questId: record.id, npcId };
    const check = checkConditions(stage.check, profile, context);
    if (!check.ok) return { ...check, state };
    return { ...checkConditions(stage.actionCheck, profile, context), state };
  }

  dependencies(record) {
    const result = [];
    const content = this.catalog.content;
    for (const npc of record.dependencies.npcIds) {
      if (!content.npcs[npc]) {
        result.push(`NPC ${npc}: no placement in packaged maps`);
      }
    }
    for (const mob of record.dependencies.mobIds) {
      if (!content.mobs[mob]) {
        result.push(`Monster ${mob}: no spawn in packaged maps`);
      }
    }
    for (const map of record.dependencies.mapIds) {
      if (!content.maps.includes(map)) {
        result.push(`Referenced map ${map}: not packaged`);
      }
    }
    for (const item of record.dependencies.itemIds) {
      result.push(
        `Item ${item}: must be owned; local acquisition is limited to encoded quest grants and supported original-item/Cosmic drop rows`,
      );
    }
    for (const script of record.dependencies.scriptRefs) {
      result.push(`Missing original script body: ${script}`);
    }
    return result;
  }

  describe(record, npcId) {
    const status = this.status(record, npcId);
    const stage = status.state === 2 ? 1 : status.state;
    return {
      id: record.id,
      name: record.name,
      state: status.state,
      supported: record.supported,
      status,
      npcId,
      journal: record.info?.[status.state] ?? null,
      info: record.info,
      dialogue: record.stages[stage].say,
      rewards: record.stages[stage].act,
      blockers: record.blockers,
      unavailableBranches: record.unavailableBranches,
      dependencies: this.dependencies(record),
      conditions: record.stages[stage].check,
    };
  }

  /** Shared menu/indicator admission; active endpoints remain visible before objectives are met. */
  npcEntries(npcId, profile = this.store.profile) {
    const id = Number(npcId);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    const progress = [];
    const available = [];
    for (const record of this.byNpc.get(id) ?? []) {
      const state = stateOf(profile, record.id);
      if (state !== 0 && state !== 1) continue;
      if (!isNpcEndpoint(record.stages[state], id)) continue;
      const admission = this.status(record, id, profile);
      if (state === 1) {
        progress.push({ record, state, ready: admission.ok });
      } else if (admission.ok) {
        available.push({ record, state, ready: false });
      }
    }
    return progress.concat(available);
  }

  forNpc(npcId) {
    const id = Number(npcId);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    return (this.byNpc.get(id) ?? []).map((record) =>
      this.describe(record, id),
    );
  }

  begin(questId, npcId, session = null) {
    return this.mutate(questId, npcId, 0, session);
  }

  complete(questId, npcId, session = null) {
    return this.mutate(questId, npcId, 1, session);
  }

  async mutate(questId, npcId, stage, session) {
    if (this.store.profileTransactionPending) {
      return fail("profile", "Character update is still committing");
    }
    const record = this.catalog.records[questId];
    if (!record) return fail("quest", "Unknown original quest ID");
    let result;
    try {
      await this.store.commitProfile((draft) => {
        const status = this.status(record, Number(npcId), draft);
        if (!status.ok) throw Object.assign(new Error(status.reason), status);
        if (status.state !== stage) throw new Error("Quest state changed");
        const admission = this.admitSession(
          record,
          stage,
          Number(npcId),
          session,
        );
        if (!admission.ok) {
          throw Object.assign(new Error(admission.reason), admission);
        }
        result = transaction(draft, record, stage, {
          selected: session?.rewardIndex,
          growth: this.hooks.growth?.(draft),
          items: this.hooks.items,
        });
        if (!result.ok) throw Object.assign(new Error(result.reason), result);
        if (stage === 1) {
          draft.settings.questTracker.ids =
            draft.settings.questTracker.ids.filter((id) => id !== record.id);
        }
      });
    } catch (error) {
      return fail(error.code ?? "profile", error.message);
    }
    this.commitTransaction(result, stage, session);
    return {
      ok: true,
      state: stage + 1,
      rewards: result.rewards,
      nextQuest: result.nextQuest,
    };
  }

  /** A choice-bearing record requires this system's authorization for this exact endpoint. */
  admitSession(record, stage, npcId, session) {
    if (
      session &&
      (session.record !== record ||
        session.stage !== stage ||
        session.npcId !== npcId)
    ) {
      return fail(
        "dialogue",
        "Dialogue transaction does not match the quest and NPC",
      );
    }
    const requiresChoices =
      Object.keys(record.stages[stage].say.choices).length > 0;
    if (requiresChoices && (!session || !this.authorized.has(session))) {
      return fail(
        "dialogue",
        "Complete the original dialogue choices before committing",
      );
    }
    return { ok: true };
  }

  /** Effects and dialogue authorization change only after durable publication. */
  commitTransaction(result, stage, session) {
    if (session) this.authorized.delete(session);
    try {
      this.hooks.onChange?.();
      this.hooks.onReward?.(result);
      if (stage === 1) this.hooks.onEffect?.("QuestClear");
      if (result.levels) this.hooks.onEffect?.("LevelUp");
    } catch (error) {
      this.hooks.onError?.(error);
    }
  }

  /** The field owns the accepted death checkpoint; this operation never publishes or commits. */
  applyKill(profile, templateId) {
    const rules = this.byMob.get(Number(templateId));
    if (!rules) return false;
    let changed = false;
    for (const rule of rules) {
      const state = profile.quests[rule.questId];
      if (state?.state !== 1) continue;
      const old = state.kills[templateId] ?? 0;
      if (old >= rule.count) continue;
      state.kills[templateId] = old + 1;
      changed = true;
    }
    return changed;
  }

  openDialogue(questId, npcId) {
    const record = this.catalog.records[questId];
    if (!record) return null;
    return new QuestDialogue(this, record, Number(npcId));
  }

  /** Routine inspection summarizes durable progress only; journal descriptions are demand-driven. */
  snapshot() {
    const state = structuredClone(this.store.profile.quests);
    const quests = [];
    let active = 0,
      completed = 0;
    for (const [id, progress] of Object.entries(state)) {
      if (progress.state === 1) active++;
      if (progress.state === 2) completed++;
      quests.push({
        id: Number(id),
        name: this.catalog.records[id]?.name ?? null,
        ...progress,
      });
    }
    return {
      policy: this.catalog.policy,
      total: this.records.length,
      supported: this.supportedCount,
      active,
      completed,
      quests,
      state,
    };
  }
}

/** Choice IDs stay the authored #L IDs (not array indexes); never evaluate encoded text. */
export function questChoices(text) {
  if (typeof text !== "string" || text.length > MAX_TEXT) {
    throw new Error("Quest dialogue exceeds text policy");
  }
  const result = [];
  for (const match of text.matchAll(/#L(\d+)#/g)) result.push(Number(match[1]));
  return result;
}

class QuestDialogue {
  constructor(system, record, npcId) {
    this.system = system;
    this.record = record;
    this.npcId = npcId;
    this.stage = Math.min(stateOf(system.store.profile, record.id), 1);
    this.say = record.stages[this.stage].say;
    this.status = system.status(record, npcId);
    this.pages = this.status.ok
      ? this.say.pages
      : (this.say.stop[this.status.code] ?? this.say.stop.default ?? []);
    this.page = 0;
    this.mode = this.status.ok ? this.offerMode() : "blocked";
    this.steps = 0;
    this.rewardIndex = null;
    this.result = null;
  }

  /** A plain final Say page is the question itself, not a duplicate Next page. */
  offerMode() {
    const final = this.page >= this.pages.length - 1;
    return final && !questChoices(this.pages[this.page]?.text ?? "").length
      ? "confirm"
      : "offer";
  }

  snapshot() {
    const current = this.pages[this.page];
    const text = current?.text ?? "";
    return {
      questId: this.record.id,
      name: this.record.name,
      npcId: this.npcId,
      stage: this.stage,
      mode: this.mode,
      page: this.page,
      pageCount: this.pages.length,
      text,
      choices: this.mode === "offer" ? questChoices(text) : [],
      status: this.status,
      result: this.result,
      rewardChoices:
        rewardItems(
          this.record.stages[this.stage].act,
          this.system.store.profile,
          this.rewardIndex,
        ).choices ?? [],
      finalPage: this.page >= this.pages.length - 1,
      canPrevious: this.page > 0 && Object.keys(this.say.choices).length === 0,
    };
  }

  /** Every click advances at most one page; wrong branch terminates without state changes. */
  advance(choice = null) {
    if (this.mode === "confirm" || this.mode === "closed") {
      return fail("dialogue", "This page has no next dialogue");
    }
    if (++this.steps > MAX_DIALOGUE_STEPS) {
      return fail(
        "dialogue-bound",
        "Dialogue action bound exceeded; reopen NPC",
      );
    }
    const answer = this.answerChoice(choice);
    if (!answer.ok) return answer;
    if (answer.rejected) return { ok: true };
    if (this.page < this.pages.length - 1) {
      this.page++;
      if (this.mode === "offer") this.mode = this.offerMode();
    } else if (this.mode === "offer") this.mode = "confirm";
    else this.mode = "closed";
    return { ok: true };
  }

  /** A nonempty authored stop response rejects; absent/empty responses advance. */
  answerChoice(choice) {
    const page = this.pages[this.page];
    const choices = this.mode === "offer" ? questChoices(page?.text ?? "") : [];
    if (!choices.length) return { ok: true };
    if (!choices.includes(choice)) {
      return fail("choice", "Choose one of the authored answers");
    }
    const stop = this.say.choices[page.index];
    if (!stop) return fail("choice", "Missing authored answer branch");
    const response = stop[choice];
    if (typeof response === "string" && response.length) {
      this.pages = [{ index: 0, text: response }];
      this.page = 0;
      this.mode = "rejected";
      return { ok: true, rejected: true };
    }
    return { ok: true };
  }

  previous() {
    if (!this.snapshot().canPrevious) return false;
    this.page--;
    if (this.mode === "confirm") this.mode = this.offerMode();
    return true;
  }

  reject() {
    if (!["offer", "confirm"].includes(this.mode)) return false;
    this.pages = this.say.no;
    this.page = 0;
    this.mode = this.pages.length ? "rejected" : "closed";
    return true;
  }

  async accept() {
    if (this.mode !== "confirm") {
      return fail("dialogue", "Read and answer the original dialogue first");
    }
    this.system.authorized.add(this);
    const result = await (this.stage === 0
      ? this.system.begin(this.record.id, this.npcId, this)
      : this.system.complete(this.record.id, this.npcId, this));
    this.result = result;
    if (!result.ok) return result;
    this.pages = this.say.yes;
    this.page = 0;
    this.mode = this.pages.length ? "accepted" : "closed";
    return result;
  }
}
