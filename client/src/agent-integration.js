import { AgentControl } from "./agent-control.js";
import { AgentObservation } from "./agent-observation.js";
import { AgentScenarios } from "./agent-scenarios.js";
import { createPlayerActions } from "./player-actions.js";
import { COMBAT_POLICY, PLAYER_HIT } from "./offline-field.js";
import { MOB_POLICY } from "./offline-mobs.js";
import { PROGRESSION_POLICY } from "./offline-progression.js";

/** Browser integration, not an original-game protocol. Getters retain Main's ownership.
 * @param {{canvas:HTMLCanvasElement,input:object,root:HTMLElement,hooks:object}} options
 */
export function createAgentInterface({ canvas, input, root, hooks }) {
  const channel = {
    actions: createPlayerActions({ input, canvas, getSystems: hooks.systems }),
    controller: null,
    scenarios: null,
    replay: false,
  };
  const observation = new AgentObservation({
    scene: hooks.scene,
    systems: hooks.systems,
    input: () => input,
    status: () => ({
      ...hooks.status(),
      control: channel.controller?.status(),
      scenario: channel.scenarios?.snapshot(false),
    }),
    canvas: () => canvas,
    render: hooks.render,
  });
  const controller = new AgentControl({
    input,
    canvas,
    root,
    hooks: {
      dispatch: dispatchPlayerCommand.bind(null, channel),
      observe: observation.observe.bind(observation),
      capture: observation.capture.bind(observation),
      ready: hooks.ready,
      onInterrupt: hooks.interrupt,
    },
  });
  channel.controller = controller;
  const scenarios = createScenarioCoordinator(channel, hooks, input);
  channel.scenarios = scenarios;
  const development = createDevelopmentControls(root, scenarios, hooks);
  return {
    controller,
    observation,
    scenarios,
    agent: Object.freeze({
      ...controller.api,
      describe: channel.actions.describe,
    }),
    dev: Object.freeze({
      scenarios: scenarioAPI(scenarios),
      describe: (options) => describeDevelopment(hooks, options),
    }),
    tick(ms) {
      observation.tick(ms);
      scenarios.tick(ms);
    },
    refreshDevelopment: development.refresh,
    destroy() {
      controller.destroy();
      observation.destroy();
      development.destroy();
    },
  };
}

/** Record attempted normal commands: refusals can also change chat/UI gates. */
async function dispatchPlayerCommand(channel, command, guard) {
  const scenarios = channel.scenarios;
  if (scenarios.pending && !channel.replay) {
    throw new Error("Scenario operation owns command admission");
  }
  scenarios.assertCanRecord();
  const result = await channel.actions.dispatch(command, guard);
  guard.assertActive();
  scenarios.record(command, result.accepted);
  return result;
}

function createScenarioCoordinator(channel, hooks, input) {
  return new AgentScenarios({
    enter: hooks.enter,
    exit: hooks.exit,
    step: hooks.step,
    dispatch(command) {
      channel.replay = true;
      try {
        return channel.controller.api.act(command);
      } finally {
        channel.replay = false;
      }
    },
    controlGeneration: () => channel.controller.generation,
    assertControl: () => {
      const control = channel.controller;
      if (!control.active || !control.permission || control.destroyed) {
        throw new Error("Agent control lease is inactive");
      }
    },
    clearInput: input.clear,
    describe: hooks.status,
    waitReady: hooks.waitReady,
    isLoading: hooks.isLoading,
  });
}

/** No mutable scheduler internals or clock-writing hooks enter the public API. */
function scenarioAPI(scenarios) {
  return Object.freeze({
    begin: scenarios.begin.bind(scenarios),
    end: scenarios.end.bind(scenarios),
    step: scenarios.step.bind(scenarios),
    run: scenarios.run.bind(scenarios),
    startRecording: scenarios.startRecording.bind(scenarios),
    stopRecording: scenarios.stopRecording.bind(scenarios),
    random: scenarios.random.bind(scenarios),
    snapshot: scenarios.snapshot.bind(scenarios),
  });
}
/** A temporary world remains visibly experimental even after a human takes over. */
function createDevelopmentControls(root, scenarios, hooks) {
  const status = document.createElement("span");
  status.id = "agent-development-status";
  status.setAttribute("role", "status");
  const exit = document.createElement("button");

  exit.type = "button";
  exit.textContent = "Exit experiment";
  async function leave() {
    try {
      await scenarios.end();
    } catch (error) {
      hooks.report(error);
    }
  }
  function refresh() {
    const active = hooks.experimental();
    status.textContent = active ? "Experimental · temporary profile" : "";
    exit.hidden = !active;
    root.toggleAttribute("data-experimental", active);
  }
  exit.addEventListener("click", leave);
  root.append(status, exit);
  refresh();
  return {
    refresh,
    destroy() {
      exit.removeEventListener("click", leave);
      status.remove();
      exit.remove();
    },
  };
}

/** Detached, inspectable definitions; editing a returned object never changes live rules.
 * @param {object} hooks Main's read-only scene getter.
 * @param {{entityId?:string}} options One original life definition, or policy/source index.
 */
function describeDevelopment(hooks, options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some((key) => key !== "entityId")
  ) {
    throw new TypeError("Development description accepts only entityId");
  }
  const scene = hooks.scene();
  if (!scene) throw new Error("No loaded field");
  if (options.entityId !== undefined) {
    if (typeof options.entityId !== "string" || options.entityId.length > 128) {
      throw new TypeError("Invalid entity ID");
    }
    const placement = scene.manifest.life.placements.find(
      (record) => record.id === options.entityId,
    );
    if (!placement) throw new Error("No original life definition with this ID");
    return structuredClone({
      placement,
      template: scene.manifest.life.templates[placement.template],
    });
  }
  return structuredClone({
    authority: "browser-development-interface",
    experimental: hooks.experimental(),
    sources: {
      input: "client/src/player-input.js",
      bindings: "client/src/keymap.js",
      combat: "client/src/offline-field.js",
      mobs: "client/src/offline-mobs.js",
      progression: "client/src/offline-progression.js",
      physics: "client/src/physics/settings.js",
      entities: "client/tools/life-data.js",
      profiles: "client/src/profile-validation.js",
    },
    policies: {
      combat: COMBAT_POLICY,
      hitPresentation: PLAYER_HIT,
      mobs: MOB_POLICY,
      progression: PROGRESSION_POLICY,
    },
    physics: {
      globals: scene.manifest.physics.globals,
      map: scene.manifest.physics.map,
    },
    effectiveSettings: scene.simulation.effectiveSettings,
    persistence:
      "Scenario overrides are temporary. Permanent rules require explicit source edits and a Bun rebuild.",
  });
}
