import { PLAYER_DISEASE_IDS } from "../../client/src/skills/skill-diseases.js";

export function retainsReceivedEffect(actor, now, id, state) {
  return actor.profile.onlineState.effects.some(
    (row) =>
      row.templateId === id &&
      row.id === state.wireId &&
      row.sourceActorId &&
      row.sourceActorId !== actor.id &&
      row.expiresAt > now,
  );
}

/** Cast admission validates authored seconds before this durable timer is installed. */
export function setSkillCooldown(profile, skillId, info, now) {
  const cooldown = Number(info.cooltime ?? 0) * 1000;
  if (cooldown > 0) {
    profile.onlineState.cooldowns[`skill:${skillId}`] = now + cooldown;
  }
}

/** Restore server-owned clocks without granting skill ranks to buff recipients. */
export function hydrateSkillClocks(actor, now) {
  const durable = actor.profile.onlineState;
  for (const [id, state] of actor.skills.states) {
    state.cooldown = Math.max(0, (durable.cooldowns[`skill:${id}`] ?? 0) - now);
  }
  const diseases = actor.skillField?.diseases;
  if (!diseases) return;
  for (const id of PLAYER_DISEASE_IDS) {
    const row = durable.diseases?.find((entry) => entry.id === id);
    diseases.remaining[id] = Math.max(0, (row?.expiresAt ?? 0) - now);
    diseases.values[id] = diseases.remaining[id] ? row.value : 0;
  }
  actor.skillField.synchronizeProfile();
}

/** Reuse bounded disease rows; allocate only when a newly inflicted disease first appears. */
export function syncSkillDiseases(actor, now) {
  const diseases = actor.skillField?.diseases;
  if (!diseases) return;
  const rows = (actor.profile.onlineState.diseases ??= []);
  for (let index = rows.length - 1; index >= 0; index--) {
    if (!diseases.remaining[rows[index].id]) rows.splice(index, 1);
  }
  for (const id of PLAYER_DISEASE_IDS) {
    if (!diseases.remaining[id]) continue;
    let row = rows.find((entry) => entry.id === id);
    if (!row) {
      row = { id, expiresAt: 0, value: 0 };
      rows.push(row);
    }
    row.expiresAt = now + diseases.remaining[id];
    row.value = diseases.values[id];
  }
}
