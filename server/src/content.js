import { openOriginalContent } from "@openms/content/original";
import { prepareOnlineQuests } from "./quest-lifecycle.js";

/** Load once before listening. No input extraction or browser/offline-release rebuild. */
export async function loadContent(options = {}) {
  const content = await openOriginalContent(options);
  await prepareOnlineQuests(content);
  await content.map(content.catalog.defaultMap);
  return content;
}
