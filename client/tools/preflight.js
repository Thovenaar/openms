import { resolve } from "node:path";
import { value, resolveNode } from "../src/assets/image.js";
import {
  extractAvatar,
  extractAvatarRecord,
  avatarMaps,
  defaultAvatarInputs,
} from "./avatar-data.js";
import { originalFrames } from "./extraction-frames.js";
import { selectedMapIds } from "./extraction-inputs.js";
import { convertServerData } from "./server-data.js";
import {
  preflightInputs,
  preflightFindings,
  provenance,
} from "./preflight-inputs.js";
import { originalValidators } from "./preflight-validators.js";
import { selectWorld, validateWorldMap } from "./preflight-world.js";

function createState(options, report) {
  const context = preflightInputs(
    resolve(
      options.assets ??
        Bun.env.MAPLE_ASSETS ??
        "/Users/k/Development/tensorfish/Maplestory-Client",
    ),
    report,
  );
  const findings = preflightFindings(report);
  const validators = originalValidators(report, findings);
  context.part = async (original, x = 0, y = 0, z = 0) => {
    const node = resolveNode(original),
      origin = value(node, "origin", { x: 0, y: 0 });
    const texture = validators.canvas(node);
    if (texture === null) {
      throw new Error(`Canvas validation failed at ${nodePath(node)}`);
    }
    return { texture, x: x - origin.x, y: y - origin.y, z };
  };
  context.frames = (node) => originalFrames(node, context.part, nodePath);
  return {
    context,
    findings,
    validators,
    report,
    templateOwners: new Map(),
    lifeTemplates: new Set(),
  };
}

function nodePath(node) {
  const location = provenance(node);
  return `${location.source}/${location.field}`;
}

async function routes(state, options) {
  state.context.setOwner("shared");
  try {
    const converted = await convertServerData({
      serverRoot:
        options.serverReference ??
        Bun.env.MAPLE_SERVER_REFERENCE ??
        "/Users/k/Development/tensorfish/MapleStory-Server",
      defaultTalkForNpc: (id) => {
        const root = state.context.image("String", "Npc.img").children[
          String(id)
        ];
        return root ? value(root, "d0", "(...)") : "(...)";
      },
    });
    state.report.serverReference = converted.report;
    state.context.portalPrograms = converted.report.scripts.portalPrograms;
    state.context.npcRoutes = new Map(
      converted.datasets.shops.npcRoutes
        .filter((route) => route.status === "supported")
        .map((route) => [route.npcId, route]),
    );
  } catch (error) {
    error.code = "server-reference-boundary";
    state.findings.add(error);
  }
}

async function sharedWorld(state) {
  state.context.setOwner("shared");
  const maps = state.findings.check(null, "avatar-maps", undefined, () =>
    avatarMaps(state.context),
  );
  for (const input of defaultAvatarInputs) {
    try {
      state.context.image("Character", input.path);
      if (maps) await extractAvatarRecord(state.context, input, maps);
    } catch (error) {
      error.source ??= `Character.wz:${input.path}`;
      state.findings.add(error);
    }
  }
  try {
    await extractAvatar(state.context);
  } catch (error) {
    state.findings.add(error);
  }
  for (const [archive, path] of [
    ["Map", "MapHelper.img"],
    ["Map", "Physics.img"],
  ]) {
    try {
      state.context.image(archive, path);
    } catch (error) {
      state.findings.add(error);
    }
  }
}

/** Join ownership after every traversal, including cached sources reused by later maps. */
export function finalizePreflight(state) {
  const { context, report, templateOwners } = state;
  const shared = context.dependencies.get("shared") ?? new Set();
  for (const id of report.selection.ids) {
    report.dependencies[id] = [
      ...new Set([...shared, ...(context.dependencies.get(id) ?? [])]),
    ].sort();
  }
  for (const row of [...report.failures, ...report.normalizations]) {
    const sourceOwners = context.owners.get(row.source) ?? new Set();
    row.mapIds = sourceOwners.has("shared")
      ? [...report.selection.ids]
      : [...sourceOwners].sort();
    const owners = templateOwners.get(row.source);
    row.npcIds = [...(owners?.npcIds ?? [])].sort();
    row.mobIds = [...(owners?.mobIds ?? [])].sort();
  }
  report.status = report.failures.length ? "fail" : "pass";
}

/** Validate the complete selected world closure without creating any generated release resources. */
export async function preflightAssets(options = {}) {
  const started = performance.now();
  const report = {
    schemaVersion: 1,
    status: "fail",
    elapsedMs: 0,
    selection: { ids: [], seeds: [], blocked: [] },
    sources: {},
    dependencies: {},
    failures: [],
    normalizations: [],
    coverage: {
      scope: "selected-world-dependency-closure",
      canvases: 0,
      sounds: 0,
      nodes: 0,
      releaseGate:
        "Full inventory, cash shop, all-skill UI and catalog publication are a separate final release gate.",
    },
  };
  const state = createState(options, report);
  try {
    const seeds = selectedMapIds(options.maps);
    await routes(state, options);
    selectWorld(state, seeds, options.maps !== undefined);
    await sharedWorld(state);
    for (const id of report.selection.ids) {
      try {
        await validateWorldMap(state, id);
      } catch (error) {
        state.findings.add(error);
      }
    }
    finalizePreflight(state);
  } catch (error) {
    state.findings.add(error);
  } finally {
    state.context.close();
  }
  report.elapsedMs = Math.round(performance.now() - started);
  if (options.report) {
    await Bun.write(
      resolve(options.report),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

export function preflightOptions(args) {
  const options = {};
  const names = {
    "--assets": "assets",
    "--maps": "maps",
    "--map": "maps",
    "--server-reference": "serverReference",
    "--report": "report",
  };
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]],
      value = args[index + 1];
    if (!name || !value || value.startsWith("--")) {
      throw new Error(`Invalid preflight option ${args[index]}`);
    }
    options[name] = value;
  }
  return options;
}

if (import.meta.main) {
  try {
    const report = await preflightAssets(
      preflightOptions(process.argv.slice(2)),
    );
    console.log(JSON.stringify(report));
    process.exitCode = report.status === "pass" ? 0 : 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        status: "fail",
        failures: [{ code: "cli-input", message: error.message }],
      }),
    );
    process.exitCode = 1;
  }
}
