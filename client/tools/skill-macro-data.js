import { resolveNode } from "../src/assets/image.js";

const MAX_CURSE_WORDS = 8192;
const MAX_WORD_LENGTH = 256;

/**007a06f3 loads the original ordered Etc/Curse.img dictionary; no community word list. */
export async function extractSkillMacroRules(context) {
  const root = await context.image("Etc", "Curse.img");
  const keys = Object.keys(root.children);
  if (keys.length === 0 || keys.length > MAX_CURSE_WORDS) {
    throw new Error(
      "Original macro-name dictionary is empty or exceeds its budget",
    );
  }
  const curseWords = [];
  for (let index = 0; index < keys.length; index++) {
    const word = resolveNode(root.children[String(index)])?.value;
    if (
      typeof word !== "string" ||
      word.length === 0 ||
      word.length > MAX_WORD_LENGTH ||
      /[^\x20-\x7e]/u.test(word) ||
      word.includes("*")
    ) {
      throw new Error(`Unsupported original macro dictionary entry ${index}`);
    }
    curseWords.push(word);
  }
  return { source: "Etc.wz:Curse.img", curseWords };
}
