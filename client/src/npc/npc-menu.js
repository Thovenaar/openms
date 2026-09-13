// Original006d38f3..006d39fd: completable, available, then in-progress.
export const NPC_MENU_HEADINGS = [3, 1, 0];

export function npcQuestGroup(entry) {
  return entry.state === 0 ? 1 : entry.ready ? 0 : 2;
}

/** Original006d3a65..006d3bea resolves the authored script's ScriptInfo label.
 * Unlabelled emulator routes get an explicit talk action instead of a bare NPC name. */
export function npcTalkLabel(template, labels = {}) {
  const rows = template?.sources?.[0]?.metadata ?? [];
  if (rows.length > 32768) throw new Error("NPC metadata exceeds its bound");
  const script = rows.find((row) => row.path === "info/script/0/script")?.value;
  return labels[script] || `Talk to ${template?.name ?? "this NPC"}`;
}
