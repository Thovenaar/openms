import { domainInvalid, domainKeys } from "./profile-domain-validation.js";

/** GameOpt00993a30/009940bd original checkbox records; allowGame has no offline minigame consumer. */
export const GAME_OPTION_FIELDS = Object.freeze([
  "allowWhisper",
  "allowFriend",
  "allowMessenger",
  "allowTrade",
  "allowParty",
  "allowPartySearch",
  "allowGame",
  "allowGuildChat",
  "allowGuildInvite",
  "allowAllianceChat",
  "allowAllianceInvite",
  "allowFamily",
]);

export function createGameOptions() {
  const result = {};
  for (const field of GAME_OPTION_FIELDS) result[field] = true;
  return result;
}

export function validateGameOptions(value) {
  domainKeys(value, GAME_OPTION_FIELDS, "game options");
  for (const field of GAME_OPTION_FIELDS) {
    if (typeof value[field] !== "boolean") {
      domainInvalid(`game option ${field}`);
    }
  }
}
