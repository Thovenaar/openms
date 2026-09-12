import { AgentControl } from "./agent-control.js";
import { AgentObservation } from "./agent-observation.js";
import { AgentScenarios } from "./agent-scenarios.js";
import { createPlayerActions } from "../input/player-actions.js";
import { COMBAT_POLICY, PLAYER_HIT } from "../combat/offline-field.js";
import { MOB_POLICY } from "../combat/offline-mobs.js";
import { PROGRESSION_POLICY } from "../character/offline-progression.js";
import { replayNativeEvent } from "./diagnostic-events.js";

/** Browser integration, not an original-game protocol. Getters retain Main's ownership.
 * @param {{canvas:HTMLCanvasElement,input:object,root:HTMLElement,hooks:object}} options
 */
export function createAgentInterface({ canvas, input, root, hooks }) {
  const channel = {
    actions: createPlayerActions({ input, canvas, getSystems: hooks.systems }),
    beginDiagnosticCommand: hooks.beginDiagnosticCommand,
    controller: null,
    scenarios: null,
    replay: false,
  };
  const observation = createAgentObservation(channel, hooks, input, canvas);
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
  channel.nativeHooks = {
    systems: hooks.systems,
    scene: hooks.scene,
    canvas,
    settle: hooks.settleNative,
    signal: () => (hooks.localReplay?.() ? hooks.localReplaySignal() : null),
  };
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

function createAgentObservation(channel, hooks, input, canvas) {
  return new AgentObservation({
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
}

/** Record attempted normal commands: refusals can also change chat/UI gates. */
async function dispatchPlayerCommand(channel, command, guard) {
  const scenarios = channel.scenarios;
  if (scenarios.pending && !channel.replay) {
    throw new Error("Scenario operation owns command admission");
  }
  scenarios.assertCanRecord();
  const diagnostic = channel.beginDiagnosticCommand?.(command);
  const result = await channel.actions.dispatch(command, guard);
  if (diagnostic) diagnostic.accepted = result.accepted;
  guard.assertActive();
  scenarios.record(command, result.accepted);
  return result;
}

function createScenarioCoordinator(channel, hooks, input) {
  return new AgentScenarios({
    enter: hooks.enter,
    exit: hooks.exit,
    step: hooks.step,
    dispatchNative: (event) => replayNativeEvent(event, channel.nativeHooks),
    prepareNative: hooks.prepareNative,
    dispatch(command) {
      if (hooks.localReplay?.()) {
        return channel.actions.dispatch(command, {
          assertActive: hooks.assertLocalReplay,
          signal: hooks.localReplaySignal(),
        });
      }
      channel.replay = true;
      try {
        return channel.controller.api.act(command);
      } finally {
        channel.replay = false;
      }
    },
    controlGeneration: () =>
      hooks.localReplay?.() ? -1 : channel.controller.generation,
    assertControl: () => {
      if (hooks.localReplay?.()) {
        hooks.assertLocalReplay();
        return;
      }
      const control = channel.controller;
      if (!control.active || !control.permission || control.destroyed) {
        throw new Error("Agent control lease is inactive");
      }
    },
    clearInput: input.clear,
    describe: hooks.status,
    waitReady: hooks.waitReady,
    waitIdle: hooks.settleNative,
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
function appendDevelopmentText(parent, tag, text, className = "") {
  const node = parent.ownerDocument.createElement(tag);
  node.textContent = text;
  node.className = className;
  parent.append(node);
  return node;
}

function createAgentGuide(root) {
  const guide = appendDevelopmentText(root, "section", "", "agent-guide");
  appendDevelopmentText(guide, "h3", "Use an external tool");
  const steps = appendDevelopmentText(guide, "ol", "");
  appendDevelopmentText(
    steps,
    "li",
    "Inspect first: window.maple.agent.status() and observe() are read-only and need no permission.",
  );
  appendDevelopmentText(
    steps,
    "li",
    "A human clicks Allow agent control. This tab does not connect or start a tool, and changing tabs never grants permission.",
  );
  appendDevelopmentText(
    steps,
    "li",
    "Your external browser tool acquires a named lease, then sends supported actions through window.maple.agent.act(). Await each result; a refused action is not success.",
  );
  appendDevelopmentText(
    steps,
    "li",
    "Native keys, pointer-down or wheel cancel agent control. Window blur or a hidden document also revoke permission. Stop or release() clears held input; re-grant before resuming.",
  );
  const details = appendDevelopmentText(guide, "details", "");
  appendDevelopmentText(
    details,
    "summary",
    "API examples and temporary scenarios",
  );
  appendDevelopmentText(
    details,
    "pre",
    'await window.maple.ready;\nconst agent = window.maple.agent;\nagent.status();\nagent.observe();\nagent.describe(); // supported actions and bindings\n\n// External tool, after a human grants permission:\nagent.acquire("my browser tool");\nawait agent.act({ type: "ui", name: "Item" });\nagent.release();',
  );
  appendDevelopmentText(
    details,
    "p",
    'For controlled experiments, window.maple.dev.scenarios.begin({ mapId: "100000000" }) prepares a memory-only field under an active lease. Close game windows and finish saves first. Scenarios start paused: step(1) advances one real simulation tick; end() restores the retained baseline. Human takeover resumes normal play in the temporary field, not the persistent one.',
  );
  appendDevelopmentText(
    details,
    "p",
    "Read-only capture() captures the game canvas, not this inspector. Movement hold/press requires an explicit release action. This permission gate is an interaction safeguard, not a JavaScript security sandbox.",
  );
  return guide;
}

/** A temporary world remains visibly experimental even after a human takes over. */
function createDevelopmentControls(root, scenarios, hooks) {
  const panel = appendDevelopmentText(
    root,
    "section",
    "",
    "agent-experiment agent-card",
  );
  panel.setAttribute("aria-label", "Profile destination");
  appendDevelopmentText(panel, "h3", "Profile destination");
  const status = appendDevelopmentText(panel, "p", "");
  status.id = "agent-development-status";
  status.setAttribute("role", "status");
  const actions = appendDevelopmentText(panel, "div", "", "agent-actions");
  const exit = appendDevelopmentText(actions, "button", "Exit experiment");
  exit.type = "button";
  appendDevelopmentText(
    panel,
    "p",
    "Normal play and applied character edits use your persistent local profile. During an experiment, saves and progress stay in memory only. Exit restores the retained original field, profile, input, chat and view settings; temporary progress is discarded, never merged into your save.",
  );
  appendDevelopmentText(
    panel,
    "p",
    "Stopping agent control does not exit an experiment. Exit remains available without permission. Starting an experiment may checkpoint existing persistent progress.",
  );
  const guide = createAgentGuide(root);
  async function leave() {
    try {
      await scenarios.end();
    } catch (error) {
      hooks.report(error);
    }
  }
  function refresh() {
    const active = hooks.experimental();
    status.textContent = active
      ? "Experimental · temporary profile"
      : "Persistent · local profile";
    exit.disabled = !active;
    root.toggleAttribute("data-experimental", active);
  }
  exit.addEventListener("click", leave);
  refresh();
  return {
    refresh,
    destroy() {
      exit.removeEventListener("click", leave);
      panel.remove();
      guide.remove();
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
      input: "client/src/input/player-input.js",
      bindings: "client/src/input/keymap.js",
      combat: "client/src/combat/offline-field.js",
      mobs: "client/src/combat/offline-mobs.js",
      progression: "client/src/character/offline-progression.js",
      physics: "client/src/physics/settings.js",
      entities: "client/tools/life-data.js",
      profiles: "client/src/profile/profile-validation.js",
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
