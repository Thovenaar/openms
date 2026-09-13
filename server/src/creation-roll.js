import { randomInt, randomUUID } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import {
  STARTING_STAT_KEYS,
  validStartingStats,
} from "../../shared/starting-stats.js";
import { RateLimit } from "./auth.js";

/** One retained roll per authenticated session; bounded work and no client RNG. */
export function issueCreationRoll(session) {
  session.creationRollRate ??= new RateLimit(3, 3);
  if (!session.creationRollRate.take()) throw protocolError("RATE_LIMITED");
  const stats = { str: 4, dex: 4, int: 4, luk: 4 };
  for (let point = 0; point < 9; point++) {
    stats[STARTING_STAT_KEYS[randomInt(4)]]++;
  }
  const roll = { rollId: randomUUID(), ...stats };
  session.creationRoll = roll;
  return { ...roll };
}

/** A legal distribution still cannot substitute for this session's issued roll.
 * Retained until reroll/logout, so retrying a failed creation does not lose it. */
export function admitCreationRoll(session, body) {
  const roll = session.creationRoll;
  if (!roll || body.rollId !== roll.rollId || !validStartingStats(body)) {
    throw protocolError("INVALID_MESSAGE");
  }
  for (const key of STARTING_STAT_KEYS) {
    if (body[key] !== roll[key]) throw protocolError("INVALID_MESSAGE");
  }
}
