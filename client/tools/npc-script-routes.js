const MAX_ROUTES = 10000;
const MAX_SHOP_ROWS = 200000;
const MAX_DEPENDENCIES = 32768;
const DEPENDENCY_FIELDS = [
  "itemIds",
  "questIds",
  "shopIds",
  "npcIds",
  "mapIds",
  "mobIds",
  "artworkPaths",
];
const ROUTE_SOURCE =
  "src/main/java/net/server/channel/handlers/NPCTalkHandler.java";
const SHOP_SOURCE = "src/main/java/server/Shop.java";
const NAME_OVERRIDE = Object.freeze({
  field: "npcName",
  operator: "ends-with",
  value: "Maple TV",
  script: "mapleTV",
});

/** NPCTalkHandler + constants/id/NpcId, not inferred from SQL/script filenames. */
export const NPC_ROUTING_POLICY = Object.freeze({
  source: ROUTE_SOURCE,
  precedence: [
    "duey",
    "gachapon",
    "maple-tv-name",
    "numeric-script",
    "standard-shop-fallback",
  ],
  duey: {
    npcId: 9010009,
    status: "blocked",
    reason: "DueyProcessor requires a real parcel service",
  },
  gachapon: {
    minNpcId: 9100100,
    maxNpcId: 9100117,
    script: "gachapon",
    status: "blocked",
    reason:
      "Named gachapon override requires random reward and remote/server authority",
  },
  nameOverride: NAME_OVERRIDE,
  missingName:
    "block-until-original-npc-name-resolves; never bypass name override",
  missingNumericScript: "only-case-allowing-SQL-fallback",
  blockedNumericScript: "never-fall-back-to-SQL",
});

function routeProblem(route, source, reason) {
  route.blockers.push({ source, reason });
  route.status = "blocked";
  route.program = null;
}

function specialRoute(route) {
  if (route.npcId === NPC_ROUTING_POLICY.duey.npcId) {
    route.precedence = "duey";
    routeProblem(route, ROUTE_SOURCE, NPC_ROUTING_POLICY.duey.reason);
  } else if (
    route.npcId >= NPC_ROUTING_POLICY.gachapon.minNpcId &&
    route.npcId <= NPC_ROUTING_POLICY.gachapon.maxNpcId
  ) {
    route.precedence = "gachapon";
    routeProblem(route, ROUTE_SOURCE, NPC_ROUTING_POLICY.gachapon.reason);
  }
}

function scriptFields(compilation) {
  if (!compilation) {
    return {
      status: "supported",
      source: null,
      numericScript: null,
      blockers: [],
      requirements: [],
      dependencies: {
        itemIds: [],
        questIds: [],
        shopIds: [],
        npcIds: [],
        mapIds: [],
        mobIds: [],
        artworkPaths: [],
      },
      program: null,
    };
  }
  return {
    status: compilation.status,
    source: compilation.source,
    numericScript: compilation.source.path,
    blockers: [...compilation.blockers],
    requirements: compilation.requirements,
    dependencies: compilation.dependencies,
    program: compilation.program,
  };
}

function sourceRoute(npcId, compilation, shops) {
  const route = {
    npcId,
    precedence: compilation ? "numeric-script" : "standard-shop-fallback",
    ...scriptFields(compilation),
    sqlShopIds: shops.map((shop) => shop.shopid),
    guard: { resolvedNpcNameRequired: true, rejectNameOverride: NAME_OVERRIDE },
    shopId: null,
  };
  if (!compilation) {
    if (shops.length !== 1) {
      routeProblem(
        route,
        SHOP_SOURCE,
        `SQL NPC mapping is ${shops.length ? "ambiguous" : "absent"}; no deterministic authored fallback`,
      );
    } else {
      route.shopId = shops[0].shopid;
      route.dependencies.shopIds.push(route.shopId);
    }
  }
  specialRoute(route);
  return route;
}

function validShop(shop) {
  return (
    Number.isSafeInteger(shop.shopid) &&
    shop.shopid > 0 &&
    Number.isSafeInteger(shop.npcid) &&
    shop.npcid > 0
  );
}

function validShopItem(row) {
  return (
    [row.itemid, row.price, row.pitch, row.position].every(
      Number.isSafeInteger,
    ) &&
    row.itemid > 0 &&
    row.price >= 0 &&
    row.pitch >= 0
  );
}

function indexShops(tables) {
  if (
    tables.shops.length > MAX_ROUTES ||
    tables.shopitems.length > MAX_SHOP_ROWS
  ) {
    throw new Error("NPC route/SQL shop row limit");
  }
  const byId = new Map(),
    byNpc = new Map(),
    rows = new Map();
  for (const shop of tables.shops) {
    if (!validShop(shop) || byId.has(shop.shopid)) {
      throw new Error("Invalid or duplicate authored SQL shop identity");
    }
    byId.set(shop.shopid, shop);
    if (!byNpc.has(shop.npcid)) byNpc.set(shop.npcid, []);
    byNpc.get(shop.npcid).push(shop);
    rows.set(shop.shopid, []);
  }
  for (let index = 0; index < tables.shopitems.length; index++) {
    const row = tables.shopitems[index];
    if (!rows.has(row.shopid) || !validShopItem(row)) {
      throw new Error(
        `Invalid/orphan authored SQL shop item at source row ${index}`,
      );
    }
    rows.get(row.shopid).push(index);
  }
  return { byId, byNpc, rows };
}

function closeRoute(route, shops, tables) {
  if (route.status !== "supported") return;
  const itemIds = new Set(route.dependencies.itemIds),
    shopRows = [];
  for (const id of route.dependencies.shopIds) {
    if (!shops.byId.has(id)) {
      routeProblem(
        route,
        route.source?.path ?? SHOP_SOURCE,
        `Authored shop ${id} is absent; Cosmic emergency shop11000 fallback is not local authority`,
      );
      return;
    }
    for (const index of shops.rows.get(id)) {
      const row = tables.shopitems[index];
      itemIds.add(row.itemid);
      if (row.pitch > 0) itemIds.add(4000517);
      shopRows.push(index);
    }
  }
  route.dependencies = {
    ...route.dependencies,
    itemIds: [...itemIds].sort((a, b) => a - b),
  };
  route.shopItemRows = shopRows;
}

function authoredShopIndex(tables, shops) {
  return [...shops.byId.values()].map((shop) => ({
    shopId: shop.shopid,
    npcId: shop.npcid,
    itemRows: [...shops.rows.get(shop.shopid)].sort(
      (left, right) =>
        tables.shopitems[right].position - tables.shopitems[left].position ||
        left - right,
    ),
  }));
}

function indexScripts(compilations, shops) {
  const scripts = new Map(),
    namedScripts = {},
    npcIds = new Set(shops.byNpc.keys());
  if (compilations.length > MAX_ROUTES) {
    throw new Error("NPC script route limit");
  }
  for (const compilation of compilations) {
    const named = /^scripts\/npc\/(gachapon|mapleTV)\.js$/.exec(
      compilation.source.path,
    );
    if (named) namedScripts[named[1]] = { ...compilation };
    const match = /^scripts\/npc\/([1-9]\d*)\.js$/.exec(
      compilation.source.path,
    );
    if (!match) continue;
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id > 2147483647 || scripts.has(id)) {
      throw new Error("Invalid/duplicate numeric NPC override");
    }
    scripts.set(id, compilation);
    npcIds.add(id);
  }
  if (npcIds.size > MAX_ROUTES) throw new Error("NPC route limit");
  return { scripts, namedScripts, npcIds };
}

/** One canonical summary closes every admitted route, not only selected map NPCs. */
function supportedDependencies(routes, namedScripts) {
  const sets = Object.fromEntries(
    DEPENDENCY_FIELDS.map((key) => [key, new Set()]),
  );
  for (const route of [...routes, ...Object.values(namedScripts)]) {
    if (route.status !== "supported") continue;
    if (route.npcId) sets.npcIds.add(route.npcId);
    for (const key of DEPENDENCY_FIELDS) {
      const values = route.dependencies[key] ?? [];
      if (values.length > MAX_DEPENDENCIES) {
        throw new Error(`NPC ${key} closure limit`);
      }
      for (const value of values) sets[key].add(value);
      if (sets[key].size > MAX_DEPENDENCIES) {
        throw new Error(`NPC ${key} closure limit`);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(sets).map(([key, values]) => [
      key,
      [...values].sort((a, b) =>
        typeof a === "number" ? a - b : a.localeCompare(b),
      ),
    ]),
  );
}

/** Numeric overrides are one route per NPC, never one competing route per SQL row. */
export function compileNpcRoutes(tables, compilations) {
  const shops = indexShops(tables),
    { scripts, namedScripts, npcIds } = indexScripts(compilations, shops);
  const routes = [];
  for (const npcId of [...npcIds].sort((a, b) => a - b)) {
    const route = sourceRoute(
      npcId,
      scripts.get(npcId),
      shops.byNpc.get(npcId) ?? [],
    );
    closeRoute(route, shops, tables);
    routes.push(route);
  }
  for (const named of Object.values(namedScripts)) {
    closeRoute(named, shops, tables);
  }
  const dependencies = supportedDependencies(routes, namedScripts);
  return {
    schemaVersion: 2,
    routing: NPC_ROUTING_POLICY,
    npcRoutes: routes,
    namedScripts,
    shopIndex: authoredShopIndex(tables, shops),
    supportedItemIds: dependencies.itemIds,
    supportedDependencies: dependencies,
    routeSummary: {
      numericAndSql: routes.length,
      supported: routes.filter((route) => route.status === "supported").length,
      blocked: routes.filter((route) => route.status === "blocked").length,
      named: Object.keys(namedScripts).length,
      requiredMetadata: Object.fromEntries(
        Object.entries(dependencies).map(([key, values]) => [
          key,
          values.length,
        ]),
      ),
    },
    ordering: {
      source: `${SHOP_SOURCE}:268`,
      primary: "position DESC",
      tiePolicy:
        "source-row-order (browser deterministic policy; SQL leaves ties unspecified)",
      rowReference: "zero-based tables.shopitems index",
    },
    generatedRechargeRows: {
      source: `${SHOP_SOURCE}:272-285`,
      status: "not-published",
      reason:
        "Server-generated rechargeable additions are not authored SQL rows",
    },
  };
}
