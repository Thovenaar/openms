import { decodeResponse } from "../../client/src/npc/npc-script-runtime.js";
import {
  npcReferences,
  resolveNpcRoute,
  npcEnvironment,
} from "./interaction-npc-content.js";
import { boundedNpcTurn, replayNpcPlan } from "./interaction-npc-executor.js";
import { openShop, admitShop } from "./interaction-shop.js";
import { questOffers } from "./interaction-quest.js";
import { publishNpcMenu, answerNpcMenu } from "./interaction-npc-menu.js";
import { answerQuestDialogue } from "./interaction-quest-dialogue.js";
import { operationFor } from "./action-rules.js";
import {
  closeConversation,
  currentNpc,
  freshLease,
  interactionReceipt,
  publishInteraction,
  requireCharacterRevision,
  requireInteraction,
  serverRandomSamples,
  storeDialogue,
  INTERACTION_LIMITS,
} from "./interaction-common.js";

export async function executeNpc(actor, message, world) {
  if (message.action.kind === "npc.open") return openNpc(actor, message, world);
  const lease = actor.conversation;
  currentNpc(world, actor, lease);
  requireInteraction(
    message.action.conversationId === lease.id &&
      message.action.step === lease.step &&
      message.expectedRevision === lease.step,
    "STALE_REVISION",
  );
  if (lease.questDialogue) {
    return answerQuestDialogue(actor, message, world, lease);
  }
  if (lease.menu) {
    const receipt = answerNpcMenu(actor, message, world, lease);
    return receipt ?? runRoute(actor, message, world, lease);
  }
  requireInteraction(lease.view, "NOT_ALLOWED");
  const input = decodeResponse(
    { ...lease.view, sessionId: lease.id, revision: lease.step },
    wireResponse(lease, message.action.answer),
  );
  if (input.local) {
    closeConversation(actor, world);
    return interactionReceipt(lease.step + 1);
  }
  return runTurn(actor, message, world, { lease, input });
}

async function openNpc(actor, message, world) {
  requireCharacterRevision(actor, message);
  requireInteraction(!actor.tradeId && actor.profile.hp > 0, "CHARACTER_BUSY");
  const npc = world.npc(actor, message.action.npcId);
  const references = await npcReferences(world);
  requireCharacterRevision(actor, message);
  const lease = freshLease(actor, npc);
  currentNpc(world, actor, lease);
  const route = resolveNpcRoute(references, npc, world.content.catalog);
  const offers = questOffers(actor, world, lease);
  requireInteraction(
    offers.length || route?.status === "supported",
    "CONTENT_MISMATCH",
  );
  closeConversation(actor, world);
  actor.conversation = lease;
  actor.shop = null;
  lease.route = route;
  if (offers.length) {
    lease.menu = offers;
    lease.step++;
    publishNpcMenu(actor, world, lease);
    return interactionReceipt(actor.revision);
  }
  return runRoute(actor, message, world, lease);
}

async function runRoute(actor, message, world, lease) {
  const route = lease.route;
  requireInteraction(route?.status === "supported", "CONTENT_MISMATCH");
  if (route.precedence === "standard-shop-fallback") {
    lease.step++;
    await openShop(actor, world, lease, route.shopId);
    return interactionReceipt(
      message.action.kind === "npc.open" ? actor.revision : lease.step,
    );
  }
  lease.compilation = route;
  lease.environment = await npcEnvironment(
    world,
    lease,
    await npcReferences(world),
    route,
  );
  return runTurn(actor, message, world, { lease, input: { start: true } });
}

function wireResponse(lease, answer) {
  const response = { sessionId: lease.id, revision: lease.step };
  if (answer.kind === "cancel") response.action = "close";
  else if (answer.kind === "next") {
    response.action =
      lease.view.kind === "say" && !lease.view.next ? "acknowledge" : "next";
  } else if (answer.kind === "previous") response.action = "previous";
  else if (answer.kind === "yesno") {
    response.action =
      lease.view.kind === "accept-decline"
        ? answer.value
          ? "accept"
          : "decline"
        : answer.value
          ? "yes"
          : "no";
  } else if (answer.kind === "choice") {
    response.action = "choose";
    response.value = answer.choiceId;
  } else {
    response.action = answer.kind;
    response.value = answer.value;
  }
  return response;
}

function turnRequest(actor, lease, input) {
  requireInteraction((lease.turns ?? 0) < 2048, "SESSION_EXPIRED");
  return {
    compilation: lease.compilation,
    environment: lease.environment,
    state: lease.vmState,
    profile: scriptProfile(actor.profile),
    input,
    now: Date.now(),
    samples: serverRandomSamples(),
  };
}

function scriptProfile(profile) {
  const snapshot = structuredClone(profile);
  delete snapshot.onlineState;
  return snapshot;
}

async function admitView(actor, world, lease, view) {
  if (view.kind === "closed") return;
  if (view.kind === "shop") {
    await admitShop(world, view.shopId);
    return;
  }
  requireInteraction(
    ["say", "yes-no", "accept-decline", "choice", "number", "text"].includes(
      view.kind,
    ),
    "CONTENT_MISMATCH",
  );
  requireInteraction(
    view.kind !== "choice" || view.choices.length <= 128,
    "CONTENT_MISMATCH",
  );
  requireInteraction(
    view.kind !== "text" || view.minLength <= 256,
    "CONTENT_MISMATCH",
  );
  storeDialogue(world, actor, lease, view.text);
}

function sameDestination(first, second) {
  return (
    first?.mapId === second?.mapId &&
    first?.portal === second?.portal &&
    first?.randomSpawn === second?.randomSpawn
  );
}

async function runTurn(actor, message, world, { lease, input }) {
  currentNpc(world, actor, lease);
  const request = turnRequest(actor, lease, input);
  let result = await boundedNpcTurn(world, request);
  currentNpc(world, actor, lease);
  requireInteraction(actor.conversation === lease, "SESSION_EXPIRED");
  await admitView(actor, world, lease, result.view);
  let receipt = interactionReceipt(
    message.action.kind === "npc.open" ? actor.revision : lease.step + 1,
  );
  if (result.operations.length) {
    const committed = await commitTurn(actor, message, world, {
      lease,
      request,
      result,
    });
    receipt = committed.receipt;
    result = committed.result;
    if (receipt.status !== "committed") return receipt;
  }
  lease.step++;
  lease.turns = (lease.turns ?? 0) + 1;
  lease.vmState = result.state;
  lease.view = result.view;
  lease.expiresAt = Date.now() + INTERACTION_LIMITS.leaseMs;
  if (actor.field.epoch === lease.fieldEpoch) {
    await publishNpcView(actor, world, lease);
    if (lease.view.kind === "closed" && !lease.offers.length) {
      closeConversation(actor, world);
    }
  } else closeConversation(actor, world);
  return receipt;
}

async function commitTurn(actor, message, world, execution) {
  const { lease, request } = execution;
  let result = execution.result;
  const destination = result.effects.find((effect) => effect.kind === "warp");
  const operation = { ...operationFor(message), domainRevision: lease.step };
  async function mutate(draft) {
    currentNpc(world, actor, lease, Boolean(destination));
    requireInteraction(actor.conversation === lease, "SESSION_EXPIRED");
    if (message.action.kind === "npc.answer") {
      requireInteraction(
        message.expectedRevision === lease.step,
        "STALE_REVISION",
      );
    }
    const fresh = { ...request, profile: scriptProfile(draft) };
    const prepared = await boundedNpcTurn(world, fresh);
    requireInteraction(
      sameDestination(
        destination,
        prepared.effects.find((effect) => effect.kind === "warp"),
      ),
      "REQUIREMENTS_NOT_MET",
    );
    requireInteraction(
      JSON.stringify(prepared.view) === JSON.stringify(execution.result.view),
      "REQUIREMENTS_NOT_MET",
    );
    currentNpc(world, actor, lease, Boolean(destination));
    result = replayNpcPlan(draft, fresh, prepared);
    return {
      domainRevision:
        message.action.kind === "npc.answer" ? lease.step + 1 : undefined,
      value: { conversationId: lease.id, step: lease.step + 1 },
    };
  }
  let receipt;
  if (destination) {
    receipt = await world.transition(actor, destination, {
      ...operation,
      mutate,
    });
  } else receipt = await world.database.commit(actor, operation, mutate);
  if (receipt.status === "committed") {
    world.publish(actor, { type: "snapshot-request" });
  }
  return { receipt, result };
}

/** Translate an admitted authored prompt into its wire input kind. */
function dialogueInput(view) {
  if (view.kind === "say") return "next";
  if (["yes-no", "accept-decline"].includes(view.kind)) return "yesno";
  return view.kind;
}

export async function publishNpcView(actor, world, lease = actor.conversation) {
  const view = lease?.view;
  if (!view || view.kind === "closed") return;
  if (view.kind === "shop") {
    await openShop(actor, world, lease, view.shopId);
    return;
  }
  requireInteraction(
    ["say", "yes-no", "accept-decline", "choice", "number", "text"].includes(
      view.kind,
    ),
    "CONTENT_MISMATCH",
  );
  const input = dialogueInput(view);
  const choices =
    view.kind === "choice" ? view.choices.map((choice) => choice.id) : [];
  requireInteraction(choices.length <= 128, "CONTENT_MISMATCH");
  const contentId = storeDialogue(world, actor, lease, view.text);
  publishInteraction(world, actor, {
    kind: "dialogue",
    conversationId: lease.id,
    step: lease.step,
    npcId: lease.npcId,
    contentId,
    choices,
    input,
    minimum:
      view.kind === "number"
        ? view.min
        : view.kind === "text"
          ? view.minLength
          : null,
    maximum:
      view.kind === "number"
        ? view.max
        : view.kind === "text"
          ? Math.min(view.maxLength, 256)
          : null,
  });
}
