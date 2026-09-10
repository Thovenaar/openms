import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { itemTooltip } from "./ui-tooltip.js";

const MAX_EPISODE_CHARACTERS = 32768;
const MAX_EPISODE_LINES = 4096;
const EPISODE_LINES_PER_PAGE = 14;
const LOCATIONS_PER_PAGE = 11;
const REWARDS_PER_PAGE = 20; // 00863717: four columns, five rows,36px spacing.

export function bookText(layer, text, rect, align = "left") {
  const label = layer.text(text, rect.x, rect.y, rect.width);
  label.style.cssText += `font:12px/16px Arial,sans-serif;color:#33251b;text-align:${align};white-space:pre-wrap;overflow-wrap:break-word;`;
  return label;
}

/** Original literal newline escapes are text, never HTML. Bounded measurement occurs only on selection. */
export function episodePages(text) {
  if (text === null) return null;
  if (typeof text !== "string" || text.length > MAX_EPISODE_CHARACTERS) {
    throw new Error("Invalid Monster Book episode");
  }
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Monster Book text requires Canvas2D");
  context.font = "12px Arial";
  const lines = [];
  const paragraphs = text.replace(/\\r\\n|\\n|\\r/g, "\n").split("\n");
  for (const paragraph of paragraphs) {
    let line = "";
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > 200) {
        const space = line.lastIndexOf(" ");
        if (space > 0) {
          lines.push(line.slice(0, space));
          line = line.slice(space + 1);
        } else {
          lines.push(line);
          line = "";
        }
      }
      line += char;
      if (lines.length >= MAX_EPISODE_LINES) {
        throw new Error("Monster Book episode line limit");
      }
    }
    lines.push(line);
  }
  const pages = [];
  for (
    let offset = 0;
    offset < lines.length;
    offset += EPISODE_LINES_PER_PAGE
  ) {
    pages.push(lines.slice(offset, offset + EPISODE_LINES_PER_PAGE).join("\n"));
  }
  return pages;
}

/** Native00867240..008673ce groups street headings into11rows and never orphans a heading. */
export function locationPages(locations) {
  if (locations === null) return null;
  const pages = [];
  let page = [],
    street;
  for (const location of locations) {
    const heading =
      location.streetName !== null &&
      (page.length === 0 || street !== location.streetName);
    if (page.length + (heading ? 2 : 1) > LOCATIONS_PER_PAGE) {
      pages.push(page);
      page = [];
    }
    if (
      location.streetName !== null &&
      (page.length === 0 || street !== location.streetName)
    ) {
      page.push({ text: location.streetName, heading: true });
    }
    page.push({
      text:
        location.name ?? `Original map name unavailable (${location.mapId})`,
      heading: false,
    });
    street = location.streetName;
  }
  if (page.length) pages.push(page);
  return pages;
}

export function detailPageCount(card, state) {
  if (!card) return 1;
  if (state.tab === 1) return Math.max(1, state.episode?.length ?? 0);
  if (state.tab === 2) {
    return Math.max(
      1,
      Math.ceil((card.rewards?.length ?? 0) / REWARDS_PER_PAGE),
    );
  }
  if (state.tab === 3) return Math.max(1, state.locations?.length ?? 0);
  return 1;
}

async function loadPortrait(layer, card, count, signal) {
  if (!card.portrait.available) {
    bookText(layer, card.portrait.reason, { x: 250, y: 90, width: 200 });
    return;
  }
  const resource = await loadVisualBundle(
    card.portrait.descriptor,
    layer.owner.services,
    signal,
  );
  if (signal.aborted || layer.disposed) {
    resource.destroy();
    signal.throwIfAborted();
    return;
  }
  layer.dependencies.push(resource);
  const source = resource.manifest.entities[0];
  const action = `rank${count}`;
  if (!source.actions[action]) {
    throw new Error("Original ranked Monster Book portrait is unavailable");
  }
  const sprite = new EntityAnimation(
    { ...source, action, actions: { [action]: source.actions[action] } },
    resource.textures,
  );
  const bounds = resource.manifest.metadata.bounds;
  // Original right content layer starts(240,20), is220px wide. No art stretching.
  sprite.setPosition(
    350 - (bounds.left + bounds.right) / 2,
    250 - bounds.bottom,
  );
  layer.root.addChild(sprite.container);
  layer.sprites.push(sprite);
  layer.timedSprites.push(sprite);
}

async function basicPage(layer, card, count, signal) {
  if (!count) return;
  const hp =
    count > 1 && card.info.maxHP !== undefined ? card.info.maxHP : "???";
  const mp =
    count > 1 && card.info.maxMP !== undefined ? card.info.maxMP : "???";
  // Original strings at00b3a2ac..d0; 00865782 reveals HP/MP only above card rank1.
  bookText(
    layer,
    `HP : ${hp}   MP : ${mp}`,
    { x: 278, y: 289, width: 130 },
    "center",
  );
  await loadPortrait(layer, card, count, signal);
}

function locationsPage(layer, state) {
  if (state.locations === null) {
    bookText(layer, "Original location information is unavailable.", {
      x: 250,
      y: 60,
      width: 200,
    });
    return;
  }
  const page = state.locations[state.detailPage] ?? [];
  for (let index = 0; index < page.length; index++) {
    const row = page[index],
      x = row.heading ? 260 : 272,
      y = 60 + index * 19;
    const label = bookText(layer, row.text, { x, y, width: 440 - x });
    label.style.cssText += `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:${row.heading ? "bold" : "normal"};`;
    layer.hit(
      row.text,
      { x, y, width: 440 - x, height: 18 },
      {},
      { tooltip: row.text },
    );
  }
}

function episodePage(layer, state) {
  const prose =
    state.episode?.[state.detailPage] ??
    "Original episode information is unavailable.";
  bookText(layer, prose, { x: 250, y: 52, width: 200 });
}

async function rewardPage(layer, card, state, signal) {
  if (card.rewards === null) {
    bookText(layer, "Original drop information is unavailable.", {
      x: 250,
      y: 60,
      width: 200,
    });
    return;
  }
  const start = state.detailPage * REWARDS_PER_PAGE;
  const end = Math.min(card.rewards.length, start + REWARDS_PER_PAGE);
  for (let index = start; index < end; index++) {
    const id = card.rewards[index],
      template = layer.owner.index.items[id];
    const position = index - start;
    const rect = {
      x: 278 + (position % 4) * 36,
      y: 80 + Math.floor(position / 4) * 36,
      width: 32,
      height: 32,
    };
    if (template?.descriptor) {
      const resource = await loadVisualBundle(
        template.descriptor,
        layer.owner.services,
        signal,
      );
      if (signal.aborted || layer.disposed) {
        resource.destroy();
        signal.throwIfAborted();
        return;
      }
      layer.dependencies.push(resource);
      layer.borrow(resource);
      if (template.iconPath) {
        layer.image(template.iconPath, rect.x, rect.y + 32, true);
      }
    }
    const name =
      template?.name ??
      layer.owner.index.itemNames?.[id] ??
      "Original item name unavailable";
    layer.hit(
      name,
      rect,
      {},
      { tooltip: () => itemTooltip(layer.owner, template, id) },
    );
  }
}

/** Replacement is all-or-nothing; abort/close never publishes a stale asynchronous detail page. */
export async function drawBookDetails(layer, service, state, signal) {
  if (state.category === 9) return;
  const card = service.data.cards[state.selected];
  if (!card) return;
  const count = service.snapshot().cards[card.itemId] ?? 0;
  const title = bookText(
    layer,
    card.name ?? "Original monster name unavailable",
    { x: 250, y: 30, width: 195 },
    "center",
  );
  title.style.fontWeight = "bold";
  if (state.tab === 0) await basicPage(layer, card, count, signal);
  else if (state.tab === 1 && count >= 3) episodePage(layer, state);
  else if (state.tab === 2 && count >= 4) {
    await rewardPage(layer, card, state, signal);
  } else if (state.tab === 3 && count >= 5) locationsPage(layer, state);
  drawDetailPagination(layer, card, state, count);
}

function drawDetailPagination(layer, card, state, count) {
  if (state.tab !== 0 && count >= [1, 3, 4, 5][state.tab]) {
    bookText(
      layer,
      `${state.detailPage + 1} / ${detailPageCount(card, state)}`,
      { x: 314, y: 287, width: 72 },
      "center",
    );
  }
}
