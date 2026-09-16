// Authorized Cosmic portal sources. These are exact closed programs, not arbitrary JavaScript.
export const TUTORIAL_PORTAL_PROGRAMS = Object.freeze({
  tutoChatNPC: Object.freeze({
    schemaVersion: 1,
    script: "tutoChatNPC",
    source: "scripts/portal/tutoChatNPC.js",
    sha256: "a3a95daa99e103a322871508d5f5f590792d8cf7a9346f745751c2ba31775169",
    branches: Object.freeze([]),
    openNpc: Object.freeze({ npcId: 2007, minimumAccountLevel: 30 }),
    blockPortal: true,
    result: true,
  }),
  infoMinimap: Object.freeze({
    schemaVersion: 1,
    script: "infoMinimap",
    source: "scripts/portal/infoMinimap.js",
    sha256: "a16aabd97ac1aed32d742dd1b6fa4f5a4c0cee3c003d8b9d8df69a6466983938",
    branches: Object.freeze([
      Object.freeze({ questId: 1031, state: 1, path: "UI/tutorial.img/25" }),
    ]),
    blockPortal: true,
    result: true,
  }),
  infoPickup: Object.freeze({
    schemaVersion: 1,
    script: "infoPickup",
    source: "scripts/portal/infoPickup.js",
    sha256: "3119f070a4a60b212c4e1ddfa07a519fae23a05a48ea61f7f99eb51060225a09",
    branches: Object.freeze([
      Object.freeze({ questId: 1035, state: 1, path: "UI/tutorial.img/21" }),
    ]),
    blockPortal: true,
    result: true,
  }),
  infoReactor: Object.freeze({
    schemaVersion: 1,
    script: "infoReactor",
    source: "scripts/portal/infoReactor.js",
    sha256: "1c488e986e6b9ed5405e84136a7b98ee986144b16b8c2046cdbf938efe4c0272",
    branches: Object.freeze([
      Object.freeze({ questId: 1008, state: 2, path: "UI/tutorial.img/22" }),
      Object.freeze({ questId: 1020, state: 2, path: "UI/tutorial.img/27" }),
    ]),
    blockPortal: true,
    result: true,
  }),
});

/** Conversations a tutorial portal may still admit but must no longer offer.
 *
 *  `scripts/npc/2007.js` (Shanks, Maple Island) is the "Would you like to skip the tutorials
 *  and head straight to Lith Harbor?" prompt: answering yes warps to 104000000. The original
 *  client only renders what the server script asks for, so removing the option is a content
 *  policy, not a client change. This project removes it, so the `tutoChatNPC` portal opens no
 *  NPC and the skip prompt is never shown. */
export const REMOVED_TUTORIAL_NPCS = Object.freeze(new Set([2007]));

/** Only these complete closed programs may enter the portal authority. */
export function admitTutorialPortal(program) {
  const expected = TUTORIAL_PORTAL_PROGRAMS[program?.script];
  if (!expected || JSON.stringify(program) !== JSON.stringify(expected)) {
    throw new Error("Tutorial portal source program is missing or altered");
  }
  return expected;
}

/** A removed conversation is treated as absent, never as a missing/broken program. */
export function tutorialNpcOffered(program) {
  return Boolean(
    program?.openNpc && !REMOVED_TUTORIAL_NPCS.has(program.openNpc.npcId),
  );
}

export function tutorialPortalKind(portal, raw) {
  return portal.type === 9 &&
    portal.targetMap === 999999999 &&
    Object.hasOwn(TUTORIAL_PORTAL_PROGRAMS, raw.script)
    ? raw.script
    : null;
}

/** Source branch order is significant: infoReactor's completed-1008 branch wins. */
export function resolveTutorialPortal(program, profile) {
  const source = admitTutorialPortal(program);
  if (!profile?.quests) {
    throw new Error(
      "Tutorial portal requires the active character quest ledger",
    );
  }
  for (const branch of source.branches) {
    const state = profile.quests[branch.questId]?.state ?? 0;
    if (![0, 1, 2].includes(state)) {
      throw new Error("Invalid tutorial quest state");
    }
    if (state === branch.state) return branch.path;
  }
  return null;
}
