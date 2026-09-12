import { expect, test } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { GameDiagnostics } from "../src/development/game-diagnostics.js";
import {
  AgentScenarios,
  validateScenarioRecording,
} from "../src/development/agent-scenarios.js";
import { createProfile } from "../src/profile/profile-validation.js";
import { createAccountStorage } from "../src/profile/account-storage.js";
import {
  createSimulation,
  advanceSimulation,
} from "../src/physics/simulation.js";

function recording() {
  return {
    schemaVersion: 2,
    mode: "native-fixed-tick",
    quantumMs: 30,
    buildId: "diagnostic-regression",
    spec: {
      mapId: "100000000",
      profile: createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 }),
      characterId: "local",
      accountStorage: createAccountStorage(),
      peers: [],
      seed: 1,
    },
    initialUI: {
      windows: [],
      positions: [],
      viewport: { width: 800, height: 600 },
    },
    actions: [],
    totalTicks: 0,
  };
}

function nativeEvent() {
  return {
    type: "mousedown",
    root: 0,
    path: [],
    tag: "CANVAS",
    label: "",
    code: "",
    key: "",
    pointerType: "",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    button: 0,
    buttons: 1,
    pointerId: 0,
    isPrimary: false,
    x: 0.5,
    y: 0.5,
    value: null,
    checked: null,
    selectionStart: null,
    selectionEnd: null,
    detail: 2,
    keyCode: 0,
    deltaY: 0,
    scrollTop: 0,
    scrollLeft: 0,
    related: null,
  };
}

// No DOM listener is needed to exercise the journal/export owner in isolation.
function journal() {
  return Object.assign(Object.create(GameDiagnostics.prototype), {
    hooks: {
      identity: () => ({ buildId: "diagnostic-regression" }),
      context: () => ({}),
    },
    baseline: recording(),
    actions: [],
    ticks: 0,
    clockTicks: 0,
    limitation: "",
    replaying: false,
    capturing: false,
  });
}

test("export includes a second executed quantum whose consumer fails before journaling", () => {
  const diagnostics = journal();
  const simulation = createSimulation(
    {
      schemaVersion: 1,
      globals: original.globals,
      ladders: [],
      map: {},
      footholds: [
        {
          id: 1,
          layer: 1,
          group: 0,
          x1: -1000,
          y1: 100,
          x2: 1000,
          y2: 100,
          prev: 0,
          next: 0,
          properties: {},
        },
      ],
    },
    { x: 0, y: 0 },
  );
  const input = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    attack: false,
    jumpPressed: false,
  };
  const failure = new Error("second-quantum consumer failure");
  const before = diagnostics.ticks;
  const physicalBefore = simulation.diagnostics.ticks;
  let consumers = 0;
  expect(() =>
    advanceSimulation(simulation, input, 60, () => {
      consumers++;
      if (consumers === 2) {
        throw failure;
      }
      diagnostics.tick();
    }),
  ).toThrow(failure);
  diagnostics.simulationFailure(
    before,
    simulation.diagnostics.ticks - physicalBefore,
  );
  diagnostics.capture(failure.message);
  const dump = JSON.parse(diagnostics.exportJSON());
  expect(dump.replayable).toBe(true);
  expect(dump.recording.totalTicks).toBe(2);
  expect(dump.errors).toEqual([failure.message]);
});

test("corrupt native event data cannot retire an already active world or execute accessors", async () => {
  const retained = { mapId: "100000000", profile: recording().spec.profile };
  let owner = retained;
  let getterReads = 0;
  const scenarios = new AgentScenarios({
    enter: async () => {
      owner = retained;
      return retained;
    },
    exit: async () => {
      owner = null;
    },
    assertControl() {},
    clearInput() {},
    controlGeneration: () => 1,
    describe: () => ({ buildId: "diagnostic-regression" }),
  });
  await scenarios.begin();
  const valid = recording();
  valid.actions.push({ tick: 0, native: nativeEvent(), accepted: true });
  validateScenarioRecording(valid, valid.buildId);
  const corruptions = [
    (event) => {
      event.selector = "body";
    },
    (event) => {
      Object.defineProperty(event, "type", {
        enumerable: true,
        get() {
          getterReads++;
          return "mousedown";
        },
      });
    },
    (event) => {
      Object.setPrototypeOf(event, { privileged: true });
    },
    (event) => {
      event.path = [-1];
    },
    (event) => {
      event.related = { root: 6, path: [], tag: "INPUT", label: "" };
    },
  ];
  for (const corrupt of corruptions) {
    const value = structuredClone(valid);
    corrupt(value.actions[0].native);
    await expect(scenarios.run(value)).rejects.toThrow();
    expect(owner).toBe(retained);
    expect(scenarios.snapshot().active).toBe(true);
  }
  expect(getterReads).toBe(0);
});
