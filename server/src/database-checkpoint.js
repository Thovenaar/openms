import { isDeepStrictEqual } from "node:util";
import { protocolError } from "../../shared/protocol.js";
import { cacheProfile } from "./database-items.js";

export const CHECKPOINT_HISTORY = Object.freeze({
  intervalSeconds: 60,
  retained: 60,
  pruneBatch: 128,
});

/** Current state keeps its one-second cadence; history is sampled and independently bounded. */
export async function persistCheckpoint(
  tx,
  database,
  actor,
  { current, durable },
) {
  const cache = cacheProfile(current);
  if (!isDeepStrictEqual(cache, cacheProfile(durable))) {
    const rows =
      await tx`UPDATE character SET profile=${cache},map_id=${Number(current.location.mapId)},updated_at=clock_timestamp() WHERE id=${actor.id} AND fencing_generation=${actor.fence} AND lease_owner=${database.owner} AND lease_until>clock_timestamp() RETURNING id`;
    if (!rows.length) throw protocolError("STALE_CONNECTION");
    await tx`INSERT INTO character_snapshot(character_id,fencing_generation,profile)
      SELECT ${actor.id},${actor.fence},${cache}::jsonb
      WHERE COALESCE((SELECT created_at<=clock_timestamp()-${CHECKPOINT_HISTORY.intervalSeconds}*interval '1 second'
        FROM character_snapshot WHERE character_id=${actor.id} ORDER BY seq DESC LIMIT 1),true)`;
  }
  // Existing oversized histories drain in bounded batches when their character checkpoints.
  await tx`DELETE FROM character_snapshot WHERE seq IN (
    SELECT seq FROM character_snapshot WHERE character_id=${actor.id}
    AND seq<(SELECT seq FROM character_snapshot WHERE character_id=${actor.id}
      ORDER BY seq DESC OFFSET ${CHECKPOINT_HISTORY.retained - 1} LIMIT 1)
    ORDER BY seq LIMIT ${CHECKPOINT_HISTORY.pruneBatch})`;
}
