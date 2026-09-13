import { referenceKey } from "./definitions.js";
import { requireContent } from "./validation.js";
import { canonical, digest } from "./digest.js";

/** Separate custom gameplay identity from the original appearance and source provenance. */
export function compileMob(row, dependencies, appearance) {
  const base = dependencies.get(referenceKey(row.definition.base));
  const template = structuredClone(base.template);
  const visual = structuredClone(appearance ?? base.visual);
  template.sourceTemplateId = template.originalId;
  template.originalId = String(row.runtimeId);
  template.key = `mob:${row.runtimeId}`;
  template.name = row.name;
  template.info = { ...template.info, ...row.definition.stats };
  template.provenance = {
    source: "custom",
    id: row.id,
    revision: row.revision,
  };
  if (appearance) replaceActions(template, visual, row.definition.appearance);
  requireContent(
    visual.entity.actions[template.defaultAction],
    "Appearance lacks the base monster's default action",
  );
  visual.entity.kind = "mob";
  visual.entity.action = template.defaultAction;
  return { kind: "mob", template, visual };
}

function replaceActions(template, visual, appearance) {
  // Attack timing and body shapes cannot be borrowed from a different animation set.
  requireContent(
    (template.combat?.attacks?.length ?? 0) === 0,
    "Appearance replacement for attacking monsters is not supported yet",
  );
  requireContent(
    appearance.source === "upload",
    "A different original appearance requires explicit body/timing authoring",
  );
  const actions = Object.create(null);
  for (const [name, frames] of Object.entries(appearance.actions)) {
    requireContent(
      frames.every((frame) => frame.body),
      "Monster frames require explicit body rectangles",
      name,
    );
    actions[name] = {
      timingKnown: true,
      frames: frames.map((frame) => ({
        delayMs: frame.delay,
        body: frame.body ?? null,
      })),
    };
  }
  for (const name of Object.keys(template.actions)) {
    requireContent(
      visual.entity.actions[name],
      `Appearance lacks required action: ${name}`,
    );
  }
  template.actions = actions;
  template.artworkStatus = "custom-action-artwork";
  template.artworkHash = digest(canonical(visual));
}
