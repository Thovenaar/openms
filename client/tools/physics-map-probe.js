import { resolve } from "node:path";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage } from "../src/assets/image.js";
import { readPhysicsData } from "./physics-data.js";

const MAX_ENTRIES = 100000;

/** Read every original map through the production extraction helper; retain active
 * unusual options and exact maps, not name-derived claims about behavior.
 * @param {string} source @param {string} output */
export async function probePhysicsMaps(source, output) {
  const archive = new WzArchive(resolve(source, "Map.wz"));
  const report = {
    maps: 0,
    extracted: 0,
    footholds: 0,
    ladders: 0,
    portals: 0,
    areas: 0,
    objectCandidates: 0,
    failures: [],
    active: [],
    sections: new Map(),
  };
  try {
    if (archive.entries.size > MAX_ENTRIES) {
      throw new Error("Archive exceeds probe entry bound");
    }
    const physics = parseImage(archive.imageReader("Physics.img"));
    for (const entry of archive.entries.values()) {
      if (entry.type !== 4 || !/^Map\/Map\d\/\d+\.img$/.test(entry.path)) {
        continue;
      }
      report.maps++;
      const map = parseImage(archive.imageReader(entry.path));
      for (const key of Object.keys(map.children)) {
        report.sections.set(key, (report.sections.get(key) ?? 0) + 1);
      }
      try {
        const data = readPhysicsData(map, physics);
        report.extracted++;
        report.footholds += data.footholds.length;
        report.ladders += data.ladders.length;
        report.portals += data.portals.length;
        report.areas += data.areas.length;
        report.objectCandidates += Object.keys(data.map.$objectPhysics).length;
        retainActive(report.active, entry.path, data);
      } catch (error) {
        report.failures.push({ path: entry.path, error: String(error) });
      }
    }
  } finally {
    archive.close();
  }
  report.sections = Object.fromEntries(report.sections);
  await Bun.write(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, active: report.active.length }));
}

/** Collect nonzero field flags and uninterpreted map sections.
 * @param {any} data */
function activeFlags(data) {
  const flags = Object.create(null);
  for (const key of [
    "swim",
    "fly",
    "fs",
    "moveLimit",
    "fieldLimit",
    "fieldType",
    "VRLimit",
    "allMoveCheck",
  ]) {
    if (data.map[key]) flags[key] = data.map[key];
  }
  for (const [key, value] of Object.entries(data.map.$unrecognized)) {
    flags[key] = value;
  }
  return flags;
}

/** Retain footholds carrying active force, drag or drop metadata.
 * @param {any[]} footholds */
function activeFootholds(footholds) {
  const unusualFootholds = [];
  for (const foothold of footholds) {
    const fields = foothold.properties;
    if (fields.force || fields.drag || fields.forbidFallDown) {
      unusualFootholds.push({ id: foothold.id, properties: fields });
    }
  }
  return unusualFootholds;
}

/** Retain portals carrying active impulse metadata. @param {any} data */
function activeImpacts(data) {
  const impacts = [];
  for (const [id, properties] of Object.entries(data.map.$portalProperties)) {
    if (properties.horizontalImpact || properties.verticalImpact) {
      impacts.push({ id, properties });
    }
  }
  return impacts;
}

/** @param {object[]} active @param {string} path @param {any} data */
function retainActive(active, path, data) {
  const flags = activeFlags(data);
  const unusualFootholds = activeFootholds(data.footholds);
  const impacts = activeImpacts(data);
  if (Object.keys(flags).length || unusualFootholds.length || impacts.length) {
    active.push({ path, flags, unusualFootholds, impacts });
  }
}

if (import.meta.main) {
  const source =
    process.argv[2] ??
    Bun.env.MAPLE_ASSETS ??
    "/Users/k/Development/tensorfish/Maplestory-Client";
  await probePhysicsMaps(
    source,
    process.argv[3] ?? "docs/ghidra-physics-options/map-probe.json",
  );
}
