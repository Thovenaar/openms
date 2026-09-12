import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { compileNpcScript } from "../tools/npc-script-compiler.js";
import { NpcScriptSession } from "../src/npc/npc-script-runtime.js";
import { NpcInteractions } from "../src/npc/npc-interactions.js";
import { ProfileStore } from "../src/profile/profile-store.js";
import { createProfile } from "../src/profile/profile-validation.js";
import { grantItem, itemCount } from "../src/items/inventory-model.js";

const LOCATION = { mapId: "100000000", x: 0, y: 0, facing: 1 };
const ITEMS = {
  1040002: { id: 1040002, descriptor: {}, info: { islot: "Ma" } },
  1060002: { id: 1060002, descriptor: {}, info: { islot: "Pn" } },
  1072001: { id: 1072001, descriptor: {}, info: { islot: "So" } },
  1302000: { id: 1302000, descriptor: {}, info: { islot: "Wp" } },
  2000000: { id: 2000000, descriptor: {}, info: { slotMax: 100 } },
};

test("crafting flag rolls back with a failed debit and dispose resets it before later effects", async () => {
  const profile = store();
  const source = compilation(`
    function start() { cm.getPlayer().setCS(true); cm.sendYesNo("Craft?"); }
    function action() {
      if (cm.getPlayer().getCS()) {
        cm.getPlayer().setCS(false); cm.gainMeso(-5); cm.sendYesNo("Continue?");
      } else {
        cm.getPlayer().setCS(true); cm.dispose();
        if (cm.getPlayer().getCS()) { cm.gainMeso(-10); }
        else { cm.gainMeso(-1); }
      }
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    expect((await session.start()).ok).toBe(true);
    const submit = response(session, "yes");
    profile.revision = Number.MAX_SAFE_INTEGER;
    expect((await session.respond(submit)).ok).toBe(false);
    expect(profile.profile.meso).toBe(20);
    profile.revision = 0;
    expect((await session.respond(submit)).ok).toBe(true);
    expect(profile.profile.meso).toBe(15);
    expect((await session.respond(response(session, "yes"))).ok).toBe(true);
    expect(profile.profile.meso).toBe(14);
    expect(profile.profile.cash.balances).toEqual({
      credit: 0,
      points: 0,
      prepaid: 0,
    });
  } finally {
    await profile.destroy();
  }
});

test("nonboolean dynamic setCS rolls back earlier effects instead of coercing a crafting flag", async () => {
  const profile = store();
  const session = new NpcScriptSession(
    compilation(`
    function start() { cm.sendYesNo("Proceed?"); }
    function action(mode) {
      cm.gainMeso(-5); cm.getPlayer().setCS(mode); cm.dispose();
    }
  `),
    profile,
    environment(),
  );
  try {
    await session.start();
    expect((await session.respond(response(session, "yes"))).code).toBe(
      "npc-value",
    );
    expect(profile.profile.meso).toBe(20);
    expect(session.view.kind).toBe("yes-no");
  } finally {
    await profile.destroy();
  }
  expect(
    compilation('function start(){cm.getPlayer().setCS("true");cm.dispose();}')
      .status,
  ).toBe("blocked");
});

function compilation(text) {
  return compileNpcScript({
    text,
    path: "test/npc-transaction.js",
    sha256: createHash("sha256").update(text).digest("hex"),
  });
}

function environment() {
  return {
    npcId: 11000,
    items: ITEMS,
    quests: { schemaVersion: 1, records: {} },
    names: { npc: { 11000: "Test NPC" }, item: {}, mob: {} },
    mapNames: {},
    portraits: { 11000: {} },
    shops: {},
    artwork: new Set(),
    artworkMetadata: {},
    isCurrent: () => true,
    isBusy: () => false,
  };
}

function store() {
  const profile = createProfile(LOCATION);
  profile.meso = 20;
  return ProfileStore.memory(profile, { items: ITEMS });
}

function response(session, action, value) {
  return {
    sessionId: session.sessionId,
    revision: session.view.revision,
    action,
    ...(value === undefined ? {} : { value }),
  };
}

// Authorized Cosmic scripts/npc/2007.js: status changes correlate the sibling conditions.
const BEGINNER_SKIP_SOURCE = `function start() {
    status = -1;
    action(1, 0, 0);
}

function action(mode, type, selection) {
    if (mode == -1) {
        cm.sendNext("Enjoy your trip.");
        cm.dispose();
    } else {
        if (status == 0 && mode == 0) {
            cm.sendNext("Enjoy your trip.");
            cm.dispose();
        }
        if (mode == 1) {
            status++;
        } else {
            status--;
        }
        if (status == 0) {
            cm.sendYesNo("Would you like to skip the tutorials and head straight to Lith Harbor?");
        } else if (status == 1) {
            cm.warp(104000000, 0);
            cm.dispose();
        }
    }
}`;

test("authored beginner skip keeps correlated refusal separate from its destination turn", async () => {
  for (const action of ["no", "yes"]) {
    const profile = store();
    const session = new NpcScriptSession(
      compilation(BEGINNER_SKIP_SOURCE),
      profile,
      {
        ...environment(),
        mapNames: { 104000000: "Lith Harbor" },
        prepareTravel: async ({ mapId, portal }) => {
          expect(portal).toBe(0);
          return {
            isCurrent: () => true,
            apply: (draft) => {
              draft.location = { ...LOCATION, mapId: String(mapId) };
            },
            publish: () => {},
            release: () => {},
          };
        },
      },
    );
    try {
      expect((await session.start()).view.kind).toBe("yes-no");
      const result = await session.respond(response(session, action));
      expect(result.ok).toBe(true);
      expect(result.view.disposed).toBe(true);
      expect(profile.profile.location.mapId).toBe(
        action === "yes" ? "104000000" : LOCATION.mapId,
      );
      expect(result.view.kind).toBe(action === "yes" ? "closed" : "say");
    } finally {
      await profile.destroy();
    }
  }
});

test("uncertain conditional output paths retain the atomic runtime multi-view refusal", async () => {
  const source = compilation(`
    function start() {
      cm.gainMeso(-5);
      if (cm.getMeso() > 0) cm.sendOk("First");
      if (cm.getMeso() > 0) cm.sendOk("Second");
    }
  `);
  const profile = store();
  const session = new NpcScriptSession(source, profile, environment());
  try {
    const result = await session.start();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("npc-output");
    expect(profile.profile.meso).toBe(20);
    expect(session.view.kind).toBe("closed");
  } finally {
    await profile.destroy();
  }
  expect(
    compilation('function start() { cm.sendOk("First"); cm.sendOk("Second"); }')
      .status,
  ).toBe("blocked");
});

function interactionMenu(profile, route) {
  const surface = { current: null, errors: [] };
  const owner = {
    store: profile,
    scene: {},
    catalog: {
      ui: { items: ITEMS, npcPortraits: { 11000: {} }, bundles: {} },
      quests: {
        schemaVersion: 1,
        records: {},
        strings: { npc: { 11000: "Test NPC" }, item: {}, mob: {} },
      },
      mapNames: {},
    },
    quests: { npcEntries: () => [{ record: { id: 1009 } }] },
    isOperationPending: () => false,
    profileChanged() {},
    hooks: {
      isTransitioning: () => false,
      onError: (error) => surface.errors.push(error),
    },
    ui: {
      showNpc(record) {
        surface.current = { record, view: interactions.session?.view ?? null };
      },
      close(name) {
        surface.current = null;
        interactions.windowClosed(name);
      },
      status() {},
    },
  };
  const interactions = new NpcInteractions(owner, profile);
  interactions.references = { routing: { nameOverride: { value: "_unused" } } };
  interactions.routes = new Map([[11000, route]]);
  interactions.shops = new Map();
  return { interactions, surface };
}

test("a blocked talk route retains the quest menu and its live NPC lease", async () => {
  const profile = store();
  const { interactions, surface } = interactionMenu(profile, {
    status: "blocked",
    blockers: [
      { reason: "The authored route requires unavailable party authority" },
    ],
  });
  try {
    await interactions.open({
      id: "npc-1",
      templateId: 11000,
      name: "Test NPC",
      canInteract: () => true,
    });
    const menu = surface.current;
    const result = await menu.record.onTalk();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("party authority");
    expect(surface.current).toBe(menu);
    expect(interactions.isCurrent()).toBe(true);
    expect(interactions.session).toBeNull();
  } finally {
    interactions.destroy();
    await profile.destroy();
  }
});

test("a refused initial script debit leaves the quest menu usable without an active VM", async () => {
  const profile = store();
  const { interactions, surface } = interactionMenu(
    profile,
    compilation(`
    function start() { cm.gainMeso(-100); cm.dispose(); }
  `),
  );
  try {
    await interactions.open({
      id: "npc-1",
      templateId: 11000,
      name: "Test NPC",
      canInteract: () => true,
    });
    const menu = surface.current;
    expect((await menu.record.onTalk()).ok).toBe(false);
    expect(surface.current).toBe(menu);
    expect(profile.profile.meso).toBe(20);
    expect(interactions.session).toBeNull();
    expect(interactions.release()).toBe(true);
  } finally {
    interactions.destroy();
    await profile.destroy();
  }
});

test("a quest-menu talk choice enters the authored callback instead of hiding valid talk", async () => {
  const profile = store();
  const { interactions, surface } = interactionMenu(
    profile,
    compilation(`
    function start() { cm.sendSimple("#L42#Continue the conversation#l"); }
    function action(mode, type, selection) {
      if (selection === 42) { cm.sendOk("The authored answer"); cm.dispose(); }
    }
  `),
  );
  try {
    await interactions.open({
      id: "npc-1",
      templateId: 11000,
      name: "Test NPC",
      canInteract: () => true,
    });
    const menu = surface.current;
    expect((await menu.record.onTalk()).ok).toBe(true);
    expect(surface.current).not.toBe(menu);
    expect(surface.current.view.kind).toBe("choice");
    const result = await interactions.session.respond(
      response(interactions.session, "choose", 42),
    );
    expect(result.ok).toBe(true);
    expect(result.view.text).toBe("The authored answer");
  } finally {
    interactions.destroy();
    await profile.destroy();
  }
});

test("action return resumes start; nonordinal choice and late disposed effects remain exact", async () => {
  const profile = store();
  const source = compilation(`
    var status = 0;
    function start() { action(1, 0, 0); status += 100; }
    function action(mode, type, selection) {
      if (status === 0) { status = 1; cm.sendSimple("#L42#Authored choice"); return; }
      if (status === 101 && selection === 42) {
        cm.sendOk("Accepted"); cm.dispose(); cm.gainMeso(7);
      } else { cm.sendOk("Wrong source state"); cm.dispose(); }
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    const first = await session.start();
    expect(first.view.choices).toEqual([{ id: 42, text: "Authored choice" }]);
    const stale = response(session, "choose", 42);
    expect((await session.respond(response(session, "choose", 0))).ok).toBe(
      false,
    );
    const result = await session.respond(stale);
    expect(result.view.text).toBe("Accepted");
    expect(result.view.disposed).toBe(true);
    expect(profile.profile.meso).toBe(27);
    expect(result.effects).toEqual([{ kind: "meso", delta: 7, balance: 27 }]);
    expect((await session.respond(stale)).code).toBe("npc-stale");
    expect(
      (await session.respond(response(session, "acknowledge"))).view.kind,
    ).toBe("closed");
    expect(profile.profile.meso).toBe(27);
  } finally {
    await profile.destroy();
  }
});

test("failed save retains callback globals and view; pending lease prevents double submit and teardown", async () => {
  const profile = store();
  const source = compilation(`
    var status = 0;
    function start() { cm.sendYesNo("Pay?"); }
    function action(mode) {
      status++;
      if (status === 1) { cm.gainMeso(-5); cm.sendOk("Paid"); }
      else { cm.sendOk("Callback incorrectly advanced"); }
      cm.dispose();
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    await session.start();
    const previous = session.view,
      submit = response(session, "yes");
    profile.revision = Number.MAX_SAFE_INTEGER;
    const pending = session.respond(submit);
    expect(session.close().code).toBe("npc-busy");
    expect((await session.respond(submit)).code).toBe("npc-busy");
    expect((await pending).ok).toBe(false);
    expect(session.view).toBe(previous);
    expect(profile.profile.meso).toBe(20);
    profile.revision = 0;
    const retried = await session.respond(submit);
    expect(retried.view.text).toBe("Paid");
    expect(profile.profile.meso).toBe(15);
  } finally {
    await profile.destroy();
  }
});

test("a late inventory failure cannot publish an earlier dialog, disposal, or debit", async () => {
  const profile = store();
  const source = compilation(`
    function start() { cm.sendYesNo("Trade?"); }
    function action(mode) {
      cm.sendOk("Traded"); cm.dispose(); cm.gainMeso(-5); cm.gainItem(2000000, -2);
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    await profile.commitProfile((draft) => {
      grantItem(draft, ITEMS[2000000], 1);
    });
    await session.start();
    const previous = session.view,
      submit = response(session, "yes");
    expect((await session.respond(submit)).code).toBe("insufficient-items");
    expect(session.view).toBe(previous);
    expect(profile.profile.meso).toBe(20);
    expect(itemCount(profile.profile, 2000000)).toBe(1);
    await profile.commitProfile((draft) => {
      grantItem(draft, ITEMS[2000000], 1);
    });
    expect((await session.respond(submit)).view.text).toBe("Traded");
    expect(profile.profile.meso).toBe(15);
    expect(itemCount(profile.profile, 2000000)).toBe(0);
  } finally {
    await profile.destroy();
  }
});

test("admission rejects unknown unreachable operations and omitted executable dependencies", async () => {
  const profile = store();
  const source = compilation(`function start() {
    if (cm.haveItem(2000000)) { cm.sendOk("Present"); } else { cm.sendOk("Absent"); }
    cm.dispose();
  }`);
  try {
    const unknown = structuredClone(source);
    unknown.program.statements.push({
      op: "external-call",
      source: { start: 0, end: 0, line: 1, column: 0 },
    });
    expect(
      () => new NpcScriptSession(unknown, profile, environment()),
    ).toThrow();
    const missing = structuredClone(source);
    missing.dependencies.itemIds = [];
    expect(
      () => new NpcScriptSession(missing, profile, environment()),
    ).toThrow();
    expect(profile.profile.meso).toBe(20);
  } finally {
    await profile.destroy();
  }
});

test("artwork closure resolves aliases, nested finite array selections and whole path concatenations", () => {
  const source = compilation(`
    var directory = "UI/UIWindow.img/QuestIcon/";
    var entries = [["8", "4"], ["4", "8"]];
    var alias = entries;
    function start() {
      var path = directory + alias[cm.getMeso()][cm.getLevel()] + "/" + (1 - 1);
      cm.sendSimple("#L42#Fighter#l " + cm.getText() + "#F" + path + "#");
    }
  `);
  expect(source.status).toBe("supported");
  expect(source.dependencies.artworkPaths).toEqual([
    "UI/UIWindow.img/QuestIcon/4/0",
    "UI/UIWindow.img/QuestIcon/8/0",
  ]);
});

test("unbounded artwork fragments and cyclic path aliases refuse the entire source", () => {
  for (const text of [
    `function start() { cm.sendOk("#fUI/UIWindow.img/" + cm.getText() + "#"); cm.dispose(); }`,
    `var path = "UI/" + path; function start() { cm.sendOk("#f" + path + "#"); cm.dispose(); }`,
    `var text = "#"; function start() { text += "fUI/"; text += cm.getText(); text += "#"; cm.sendOk(text); cm.dispose(); }`,
  ]) {
    const source = compilation(text);
    expect(source.status).toBe("blocked");
    expect(source.program).toBeNull();
    expect(
      source.blockers.some((blocker) => blocker.reason.includes("Artwork")),
    ).toBe(true);
  }
});

test("quest title and objective markup close literal and concatenated quest IDs", () => {
  const source = compilation(`
    var targets = [210121, 210132];
    var titles = [2112, 2113];
    function start() {
      cm.sendOk("#y2111# #a210111# " + "#a" + targets[cm.getMeso()] + "# #y" + titles[cm.getMeso()] + "#");
      cm.dispose();
    }
  `);
  expect(source.status).toBe("supported");
  expect(source.dependencies.questIds).toEqual([
    2111, 2112, 2113, 21011, 21012, 21013,
  ]);
});

test("late dialog artwork refusal keeps the callback debit, globals and previous view atomic", async () => {
  const profile = store(),
    env = environment(),
    path = "UI/UIWindow.img/QuestIcon/4/0";
  env.artwork.add(path);
  env.artworkMetadata[path] = {
    descriptor: {},
    path,
    width: 1025,
    height: 1024,
  };
  const source = compilation(`
    var status = 0;
    function start() { cm.sendYesNo("Continue?"); }
    function action() {
      status++;
      cm.gainMeso(-5);
      if (status === 1) { cm.sendOk("#fUI/UIWindow.img/QuestIcon/4/0#"); }
      else { cm.sendOk("Incorrectly committed callback"); }
      cm.dispose();
    }
  `);
  const session = new NpcScriptSession(source, profile, env);
  try {
    await session.start();
    const previous = session.view,
      submit = response(session, "yes");
    expect((await session.respond(submit)).code).toBe("npc-dependency");
    expect(profile.profile.meso).toBe(20);
    expect(session.view).toBe(previous);
    env.artworkMetadata[path].width = 1024;
    expect((await session.respond(submit)).view.text).toBe(`#f${path}#`);
    expect(profile.profile.meso).toBe(15);
  } finally {
    await profile.destroy();
  }
});

test("rendered image count includes item icons and refuses before committing effects", async () => {
  const profile = store(),
    env = environment();
  env.items = {
    ...ITEMS,
    2000000: {
      ...ITEMS[2000000],
      iconPath: "icon",
      iconWidth: 32,
      iconHeight: 32,
    },
  };
  const source = compilation(`function start() {
    cm.gainMeso(-5); cm.sendOk("${"#i2000000#".repeat(64) + "#i2000000:#".repeat(65)}"); cm.dispose();
  }`);
  const session = new NpcScriptSession(source, profile, env);
  try {
    expect((await session.start()).code).toBe("npc-dependency");
    expect(profile.profile.meso).toBe(20);
  } finally {
    await profile.destroy();
  }
});

test("packaged artwork cannot authorize an undeclared source dependency", async () => {
  const profile = store(),
    env = environment(),
    path = "UI/UIWindow.img/QuestIcon/4/0";
  env.artwork.add(path);
  env.artworkMetadata[path] = { descriptor: {}, path, width: 32, height: 32 };
  const source = compilation(
    `function start() { cm.gainMeso(-5); cm.sendOk("#f${path}#"); cm.dispose(); }`,
  );
  source.dependencies.artworkPaths = [];
  const session = new NpcScriptSession(source, profile, env);
  try {
    expect((await session.start()).code).toBe("npc-dependency");
    expect(profile.profile.meso).toBe(20);
  } finally {
    await profile.destroy();
  }
});

function travelPublicationEnvironment(profile, counters) {
  return {
    ...environment(),
    mapNames: { 101000000: "Ellinia" },
    prepareTravel: async ({ mapId }) => ({
      isCurrent: () => true,
      apply: (draft) => {
        draft.location = { ...LOCATION, mapId: String(mapId) };
      },
      publish: () => {
        expect(profile.profile.meso).toBe(15);
        expect(itemCount(profile.profile, 2000000)).toBe(0);
        expect(profile.profile.location.mapId).toBe("101000000");
        expect(profile.profile.savedLocations.WORLDTOUR).toBe(
          Number(LOCATION.mapId),
        );
        counters.published++;
      },
      release: () => {
        counters.released++;
      },
    }),
  };
}

test("prepared NPC travel commits fare, ticket and destination together; failed save permits exact retry", async () => {
  const profile = store();
  const source = compilation(`
    var status = 0;
    function start() { cm.sendYesNo("Travel?"); }
    function action(mode) {
      status++;
      if (mode !== 1) { cm.dispose(); return; }
      if (status !== 1) { cm.sendOk("Wrong continuation"); return; }
      cm.gainMeso(-5); cm.gainItem(2000000, -1);
      cm.getPlayer().saveLocation("WORLDTOUR");
      cm.warp(101000000, 0); cm.dispose();
    }
  `);
  const counters = { published: 0, released: 0 };
  const env = travelPublicationEnvironment(profile, counters);
  const session = new NpcScriptSession(source, profile, env);
  try {
    await profile.commitProfile((draft) => grantItem(draft, ITEMS[2000000], 1));
    await session.start();
    const prior = session.view;
    const submit = response(session, "yes");
    profile.revision = Number.MAX_SAFE_INTEGER;
    expect((await session.respond(submit)).ok).toBe(false);
    expect(session.view).toBe(prior);
    expect(profile.profile.meso).toBe(20);
    expect(itemCount(profile.profile, 2000000)).toBe(1);
    expect(profile.profile.location.mapId).toBe(LOCATION.mapId);
    expect(profile.profile.savedLocations.WORLDTOUR).toBeNull();
    expect(counters.published).toBe(0);
    expect(counters.released).toBe(1);
    profile.revision = 0;
    expect((await session.respond(submit)).ok).toBe(true);
    expect(counters.published).toBe(1);
    expect(counters.released).toBe(2);
  } finally {
    await profile.destroy();
  }
});

test("failed NPC field loading never debits fare or consumes the current continuation", async () => {
  const profile = store();
  const source = compilation(`
    function start() { cm.sendYesNo("Travel?"); }
    function action(mode) {
      cm.gainMeso(-5);
      var destination = cm.getPlayer().getSavedLocation("WORLDTOUR");
      cm.warp(destination, 0); cm.dispose();
    }
  `);
  const session = new NpcScriptSession(source, profile, {
    ...environment(),
    mapNames: { 101000000: "Ellinia" },
    prepareTravel: async () => {
      throw new Error("Destination fetch failed");
    },
  });
  try {
    await profile.commitProfile((draft) => {
      draft.savedLocations.WORLDTOUR = 101000000;
    });
    await session.start();
    const prior = session.view;
    expect((await session.respond(response(session, "yes"))).ok).toBe(false);
    expect(profile.profile.meso).toBe(20);
    expect(profile.profile.location.mapId).toBe(LOCATION.mapId);
    expect(profile.profile.savedLocations.WORLDTOUR).toBe(101000000);
    expect(session.view).toBe(prior);
  } finally {
    await profile.destroy();
  }
});

test("pure bounded helpers preserve first return and global lexical reads", async () => {
  const profile = store();
  const source = compilation(`
    var destinations = [101000000, 100000000];
    var fees = [30, 7];
    function indexOfMap(mapid) {
      for (var i = 0; i < destinations.length; i++) {
        if (mapid == destinations[i]) return i;
      }
      return 0;
    }
    function start() {
      cm.sendYesNo("Travel?");
    }
    function action() {
      var destinations = [999999999];
      cm.gainMeso(-fees[indexOfMap(cm.getPlayer().getMapId())]);
      cm.sendOk("Paid"); cm.dispose();
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    await session.start();
    expect((await session.respond(response(session, "yes"))).ok).toBe(true);
    expect(profile.profile.meso).toBe(13);
  } finally {
    await profile.destroy();
  }
});

test("nested destination arrays survive null guards and preserve selected travel fare", async () => {
  const profile = store();
  // 9201135's array-valued toMap[location] passes its source88 guard before selection.
  const source = compilation(`
    var toMap = [100000000, [101000000, 100000000]];
    var costs = [0, [7, 0]];
    var location = 1;
    function start() { cm.sendSimple("#L0#Paid trip#l#L1#Return#l"); }
    function action(mode, type, selection) {
      if (toMap[location] == null) { cm.dispose(); return; }
      if (null == toMap[location]) { cm.dispose(); return; }
      if (toMap[location] != null && toMap[location] instanceof Array) {
        var maps = toMap[location];
        cm.gainMeso(-costs[location][selection]);
        cm.sendOk("Destination " + maps[selection]); cm.dispose();
      }
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    expect((await session.start()).ok).toBe(true);
    const result = await session.respond(response(session, "choose", 0));
    expect(result.ok).toBe(true);
    expect(result.view.text).toBe("Destination 101000000");
    expect(profile.profile.meso).toBe(13);
  } finally {
    await profile.destroy();
  }
});

test("helper-local hoisting does not read the caller or global binding", async () => {
  const profile = store();
  const source = compilation(`
    var value = 7;
    function h(flag) { if (flag) return value; var value = 2; return value; }
    function start() { cm.sendOk("" + h(true)); }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    expect((await session.start()).view.text).toBe("undefined");
  } finally {
    await profile.destroy();
  }
});

test("helper bounds refuse reassigned or shadowed global arrays", () => {
  const helper = `function f(v) {
    for (var i = 0; i < a.length; i++) { if (a[i] == v) return i; }
    return -1;
  }`;
  expect(
    compilation(`var a=[1]; ${helper}
    function start(){a=[1,2];cm.sendOk(""+f(2));}`).status,
  ).toBe("blocked");
  expect(
    compilation(`var a=[1]; function f(a) {
    for(var i=0;i<a.length;i++){if(a[i]==2)return i;} return -1;
  } function start(){cm.sendOk(""+f([1,2]));}`).status,
  ).toBe("blocked");
});

test("fixed-slot array lowering refuses loop-carried aliases", () => {
  expect(
    compilation(`
    var a=[0], saved;
    function start() {
      for(var i=0;i<2;i++){a[0]=i;if(i==0)saved=a;}
      cm.sendOk(""+saved[0]);
    }
  `).status,
  ).toBe("blocked");
});

test("helper admission checks discarded calls and eager error paths", () => {
  expect(
    compilation(`var fake=0;
    function h(){var ignored=fake.getMapId();return 1;}
    function start(){cm.sendOk(""+h());}`).status,
  ).toBe("blocked");
  expect(
    compilation(`var a=null;function h(x){return 1;}
    function start(){cm.sendOk(""+h(a[0]));}`).status,
  ).toBe("blocked");
  expect(
    compilation(`var a=null;
    function h(){var ignored=a[0];return 1;}
    function start(){cm.sendOk(""+h());}`).status,
  ).toBe("blocked");
});

test("array equality refuses implicit string conversion without committing earlier effects", async () => {
  const profile = store();
  const source = compilation(`
    function start() {
      var values = [1]; cm.gainMeso(-5);
      cm.sendOk("" + (values == "1"));
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    expect((await session.start()).code).toBe("npc-value");
    expect(profile.profile.meso).toBe(20);
  } finally {
    await profile.destroy();
  }
});

test("unreachable recursive helpers remain outside complete-source admission", () => {
  expect(
    compilation(`function h(){return h();}
    function start(){cm.sendOk("Ready");}`).status,
  ).toBe("blocked");
});

test("low-ID post-warp reads preserve numeric saved locations and nine-digit profile identity", async () => {
  const profile = store();
  const source = compilation(`
    function start() {
      cm.warp(40000);
      cm.getPlayer().saveLocation("WORLDTOUR");
      if (cm.getPlayer().getMapId() == 40000) cm.gainMeso(-5);
      cm.dispose();
    }
  `);
  const session = new NpcScriptSession(source, profile, {
    ...environment(),
    mapNames: { 40000: "In a Small Forest" },
    prepareTravel: async () => ({
      isCurrent: () => true,
      apply: (draft) => {
        draft.location.x = 42;
      },
      publish: () => {
        expect(profile.profile.savedLocations.WORLDTOUR).toBe(40000);
        expect(profile.profile.location.x).toBe(42);
      },
      release: () => {},
    }),
  });
  try {
    expect((await session.start()).ok).toBe(true);
    expect(profile.profile.savedLocations.WORLDTOUR).toBe(40000);
    expect(profile.profile.location.mapId).toBe("000040000");
    expect(profile.profile.meso).toBe(15);
  } finally {
    await profile.destroy();
  }
});

test("array equality preserves reference identity without coercion", async () => {
  const profile = store();
  const source = compilation(`
    var values = [1], alias = values, other = [1];
    function start() {
      if (values == alias && values === alias && values != other && values !== other &&
          values !== null && values != undefined) cm.gainMeso(-5);
      cm.dispose();
    }
  `);
  const session = new NpcScriptSession(source, profile, environment());
  try {
    expect((await session.start()).ok).toBe(true);
    expect(profile.profile.meso).toBe(15);
  } finally {
    await profile.destroy();
  }
});

test("unused helper arguments still read lexical bindings and roll back the entire turn", async () => {
  const profile = store();
  const before = structuredClone(profile.profile);
  const session = new NpcScriptSession(
    compilation(`
    function unused(value) { return 1; }
    function start() {
      cm.gainMeso(1);
      cm.sendOk("" + unused(value));
      let value = 7;
    }
  `),
    profile,
    environment(),
  );
  const previousView = session.view;
  try {
    expect(await session.start()).toMatchObject({
      ok: false,
      code: "npc-scope",
    });
    expect(profile.profile).toEqual(before);
    expect(session.view).toEqual(previousView);
  } finally {
    await profile.destroy();
  }
});

test("helper frames evaluate array arguments and locals once without sharing separate calls", async () => {
  const profile = store();
  const session = new NpcScriptSession(
    compilation(`
    function same(value) { return value === value; }
    function local() { var value = [1]; var alias = value; return value === alias; }
    function nested(value) { return same([1]) && value === value; }
    function make() { var value = [1]; return value; }
    function start() {
      cm.sendOk("" + same([1]) + "," + local() + "," + nested([2]) + "," +
        (make() === make()));
    }
  `),
    profile,
    environment(),
  );
  try {
    const result = await session.start();
    expect(result.ok).toBe(true);
    expect(result.view.text).toBe("true,true,true,false");
  } finally {
    await profile.destroy();
  }
});

test("start-owned fixed array writes remain admitted inside lexical blocks", async () => {
  const profile = store();
  const session = new NpcScriptSession(
    compilation(`
    var values = [0];
    function start() {
      { values[0] = 7; }
      cm.sendOk("" + values[0]);
    }
  `),
    profile,
    environment(),
  );
  try {
    const result = await session.start();
    expect(result.ok).toBe(true);
    expect(result.view.text).toBe("7");
  } finally {
    await profile.destroy();
  }
});
