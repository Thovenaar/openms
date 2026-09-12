import { expect, test } from "bun:test";
import {
  PortalSystem,
  PortalTravelGate,
  portalRouteStatus,
  resolveMarketTravel,
  selectMarketReturnPortal,
} from "../src/world/portal-system.js";
import { TUTORIAL_PORTAL_PROGRAMS } from "../src/npc/npc-script-portals.js";
import { compileTutorialPortal } from "../tools/portal-data.js";
import { NpcInteractions } from "../src/npc/npc-interactions.js";

test("portal admission is response-timed and stale completions cannot release a successor", () => {
  let now = 0;
  const gate = new PortalTravelGate(() => now);
  const first = gate.tryBegin(true);
  now = 1000;
  expect(gate.tryBegin(true)).toBeNull();
  gate.complete(first);
  now = 1499;
  expect(gate.tryBegin(true)).toBeNull();
  now = 1500;
  const second = gate.tryBegin(true);
  expect(second).not.toBeNull();
  expect(gate.complete(first)).toBe(false);
  expect(gate.snapshot().pending).toBe(true);
  gate.complete(second, "failed");
  now = 1999;
  expect(gate.tryBegin(true)).toBeNull();
  now = 2000;
  expect(gate.tryBegin(true)).not.toBeNull();
});

test("same-map recovery holds for600ms and explicit cancellation aborts the owned request", () => {
  let now = 0;
  const gate = new PortalTravelGate(() => now);
  const first = gate.tryBegin(false);
  gate.complete(first);
  now = 599;
  expect(gate.tryBegin(false)).toBeNull();
  now = 600;
  const next = gate.tryBegin(false);
  expect(next).not.toBeNull();
  expect(gate.cancel(next)).toBe(true);
  expect(next.signal.aborted).toBe(true);
  expect(gate.snapshot().pending).toBe(false);
  expect(gate.cancel(first)).toBe(false);
});

test("market scripts distinguish entry from return and resolve the authored return portal ID", () => {
  const portal = { id: 21, name: "market00", type: 7, targetMap: 999999999 };
  expect(portalRouteStatus(portal, { script: "market01" })).toBeNull();
  expect(portalRouteStatus(portal, { script: "market25" })).toBe(
    "server-script-unavailable",
  );
  expect(
    portalRouteStatus({ ...portal, type: 9 }, { script: "market01" }),
  ).toBe("server-script-unavailable");
  const profile = {
    location: { mapId: "100000100" },
    savedLocations: { FREE_MARKET: null },
  };
  const entry = resolveMarketTravel(
    { script: "market01", sourceMapId: "100000100" },
    profile,
  );
  expect(entry).toEqual({
    mapId: "910000000",
    portal: "out00",
    savedLocation: 100000100,
  });
  expect(profile.savedLocations.FREE_MARKET).toBeNull();
  profile.location.mapId = "910000000";
  profile.savedLocations.FREE_MARKET = entry.savedLocation;
  const back = resolveMarketTravel(
    { script: "market00", sourceMapId: "910000000" },
    profile,
  );
  expect(back).toEqual({
    mapId: "100000100",
    portal: { marketReturn: true },
    savedLocation: null,
  });
  expect(profile.savedLocations.FREE_MARKET).toBe(100000100);
  expect(
    selectMarketReturnPortal({
      portals: [{ id: 0, name: "sp", type: 0, targetMap: 999999999 }, portal],
      map: { $portalProperties: { 21: { script: "market01" } } },
    }),
  ).toBe(21);
  expect(() =>
    resolveMarketTravel(
      { script: "market01", sourceMapId: "910000000" },
      profile,
    ),
  ).toThrow();
  profile.savedLocations.FREE_MARKET = null;
  expect(
    resolveMarketTravel(
      { script: "market00", sourceMapId: "910000000" },
      profile,
    ),
  ).toEqual({ mapId: "100000000", portal: 0, savedLocation: null });
});

const TUTOR_CHAT_SOURCE =
  "function enter(pi) {\n" +
  "    if (pi.hasLevel30Character()) {\n" +
  "        pi.openNpc(2007);\n" +
  "    }\n" +
  "    pi.blockPortal();\n" +
  "    return true;\n" +
  "}";

function tutorialScene(program = TUTORIAL_PORTAL_PROGRAMS.tutoChatNPC) {
  return {
    manifest: {
      id: "000010000",
      physics: {
        portals: [
          {
            id: 4,
            name: "tuto00",
            type: 9,
            x: -95,
            y: 428,
            targetMap: 999999999,
            targetName: "",
          },
        ],
        map: {
          $portalProperties: { 4: { script: "tutoChatNPC", onlyOnce: 1 } },
        },
      },
      portalPresentation: {
        schemaVersion: 1,
        records: [
          {
            portalId: 4,
            entityId: null,
            status: "metadata-only",
            tutorialProgram: program,
          },
        ],
      },
    },
    simulation: { x: -93, y: 450, footholdId: 1, action: "stand" },
  };
}

function tutorialRuntime(eligible, openTutorialNpc = async () => {}) {
  const errors = [];
  const scene = tutorialScene();
  const gate = new PortalTravelGate(() => 1000);
  const system = new PortalSystem(scene, {
    travelGate: gate,
    travel: () => {
      throw new Error("Tutorial must not directly warp");
    },
    onError: (error) => errors.push(error),
    getProfile: () => ({ location: { mapId: scene.manifest.id }, quests: {} }),
    hasLevel30Character: async () => eligible,
    openTutorialNpc,
  });
  return { system, scene, gate, errors };
}

test("tutorial source admission rejects a changed account gate and altered packaged program", () => {
  expect(
    compileTutorialPortal({
      script: "tutoChatNPC",
      text: TUTOR_CHAT_SOURCE,
    }),
  ).toEqual(TUTORIAL_PORTAL_PROGRAMS.tutoChatNPC);
  expect(() =>
    compileTutorialPortal({
      script: "tutoChatNPC",
      text: TUTOR_CHAT_SOURCE.replace("hasLevel30Character()", "true"),
    }),
  ).toThrow();
  const altered = {
    ...TUTORIAL_PORTAL_PROGRAMS.tutoChatNPC,
    openNpc: { npcId: 2007, minimumAccountLevel: 1 },
  };
  expect(
    () =>
      new PortalSystem(tutorialScene(altered), {
        travel: () => {},
        onError: () => {},
        travelGate: new PortalTravelGate(),
      }),
  ).toThrow();
});

test("beginner tutorial overlap silently blocks ineligible account without travel or dialogue", async () => {
  let opened = false;
  const { system, scene, gate, errors } = tutorialRuntime(false, async () => {
    opened = true;
  });
  system.update(30, { upPressed: false });
  await Bun.sleep(0);
  expect(errors).toEqual([]);
  expect(opened).toBe(false);
  expect(scene.manifest.id).toBe("000010000");
  expect(gate.blockedScripts.has("tutoChatNPC")).toBe(true);
  system.update(30, { upPressed: false });
  expect(system.requests).toBe(1);
  system.destroy();
});

test("eligible tutorial offers the authored NPC once, but a failed opening remains retryable", async () => {
  let available = false;
  const opened = [];
  const { system, scene, gate, errors } = tutorialRuntime(true, async (id) => {
    if (!available) throw new Error("NPC asset unavailable");
    opened.push(id);
  });
  system.update(30, { upPressed: false });
  await Bun.sleep(0);
  expect(errors.length).toBe(1);
  expect(gate.blockedScripts.has("tutoChatNPC")).toBe(false);
  expect(scene.manifest.id).toBe("000010000");
  available = true;
  // Failed automatic overlap requires exit/reentry; settlement recovery still applies.
  gate.clock = () => 2000;
  scene.simulation.x = 100;
  system.update(30, { upPressed: false });
  scene.simulation.x = -93;
  system.update(30, { upPressed: false });
  await Bun.sleep(0);
  expect(opened).toEqual([2007]);
  expect(gate.blockedScripts.has("tutoChatNPC")).toBe(true);
  expect(scene.manifest.id).toBe("000010000");
  system.destroy();
});

test("a failed portal-opened NPC load can retry instead of retaining a ghost conversation", async () => {
  const store = { profile: { hp: 50 } };
  const owner = {
    store,
    scene: { manifest: { id: "000010000" } },
    catalog: {
      quests: { strings: { npc: { 2007: "Tutor" } } },
      serverData: { datasets: { shops: {} } },
    },
    isOperationPending: () => false,
    services: {
      network: {
        json: async () => {
          throw new Error("Reference transport unavailable");
        },
      },
    },
  };
  const npc = new NpcInteractions(owner, store);
  const options = {
    signal: new AbortController().signal,
    source: "scripts/portal/tutoChatNPC.js",
    sourceMapId: "000010000",
  };
  await expect(npc.openPortal(2007, options)).rejects.toThrow();
  await expect(npc.openPortal(2007, options)).rejects.toThrow();
  npc.destroy();
});
