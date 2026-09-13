import { QuestSystem } from "../../client/src/quests/quest-system.js";

/** Original quest rules on a detached server draft, never a browser persistence owner. */
export function narrativeQuestSystem(profile, world, exclusions = new Set()) {
  const store = {
    profile,
    profileTransactionPending: false,
    commitProfile: async (mutate) => mutate(profile),
  };
  const system = new QuestSystem(world.content.catalog.quests, store, {
    onError: (error) => {
      throw error;
    },
    mapName: (id) => world.content.catalog.mapNames[id],
  });
  system.trackerExclusions = exclusions;
  return system;
}

/** Complete Title criteria and admissions are the original quest service projection. */
export function nativeMedalViews(actor, world) {
  return narrativeQuestSystem(actor.profile, world).medalEntries();
}
