import {
  call,
  cmMethod,
  member,
  playerMethod,
  resolveVariable,
} from "./npc-script-ir.js";

const PARTY_CALLS = new Set(["getParty", "isLeader", "partyMembersInMap"]);
const CARNIVAL_CALLS = new Set([
  "sendCPQMapLists",
  "fieldTaken",
  "fieldLobbied",
  "challengeParty",
  "cpqLobby",
]);
const PARTY_QUEST_CALLS = new Set([
  "gotPartyQuestItem", "removePartyQuestItem", "setPartyQuestItemObtained",
]);
const GAME_CONSTANT_READS = Object.freeze({
  getHallOfFameMapid: "hall-of-fame-map",
  getSkillBook: "skill-book",
  isCygnus: "is-cygnus",
  isAran: "is-aran",
});

/** Known remote operations compile to a transactional trap, never a host invocation. */
export function npcRemoteService(node) {
  const method = cmMethod(node);
  if (method === "canSpawnPlayerNpc") return "hall-of-fame-player-npc";
  if (PARTY_QUEST_CALLS.has(playerMethod(node))) return "party-quest-progress";
  if (PARTY_CALLS.has(method) || playerMethod(node) === "getParty") {
    return "party-membership";
  }
  if (
    CARNIVAL_CALLS.has(method) ||
    playerMethod(node) === "getFestivalPoints"
  ) {
    return "monster-carnival";
  }
  if (method === "gainExp") return "server-experience-reward";
  if (
    call(node, "getMembers") &&
    (cmMethod(node.callee.object) === "getParty" ||
      playerMethod(node.callee.object) === "getParty")
  ) {
    return "party-membership";
  }
  return null;
}

function configField(context, scope, node) {
  if (!member(node.object, "server") || !member(node.object.object, "config")) {
    return null;
  }
  const receiver = node.object.object.object;
  if (receiver.type !== "Identifier") return null;
  const binding = resolveVariable(context, scope, receiver);
  if (binding?.host !== "config.YamlConfig") return null;
  if (
    binding.owner === context.scopeOwners.get(scope) &&
    binding.declarationEnd > node.start
  ) {
    throw new Error("Static configuration binding used before initialization");
  }
  const name = node.property.name;
  if (!["USE_CPQ", "USE_ENABLE_SOLO_EXPEDITIONS"].includes(name)) return null;
  if (typeof context.staticConfig?.[name] !== "boolean") {
    throw new Error(`Missing authored static configuration: ${name}`);
  }
  return {
    op: "literal",
    value: context.staticConfig[name],
    raw: String(context.staticConfig[name]),
  };
}

/** Only named, side-effect-free source methods are lowered; Java itself is never evaluated. */
function staticHostExpression(context, scope, node) {
  if (node.type !== "CallExpression" || node.callee.computed ||
      node.callee.object?.type !== "Identifier") return null;
  if (!context.variables.some((variable) => variable.name === node.callee.object.name && variable.host)) return null;
  const binding = resolveVariable(context, scope, node.callee.object);
  if (!binding?.host) return null;
  if (binding.owner === context.scopeOwners.get(scope) && binding.declarationEnd > node.start) {
    throw new Error("Static host binding used before initialization");
  }
  const method = node.callee.property?.name;
  if (binding.host === "server.life.PlayerNPC" && method === "spawnPlayerNPC" && node.arguments.length === 2) {
    return { op: "unavailable", service: "hall-of-fame-player-npc" };
  }
  if (binding.host !== "constants.game.GameConstants" ||
      !Object.hasOwn(GAME_CONSTANT_READS, method) || node.arguments.length !== 1) return null;
  return { op: "read", kind: GAME_CONSTANT_READS[method], args: [] };
}

export function npcBooleanConfig(context, name) {
  const value = context.staticConfig?.[name];
  if (typeof value !== "boolean") throw new Error(`Missing authored static configuration: ${name}`);
  return value;
}

export function npcServiceExpression(context, scope, node) {
  if (node.type === "MemberExpression" && !node.computed) {
    return configField(context, scope, node);
  }
  const host = staticHostExpression(context, scope, node);
  if (host) return host;
  const service = npcRemoteService(node);
  if (service) return { op: "unavailable", service };
  if (
    (call(node, "size") || call(node, "get")) &&
    node.callee.object.type === "Identifier"
  ) {
    const binding = resolveVariable(context, scope, node.callee.object);
    if (binding?.remoteService) {
      return { op: "unavailable", service: binding.remoteService };
    }
  }
  if (playerMethod(node) === "isGM" && node.arguments.length === 0) {
    // Offline character profiles never confer server GM privileges.
    return { op: "read", kind: "is-gm", args: [] };
  }
  return mapServiceExpression(node);
}

function mapServiceExpression(node) {
  if (node.type !== "CallExpression" || node.arguments.length !== 0) {
    return null;
  }
  if (
    playerMethod(node.callee.object) !== "getMap" ||
    node.callee.object.arguments.length
  ) {
    return null;
  }
  if (call(node, "isCPQWinnerMap")) {
    return { op: "read", kind: "cpq-winner-map", args: [] };
  }
  if (call(node, "isCPQLoserMap")) {
    return { op: "read", kind: "cpq-loser-map", args: [] };
  }
  return null;
}

/** A server-owned collection cannot be materialized locally; fail before iterating it. */
export function npcRemoteLoop(context, scope, node) {
  const bound = node.test?.right;
  if (
    !call(bound, "size") ||
    bound.arguments.length ||
    bound.callee.object.type !== "Identifier"
  ) {
    return null;
  }
  const binding = resolveVariable(context, scope, bound.callee.object);
  return binding?.remoteService
    ? { op: "unavailable", service: binding.remoteService }
    : null;
}
