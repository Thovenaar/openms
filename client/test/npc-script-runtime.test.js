import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { compileNpcScript } from "../tools/npc-script-compiler.js";
import { NpcScriptSession } from "../src/npc-script-runtime.js";
import { ProfileStore } from "../src/profile-store.js";
import { createProfile } from "../src/profile-validation.js";
import { grantItem, itemCount } from "../src/inventory-model.js";

const LOCATION = { mapId: "100000000", x: 0, y: 0, facing: 1 };
const ITEMS = {
  1040002: { id: 1040002, descriptor: {}, info: { islot: "Ma" } },
  1060002: { id: 1060002, descriptor: {}, info: { islot: "Pn" } },
  1072001: { id: 1072001, descriptor: {}, info: { islot: "So" } },
  1302000: { id: 1302000, descriptor: {}, info: { islot: "Wp" } },
  2000000: { id: 2000000, descriptor: {}, info: { slotMax: 100 } },
};

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
    cm.gainMeso(-5); cm.sendOk("${"#i2000000#".repeat(129)}"); cm.dispose();
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
