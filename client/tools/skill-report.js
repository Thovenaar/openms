import { dirname, resolve } from "node:path";
import { classifySkill } from "./skill-data.js";
import { skillBooks } from "../src/ui-skill-books.js";
import { validateProfile } from "../src/profile-validation.js";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_SKILLS = 4096;
const MAX_ENTITIES = 65536;
const MAX_FIELDS = 256;
const CONSUMED_VISUALS = new Set(["effect", "effect0", "hit", "hit/0"]);

/** Exhaustive, deterministic catalog/controller join; no extraction, server, or browser required. */
export function skillReport(catalog, scene, profile = null, now = Date.now()) {
  const skills = Object.values(catalog.ui.skills);
  if (!skills.length || skills.length > MAX_SKILLS) {
    throw new Error("Invalid skill catalog bound");
  }
  if (!Array.isArray(scene.actors) || scene.actors.length > MAX_ENTITIES) {
    throw new Error("Actor manifest bound exceeded");
  }
  if (profile) validateProfile(profile);
  const actor = scene.actors.find((entity) => entity.kind === "character");
  if (!actor) throw new Error("Scene lacks original avatar action manifest");
  const actions = new Set(Object.keys(actor.actions));
  const records = skills
    .sort((a, b) => a.id - b.id)
    .map((skill) => reportRecord(skill, actions, catalog.combat));
  const { counts, supported } = summarizeClassifications(records);
  return {
    schemaVersion: 1,
    total: records.length,
    supported,
    unavailable: records.length - supported,
    counts,
    actorActions: [...actions].sort(),
    records,
    bindings: profile ? bindingReport(profile, records, now) : null,
    boundary:
      "Controller coverage, not native cast proof. Missing actions are evaluated against this extracted avatar. Solo-party buffs apply to the sole offline character; no remote party is fabricated.",
  };
}

/** Count supported and unavailable controller families from the completed catalog join. */
function summarizeClassifications(records) {
  const counts = {};
  let supported = 0;
  for (const record of records) {
    const key = `${record.classification.activation}:${record.classification.supported ? "supported" : "unavailable"}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (record.classification.supported) supported++;
  }
  return { counts, supported };
}

function reportRecord(skill, actions, combat) {
  const classification = classifySkill(skill);
  const rankFields = new Set();
  for (const rank of Object.values(skill.levels)) {
    const fields = Object.keys(rank);
    if (fields.length > MAX_FIELDS) {
      throw new Error(`Skill ${skill.id} rank field bound exceeded`);
    }
    for (const field of fields) rankFields.add(field);
  }
  const effectiveActions = skill.actions.length
    ? skill.actions
    : classification.activation === "melee"
      ? [combat.defaultAction, combat.proneAction]
      : [];
  return {
    id: skill.id,
    name: skill.name,
    bookId: skill.bookId,
    source: skill.source,
    classification,
    previousClassification: skill.classification,
    requirements: {
      flags: skill.flags,
      reqLev: skill.properties.reqLev ?? null,
      prerequisites: skill.prerequisites,
      maxLevel: skill.maxLevel,
    },
    rankFields: [...rankFields].sort(),
    actions: skill.actions,
    actionSelection: skill.actions.length
      ? "authored"
      : classification.activation === "melee"
        ? "equipped weapon default/prone"
        : "no authored cast pose",
    missingActions: effectiveActions.filter((action) => !actions.has(action)),
    missingWeaponRectangles:
      classification.activation === "melee"
        ? effectiveActions.filter((action) => !combat.attacks[action])
        : [],
    resources: resourceReport(skill, classification),
    dependencies: controllerDependencies(skill, classification, rankFields),
  };
}

function resourceReport(skill, classification) {
  const paths = Object.keys(skill.visuals);
  return {
    visualPaths: paths,
    missingVisuals: paths.filter(
      (path) => skill.visuals[path].available === false,
    ),
    unselectedVisuals: paths.filter((path) => !CONSUMED_VISUALS.has(path)),
    soundLeaves: Object.keys(skill.sounds.leaves),
    unselectedSounds: Object.keys(skill.sounds.leaves).filter(
      (leaf) => leaf !== "Use" && leaf !== "Hit",
    ),
    missingSounds: Object.entries(skill.sounds.leaves)
      .filter(([, leaf]) => !leaf.available)
      .map(([name]) => name),
    presentationPolicy: classification.supported
      ? "baseline effect/hit; original alternate selection retained, not invented"
      : "controller unavailable; resources alone never admit a cast",
  };
}

/** Dependencies name observed WZ features independently, not one catch-all missing server label. */
function controllerDependencies(skill, classification, fields) {
  const dependencies = [];
  if (!classification.supported) dependencies.push(classification.reason);
  actorDependencies(skill.properties, fields, dependencies);
  stateDependencies(skill.properties, fields, dependencies);
  authorityDependencies(skill, classification, fields, dependencies);
  return dependencies;
}

function actorDependencies(p, fields, dependencies) {
  if (p.summon) dependencies.push("summon lifetime/movement/target scheduler");
  if (p.ball || fields.has("ball")) {
    dependencies.push("projectile spawn/flight/contact phases");
  }
  if (p.mob || fields.has("mob")) {
    dependencies.push("mob status application, probability and expiry");
  }
  if (p.tile || fields.has("tile")) {
    dependencies.push("map-area effect placement and lifetime");
  }
  if (fields.has("morph")) {
    dependencies.push("morph actor and movement attributes");
  }
}

function stateDependencies(p, fields, dependencies) {
  if (p.keydown || p.repeat || p.keydownend) {
    dependencies.push("held input/release and repeated resource transaction");
  }
  if (p.finish || p.state) {
    dependencies.push("combo/state prerequisites and atomic transition");
  }
  if (
    fields.has("itemCon") ||
    fields.has("bulletConsume") ||
    fields.has("moneyCon")
  ) {
    dependencies.push("slot-aware item/projectile/meso debit");
  }
}

function authorityDependencies(skill, classification, fields, dependencies) {
  const p = skill.properties;
  if (p.cDoor || p.mDoor || fields.has("moveTo")) {
    dependencies.push("map destination/portal authorization");
  }
  if (p.affected && classification.hooks[0] !== "solo-party-stats") {
    dependencies.push("party/affected target selection");
  }
  if (
    skill.flags.timeLimited ||
    skill.flags.disabled ||
    (skill.bookId >= 800 && skill.bookId < 1000)
  ) {
    dependencies.push("event/permission/expiration authority");
  }
}

function bindingReport(profile, records, now) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const books = skillBooks(profile.job);
  const bindings = [];
  for (let index = 0; index < profile.keyBindings.keys.length; index++) {
    const binding = profile.keyBindings.keys[index];
    if (binding?.type !== 1) continue;
    const record = byId.get(binding.id);
    const owned = ownsLearnedBinding(
      profile.skills[binding.id],
      record,
      books,
      now,
    );
    bindings.push({
      keyIndex: index,
      id: binding.id,
      owned,
      controller: record?.classification ?? null,
      missingActions: record?.missingActions ?? [],
      reason: owned
        ? record.classification.reason
        : "unlearned, expired, unknown or outside current job books",
    });
  }
  return bindings;
}

/** Catalog identity, current job ownership and a live positive learned rank are all required. */
function ownsLearnedBinding(learned, record, books, now) {
  return Boolean(
    record &&
    books.includes(record.bookId) &&
    learned?.level > 0 &&
    (learned.expiresAt === null || learned.expiresAt > now),
  );
}

async function readJson(path) {
  const file = Bun.file(path);
  if (file.size > MAX_BYTES) {
    throw new Error(`Input byte bound exceeded: ${path}`);
  }
  return file.json();
}

if (import.meta.main) {
  const [catalogPath, scenePath, outputPath, profilePath] = Bun.argv.slice(2);
  if (!catalogPath || !scenePath || !outputPath || Bun.argv.length > 6) {
    throw new Error(
      "Usage: bun tools/skill-report.js catalog.json map.json|default report.json [profile.json]",
    );
  }
  const catalog = await readJson(catalogPath);
  const mapPath =
    scenePath === "default"
      ? resolve(
          dirname(catalogPath),
          "..",
          catalog.maps[catalog.defaultMap].url.slice(1),
        )
      : scenePath;
  const [scene, profile] = await Promise.all([
    readJson(mapPath),
    profilePath ? readJson(profilePath) : null,
  ]);
  const report = skillReport(catalog, scene, profile);
  await Bun.write(outputPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      total: report.total,
      supported: report.supported,
      unavailable: report.unavailable,
      counts: report.counts,
      outputPath,
    }),
  );
}
