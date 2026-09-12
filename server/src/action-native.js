import { validateNativePreferences } from "../../shared/native-presentation.js";
import { nativeQuestViews } from "./native-presentation.js";
import { reject } from "./action-rules.js";

function validateTracked(profile, actor, world) {
  const views = new Map(nativeQuestViews({ ...actor, profile }, world).map((entry) => [entry.id, entry]));
  for (const id of profile.settings.questTracker.ids) {
    if (!views.get(id)?.tracker) reject("NOT_ALLOWED", "Quest cannot be tracked.");
  }
}

/** These closed requests only change admitted preference/notice domains inside the existing transaction. */
export function executeNativePreference(profile, action, context) {
  validateNativePreferences(action);
  if (action.kind === "settings.save") {
    profile.settings = structuredClone(action.settings);
    validateTracked(profile, context.actor, context.world);
  } else if (action.kind === "key-bindings.save") {
    profile.keyBindings = structuredClone(action.keyBindings);
  } else if (action.kind === "skill-macros.save") {
    saveMacros(profile, action.skillMacros, context.world);
  } else if (action.kind === "quest.track") {
    changeTracker(profile, action, context);
  } else if (action.kind === "quest.notice") {
    acknowledgeNotice(profile, action.questId, context);
  } else reject("INVALID_MESSAGE", "Unknown native preference command.");
}

function saveMacros(profile, macros, world) {
  for (const macro of macros) {
    for (const id of macro.skills) {
      if (id && (!world.content.catalog.ui.skills[id] || !(profile.skills[id]?.level > 0))) reject("REQUIREMENTS_NOT_MET", "Macro skill is not learned.");
    }
  }
  profile.skillMacros = structuredClone(macros);
}

function changeTracker(profile, action, context) {
  const tracker = profile.settings.questTracker;
  if (!action.tracked) {
    tracker.ids = tracker.ids.filter((id) => id !== action.questId);
    return;
  }
  if (tracker.ids.includes(action.questId) || tracker.ids.length >= 5) reject("NOT_ALLOWED", "Quest tracker admission failed.");
  tracker.ids.push(action.questId);
  tracker.open = true;
  validateTracked(profile, context.actor, context.world);
}

function acknowledgeNotice(profile, questId, context) {
  const quest = nativeQuestViews({ ...context.actor, profile }, context.world).find((entry) => entry.id === questId);
  const cycle = profile.onlineState?.questCycles?.[questId];
  if (!quest?.ready || !cycle) reject("NOT_ALLOWED", "Quest has no current readiness notice.");
  profile.onlineState.questNotices ??= {};
  profile.onlineState.questNotices[questId] = cycle;
}
