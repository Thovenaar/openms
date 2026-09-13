import {
  admitTutorialPortal,
  tutorialPortalKind,
} from "../../client/src/npc/npc-script-portals.js";
import { freshLease, requireInteraction } from "./interaction-common.js";
import { narrativeQuestSystem } from "./interaction-quest-system.js";

/** Call only after currentNpc's actor/session/field/living checks. No placement is invented. */
export function admitVirtualNpc(world, actor, lease) {
  requireInteraction(actor.conversation === lease, "SESSION_EXPIRED");
  requireInteraction(
    lease.source.mapId === actor.profile.location.mapId,
    "STALE_FIELD",
  );
  if (lease.source.kind === "portal") {
    const portal = actor.field.physics.portals.find(
      (entry) => entry.id === lease.source.portalId,
    );
    const program = portalNpcProgram(actor, portal);
    requireInteraction(
      program.openNpc.npcId === lease.npcTemplateId,
      "NOT_ALLOWED",
    );
  } else if (lease.source.kind === "medal") {
    const record = world.content.catalog.quests.records[lease.source.questId];
    const system = narrativeQuestSystem(actor.profile, world);
    requireInteraction(system.isMedalRecord(record), "NOT_ALLOWED");
    const endpoint = record.stages[lease.source.stage];
    requireInteraction(
      (endpoint.check.npc || endpoint.actionCheck.npc) ===
        lease.npcTemplateId && lease.questDialogue?.record.id === record.id,
      "NOT_ALLOWED",
    );
  } else requireInteraction(false, "NOT_ALLOWED");
  return { id: lease.npcId, templateId: lease.npcTemplateId };
}

export function portalNpcProgram(actor, portal) {
  requireInteraction(
    portal && actor.field.physics.portals.includes(portal),
    "NOT_ALLOWED",
  );
  const raw = actor.field.manifest.physics.map.$portalProperties[portal.id];
  requireInteraction(
    tutorialPortalKind(portal, raw) === "tutoChatNPC",
    "NOT_ALLOWED",
  );
  const presentation = actor.field.manifest.portalPresentation.records.find(
    (entry) => entry.portalId === portal.id,
  );
  const program = admitTutorialPortal(presentation?.tutorialProgram);
  requireInteraction(
    program.script === "tutoChatNPC" && program.openNpc.npcId === 2007,
    "CONTENT_MISMATCH",
  );
  return program;
}

export function virtualNpcLease(actor, npcTemplateId, source) {
  const lease = freshLease(actor, {
    id: crypto.randomUUID(),
    templateId: npcTemplateId,
  });
  lease.source = { ...source, mapId: actor.profile.location.mapId };
  return lease;
}
