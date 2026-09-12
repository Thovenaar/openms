import { at, value, resolveNode } from "../src/assets/image.js";
import {
  linkedImage,
  placement,
  placementCoordinate,
  fields,
  extractLife,
  extractTemplate,
} from "./life-data.js";
import {
  linkedTemplate,
  placementRecord,
  stateRecord,
} from "./reactor-data.js";
import {
  extractPortals,
  extractOne,
  graphics,
  admitClosureRoute,
  admitNpcDestinations,
} from "./portal-data.js";
import { readPhysicsData } from "./physics-data.js";
import { provenance, rawValue } from "./preflight-inputs.js";
import { mapBounds, spawnPortal } from "./extraction-inputs.js";

/** Source-driven closure keeps parse-failure boundaries local to each original edge. */
export function selectWorld(state, seeds, explicit) {
  const { context, findings, report } = state;
  const closure = {
    ids: [...seeds],
    seen: new Set(seeds),
    blocked: [],
    npcIds: new Set(),
  };
  for (let index = 0; index < closure.ids.length; index++) {
    const id = closure.ids[index];
    context.setOwner(id);
    let map;
    try {
      map = context.image("Map", `Map/Map${id[0]}/${id}.img`);
    } catch (error) {
      findings.add(error);
      continue;
    }
    if (explicit) continue;
    for (const node of Object.values(map.children.portal?.children ?? {})) {
      const target = findings.check(node, "route", fields(node), () =>
        admitClosureRoute(context, id, node, closure.blocked),
      );
      if (target === null || closure.seen.has(target)) continue;
      if (closure.ids.length >= 1024) {
        findings.add(
          new Error("Playable map closure exceeds 1024 maps"),
          node,
          "tm",
          value(node, "tm"),
        );
        continue;
      }
      closure.seen.add(target);
      closure.ids.push(target);
    }
    findings.check(map, "life", undefined, () =>
      admitNpcDestinations(context, id, closure),
    );
  }
  report.selection = {
    ids: closure.ids.sort(),
    seeds,
    blocked: closure.blocked,
  };
  context.mapIds = report.selection.ids;
}

function asset(state, archive, path, branch) {
  const root = state.context.image(archive, path);
  const node = branch ? at(root, branch) : root;
  return node;
}

function layerAssets(state, map) {
  for (let layer = 0; layer < 8; layer++) {
    const node = state.findings.check(map, String(layer), undefined, () =>
      at(map, String(layer)),
    );
    if (!node) continue;
    for (const kind of ["obj", "tile"]) {
      const group = state.findings.check(node, kind, undefined, () =>
        at(node, kind),
      );
      if (!group) continue;
      for (const entry of Object.values(group.children)) {
        state.findings.check(entry, "", fields(entry), () => {
          if (kind === "obj") {
            return state.validators.animation(
              asset(
                state,
                "Map",
                `Obj/${value(entry, "oS")}.img`,
                `${value(entry, "l0")}/${value(entry, "l1")}/${value(entry, "l2")}`,
              ),
            );
          }
          return state.validators.animation(
            asset(
              state,
              "Map",
              `Tile/${value(at(node, "info"), "tS")}.img`,
              `${value(entry, "u")}/${value(entry, "no")}`,
            ),
          );
        });
      }
    }
  }
  const backgrounds = state.findings.check(map, "back", undefined, () =>
    at(map, "back"),
  );
  for (const entry of Object.values(backgrounds?.children ?? {})) {
    if (!value(entry, "bS")) continue;
    state.findings.check(entry, "", fields(entry), () =>
      state.validators.animation(
        asset(
          state,
          "Map",
          `Back/${value(entry, "bS")}.img`,
          `${value(entry, "ani", 0) ? "ani" : "back"}/${value(entry, "no")}`,
        ),
      ),
    );
  }
}

function rememberOwners(state, sources, kind, id) {
  for (const { source } of sources) {
    if (!state.templateOwners.has(source)) {
      state.templateOwners.set(source, {
        npcIds: new Set(),
        mobIds: new Set(),
      });
    }
    const owners = state.templateOwners.get(source);
    owners[kind === "npc" ? "npcIds" : "mobIds"].add(id);
  }
}

async function lifeAssets(state, map, mapId) {
  const seen = new Set();
  for (const entry of Object.values(map.children.life?.children ?? {})) {
    const identity = lifePlacement(state, entry, mapId);
    if (!identity) continue;
    const { kind, id, rawId } = identity;
    const templateKey = `${kind}:${id}`;
    if (seen.has(templateKey)) continue;
    seen.add(templateKey);
    rememberOwners(
      state,
      [{ source: `${kind === "npc" ? "Npc" : "Mob"}.wz:${id}.img` }],
      kind,
      id,
    );
    state.findings.check(entry, "template", rawId, () => {
      const linked = linkedImage(state.context, kind, id);
      rememberOwners(state, linked.chain, kind, id);
      state.context.image("String", kind === "npc" ? "Npc.img" : "Mob.img");
      for (const [name, child] of Object.entries(linked.node.children)) {
        if (name === "info") continue;
        const action = state.findings.check(child, "", child.value, () =>
          resolveNode(child),
        );
        if (!action?.children["0"]) continue;
        const first = state.findings.check(
          action.children["0"],
          "",
          action.children["0"].value,
          () => at(action, "0"),
        );
        if (first?.type === "Canvas") {
          state.validators.tree(action, { life: kind });
        }
      }
      if (
        kind === "npc" &&
        state.validators.television(at(linked.original, "info"))
      ) {
        const television = state.context.image("UI", "MapleTV.img");
        state.validators.effect(at(television, "TVmedia"));
        state.validators.effect(at(television, "TVoff"));
      }
    });
    const key = `${kind}:${id}`;
    if (state.lifeTemplates.has(key)) continue;
    state.lifeTemplates.add(key);
    try {
      await extractTemplate(state.context, kind, id);
    } catch (error) {
      error.source ??= `${kind === "npc" ? "Npc" : "Mob"}.wz:${id}.img`;
      state.findings.add(error);
    }
  }
}

function lifePlacement(state, entry, mapId) {
  const authored = fields(entry);
  for (const key of ["x", "y", "fh", "cy", "rx0", "rx1"]) {
    state.findings.check(entry, key, authored[key], () =>
      placementCoordinate(authored, key, mapId),
    );
  }
  const record = state.findings.check(entry, "", authored, () =>
    placement(entry, mapId),
  );
  // A rejected placement does not hide independently discoverable template bytes.
  const type = value(entry, "type");
  const rawId = value(entry, "id");
  if (
    !["m", "n"].includes(type) ||
    typeof rawId !== "string" ||
    !/^\d{1,7}$/.test(rawId)
  ) {
    return null;
  }
  return {
    kind: record?.kind ?? (type === "n" ? "npc" : "mob"),
    id: rawId.padStart(7, "0"),
    rawId,
  };
}

async function reactorAssets(state, map) {
  for (const entry of Object.values(map.children.reactor?.children ?? {})) {
    const id = String(value(entry, "id")).padStart(7, "0");
    state.findings.check(entry, "placement", fields(entry), () =>
      placementRecord(entry, { id }),
    );
    if (Number(value(entry, "reactorTime", 0)) === -1) {
      state.report.normalizations.push({
        ...provenance(entry),
        field: `reactor/${entry.name}/reactorTime`,
        code: "reactor-no-respawn",
        ...rawValue(value(entry, "reactorTime")),
        normalized: 0,
      });
    }
    const linked = state.findings.check(entry, "id", value(entry, "id"), () =>
      linkedTemplate(state.context, id),
    );
    if (!linked) continue;
    state.validators.reactor(linked.root);
    for (const [key, node] of Object.entries(linked.root.children)) {
      if (!/^\d+$/.test(key)) continue;
      try {
        await stateRecord(state.context, node, {});
      } catch (error) {
        state.findings.add(error, node, "", fields(node));
      }
    }
    state.findings.check(entry, "sound", id, () => {
      const sounds = state.context.image("Sound", "Reactor.img").children[
        String(Number(id))
      ];
      if (!sounds) return;
      for (const key of Object.keys(linked.root.children).filter((key) =>
        /^\d+$/.test(key),
      )) {
        const hit = sounds.children[key]?.children.Hit;
        if (hit) state.validators.tree(hit);
      }
    });
  }
}

async function portalAssets(state, map) {
  const helper = state.findings.check(map, "portal", undefined, () =>
    state.context.image("Map", "MapHelper.img"),
  );
  if (!helper) return;
  const cache = new Map();
  for (const node of Object.values(map.children.portal?.children ?? {})) {
    const path = state.findings.check(node, "graphics", fields(node), () =>
      graphics(node),
    );
    if (path) {
      const paths = path.startsWith("portal/game/psh/")
        ? [path, path.replace("/psh/", "/ph/")]
        : [path];
      for (const resourcePath of paths) {
        let resource = helper;
        for (const key of resourcePath.split("/")) {
          resource = resource?.children[key];
        }
        if (resource) state.validators.tree(resource, { animation: true });
      }
    }
    try {
      await extractOne(state.context, node, helper, cache);
    } catch (error) {
      state.findings.add(error, node, "", fields(node));
    }
  }
}

/** Map artwork, geometry and original actors validate independently, never short-circuiting sibling assets. */
export async function validateWorldMap(state, id) {
  state.context.setOwner(id);
  let map;
  try {
    map = state.context.image("Map", `Map/Map${id[0]}/${id}.img`);
  } catch (error) {
    state.findings.add(error);
    return;
  }
  const info = state.findings.check(map, "info", undefined, () =>
    at(map, "info"),
  );
  if (info?.children.link) {
    state.findings.add(
      new Error("Linked maps require explicit target extraction"),
      info,
      "link",
      value(info, "link"),
    );
  }
  layerAssets(state, map);
  await lifeAssets(state, map, id);
  await portalAssets(state, map);
  await reactorAssets(state, map);
  state.findings.check(map, "bounds", undefined, () => mapBounds(map));
  state.findings.check(map, "portal", undefined, () => spawnPortal(map));
  state.findings.check(map, "physics", undefined, () =>
    readPhysicsData(map, state.context.image("Map", "Physics.img")),
  );
  const bgm = info ? value(info, "bgm", "") : "";
  state.findings.check(info ?? map, "bgm", bgm, () => {
    if (!/^[A-Za-z0-9_]+\/[^/\\]+$/.test(bgm)) {
      throw new Error(`Unsupported map BGM ${bgm}`);
    }
    const [image, name] = bgm.split("/");
    state.validators.sound(asset(state, "Sound", `${image}.img`, name));
  });
  for (const extract of [extractPortals, extractLife]) {
    try {
      await extract(state.context, map, id);
    } catch (error) {
      const sources = state.context.dependencies.get(id);
      const precise = state.report.failures.some(
        (row) =>
          row.message === error.message &&
          row.field &&
          sources?.has(row.source),
      );
      if (!precise) state.findings.add(error, map, extract.name);
    }
  }
}
