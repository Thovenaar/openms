const MAX_DROPS = 256;

export function reactorReward(data, descriptor) {
  const id = Number(descriptor.id);
  const program =
    data?.programs?.[id] ?? data?.programs?.[Number(descriptor.resolvedId)];
  if (program?.status !== "drops") return null;
  return { program, rows: data.rows[id] ?? [] };
}

function draw(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Invalid reactor reward random source");
  }
  return value;
}

function append(output, row, count) {
  if (output.count >= MAX_DROPS) {
    throw new Error("Reactor reward batch capacity");
  }
  output.rolls[output.count] = row;
  output.quantities[output.count++] = count;
}

/** Server/offline producer only. Hits submit no item IDs, quantities, chances or quest states. */
export function rollReactorRewards(reward, profile, items, random) {
  const { program, rows } = reward;
  if (rows.length > MAX_DROPS || program.minimumDrops > MAX_DROPS) {
    throw new Error("Reactor reward row capacity");
  }
  const output = { rolls: [], quantities: [], count: 0 };
  for (const row of rows) {
    if (row.questId && profile.quests[row.questId]?.state !== 1) continue;
    if (!items[row.itemId]) {
      throw new Error(`Reactor item metadata missing: ${row.itemId}`);
    }
    if (draw(random) * row.chance < 1) append(output, row, 1);
  }
  const meso = { itemId: 0, questId: 0 };
  const won = program.mesos && draw(random) * program.chance < 1;
  const piles = Math.max(won ? 1 : 0, program.minimumDrops - output.count);
  for (let index = 0; index < piles; index++) {
    const amount =
      program.minimum +
      Math.floor(draw(random) * (program.maximum - program.minimum));
    append(output, meso, amount);
  }
  return output;
}
