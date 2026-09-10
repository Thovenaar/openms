import {
  domainArray,
  domainId,
  domainInteger,
  domainInvalid,
  domainKeys,
  domainUnique,
} from "./profile-domain-validation.js";

/** Native macro constructor 008a8504: edit maximum0xc; Cosmic SkillMacroHandler43. */
export const PROFILE_DOMAIN_LIMITS = Object.freeze({
  cashBalance: 2147483647,
  locker: 96,
  gifts: 96,
  giftItems: 96,
  wishlist: 10,
  monsterCards: 4096,
  cardCount: 5,
  macros: 5,
  macroSkills: 3,
  macroName: 12,
});

export function createCash() {
  return {
    balances: { credit: 0, points: 0, prepaid: 0 },
    locker: [],
    wishlist: [],
    gifts: [],
  };
}

export function createSkillMacros() {
  return Array.from({ length: PROFILE_DOMAIN_LIMITS.macros }, () => ({
    name: "",
    skills: [0, 0, 0],
    shout: false,
  }));
}

/** Item validation is supplied by the one inventory schema authority. */
export function validateCash(cash, validateItem) {
  domainKeys(cash, ["balances", "locker", "wishlist", "gifts"], "cash");
  domainKeys(cash.balances, ["credit", "points", "prepaid"], "cash balances");
  for (const value of Object.values(cash.balances)) {
    domainInteger(value, 0, PROFILE_DOMAIN_LIMITS.cashBalance, "cash balance");
  }
  domainArray(cash.locker, PROFILE_DOMAIN_LIMITS.locker, "cash locker");
  for (const entry of cash.locker) {
    validateItem(entry);
    domainInteger(entry.slot, 1, PROFILE_DOMAIN_LIMITS.locker, "locker slot");
  }
  domainUnique(
    cash.locker.map((entry) => entry.slot),
    "locker slots",
  );
  domainArray(cash.wishlist, PROFILE_DOMAIN_LIMITS.wishlist, "cash wishlist");
  for (const sn of cash.wishlist) {
    domainInteger(sn, 1, 2147483647, "commodity SN");
  }
  domainUnique(cash.wishlist, "cash wishlist");
  domainArray(cash.gifts, PROFILE_DOMAIN_LIMITS.gifts, "cash gifts");
  let pendingInstances = 0;
  for (const gift of cash.gifts) {
    validateGift(gift, validateItem);
    pendingInstances += gift.items.length;
    if (pendingInstances > PROFILE_DOMAIN_LIMITS.giftItems) {
      domainInvalid("pending gift item capacity");
    }
  }
}

function validateGift(gift, validateItem) {
  domainKeys(
    gift,
    ["uid", "senderId", "senderName", "message", "sn", "items"],
    "gift",
  );
  domainId(gift.uid, "gift uid");
  domainId(gift.senderId, "gift sender");
  if (gift.senderId.length > 64) domainInvalid("gift sender character id");
  if (
    typeof gift.senderName !== "string" ||
    !gift.senderName.trim() ||
    gift.senderName.length > 32
  ) {
    domainInvalid("gift sender name");
  }
  if (typeof gift.message !== "string" || gift.message.length > 256) {
    domainInvalid("gift message");
  }
  domainInteger(gift.sn, 1, 2147483647, "gift commodity SN");
  domainArray(gift.items, PROFILE_DOMAIN_LIMITS.giftItems, "gift items");
  if (!gift.items.length) domainInvalid("empty gift items");
  for (const item of gift.items) {
    validateItem(item);
    domainInteger(item.slot, 1, PROFILE_DOMAIN_LIMITS.locker, "gift item slot");
  }
}

export function validateMonsterBook(value) {
  domainKeys(value, ["cards", "cover"], "monsterBook");
  validateMonsterCards(value.cards);
  if (
    value.cover !== 0 &&
    (!Number.isInteger(value.cover) ||
      !Object.hasOwn(value.cards, String(value.cover)))
  ) {
    domainInvalid("monsterBook cover");
  }
}

function validateMonsterCards(cards) {
  if (!cards || typeof cards !== "object" || Array.isArray(cards)) {
    domainInvalid("monsterBook cards");
  }
  const prototype = Object.getPrototypeOf(cards);
  if (prototype !== Object.prototype && prototype !== null) {
    domainInvalid("monsterBook cards");
  }
  const ids = Reflect.ownKeys(cards);
  if (ids.length > PROFILE_DOMAIN_LIMITS.monsterCards) {
    domainInvalid("monsterBook capacity");
  }
  for (const id of ids) {
    if (typeof id !== "string" || !/^238\d{4}$/.test(id)) {
      domainInvalid("monsterBook item id");
    }
    const descriptor = Object.getOwnPropertyDescriptor(cards, id);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      domainInvalid("monsterBook card");
    }
    domainInteger(
      descriptor.value,
      1,
      PROFILE_DOMAIN_LIMITS.cardCount,
      "monsterBook count",
    );
  }
}

export function validateSkillMacros(value) {
  domainArray(value, PROFILE_DOMAIN_LIMITS.macros, "skillMacros");
  if (value.length !== PROFILE_DOMAIN_LIMITS.macros) {
    domainInvalid("skillMacros count");
  }
  for (const macro of value) {
    domainKeys(macro, ["name", "skills", "shout"], "skill macro");
    if (
      typeof macro.name !== "string" ||
      macro.name.length > PROFILE_DOMAIN_LIMITS.macroName
    ) {
      domainInvalid("macro name");
    }
    domainArray(
      macro.skills,
      PROFILE_DOMAIN_LIMITS.macroSkills,
      "macro skills",
    );
    if (
      macro.skills.length !== PROFILE_DOMAIN_LIMITS.macroSkills ||
      typeof macro.shout !== "boolean"
    ) {
      domainInvalid("macro settings");
    }
    for (const id of macro.skills) {
      domainInteger(id, 0, 0xffffffff, "macro skill id");
    }
  }
}
