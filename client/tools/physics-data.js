/** Original WZ metadata extraction; numerical interpretation belongs to simulation. */
const MAX_NODES = 1000000;
const MAX_DEPTH = 64;

/** @typedef {import('../src/assets/image.js').WzNode} WzNode */
/** Decode one metadata child, queuing collections for bounded iterative traversal. */
function retainProperty(item, child, queue, unsupported) {
  const childPath = `${item.path}/${child.name}`;
  if (child.type === "value") {
    if (typeof child.value === "number" && !Number.isFinite(child.value)) {
      throw new Error(`Nonfinite physics metadata ${childPath}`);
    }
    item.output[child.name] = child.value;
  } else if (child.type === "Shape2D#Vector2D") {
    item.output[child.name] = { x: child.value.x, y: child.value.y };
  } else if (child.type === "Property" || child.type === "Shape2D#Convex2D") {
    if (item.depth >= MAX_DEPTH) {
      throw new Error(`Deep physics metadata ${childPath}`);
    }
    const target = Object.create(null);
    item.output[child.name] = target;
    queue.push({
      node: child,
      output: target,
      path: childPath,
      depth: item.depth + 1,
    });
  } else {
    item.output[child.name] = {
      type: child.type,
      value: child.value ?? null,
    };
    unsupported.push({
      path: childPath,
      reason: `Uninterpreted ${child.type} metadata retained`,
    });
  }
}
/** Preserve scalar/vector values and nested unknown metadata without parent cycles.
 * @param {WzNode|undefined} root @param {string} path @param {object[]} unsupported
 * @returns {Record<string, any>} */
function properties(root, path, unsupported) {
  const output = Object.create(null);
  if (!root) return output;
  const queue = [{ node: root, output, path, depth: 0 }];
  const visited = new Set();
  for (let index = 0; index < queue.length; index++) {
    if (index >= MAX_NODES) {
      throw new Error("Physics metadata exceeds node limit");
    }
    const item = queue[index];
    if (visited.has(item.node)) {
      throw new Error(`Cyclic physics metadata ${item.path}`);
    }
    visited.add(item.node);
    const children = Object.values(item.node.children);
    if (children.length + queue.length > MAX_NODES) {
      throw new Error("Physics metadata exceeds node limit");
    }
    for (const child of children) {
      retainProperty(item, child, queue, unsupported);
    }
  }
  return output;
}

/** Required original geometry has no guessed defaults.
 * @param {Record<string, any>} fields @param {string} key @param {string} path */
function number(fields, key, path) {
  const result = fields[key];
  if (!Number.isFinite(result)) {
    throw new Error(`Missing/nonfinite ${path}/${key}`);
  }
  return result;
}

/** @param {string} text @param {string} path */
function identifier(text, path) {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error(`Invalid geometry identifier ${path}/${text}`);
  }
  return Number(text);
}

/** @param {Record<string, any>} tree */
function footholds(tree) {
  const output = [];
  const ids = new Set();
  for (const [layer, groups] of Object.entries(tree)) {
    for (const [group, segments] of Object.entries(groups)) {
      for (const [key, fields] of Object.entries(segments)) {
        const path = `foothold/${layer}/${group}/${key}`;
        const id = identifier(key, path);
        if (ids.has(id)) throw new Error(`Duplicate foothold ${id}`);
        ids.add(id);
        output.push({
          id,
          layer: identifier(layer, path),
          group: identifier(group, path),
          x1: number(fields, "x1", path),
          y1: number(fields, "y1", path),
          x2: number(fields, "x2", path),
          y2: number(fields, "y2", path),
          prev: number(fields, "prev", path),
          next: number(fields, "next", path),
          properties: fields,
        });
      }
    }
  }
  return output;
}

/** Original l/uf are integer flags; preserve authored values, reject unsupported types. */
function ladderFlag(fields, key, path) {
  const flag = fields[key] === undefined ? 0 : fields[key];
  if (!Number.isSafeInteger(flag) || flag < -2147483648 || flag > 2147483647) {
    throw new Error(`Invalid ladder flag ${path}/${key}`);
  }
  return flag;
}

/** Original 00a43e7b reads l/uf/page with zero defaults; properties retain omissions.
 * @param {Record<string, any>} tree */
function ladders(tree) {
  const output = [];
  for (const [key, fields] of Object.entries(tree)) {
    const path = `ladderRope/${key}`;
    output.push({
      id: identifier(key, path),
      x: number(fields, "x", path),
      y1: number(fields, "y1", path),
      y2: number(fields, "y2", path),
      ladder: ladderFlag(fields, "l", path),
      uf: ladderFlag(fields, "uf", path),
      page: fields.page ?? 0,
      properties: fields,
    });
  }
  return output;
}

/** @param {Record<string, any>} tree */
function portals(tree) {
  const output = [];
  const ids = new Set();
  for (const [key, fields] of Object.entries(tree)) {
    const path = `portal/${key}`;
    const id = identifier(key, path);
    if (ids.has(id)) throw new Error(`Duplicate portal ${id}`);
    ids.add(id);
    output.push({
      id,
      x: number(fields, "x", path),
      y: number(fields, "y", path),
      name: fields.pn ?? null,
      type: fields.pt ?? null,
      targetMap: fields.tm ?? null,
      targetName: fields.tn ?? null,
    });
  }
  return output;
}

/** WZ object metadata duplicates some foothold flags; retain candidates without
 * claiming that the original runtime consumes editor-side copies.
 * @param {WzNode} map @param {object[]} unsupported */
function objectPhysics(map, unsupported) {
  const output = Object.create(null);
  let count = 0;
  for (const layer of Object.values(map.children)) {
    if (!/^\d+$/.test(layer.name)) continue;
    const objects = layer.children.obj?.children ?? {};
    for (const object of Object.values(objects)) {
      if (++count > MAX_NODES) {
        throw new Error("Map object metadata exceeds limit");
      }
      const fields = object.children;
      if (!fields.force && !fields.flow && !fields.forbidFallDown) continue;
      const path = `${layer.name}/obj/${object.name}`;
      output[path] = properties(object, path, unsupported);
      unsupported.push({
        path,
        reason:
          "Object force/flow/drop metadata retained; runtime consumer unresolved",
      });
    }
  }
  return output;
}

/** Retain unknown map sections without interpreting artwork or numbered layers.
 * @param {WzNode} map @param {object[]} unsupported */
function unrecognizedSections(map, unsupported) {
  const known = new Set([
    "info",
    "foothold",
    "ladderRope",
    "portal",
    "area",
    "back",
    "life",
    "reactor",
    "seat",
    "miniMap",
    "ToolTip",
    "clock",
  ]);
  const unknown = Object.create(null);
  for (const child of Object.values(map.children)) {
    if (known.has(child.name) || /^\d+$/.test(child.name)) continue;
    unknown[child.name] = child;
    unsupported.push({
      path: child.name,
      reason: "Unrecognized map section retained without interpretation",
    });
  }
  return unknown;
}

/** All collision metadata is returned together; no artwork or invented constants.
 * Unknown portal fields are retained under map.$portalProperties because the
 * interchange portal record has no properties slot. Unknown root metadata is
 * retained under map.$unrecognized, excluding recognized artwork/actor branches.
 * @param {WzNode} map @param {WzNode} physics */
export function readPhysicsData(map, physics) {
  const unsupported = [];
  const globals = properties(physics, "Map.wz/Physics.img", unsupported);
  const mapInfo = properties(map.children.info, "info", unsupported);
  const footholdTree = properties(
    map.children.foothold,
    "foothold",
    unsupported,
  );
  const ladderTree = properties(
    map.children.ladderRope,
    "ladderRope",
    unsupported,
  );
  const portalTree = properties(map.children.portal, "portal", unsupported);
  const areaTree = properties(map.children.area, "area", unsupported);
  const areas = [];
  for (const [id, fields] of Object.entries(areaTree)) {
    areas.push({
      id: /^\d+$/.test(id) ? identifier(id, "area") : id,
      properties: fields,
    });
  }
  const unknown = unrecognizedSections(map, unsupported);
  mapInfo.$portalProperties = portalTree;
  mapInfo.$seats = properties(map.children.seat, "seat", unsupported);
  mapInfo.$objectPhysics = objectPhysics(map, unsupported);
  mapInfo.$unrecognized = properties(
    { type: "Property", name: "map", parent: null, children: unknown },
    "map",
    unsupported,
  );
  return {
    schemaVersion: 1,
    globals,
    map: mapInfo,
    footholds: footholds(footholdTree),
    ladders: ladders(ladderTree),
    portals: portals(portalTree),
    areas,
    unsupported,
  };
}
