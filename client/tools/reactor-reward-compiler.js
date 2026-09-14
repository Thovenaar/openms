import { parse } from "acorn";

/** Closed content reader: accept only an act function containing one literal dropItems call. */
export function compileReactorReward(file) {
  const provenance = { source: file.source, sha256: file.sha256 };
  const blocked = { ...provenance, status: "unsupported-script" };
  if (file.text.length > 1000000) throw new Error("Reactor source byte bound");
  let program;
  try {
    program = parse(file.text, { ecmaVersion: 2020 });
  } catch {
    return blocked;
  }
  const call = dropCall(program);
  if (!call) return blocked;
  const policy = dropPolicy(call.arguments.map((argument) => argument.value));
  if (!policy) return blocked;
  return {
    ...provenance,
    status: "drops",
    ...policy,
  };
}

function dropCall(program) {
  const declaration = program.body[0];
  if (
    program.body.length !== 1 ||
    declaration?.type !== "FunctionDeclaration" ||
    declaration.id?.name !== "act" ||
    declaration.params.length ||
    declaration.body.body.length !== 1
  ) {
    return null;
  }
  const statement = declaration.body.body[0];
  return isDropCall(statement) ? statement.expression : null;
}

function isDropCall(statement) {
  const call = statement.expression;
  return (
    statement.type === "ExpressionStatement" &&
    call?.type === "CallExpression" &&
    call.callee.type === "MemberExpression" &&
    !call.callee.computed &&
    call.callee.object.name === "rm" &&
    call.callee.property.name === "dropItems" &&
    [0, 4, 5].includes(call.arguments.length) &&
    call.arguments.every((argument) => argument.type === "Literal")
  );
}

function validRange(chance, minimum, maximum, minimumDrops) {
  return (
    [chance, minimum, maximum, minimumDrops].every(Number.isSafeInteger) &&
    chance >= 0 &&
    minimum >= 0 &&
    maximum >= minimum &&
    maximum <= 2147483647 &&
    minimumDrops >= 0 &&
    minimumDrops <= 256
  );
}

function dropPolicy([
  mesos = false,
  chance = 0,
  minimum = 0,
  maximum = 0,
  minimumDrops = 0,
]) {
  if (typeof mesos !== "boolean") return null;
  if (!validRange(chance, minimum, maximum, minimumDrops)) return null;
  if ((mesos || minimumDrops) && (chance < 1 || minimum < 1)) return null;
  return { mesos, chance, minimum, maximum, minimumDrops };
}

/** Preserve denominators and quest gates; SQL is content, never executable server code. */
export function reactorDropContent(dataset, programs) {
  const source = dataset.tables.reactordrops;
  if (!Array.isArray(source) || source.length > 200000) {
    throw new Error("Reactor drop row bound");
  }
  const rows = Object.create(null);
  for (const row of source) {
    if (
      ![row.reactorid, row.itemid, row.chance, row.questid].every(
        Number.isSafeInteger,
      ) ||
      row.reactorid < 0 ||
      row.itemid < 1000000 ||
      row.itemid >= 6000000 ||
      row.questid < -1
    ) {
      throw new Error("Invalid reactor drop row");
    }
    if (row.chance < 0) continue;
    const entries = (rows[row.reactorid] ??= []);
    if (entries.length >= 256) {
      throw new Error("Reactor drop per-template bound");
    }
    entries.push({
      itemId: row.itemid,
      chance: row.chance,
      questId: Math.max(0, row.questid),
    });
  }
  return { programs, rows, sources: dataset.tableSources.reactordrops };
}
