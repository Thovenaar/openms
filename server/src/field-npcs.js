import { PROTOCOL, protocolError } from "../../shared/protocol.js";

const MAX_NPCS = 2048;
const MAX_CHOICES = 4096;
const SPEECH_MS = 5000; // Native00937495/00978b4f; shared SpeechBubbles lifetime.

/** Native006d2918's30ms scheduler, with randomness owned by the field server. */
export function prepareNpcAmbient(template, randomUint) {
  const speech = template.speech;
  if (template.info.imitate || !speech) return null;
  if (speech.actions.length + speech.lines.length > MAX_CHOICES) {
    throw protocolError("CONTENT_MISMATCH");
  }
  return { cooldownMs: (randomUint() % 6000) + 3000, actionMs: 0 };
}

export function advanceNpcs(world, field) {
  if (field.npcs.size > MAX_NPCS) throw protocolError("SERVER_BUSY");
  for (const npc of field.npcs.values()) {
    if (!npc.ambient) continue;
    const speech = npc.npcSpeech;
    if (
      speech &&
      (field.tick - speech.startTick) * PROTOCOL.TICK_MS > SPEECH_MS
    ) {
      npc.npcSpeech = null;
    }
    advanceNpc(world, field, npc);
  }
}

function advanceNpc(world, field, npc) {
  const state = npc.ambient;
  state.cooldownMs -= PROTOCOL.TICK_MS;
  if (state.actionMs > 0) {
    state.actionMs -= PROTOCOL.TICK_MS;
    if (state.actionMs <= 0) {
      setAction(npc, npc.template.defaultAction, field.tick);
    }
    return;
  }
  if (state.cooldownMs > 0 || isTalking(field, npc.id)) return;
  state.cooldownMs = (world.nextUint32() % 6000) + 3000;
  const { actions, lines } = npc.template.speech;
  const count = actions.length + lines.length;
  if (!count) return;
  const choice = (world.nextUint32() % 50) % count;
  if (choice >= actions.length) {
    setSpeech(npc, null, choice - actions.length, field.tick);
    return;
  }
  const action = actions[choice];
  setAction(npc, action.action, field.tick);
  state.actionMs = action.durationMs;
  if (action.lines.length) {
    setSpeech(
      npc,
      choice,
      (world.nextUint32() % 50) % action.lines.length,
      field.tick,
    );
  }
}

function isTalking(field, id) {
  for (const actor of field.characters.values()) {
    if (actor.state === "active" && actor.conversation?.npcId === id) {
      return true;
    }
  }
  return false;
}

function setAction(npc, action, tick) {
  npc.action = action;
  npc.actionStartTick = tick;
}

function setSpeech(npc, actionIndex, lineIndex, startTick) {
  const source = npc.template.speech;
  const lines =
    actionIndex === null ? source.lines : source.actions[actionIndex].lines;
  if (!lines[lineIndex]?.text) return;
  npc.npcSpeech = { actionIndex, lineIndex, startTick };
}
