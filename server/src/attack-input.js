import { PROTOCOL, protocolError } from "../../shared/protocol.js";

const MAX_EDGES = 8;
const MAX_AGE_TICKS = Math.ceil(2000 / PROTOCOL.TICK_MS);

export function resetAttackInput(actor) {
  actor.attackEdges = [];
  actor.receivedAttack = false;
  actor.combatInputSeq = null;
}

/** Movement samples expire by tick; a bounded attack edge still receives current-state admission. */
export function retainAttackInput(actor, sample) {
  const pressed = sample.attack && !actor.receivedAttack;
  actor.receivedAttack = sample.attack;
  if (!pressed) return;
  const tick = actor.field.tick;
  if (
    sample.targetTick < tick - MAX_AGE_TICKS ||
    sample.targetTick > tick + PROTOCOL.INPUT_LEAD_TICKS
  ) {
    return;
  }
  if (actor.attackEdges.length >= MAX_EDGES) {
    throw protocolError("RATE_LIMITED");
  }
  actor.attackEdges.push({
    inputSeq: sample.inputSeq,
    tick: Math.max(tick + 1, sample.targetTick),
    expires: tick + MAX_AGE_TICKS,
  });
}

/** Consume each press once, even when its release arrived in the same network burst. */
export function takeAttackInput(actor) {
  actor.combatInputSeq = null;
  const edge = actor.attackEdges[0];
  if (!edge || edge.tick > actor.field.tick) return false;
  actor.attackEdges.shift();
  if (edge.expires < actor.field.tick) return false;
  actor.combatInputSeq = edge.inputSeq;
  return true;
}
