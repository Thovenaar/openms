import { PROFILE_DOMAIN_LIMITS } from "./profile-domains.js";

const MAX_CURSE_WORDS = 8192;
const MAX_WORD_LENGTH = 256;
//00be223c ->00b3726c;007a03f0 removes these before case-insensitive substring matching.
const IGNORED = " _-:\t^.,*/;!\\'\"`+";

export function prepareMacroWords(rules) {
  if (!rules) return null;
  if (
    rules.source !== "Etc.wz:Curse.img" ||
    !Array.isArray(rules.curseWords) ||
    !rules.curseWords.length ||
    rules.curseWords.length > MAX_CURSE_WORDS
  ) {
    throw new Error("Invalid original macro-name dictionary");
  }
  const words = [];
  for (const word of rules.curseWords) {
    if (
      typeof word !== "string" ||
      !word.length ||
      word.length > MAX_WORD_LENGTH ||
      /[^\x20-\x7e]/u.test(word) ||
      word.includes("*")
    ) {
      throw new Error("Unsupported original macro-name dictionary entry");
    }
    words.push(word.toLowerCase());
  }
  return words;
}

/**007a0540 substitutes stars,007a0432 restores ignored punctuation at its original positions. */
export function filterMacroName(text, words) {
  if (
    typeof text !== "string" ||
    text.length > PROFILE_DOMAIN_LIMITS.macroName ||
    /[^\x20-\x7e\u0080-\u{10ffff}]/u.test(text)
  ) {
    throw new Error("Invalid macro name");
  }
  if (!words) {
    throw new Error(
      "Original Etc.wz:Curse.img macro-name dictionary is not packaged",
    );
  }
  let compact = "";
  const positions = [];
  const output = text.split("");
  for (let index = 0; index < text.length; index++) {
    if (IGNORED.includes(text[index])) continue;
    positions.push(index);
    compact += text[index];
  }
  // The dictionary is ASCII. Do not apply Unicode case expansions that change input positions.
  let folded = compact.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  for (const word of words) {
    for (let count = 0; count < PROFILE_DOMAIN_LIMITS.macroName; count++) {
      const start = folded.indexOf(word);
      if (start < 0) break;
      for (let index = start; index < start + word.length; index++) {
        output[positions[index]] = "*";
      }
      folded =
        folded.slice(0, start) +
        "*".repeat(word.length) +
        folded.slice(start + word.length);
    }
  }
  return output.join("");
}
