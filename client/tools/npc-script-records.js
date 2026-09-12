import { astInventory, spendAnalysisStep } from "./npc-script-ir.js";

function propertyName(node) {
  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }
  return node.property?.type === "Literal" && typeof node.property.value === "string"
    ? node.property.value
    : null;
}

function identifier(node, name) {
  return { type: "Identifier", name, start: node.start, end: node.end, loc: node.loc };
}

function recordFields(node) {
  const fields = new Map();
  for (const property of node.properties) {
    const key = property.key?.type === "Identifier" ? property.key.name : property.key?.value;
    if (property.type !== "Property" || property.computed || property.kind !== "init" ||
        property.method || property.shorthand || typeof key !== "string" || fields.has(key) ||
        ["__proto__", "prototype", "constructor"].includes(key)) {
      throw new Error("NPC record requires unique literal data fields");
    }
    fields.set(key, property.value);
  }
  return fields;
}

function collectRecords(context, root, nodes) {
  const records = new Map();
  for (const statement of root.body) {
    const node = statement.expression;
    if (statement.type !== "ExpressionStatement" || node?.type !== "AssignmentExpression" ||
        node.operator !== "=" || node.left.type !== "Identifier" || node.right.type !== "ObjectExpression") continue;
    if (records.has(node.left.name)) throw new Error("NPC record cannot be reinitialized");
    records.set(node.left.name, { statement, assignment: node, fields: recordFields(node.right), names: new Map() });
  }
  const occupied = new Set(nodes.filter((node) => node.type === "Identifier").map((node) => node.name));
  for (const [name, record] of records) {
    validateRecordUses(context, nodes, name, record);
    for (const key of record.fields.keys()) {
      const generated = `$npcRecord${records.size}_${record.assignment.start}_${record.names.size}`;
      if (occupied.has(generated)) throw new Error("NPC record binding collision");
      record.names.set(key, generated);
    }
  }
  return records;
}

function validateRecordUses(context, nodes, name, record) {
  const allowed = new Set([record.assignment.left]);
  for (const node of nodes) {
    spendAnalysisStep(context, node);
    if (node.type !== "MemberExpression" || node.object?.name !== name) continue;
    const key = propertyName(node);
    if (key === null || ["__proto__", "prototype", "constructor"].includes(key)) {
      throw new Error("NPC record requires a literal field key");
    }
    allowed.add(node.object);
    if (!record.fields.has(key)) record.fields.set(key, identifier(node, "undefined"));
  }
  for (const node of nodes) {
    if (node.type === "Identifier" && node.name === name && !allowed.has(node)) {
      throw new Error("NPC record cannot escape, alias, or shadow its global binding");
    }
  }
}

/** Closed, nonescaping top-level data records become scalar VM bindings, never host objects. */
export function lowerNpcRecords(context, root) {
  const nodes = astInventory(root);
  const records = collectRecords(context, root, nodes);
  for (const node of nodes) {
    if (node.type !== "MemberExpression") continue;
    const record = records.get(node.object?.name);
    if (!record) continue;
    const replacement = identifier(node, record.names.get(propertyName(node)));
    for (const key of Object.keys(node)) delete node[key];
    Object.assign(node, replacement);
  }
  for (const record of records.values()) {
    const body = [];
    for (const [key, value] of record.fields) {
      body.push({ ...record.statement, expression: { ...record.assignment,
        left: identifier(record.assignment.left, record.names.get(key)), right: value } });
    }
    const replacement = { ...record.statement, type: "BlockStatement", body };
    delete replacement.expression;
    Object.assign(record.statement, replacement);
    delete record.statement.expression;
  }
  return root;
}
