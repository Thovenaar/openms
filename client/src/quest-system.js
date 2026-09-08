import { awardExperience } from "./offline-progression.js";
import { PROFILE_LIMITS, validateProfile } from "./profile-validation.js";

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
  let count = 0;
  for (const item of profile.inventory) if (item.id === id) count += item.count;
  if (profile.equipment.includes(id)) count++;
  return count;
}

/** Original 00721d2c: positive minimum, negative maximum (-count), zero absence. */
function meetsQuantity(actual, required) {
  if (required > 0) return actual >= required;
  if (required < 0) return actual <= -required;
  return actual === 0;
}

/** Scalar admission runs before stock and progress gates to retain original failure precedence. */
function checkCharacterConditions(check, profile, npcId) {
  if (check.npc && check.npc !== npcId) {
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

function transactItems(draft, items) {
  const counts = new Map(draft.inventory.map((item) => [item.id, item.count]));
  const debits = checkItemDebits(counts, items);
  if (!debits.ok) return debits;
  for (const item of items) {
    const count = (counts.get(item.id) ?? 0) + item.count;
    if (!Number.isSafeInteger(count) || count < 0) {
      return fail("inventory", "Item reward exceeds safe inventory bounds");
    }
    if (count) counts.set(item.id, count);
    else counts.delete(item.id);
  }
  if (counts.size > PROFILE_LIMITS.inventory) {
    return fail("inventory", "Local inventory entry capacity reached");
  }
  draft.inventory = [...counts].map(([id, count]) => ({ id, count }));
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

function transaction(profile, record, stage, selected) {
  const act = record.stages[stage].act;
  const rewards = rewardItems(act, profile, selected);
  if (!rewards.ok) return rewards;
  const draft = {
    ...profile,
    inventory: profile.inventory,
    quests: { ...profile.quests },
  };
  const inventory = transactItems(draft, rewards.items);
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
  const levels = awardExperience(draft, act.exp);
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

function journalPriority(quests, id) {
  const state = quests[id]?.state ?? 0;
  return state === 1 ? 0 : state === 2 ? 1 : 2;
}

/** One shared durable character, synchronous transactions and no repeat-reward transition. */
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
    this.journalProgress = null;
    this.journalOrder = [];
    this.buildIndexes();
  }

  /** Local journal order; durable quest-state replacement invalidates this event-time cache. */
  journalRows() {
    const progress = this.store.profile.quests;
    if (progress !== this.journalProgress) {
      this.journalOrder = this.records
        .slice()
        .sort(
          (left, right) =>
            journalPriority(progress, left.id) -
              journalPriority(progress, right.id) || left.id - right.id,
        );
      this.journalProgress = progress;
    }
    return this.journalOrder;
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
  status(record, npcId) {
    const profile = this.store.profile;
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
        `Item ${item}: obtained only from encoded quest grants or existing stock; no invented monster drops`,
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

  mutate(questId, npcId, stage, session) {
    const record = this.catalog.records[questId];
    if (!record) return fail("quest", "Unknown original quest ID");
    const status = this.status(record, Number(npcId));
    if (!status.ok) return status;
    if (status.state !== stage) {
      return fail(
        "state",
        stage === 0 ? "Quest already accepted" : "Quest is not active",
      );
    }
    const admission = this.admitSession(record, stage, Number(npcId), session);
    if (!admission.ok) return admission;
    const result = transaction(
      this.store.profile,
      record,
      stage,
      session?.rewardIndex,
    );
    if (!result.ok) return result;
    try {
      validateProfile(result.draft);
    } catch (error) {
      return fail("profile", error.message);
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

  /** Called only after the full draft passes profile validation. */
  commitTransaction(result, stage, session) {
    const profile = this.store.profile;
    for (const key of PROGRESS_FIELDS) profile[key] = result.draft[key];
    profile.inventory = result.draft.inventory;
    profile.quests = result.draft.quests;
    if (session) this.authorized.delete(session);
    this.store.markDirty();
    this.hooks.onChange?.();
    if (stage === 1) this.hooks.onEffect?.("QuestClear");
    if (result.levels) this.hooks.onEffect?.("LevelUp");
  }

  /** Confirmed local deaths only; saturating counters cannot award or reset a quest. */
  onKill(templateId) {
    const rules = this.byMob.get(Number(templateId));
    if (!rules) return;
    let changed = false;
    for (const rule of rules) {
      const state = this.store.profile.quests[rule.questId];
      if (state?.state !== 1) continue;
      const old = state.kills[templateId] ?? 0;
      if (old >= rule.count) continue;
      state.kills[templateId] = old + 1;
      changed = true;
    }
    if (changed) {
      this.store.markDirty();
      this.hooks.onChange?.();
    }
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
    this.mode = this.status.ok ? "offer" : "blocked";
    this.steps = 0;
    this.rewardIndex = null;
    this.result = null;
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
    if (++this.steps > MAX_DIALOGUE_STEPS) {
      return fail(
        "dialogue-bound",
        "Dialogue action bound exceeded; reopen NPC",
      );
    }
    const answer = this.answerChoice(choice);
    if (!answer.ok) return answer;
    if (answer.rejected) return { ok: true };
    if (this.page < this.pages.length - 1) this.page++;
    else if (this.mode === "offer") this.mode = "confirm";
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
    return true;
  }

  reject() {
    if (!["offer", "confirm"].includes(this.mode)) return false;
    this.pages = this.say.no;
    this.page = 0;
    this.mode = this.pages.length ? "rejected" : "closed";
    return true;
  }

  accept() {
    if (this.mode !== "confirm") {
      return fail("dialogue", "Read and answer the original dialogue first");
    }
    this.system.authorized.add(this);
    const result =
      this.stage === 0
        ? this.system.begin(this.record.id, this.npcId, this)
        : this.system.complete(this.record.id, this.npcId, this);
    this.result = result;
    if (!result.ok) return result;
    this.pages = this.say.yes;
    this.page = 0;
    this.mode = this.pages.length ? "accepted" : "closed";
    return result;
  }
}
