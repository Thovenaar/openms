import { createHash } from "node:crypto";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS = 100000;
const MAX_MAPS = 10000;
const MAX_REASONS = 20;

function entries(value, maximum = MAX_RECORDS) {
  const result = Object.entries(value);
  if (result.length > maximum) throw new Error("Audit record bound exceeded");
  return result;
}

async function read(path, descriptor = null) {
  const file = Bun.file(resolve(ROOT, path));
  if (file.size > MAX_JSON_BYTES) throw new Error("Audit byte bound exceeded");
  const bytes = await file.bytes();
  if (bytes.length > MAX_JSON_BYTES) {
    throw new Error("Audit byte bound exceeded");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    descriptor &&
    (bytes.length !== descriptor.bytes || sha256 !== descriptor.sha256)
  ) {
    throw new Error(`Audit descriptor mismatch: ${path}`);
  }
  return { data: JSON.parse(new TextDecoder().decode(bytes)), sha256 };
}

async function reference(descriptor) {
  if (
    !/^\/generated\/(maps|references)\/[a-f0-9]{64}\.json$/.test(descriptor.url)
  ) {
    throw new Error("Invalid audit reference path");
  }
  return (await read(`client/public${descriptor.url}`, descriptor)).data;
}

/** Counts affected records once per reason; categories can overlap. */
function reasons(records, select) {
  const counts = new Map();
  for (const [, record] of entries(records)) {
    const values = select(record);
    for (const value of new Set(entries(values).map(([, reason]) => reason))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function originalInventory(inventory) {
  const archives = entries(inventory.archives, 32).map(([, value]) => value);
  const maps = archives.find((archive) => archive.archive === "Map");
  return {
    archives: archives.length,
    images: archives.reduce((sum, archive) => sum + archive.images, 0),
    canvases: archives.reduce((sum, archive) => sum + archive.canvases, 0),
    mapImages: entries(maps.imagesInventory).filter(([, row]) =>
      /^Map\/Map\d\/\d{9}\.img$/.test(row.path),
    ).length,
    scanFailures: inventory.failures.length,
  };
}

function npcCoverage(shops, server) {
  const routes = entries(shops.npcRoutes).map(([, row]) => row);
  const supported = routes.filter((row) => row.status === "supported");
  const blocked = routes.filter((row) => row.status !== "supported");
  const services = (row) =>
    entries(row.program?.expressions ?? [])
      .filter(([, expression]) => expression.op === "unavailable")
      .map(([, expression]) => expression.service);
  return {
    scriptCategories: server.scripts.categories,
    compiledScripts: server.summary.npcScriptsSupported,
    blockedScripts: server.summary.npcScriptsBlocked,
    numericAndSqlRoutes: routes.length,
    supportedRoutes: supported.length,
    blockedRoutes: blocked.length,
    supportedRoutesWithUnavailableBranches: supported.filter(
      (row) => services(row).length,
    ).length,
    unavailableServicesByRoute: reasons(supported, services),
    leadingBlockersByRoute: reasons(blocked, (row) =>
      row.blockers.map((blocker) => blocker.reason),
    ).slice(0, MAX_REASONS),
  };
}

function skillCoverage(catalog) {
  const skills = entries(catalog.ui.skills).map(([, row]) => row);
  const unavailable = skills.filter((row) => !row.classification.supported);
  return {
    total: skills.length,
    classifiedSupported: skills.length - unavailable.length,
    originalDisabled: unavailable.filter(
      (row) => row.classification.activation === "disabled",
    ).length,
    otherUnavailable: unavailable
      .filter((row) => row.classification.activation !== "disabled")
      .map((row) => ({ id: row.id, name: row.name, ...row.classification })),
  };
}

async function fieldCoverage(catalog) {
  const maps = entries(catalog.maps, MAX_MAPS);
  const monsters = new Map();
  const npcs = new Set();
  const propertyMaps = {
    onUserEnter: 0,
    onFirstUserEnter: 0,
    fieldType: 0,
    timeLimit: 0,
  };
  let reactorPlacements = 0;
  for (const [, descriptor] of maps) {
    const manifest = await reference(descriptor);
    for (const [id, template] of entries(manifest.life.templates)) {
      if (template.kind === "mob") monsters.set(id, template);
      else if (template.kind === "npc") npcs.add(id);
    }
    for (const key of Object.keys(propertyMaps)) {
      if (manifest.physics.map[key]) propertyMaps[key]++;
    }
    reactorPlacements += manifest.reactors.placements.length;
  }
  const attacks = [...monsters.values()].flatMap((row) =>
    entries(row.combat.attacks).map(([, attack]) => attack),
  );
  return {
    maps: maps.length,
    monsterTemplates: monsters.size,
    npcTemplates: npcs.size,
    reactorPlacements,
    mapsWithNonzeroProperties: propertyMaps,
    attackDefinitions: attacks.length,
    supportedAttackDefinitions: attacks.filter((row) => row.supported).length,
    monstersWithUnsupportedAttacks: [...monsters.values()].filter((row) =>
      row.combat.attacks.some((attack) => !attack.supported),
    ).length,
    unsupportedAttackTypes: reasons(
      attacks.filter((row) => !row.supported),
      (row) => [String(row.properties.type ?? "absent")],
    ),
  };
}

/** Static retained-content coverage; this does not start a game or certify any controller. */
async function audit() {
  const catalog = await read("client/public/generated/catalog.json");
  const inventory = await read("docs/original-resource-inventory.json");
  const c = catalog.data;
  const server = await reference(c.serverData.report);
  const shops = await reference(c.serverData.datasets.shops);
  const quests = entries(c.quests.records).map(([, row]) => row);
  return {
    schema: 1,
    evidence:
      "Static content inventory and classifications. Counts are not gameplay, visual, branch-reachability or multiplayer acceptance proof. Blocker groups overlap; only leading groups are displayed.",
    catalogBuildId: c.buildId,
    catalogSha256: catalog.sha256,
    originalInventorySha256: inventory.sha256,
    serverReportSha256: c.serverData.report.sha256,
    original: originalInventory(inventory.data),
    fields: await fieldCoverage(c),
    skills: skillCoverage(c),
    quests: {
      retained: quests.length,
      classifiedSupported: quests.filter((row) => row.supported).length,
      leadingBlockersByQuest: reasons(quests, (row) =>
        row.blockers.map((blocker) => blocker.reason),
      ).slice(0, MAX_REASONS),
    },
    npc: npcCoverage(shops, server),
    portalClassifications: reasons(c.routes.blocked, (row) => [row.reason]),
    items: {
      extracted: Object.keys(c.ui.items).length,
      missing: c.ui.coverage.missingItems,
    },
    missingPortraits: c.ui.coverage.missingPortraits.length,
    uiBundles: Object.keys(c.ui.bundles),
  };
}

const result = await audit();
await Bun.write(
  resolve(ROOT, "docs/server/content-coverage-audit.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    maps: result.fields.maps,
    quests: result.quests.classifiedSupported,
    npcRoutes: result.npc.supportedRoutes,
    classifiedSkills: result.skills.classifiedSupported,
  }),
);
