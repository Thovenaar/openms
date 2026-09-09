import { expect, test } from "bun:test";
import { AgentScenarios } from "../src/agent-scenarios.js";
import { createProfile } from "../src/profile-validation.js";

function fixture() {
  const profile = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  const state = { loading: false, accepted: false };
  const hooks = {
    async enter(spec) {
      return { ...spec, mapId: "100000000", profile };
    },
    async exit() {},
    step(ticks) {
      for (let index = 0; index < ticks; index++) scenarios.tick(30);
    },
    async dispatch() {
      return { accepted: state.accepted };
    },
    clearInput() {},
    assertControl() {},
    controlGeneration: () => 1,
    describe: () => ({ buildId: "same-source-and-assets" }),
    isLoading: () => state.loading,
    async waitReady() {
      state.loading = false;
    },
  };
  const scenarios = new AgentScenarios(hooks);
  return { scenarios, hooks, state };
}

test("final-tick travel settles before step resolves without advancing extra time", async () => {
  const { scenarios, hooks, state } = fixture();
  await scenarios.begin();
  let finishTravel;
  hooks.step = (ticks) => {
    for (let index = 0; index < ticks; index++) scenarios.tick(30);
    state.loading = true;
  };
  hooks.waitReady = () =>
    new Promise((resolve) => {
      finishTravel = () => {
        state.loading = false;
        resolve();
      };
    });
  let settled = false;
  const pending = scenarios.step(1).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(scenarios.now()).toBe(30);
  finishTravel();
  await pending;
  expect(scenarios.now()).toBe(30);
});

test("replay preserves normal refusals and fails when their admission outcome changes", async () => {
  const { scenarios, state } = fixture();
  await scenarios.begin();
  scenarios.startRecording();
  scenarios.record({ type: "key", code: "ArrowRight", phase: "press" }, false);
  await scenarios.step(1);
  const recording = scenarios.stopRecording();
  await scenarios.run(recording);
  expect(scenarios.now()).toBe(30);
  state.accepted = true;
  await expect(scenarios.run(recording)).rejects.toThrow(
    "admission outcome changed",
  );
  expect(scenarios.snapshot().active).toBe(false);
});
