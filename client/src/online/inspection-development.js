import {
  inspectionElement,
  inspectionText,
} from "../development/state-testing.js";

const SETUP_KINDS = new Set(["map", "preset", "spawn", "profile", "physics"]);
const FORM_ACTIONS = [
  ["map", "Travel to packaged map ID"],
  ["preset", "Apply server job preset"],
  ["spawn", "Spawn one packaged monster"],
  ["step", "Step server ticks (1–4)"],
];

/** Online experiments mutate the audited server realm; there is no local baseline replay. */
export function createOnlineDevelopment(owner) {
  async function request(action) {
    owner.agent.assertActive();
    const generation = owner.agent.generation;
    const result = await owner.develop(action);
    owner.agent.assertActive();
    if (generation !== owner.agent.generation) {
      throw new Error(
        "Experiment lease changed while the server request settled.",
      );
    }
    return result;
  }
  function setup(action) {
    if (!action || !SETUP_KINDS.has(action.kind)) {
      throw new Error(
        "Server setup accepts only audited map, preset, spawn, profile or physics actions.",
      );
    }
    return request(action);
  }
  return Object.freeze({
    describe: (options) => describe(owner, options),
    scenarios: Object.freeze({
      setup,
      pause: (paused) => request({ kind: "pause", paused }),
      step: (ticks) => request({ kind: "step", ticks }),
      snapshot: () => describe(owner),
    }),
  });
}

/** Detached, bounded description; observations never grant mutation permission. */
function describe(owner, options = {}) {
  if (Object.keys(options).some((key) => key !== "entityId")) {
    throw new Error("Online development describe accepts only entityId.");
  }
  const scene = owner.hooks.snapshot();
  if (scene.entities.length > 16384) {
    throw new Error("Scene observation exceeds its bound.");
  }
  const entities =
    options.entityId === undefined
      ? scene.entities.slice(0, 128)
      : scene.entities.filter((entity) => entity.id === options.entityId);
  return structuredClone({
    authority: "server",
    developmentAuthorized: owner.authorized(),
    permission: owner.agent?.status(),
    policy:
      "Audited server edits persist according to server rules. No temporary profile, saved baseline or automatic restoration.",
    actions: [
      "setup(map|preset|spawn|profile|physics)",
      "pause(boolean)",
      "step(1–4 ticks)",
    ],
    scene: {
      currentMap: scene.currentMap,
      paused: scene.paused,
      camera: scene.camera,
      entities,
      entityCount: scene.entities.length,
      shown: entities.length,
    },
    connection: owner.transport.snapshot(),
    prediction: owner.prediction.snapshot(),
    native: {
      quests: owner.model?.presentation?.quests,
      capabilities: owner.model?.presentation?.capabilities,
      interactions: owner.model?.presentation?.interactions,
    },
  });
}

function formAction(kind, value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("Enter an integer server action value.");
  }
  switch (kind) {
    case "map":
      return { kind, mapId: number };
    case "preset":
      return { kind, job: number };
    case "spawn":
      return { kind, templateId: number, count: 1 };
    case "step":
      return { kind, ticks: number };
    default:
      throw new Error("Unknown server experiment action");
  }
}

/** Human controls bypass agent leasing, never server authorization or auditing. */
export function mountOnlineExperiments(owner, root) {
  const panel = inspectionElement(root, "section");
  panel.className = "agent-card";
  inspectionElement(panel, "h3", "Server experiments");
  inspectionElement(
    panel,
    "p",
    "Developer realm only. Changes use audited HTTP requests and can persist. No offline temporary profile or automatic rollback is available. The automation API additionally requires an active human-granted agent lease.",
  );
  const controls = inspectionElement(panel, "fieldset");
  inspectionElement(controls, "legend", "Audited server action");
  const select = inspectionElement(controls, "select");
  select.setAttribute("aria-label", "Server experiment action");
  for (const [kind, title] of FORM_ACTIONS) {
    const option = inspectionElement(select, "option", title);
    option.value = kind;
  }
  const value = inspectionElement(controls, "input");
  value.type = "number";
  value.step = "1";
  value.setAttribute("aria-label", "Map ID, job ID, monster ID or tick count");
  const status = inspectionElement(panel, "p");
  status.setAttribute("role", "status");
  let pending = false;
  async function execute(event, action) {
    if (!event.isTrusted || pending) return;
    pending = true;
    refresh();
    try {
      status.textContent = inspectionText(await owner.develop(action()));
    } catch (error) {
      status.textContent = `Refused: ${error.message}`;
    } finally {
      pending = false;
      refresh();
    }
  }
  const options = { signal: owner.controller.signal };
  const apply = inspectionElement(controls, "button", "Submit server action");
  apply.type = "button";
  apply.addEventListener(
    "click",
    (event) => execute(event, () => formAction(select.value, value.value)),
    options,
  );
  addPauseButtons(controls, execute, options);
  function refresh() {
    controls.disabled =
      pending || !owner.authorized() || owner.transport.status !== "active";
  }
  refresh();
  return { refresh, destroy: () => panel.remove() };
}

function addPauseButtons(root, execute, options) {
  for (const paused of [true, false]) {
    const button = inspectionElement(
      root,
      "button",
      paused ? "Pause server field" : "Resume server field",
    );
    button.type = "button";
    button.addEventListener(
      "click",
      (event) => execute(event, () => ({ kind: "pause", paused })),
      options,
    );
  }
}
