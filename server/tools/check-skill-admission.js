import { resolve } from "node:path";
import { parseFlags } from "../../client/tools/source-options.js";
import { loadContent } from "../src/content.js";
import { OnlineWorld } from "../src/world.js";
import { prepareActorCombat } from "../src/field-combat.js";
import { prepareActorSkills, disposeActorSkills } from "../src/field-skills.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import {
  stageJobPreset,
  applyJobPresetLoadout,
  developmentJobPresets,
} from "../../client/src/development/character-presets.js";
import { skillBooks } from "../../client/src/ui/ui-skill-books.js";
import { advanceSimulation } from "../../client/src/physics/simulation.js";
import { createHeldInput } from "../../shared/motion.js";
import { COMBAT_SKILLS } from "../../client/src/skills/skill-combat-rules.js";
import { STATE_SKILLS } from "../../client/src/skills/skill-state-rules.js";
import { skillNumber } from "../../client/src/skills/skill-costs.js";

const REPOSITORY = resolve(import.meta.dir, "../..");
const DEFAULT_GENERATED_ROOT = resolve(REPOSITORY, "client/public/generated");
const DEFAULT_REPORT = resolve(
  REPOSITORY,
  "docs/ingame-validation/skill-admission.json",
);
const DEFAULT_MAP_ID = 100000000;
const TICK_MS = 30;
const GROUND_TICKS = 600;
const MAX_JOBS = 256;
const MAX_JOB_SKILLS = 4096;
const MAX_RECORDS = 65536;
const MAX_JOB_ARGUMENTS = 256;

/**
 * Correct-for-the-situation refusals: a job-correct, learned, supported skill that
 * still needs an authored weapon, a map/state, a recipient or a resource stock.
 * Each value is the recorded refusal class, not a claim of a defect.
 */
const SITUATIONAL_REASONS = new Map([
  ["Skill requires its original weapon type", "weapon-restriction"],
  ["Skill requires its original weapon family", "weapon-restriction"],
  ["This secret skill requires its original event field", "event-authority"],
  [
    "Original equipped mount and matching saddle resources are not prepared",
    "mount-resource",
  ],
  ["Insufficient original skill item", "unavailable-item"],
  ["Insufficient mesos", "meso-cost"],
  ["No loose mesos are available in the explosion rectangle", "meso-cost"],
  ["There is no dead party member in range", "party-recipient"],
  ["There is no eligible cooldown in range", "party-recipient"],
  ["There is no removable abnormal status", "situational-state"],
  [
    "There is no removable status in Dispel's original area",
    "situational-state",
  ],
  ["Energy must be fully charged", "situational-state"],
  ["Insufficient Aran combo count", "situational-state"],
  ["A combo orb is required", "situational-state"],
  ["Charged Blow requires an active charge", "situational-state"],
  ["Transformation is required", "situational-state"],
  ["Battleship is required", "situational-state"],
  ["Enrage requires ten combo orbs", "situational-state"],
  ["Assassinate requires Dark Sight", "situational-state"],
  ["MP Recovery requires spare HP and missing MP", "situational-state"],
  ["This skill requires a grounded placement", "map-placement"],
  ["Mystic Door requires level ground", "map-placement"],
  ["Teleport requires ground and a held direction", "movement-state"],
  ["This movement attack requires ground", "movement-state"],
  ["This movement skill requires ground", "movement-state"],
  ["Flash Jump requires an unused airborne jump", "movement-state"],
  ["Corkscrew requires a foothold", "movement-state"],
  ["Riding requires ground", "movement-state"],
  ["Movement skill recovery is active", "movement-state"],
  ["Movement attack recovery is active", "movement-state"],
  ["Original field movement-skill restriction", "movement-state"],
  ["Skill cooldown is active", "cooldown"],
  ["Active buff capacity is full", "buff-capacity"],
  ["Active buff budget exceeded", "buff-capacity"],
  [
    "No temporary-source capacity for Beholder and its learned Hex",
    "buff-capacity",
  ],
  ["Another original skill is being held", "interaction-state"],
  ["Character is dead or input is modal", "interaction-state"],
  ["A profile/item operation is pending", "interaction-state"],
  ["Profile transaction is pending", "interaction-state"],
  ["Skill Use visual slots are busy", "presentation-capacity"],
  ["Skill Hit visual slots are busy", "presentation-capacity"],
  ["Skill voice budget exceeded", "presentation-capacity"],
]);

/**
 * Admission refusals that leave a supported, learnable, job-appropriate skill
 * uncapturable in an ordinary full-resource environment. These are defects.
 */
const MECHANICAL_REASONS = new Map([
  ["Original skill attack rectangle is unavailable", "attack-geometry"],
  ["Original skill actor action/timing is unavailable", "actor-timing"],
  ["Original skill combat record is not prepared", "combat-record"],
  ["Skill has no runtime controller", "runtime-controller"],
  ["Learned skill rank resources are not prepared", "resources-unprepared"],
  ["World skill resources are not prepared", "resources-unprepared"],
  ["Original event repeat artwork is not prepared", "resources-unprepared"],
  ["Skill has no active state controller", "runtime-controller"],
  ["This skill is not an active world action", "runtime-controller"],
]);

/** Prefix-matched mechanical refusals whose tail names the offending action/field. */
const MECHANICAL_PREFIXES = Object.freeze([
  ["Actor lacks original action ", "actor-action"],
  ["Invalid original ", "invalid-rank-field"],
  ["Requires skill ", "prerequisite"],
  ["Character level requirement not met", "character-level"],
  ["Skill has no learned rank in this job", "unlearnable-rank"],
]);

function gapResult(refusalClass) {
  return { classification: "gap", refusalClass };
}

function byDesignResult(refusalClass) {
  return { classification: "by-design", refusalClass };
}

/** Catalog/authority gates decide before any refusal-reason lookup. */
function catalogGate(entry) {
  if (!entry.supported) return byDesignResult("catalog-unsupported");
  if (entry.rank === 0) return gapResult("unlearnable-rank");
  if (entry.flags.disabled) return byDesignResult("disabled");
  if (entry.flags.timeLimited) return byDesignResult("time-limited");
  if (entry.bookId >= 800 && entry.bookId < 1000) {
    return byDesignResult("gm-book");
  }
  if (entry.activation === "passive") return byDesignResult("passive");
  return null;
}

/** Situational reasons are by-design; mechanical and unknown reasons are gaps. */
function reasonGate(entry) {
  const situational = SITUATIONAL_REASONS.get(entry.reason);
  if (situational) return byDesignResult(situational);
  const mechanical = MECHANICAL_REASONS.get(entry.reason);
  if (mechanical) return gapResult(mechanical);
  for (const [prefix, refusalClass] of MECHANICAL_PREFIXES) {
    if (entry.reason.startsWith(prefix)) return gapResult(refusalClass);
  }
  // Unknown refusals fail closed: report them as gaps until classified.
  return gapResult("unclassified");
}

/** Classify one skill's recorded admission outcome; pure and deterministically ordered. */
export function classifyAdmission(entry) {
  if (entry.threw) return gapResult("throws");
  if (entry.reason === null || entry.reason === undefined) {
    return { classification: "ok", refusalClass: null };
  }
  return catalogGate(entry) ?? reasonGate(entry);
}

/** Authored weapon requirement evidence for one catalog skill, not an admission decision. */
function authoredWeapon(skill) {
  const owner = skill.classification.owner;
  const spec =
    owner === "combat"
      ? COMBAT_SKILLS.get(skill.id)
      : owner === "state"
        ? STATE_SKILLS.get(skill.id)
        : null;
  return {
    required:
      skillNumber(skill.properties.weapon ?? skill.properties["weapon "]) ||
      null,
    families: spec?.weapons ? [...spec.weapons] : [],
  };
}

/** Resolve the requested preset jobs against the packaged original player books. */
export function selectPresetJobs(index, requested = null) {
  const available = developmentJobPresets(index).map((entry) => entry.id);
  if (available.length > MAX_JOBS) {
    throw new Error("Preset job inventory exceeds its bound");
  }
  if (requested === null) return available;
  if (!requested.length || requested.length > MAX_JOBS) {
    throw new Error("Requested job selection exceeds its bound");
  }
  const selected = [];
  for (const job of requested) {
    if (!Number.isSafeInteger(job) || !available.includes(job)) {
      throw new Error(`Job ${job} has no packaged development preset`);
    }
    if (!selected.includes(job)) selected.push(job);
  }
  return selected;
}

/** Stage a detached development profile for one preset job; throws on preset rejection. */
export function stagePresetProfile(index, job, mapId = DEFAULT_MAP_ID) {
  const profile = createProfile({
    mapId: String(mapId),
    x: 0,
    y: 0,
    facing: 1,
  });
  profile.onlineState = { effects: [], cooldowns: {} };
  const preset = stageJobPreset(index, profile, job);
  Object.assign(profile, preset.patch);
  applyJobPresetLoadout(profile, index, job);
  const equipped = preset.loadout.equipment.find((item) => item.slot === -11);
  return {
    profile,
    weapon: equipped ? { id: equipped.id, name: equipped.name } : null,
  };
}

/** Prepare the real combat/skill runtime for a staged profile; caller disposes the actor. */
export async function preparePresetActor({ world, field, profile, job }) {
  const actor = {
    id: crypto.randomUUID(),
    profile,
    revision: 0,
    session: { expiresAt: Date.now() + 60000 },
  };
  world.prepareEntry(actor, field);
  prepareActorCombat(world, actor);
  await prepareActorSkills(world, actor);
  groundActor(actor);
  actor.state = "active";
  if (!actor.skills || !actor.combat) {
    throw new Error(`Job ${job} skill runtime was not installed`);
  }
  return actor;
}

/** Build exactly one job preset profile and evaluate every skill in its ancestor books. */
async function auditJob({ world, field, index, job }) {
  if (!skillBooks(job).includes(job)) {
    return {
      unevaluated: { stage: "ancestry", reason: "no recovered book ancestry" },
    };
  }
  let profile, weapon;
  try {
    ({ profile, weapon } = stagePresetProfile(index, job, field.manifest.id));
  } catch (error) {
    return { unevaluated: { stage: "preset", reason: error.message } };
  }
  let actor;
  try {
    actor = await preparePresetActor({ world, field, profile, job });
  } catch (error) {
    return { unevaluated: { stage: "prepare", reason: error.message } };
  }
  try {
    weapon = { ...weapon, type: actor.combat.weaponType };
    return { report: evaluateJob(actor, job, weapon) };
  } catch (error) {
    return { unevaluated: { stage: "evaluate", reason: error.message } };
  } finally {
    disposeActorSkills(actor, true);
  }
}

/** Production physics lands the preset on authored ground so ground gates cannot mask later checks. */
function groundActor(actor) {
  const input = createHeldInput();
  for (
    let tick = 0;
    tick < GROUND_TICKS && actor.simulation.state !== "ground";
    tick++
  ) {
    advanceSimulation(actor.simulation, input, TICK_MS);
  }
}

/** Walk the production admission chain for every skill in the job's books, without mutation. */
function evaluateJob(actor, job, weapon) {
  const system = actor.skills;
  const ids = Object.keys(system.catalog)
    .map(Number)
    .sort((a, b) => a - b);
  if (ids.length > MAX_JOB_SKILLS) {
    throw new Error(`Job ${job} skill inventory exceeds its bound`);
  }
  const records = [];
  for (const id of ids) {
    const skill = system.catalog[id];
    if (!system.books.includes(skill.bookId)) continue;
    records.push(evaluateSkill(system, skill, weapon));
  }
  return {
    job,
    books: [...system.books],
    weapon,
    ground: actor.simulation.state === "ground",
    counts: countClassifications(records),
    records,
  };
}

/** Evaluate one catalog skill through the production admission chain and classify the outcome. */
export function evaluateSkill(system, skill, weapon) {
  const rank = system.level(skill.id);
  const info = system.info(skill.id, rank);
  let reason = null;
  let threw = null;
  try {
    reason = system.castError(skill, info);
  } catch (error) {
    threw = error.message;
  }
  const entry = {
    id: skill.id,
    name: skill.name,
    bookId: skill.bookId,
    rank,
    activation: skill.classification.activation,
    supported: skill.classification.supported,
    unsupportedReason: skill.classification.reason,
    flags: {
      disabled: Boolean(skill.flags.disabled),
      timeLimited: Boolean(skill.flags.timeLimited),
      invisible: Boolean(skill.flags.invisible),
    },
    actions: skill.actions,
    weaponType: weapon?.type ?? 0,
    authoredWeapon: authoredWeapon(skill),
    requirement: system.skillRequirementError(skill),
    reason,
    threw,
  };
  return { ...compactSkillRecord(entry), ...classifyAdmission(entry) };
}

/** Drop empty evidence fields so the bounded report stays reviewable. */
function compactSkillRecord(entry) {
  const record = {
    id: entry.id,
    name: entry.name,
    bookId: entry.bookId,
    rank: entry.rank,
    activation: entry.activation,
    supported: entry.supported,
    flags: entry.flags,
    weaponType: entry.weaponType,
    reason: entry.reason,
  };
  if (entry.unsupportedReason) {
    record.unsupportedReason = entry.unsupportedReason;
  }
  if (entry.actions.length) record.actions = entry.actions;
  if (entry.requirement) record.requirement = entry.requirement;
  if (entry.authoredWeapon.required || entry.authoredWeapon.families.length) {
    record.authoredWeapon = entry.authoredWeapon;
  }
  if (entry.threw) record.threw = entry.threw;
  return record;
}

function countClassifications(records) {
  const counts = { ok: 0, "by-design": 0, gap: 0, throws: 0 };
  for (const record of records) {
    counts[record.classification]++;
    if (record.threw) counts.throws++;
  }
  return counts;
}

/** Require the admitted packaged catalog surfaces this audit consumes. */
function requireIndex(content) {
  const index = content?.catalog?.ui;
  if (!index?.skills) {
    throw new Error("Skill admission audit requires admitted packaged content");
  }
  if (!index.coverage?.skillCoverage?.playerBooks) {
    throw new Error(
      "Skill admission audit requires original player-book coverage",
    );
  }
  return index;
}

/** Evaluate selected preset jobs under one bounded world/field pair. */
async function collectJobReports({ world, field, index, selected }) {
  const jobReports = [];
  const unevaluated = [];
  let totalRecords = 0;
  for (const job of selected) {
    const { report, unevaluated: failure } = await auditJob({
      world,
      field,
      index,
      job,
    });
    if (failure) {
      unevaluated.push({ job, ...failure });
      continue;
    }
    totalRecords += report.records.length;
    if (totalRecords > MAX_RECORDS) {
      throw new Error("Skill admission record bound exceeded");
    }
    jobReports.push(report);
  }
  return { jobReports, unevaluated };
}

/** Deterministic, bounded audit of preset job admission over the packaged catalog. */
export async function skillAdmissionAudit({
  content,
  jobs = null,
  mapId = DEFAULT_MAP_ID,
} = {}) {
  const index = requireIndex(content);
  const selected = selectPresetJobs(index, jobs);
  const world = new OnlineWorld({ content, database: {}, publish() {} });
  const field = await world.fieldFor(mapId);
  const { jobReports, unevaluated } = await collectJobReports({
    world,
    field,
    index,
    selected,
  });
  return assembleReport({ content, mapId, selected, jobReports, unevaluated });
}

function assembleReport({ content, mapId, selected, jobReports, unevaluated }) {
  const counts = { ok: 0, "by-design": 0, gap: 0, throws: 0 };
  const refusalClasses = {};
  const gaps = [];
  const throws = [];
  for (const job of jobReports) {
    for (const key of Object.keys(counts)) counts[key] += job.counts[key];
    for (const record of job.records) {
      const label = record.refusalClass ?? "ok";
      refusalClasses[label] = (refusalClasses[label] ?? 0) + 1;
      if (record.classification !== "gap") continue;
      const row = { job: job.job, ...record };
      gaps.push(row);
      if (record.threw) throws.push(row);
    }
  }
  return {
    schemaVersion: 1,
    tool: "server/tools/check-skill-admission.js",
    catalogHash: content.catalogHash,
    buildId: content.catalog.buildId,
    mapId,
    jobs: selected.length,
    evaluatedJobs: jobReports.length,
    skillsEvaluated: jobReports.reduce(
      (total, job) => total + job.records.length,
      0,
    ),
    counts,
    refusalClasses: sortObject(refusalClasses),
    gaps,
    throws,
    unevaluated,
    jobReports,
    boundary:
      "Production preset profiles, SkillSystem admission, field combat hooks and packaged catalog only; no browser, network, database or native Windows proof. Asset preparation is real; the presented actor is grounded with production physics so ground gates cannot mask later checks. Weapon-restricted skills whose authored requirement excludes the staged job weapon are by-design, not job-admission defects.",
  };
}

function sortObject(source) {
  const sorted = {};
  for (const key of Object.keys(source).sort()) sorted[key] = source[key];
  return sorted;
}

/** Print the bounded summary; gaps carry their first underlying refusal string. */
export function summarize(report) {
  console.log(
    `skill-admission: ${report.evaluatedJobs}/${report.jobs} jobs, ` +
      `${report.skillsEvaluated} skills, ok=${report.counts.ok}, ` +
      `by-design=${report.counts["by-design"]}, gap=${report.counts.gap}, ` +
      `throws=${report.counts.throws}`,
  );
  for (const row of report.gaps) {
    console.log(
      `gap ${row.job}/${row.id} ${row.name} rank=${row.rank} ` +
        `weapon=${row.weaponType} class=${row.refusalClass} reason=${row.reason ?? row.threw}`,
    );
  }
  for (const row of report.unevaluated) {
    console.log(
      `unevaluated ${row.job} stage=${row.stage} reason=${row.reason}`,
    );
  }
}

function parseJobs(value) {
  if (value === undefined) return null;
  const parts = value.split(",");
  if (!parts.length || parts.length > MAX_JOB_ARGUMENTS) {
    throw new Error("--jobs accepts at most 256 comma-separated IDs");
  }
  return parts.map((part) => {
    if (!/^[0-9]+$/.test(part)) {
      throw new Error(`Invalid --jobs value: ${part}`);
    }
    return Number(part);
  });
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2), {
    "generated-root": { type: "string", default: DEFAULT_GENERATED_ROOT },
    jobs: { type: "string" },
    map: { type: "string", default: String(DEFAULT_MAP_ID) },
    report: { type: "string", default: DEFAULT_REPORT },
    strict: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  });
  if (flags.help) {
    console.log(
      [
        "bun server/tools/check-skill-admission.js [--generated-root DIR] [--jobs ID,ID]",
        "  [--map ID] [--report FILE] [--strict]",
        "",
        "Evaluates the full SkillSystem admission path for every skill in each preset job's",
        "ancestor books and classifies each refusal as ok, by-design or gap.",
        `Defaults: --generated-root ${DEFAULT_GENERATED_ROOT}; --map ${DEFAULT_MAP_ID};`,
        `--report ${DEFAULT_REPORT}. --strict exits non-zero on any gap, throw or unevaluated job.`,
      ].join("\n"),
    );
  } else {
    const jobs = parseJobs(flags.jobs);
    const mapId = Number(flags.map);
    if (!Number.isSafeInteger(mapId)) throw new Error("Invalid --map value");
    const content = await loadContent({
      root: resolve(flags["generated-root"]),
    });
    const report = await skillAdmissionAudit({ content, jobs, mapId });
    await Bun.write(resolve(flags.report), JSON.stringify(report, null, 2));
    summarize(report);
    console.log(`report=${resolve(flags.report)}`);
    if (
      flags.strict &&
      (report.counts.gap || report.counts.throws || report.unevaluated.length)
    ) {
      process.exitCode = 1;
    }
  }
}
