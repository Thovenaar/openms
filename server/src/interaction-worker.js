import { parentPort } from "node:worker_threads";
import { admitNpcScript } from "../../client/src/npc/npc-script-admission.js";
import { executeNpcTurn } from "../../client/src/npc/npc-script-vm.js";
import {
  validateNpcEnvironment,
  admitNpcForceQuests,
  validateNpcDraft,
} from "../../client/src/npc/npc-script-authority.js";
import { requireNpc } from "../../client/src/npc/npc-script-values.js";

const MAX_EFFECTS = 4096;

/** Worker-local capabilities retain the request's exact random sample order. */
function workerEnvironment(request, operations) {
  let randomIndex = 0;
  return {
    ...request.environment,
    isCurrent: () => true,
    isBusy: () => false,
    prepareTravel: () => {
      throw new Error("Worker cannot own field travel");
    },
    random() {
      requireNpc(
        randomIndex < request.samples.length,
        "NPC random budget exceeded",
        "npc-budget",
      );
      return request.samples[randomIndex++];
    },
    recordEffect(node, args) {
      requireNpc(
        operations.length < MAX_EFFECTS,
        "NPC effect budget exceeded",
        "npc-budget",
      );
      const capability = { kind: node.kind, args: [...args] };
      if (node.overload !== undefined) capability.overload = node.overload;
      if (node.type !== undefined) capability.type = node.type;
      if (node.mapId !== undefined) capability.mapId = node.mapId;
      operations.push(capability);
    },
  };
}

function execute(request) {
  const context = admitNpcScript(request.compilation);
  const operations = [];
  const environment = workerEnvironment(request, operations);
  validateNpcEnvironment(context, environment);
  admitNpcForceQuests(context, environment);
  const state = request.state ?? {
    globals: Object.fromEntries(
      context.program.globals.map((name) => [name, undefined]),
    ),
    inputText: null,
    craftingScroll: false,
    savedMapIds: [],
  };
  const turn = executeNpcTurn(context, state, request.profile, {
    ...request.input,
    environment,
    now: request.now,
  });
  validateNpcDraft(turn);
  return {
    view: turn.view,
    operations,
    effects: turn.effects,
    state: {
      globals: turn.globals,
      inputText: turn.inputText,
      craftingScroll: turn.craftingScroll,
      savedMapIds: [...turn.context.dependencies.mapIds].filter(
        (id) => !turn.staticMapIds.has(id),
      ),
    },
  };
}

function receive(request) {
  try {
    parentPort.postMessage({ ok: true, value: execute(request) });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error.code ?? "npc-dependency" });
  }
}

parentPort.once("message", receive);
