import { requireContent } from "./validation.js";

/** Compile one authored conversation into the immutable overlay record for its NPC. */
export function compileDialogue(row, registry) {
  const value = row.definition;
  requireContent(
    Object.hasOwn(registry.catalog.ui?.npcPortraits ?? {}, value.target.id),
    "Original NPC is unavailable in this build",
    "target/id",
  );
  return {
    kind: "dialogue",
    npcId: value.target.id,
    start: value.start,
    nodes: value.nodes.map((node) => ({
      id: node.id,
      text: node.text,
      options: node.options.map((option) => ({
        label: option.label,
        next: option.next,
      })),
    })),
  };
}
