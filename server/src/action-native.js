import { onlineQuestCatalog } from "./quest-lifecycle.js";
import { validateNativePreferences } from "../../shared/native-presentation.js";
import { nativeQuestViews } from "./native-presentation.js";
import { reject } from "./action-rules.js";
import { narrativeQuestSystem } from "./interaction-quest-system.js";
import { questObjectives } from "../../client/src/quests/quest-journal-model.js";

function validateTracked(profile, world) {
  const system = narrativeQuestSystem(profile, world);
  for (const id of profile.settings.questTracker.ids) {
    const record = system.catalog.records[id];
    if (
      !system.isTrackerQuest(record, id, profile) ||
      !questObjectives(system, record, profile).length
    ) {
      reject("NOT_ALLOWED", "Quest cannot be tracked.");
    }
  }
}

/** These closed requests only change admitted preference/notice domains inside the existing transaction. */
export async function executeNativePreference(profile, action, context) {
  validateNativePreferences(action);
  if (action.kind === "settings.save") {
    profile.settings = structuredClone(action.settings);
    validateTracked(profile, context.world);
  } else if (action.kind === "key-bindings.save") {
    profile.keyBindings = structuredClone(action.keyBindings);
  } else if (action.kind === "skill-macros.save") {
    saveMacros(profile, action.skillMacros, context.world);
  } else if (action.kind === "quest.track") {
    changeTracker(profile, action, context);
  } else if (action.kind === "quest.notice") {
    acknowledgeNotice(profile, action.questId, context);
  } else reject("INVALID_MESSAGE", "Unknown native preference command.");
  if (action.kind === "quest.track") {
    const exclusions = new Set(context.actor.questTrackerExclusions);
    if (!action.tracked) exclusions.add(action.questId);
    await autoRegisterQuests(profile, context.world, exclusions);
  }
}

function saveMacros(profile, macros, world) {
  for (const macro of macros) {
    for (const id of macro.skills) {
      if (
        id &&
        (!world.content.catalog.ui.skills[id] ||
          !(profile.skills[id]?.level > 0))
      ) {
        reject("REQUIREMENTS_NOT_MET", "Macro skill is not learned.");
      }
    }
  }
  profile.skillMacros = structuredClone(macros);
}

function changeTracker(profile, action, context) {
  const tracker = profile.settings.questTracker;
  if (!action.tracked) {
    if (!onlineQuestCatalog(context.world.content).records[action.questId]) {
      reject("NOT_ALLOWED", "Unknown original quest.");
    }
    tracker.ids = tracker.ids.filter((id) => id !== action.questId);
    return;
  }
  if (tracker.ids.includes(action.questId) || tracker.ids.length >= 5) {
    reject("NOT_ALLOWED", "Quest tracker admission failed.");
  }
  tracker.ids.push(action.questId);
  tracker.open = true;
  validateTracked(profile, context.world);
}

function acknowledgeNotice(profile, questId, context) {
  const quest = nativeQuestViews(
    { ...context.actor, profile },
    context.world,
  ).find((entry) => entry.id === questId);
  const cycle = profile.onlineState?.questCycles?.[questId];
  if (!quest?.ready || !cycle) {
    reject("NOT_ALLOWED", "Quest has no current readiness notice.");
  }
  profile.onlineState.questNotices ??= {};
  profile.onlineState.questNotices[questId] = cycle;
}

/** Event-time registration shares the offline quest service; the enclosing DB owns commit. */
export async function autoRegisterQuests(profile, world, exclusions) {
  if (!profile.settings.questTracker.auto) return;
  await narrativeQuestSystem(profile, world, exclusions).autoRegister();
}

/** Exclusions last one play lifetime and change only after the preference is durable. */
export function commitNativePreference(actor, action, receipt) {
  if (
    receipt.status === "committed" &&
    action.kind === "quest.track" &&
    !action.tracked
  ) {
    actor.questTrackerExclusions ??= new Set();
    actor.questTrackerExclusions.add(action.questId);
  }
}
