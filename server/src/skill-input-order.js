import { PROTOCOL } from "../../shared/protocol.js";
import { protocolError } from "../../shared/schema.js";

const MAX_WAITS = PROTOCOL.INPUT_LEAD_TICKS * 2;

/** Finish already queued movement before checking a cast's airborne state.
 * The browser's impulse starts immediately; only server admission waits for its
 * own scheduled input. Never advance the field clock from a command or packet. */
export async function awaitSkillInput(world, actor) {
  const field = actor.field;
  const connection = actor.connection;
  let targetTick = field.tick;
  for (const tick of actor.inputQueue.keys()) {
    targetTick = Math.max(targetTick, tick);
  }
  if (targetTick > field.tick + PROTOCOL.INPUT_LEAD_TICKS) {
    throw protocolError("NOT_ALLOWED");
  }
  for (let attempt = 0; attempt < MAX_WAITS; attempt++) {
    if (
      actor.field !== field ||
      actor.connection !== connection ||
      actor.retiring
    ) {
      throw protocolError("STALE_FIELD");
    }
    if (world.closed || world.overloaded || field.paused || field.fault) {
      throw protocolError("SERVER_BUSY");
    }
    if (field.tick >= targetTick) return;
    await new Promise((resolve) => {
      setTimeout(resolve, PROTOCOL.TICK_MS);
    });
  }
  throw protocolError("SERVER_BUSY");
}
