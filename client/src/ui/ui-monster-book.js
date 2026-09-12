import {
  bookText,
  detailPageCount,
  drawBookDetails,
  episodePages,
  locationPages,
} from "./ui-monster-book-pages.js";

const GRID_COLUMNS = 5;
const GRID_PAGE = 25;
const TABS = ["Basic Info", "Episode", "Dropping", "Found In"];
const TAB_COUNTS = [1, 3, 4, 5];

function selectedCard(service, state) {
  return service.data.cards[state.selected] ?? null;
}

function gridPages(service, state) {
  return state.category === 9
    ? 1
    : Math.max(
        1,
        Math.ceil(
          service.data.categories[state.category].cardIds.length / GRID_PAGE,
        ),
      );
}

function closeContext(panel) {
  panel.bookContext?.destroy();
  panel.bookContext = null;
}

function showFailure(panel, outcome) {
  if (!outcome.ok && !panel.disposed) {
    panel.owner.report(new Error(outcome.reason));
    const point = { x: panel.x + 235, y: panel.y + 310 };
    panel.owner.showTooltip(outcome.reason, point.x, point.y, panel.element);
  }
}

function chooseCover(panel, service, itemId) {
  closeContext(panel);
  service.setCover(itemId).then(
    (outcome) => showFailure(panel, outcome),
    (error) => panel.owner.report(error),
  );
}

/** Native right-button UP opens register/release; dismissing the menu never changes a save. */
function coverContext(panel, service, itemId, event) {
  event.preventDefault();
  const state = panel.monsterBookState;
  if (state.selected !== itemId) selectCard(panel, service, itemId);
  closeContext(panel);
  const point = panel.owner.logicalPointer(event);
  const x = Math.max(0, Math.min(386, point.x - panel.x));
  const y = Math.max(0, Math.min(291, point.y - panel.y));
  const layer = panel.layer("Monster Book cover menu");
  panel.bookContext = layer;
  layer.image("MonsterBook/ContextMenu/t", x, y);
  layer.image("MonsterBook/ContextMenu/c", x, y + 19);
  layer.image("MonsterBook/ContextMenu/s", x, y + 32);
  const view = service.snapshot();
  layer.button("MonsterBook/ContextMenu/BtRegister", x + 2, y + 3, {
    label: "Register book cover",
    disabled: !view.cards[itemId] || view.cover === itemId,
    action: () => chooseCover(panel, service, itemId),
  });
  layer.button("MonsterBook/ContextMenu/BtRelease", x + 2, y + 18, {
    label: "Release book cover",
    disabled: view.cover === 0,
    action: () => chooseCover(panel, service, 0),
  });
  layer.renderArtwork();
}

function cardTooltip(panel, service, card) {
  const count = service.snapshot().cards[card.itemId] ?? 0;
  return {
    title: card.name ?? "Original monster name unavailable",
    lines: [{ text: `${count} / 5`, tone: "normal" }],
    source: { surface: panel, path: card.iconPath },
  };
}

function drawCard(panel, layer, service, entry) {
  const { card, slot } = entry;
  const x = 48 + (slot % GRID_COLUMNS) * 33;
  const y = 56 + Math.floor(slot / GRID_COLUMNS) * 45;
  const view = service.snapshot(),
    count = view.cards[card.itemId] ?? 0;
  const image = layer.image(count ? card.iconPath : card.unownedIconPath, x, y);
  // Native00863df1 draws unowned card artwork at alpha0x55, not an encounter unlock.
  image.container.alpha = count ? 1 : 85 / 255;
  if (count === 5) layer.image("MonsterBook/fullMark", x + 1, y + 26);
  else if (count > 0) layer.image(`ItemNo/${count}`, x + 1, y + 26);
  if (view.cover === card.itemId) {
    layer.image("MonsterBook/cover", x - 2, y - 2);
  }
  if (panel.monsterBookState.selected === card.itemId) {
    layer.image("MonsterBook/select", x - 2, y - 2);
  }
  const hit = layer.hit(
    card.name ?? "Monster card",
    { x, y, width: 27, height: 38 },
    {
      pointerdown: (event) => {
        if (event.button === 0) selectCard(panel, service, card.itemId);
      },
      click: (event) => {
        if (event.detail === 0) selectCard(panel, service, card.itemId);
      },
      contextmenu: (event) => coverContext(panel, service, card.itemId, event),
    },
    { tooltip: () => cardTooltip(panel, service, card) },
  );
  hit.dataset.cardItemId = String(card.itemId);
  hit.dataset.cardCount = String(count);
  hit.setAttribute(
    "aria-pressed",
    String(panel.monsterBookState.selected === card.itemId),
  );
}

function drawSummary(layer, service) {
  const view = service.snapshot();
  layer.image("MonsterBook/infoPage", 40, 30);
  layer.image(`MonsterBook/icon/${view.level - 1}`, 117, 43);
  const rows = [
    [view.level, 30],
    [view.total, 81],
    [view.special, 114],
    [view.normal, 133],
  ];
  for (const [value, y] of rows) {
    bookText(layer, String(value), { x: 145, y, width: 35 }, "right");
  }
  const cover = service.data.cards[view.cover];
  if (cover) {
    bookText(
      layer,
      cover.name ?? "Original monster name unavailable",
      { x: 81, y: 171, width: 100 },
      "right",
    );
  }
}

function drawGrid(panel, service) {
  const state = panel.monsterBookState;
  const layer = panel.layer("Monster Book cards");
  if (state.category === 9) drawSummary(layer, service);
  else {
    layer.image("MonsterBook/cardSlot", 40, 25);
    const ids = service.data.categories[state.category].cardIds;
    const start = state.page * GRID_PAGE,
      end = Math.min(start + GRID_PAGE, ids.length);
    for (let index = start; index < end; index++) {
      drawCard(panel, layer, service, {
        card: service.data.cards[ids[index]],
        slot: index - start,
      });
    }
    bookText(
      layer,
      `${state.page + 1} / ${gridPages(service, state)}`,
      { x: 89, y: 287, width: 74 },
      "center",
    );
  }
  panel.bookGrid?.destroy();
  panel.bookGrid = layer;
}

function selectCard(panel, service, itemId) {
  const state = panel.monsterBookState,
    card = service.data.cards[itemId];
  if (!card) return;
  const ids = service.data.categories[card.category].cardIds;
  state.category = card.category;
  panel.owner.rememberTab("MonsterBook.category", card.category);
  state.page = Math.floor(ids.indexOf(itemId) / GRID_PAGE);
  state.selected = itemId;
  state.tab = restoredDetailTab(panel, service);
  state.detailPage = 0;
  state.episode = episodePages(card.episode);
  state.locations = locationPages(card.locations);
  service.markViewed(card.category);
  renderBook(panel, service);
}

function chooseCategory(panel, service, category) {
  const state = panel.monsterBookState;
  state.category = category;
  panel.owner.rememberTab("MonsterBook.category", category);
  state.page = 0;
  state.tab = 0;
  state.detailPage = 0;
  if (category !== 9) {
    const id = service.data.categories[category].cardIds[0];
    if (id) {
      selectCard(panel, service, id);
      return;
    }
  }
  state.selected = 0;
  renderBook(panel, service);
}

function chooseTab(panel, service, tab) {
  const state = panel.monsterBookState;
  if (
    state.category === 9 ||
    (service.snapshot().cards[state.selected] ?? 0) < TAB_COUNTS[tab]
  ) {
    return;
  }
  state.tab = tab;
  panel.owner.rememberTab("MonsterBook.detail", tab);
  state.detailPage = 0;
  renderBook(panel, service);
}

function restoredDetailTab(panel, service) {
  const count = service.snapshot().cards[panel.monsterBookState.selected] ?? 0;
  const choices = [0, 1, 2, 3].filter((tab) => count >= TAB_COUNTS[tab]);
  return panel.owner.restoreTab("MonsterBook.detail", choices, 0);
}

function tabButton(layer, path, geometry, options) {
  const { x, y, selectedX } = geometry;
  const state = options.disabled
    ? "disabled"
    : options.selected
      ? "selected"
      : "normal";
  const left = options.selected && !options.disabled ? selectedX : x;
  const image = layer.image(`${path}/${state}/0`, left, y);
  const size = layer.assets[`${path}/${state}/0`];
  const button = layer.hit(
    options.label,
    { x: left, y, width: size.width, height: size.height },
    {
      pointerdown: (event) => {
        if (event.button === 0 && !options.disabled) options.action();
      },
      click: (event) => {
        if (event.detail === 0 && !options.disabled) options.action();
      },
    },
    { tooltip: options.tooltip },
  );
  button.setAttribute("aria-pressed", String(options.selected));
  button.setAttribute("aria-disabled", String(Boolean(options.disabled)));
  const hoverPath = `${path}/mouseOver/0`;
  if (!options.selected && !options.disabled && layer.assets[hoverPath]) {
    const hover = layer.image(hoverPath, x, y);
    hover.container.visible = false;
    layer.listen(button, "pointerenter", () => {
      image.container.visible = false;
      hover.container.visible = true;
      layer.owner.sound("BtMouseOver");
    });
    layer.listen(button, "pointerleave", () => {
      image.container.visible = true;
      hover.container.visible = false;
    });
  }
}

function drawTabs(panel, service) {
  const view = service.snapshot();
  const layer = panel.layer("Monster Book tabs");
  drawCategoryTabs(panel, service, layer, view);
  drawDetailTabs(panel, service, layer, view);
  panel.bookTabs?.destroy();
  panel.bookTabs = layer;
}

function drawCategoryTabs(panel, service, layer, view) {
  const state = panel.monsterBookState;
  // 0086256d left rect(-7,25,50,305);008607ff stacks nine20px tabs bottom-up.
  for (let id = 0; id < 9; id++) {
    const category = service.data.categories[id];
    let owned = 0;
    for (const cardId of category.cardIds) if (view.cards[cardId]) owned++;
    tabButton(
      layer,
      `MonsterBook/LeftTab/${id}`,
      { x: -7, selectedX: -2, y: 126 + id * 20 },
      {
        label: `Monster card category ${id + 1}`,
        selected: state.category === id,
        tooltip: `${owned} / ${category.cardIds.length}`,
        action: () => {
          panel.owner.sound("Tab");
          chooseCategory(panel, service, id);
        },
      },
    );
    if (view.unread.includes(id)) {
      const selected = state.category === id;
      layer.stateImage(
        `MonsterBook/LeftTab/${id}/${selected ? "new_s" : "new_n"}/0`,
        selected ? -2 : -7,
        126 + id * 20,
      );
    }
  }
  tabButton(
    layer,
    "MonsterBook/LeftTabInfo/0",
    { x: -7, selectedX: -2, y: 25 },
    {
      label: "Monster Book information",
      selected: state.category === 9,
      action: () => {
        panel.owner.sound("Tab");
        chooseCategory(panel, service, 9);
      },
    },
  );
}

function drawDetailTabs(panel, service, layer, view) {
  const state = panel.monsterBookState;
  let y = 25;
  for (let tab = 0; tab < TABS.length; tab++) {
    tabButton(
      layer,
      `MonsterBook/RightTab/${tab}`,
      { x: 455, selectedX: 439, y },
      {
        label: TABS[tab],
        selected: state.category !== 9 && state.tab === tab,
        disabled:
          state.category === 9 ||
          (view.cards[state.selected] ?? 0) < TAB_COUNTS[tab],
        action: () => {
          panel.owner.sound("Tab");
          chooseTab(panel, service, tab);
        },
      },
    );
    y += tab === 0 ? 39 : 37;
  }
}

function changePage(panel, service, side, direction) {
  const state = panel.monsterBookState;
  if (state.category === 9) return;
  if (side === "left") {
    const page = Math.max(
      0,
      Math.min(gridPages(service, state) - 1, state.page + direction),
    );
    if (page === state.page) return;
    const id =
      service.data.categories[state.category].cardIds[page * GRID_PAGE];
    if (id) selectCard(panel, service, id);
  } else {
    const pages = detailPageCount(selectedCard(service, state), state);
    const page = Math.max(0, Math.min(pages - 1, state.detailPage + direction));
    if (page === state.detailPage) return;
    state.detailPage = page;
    renderBook(panel, service);
  }
}

function updateControls(panel, service) {
  const state = panel.monsterBookState;
  const visible = state.category !== 9;
  panel.bookSearch.hidden = !visible;
  panel.bookSearchButton.setVisible(visible);
  const pages = detailPageCount(selectedCard(service, state), state);
  const controls = panel.bookArrows;
  for (const arrow of controls) arrow.setVisible(visible);
  controls[0].setDisabled(state.page === 0);
  controls[1].setDisabled(state.page + 1 >= gridPages(service, state));
  controls[2].setVisible(visible && state.tab !== 0);
  controls[3].setVisible(visible && state.tab !== 0);
  controls[2].setDisabled(state.detailPage === 0);
  controls[3].setDisabled(state.detailPage + 1 >= pages);
}

function renderBook(panel, service) {
  if (panel.disposed) return;
  panel.bookRenderedView = service.snapshot();
  closeContext(panel);
  drawGrid(panel, service);
  drawTabs(panel, service);
  updateControls(panel, service);
  panel.bookRequest?.abort();
  const request = new AbortController();
  panel.bookRequest = request;
  const layer = panel.layer("Monster Book details");
  layer.root.visible = false;
  layer.element.hidden = true;
  const state = { ...panel.monsterBookState };
  drawBookDetails(layer, service, state, request.signal).then(
    () => {
      if (panel.disposed || request.signal.aborted) {
        layer.destroy();
        return;
      }
      panel.bookDetails?.destroy();
      panel.bookDetails = layer;
      layer.root.visible = true;
      layer.element.hidden = false;
      panel.renderArtwork();
    },
    (error) => {
      layer.destroy();
      if (!request.signal.aborted && !panel.disposed) panel.owner.report(error);
    },
  );
  panel.renderArtwork();
}

function searchCard(panel, service) {
  const query = panel.bookSearch.value.replaceAll(" ", "");
  if (!query) return;
  for (const card of Object.values(service.data.cards)) {
    if (card.name?.replaceAll(" ", "") === query) {
      panel.bookSearch.blur();
      selectCard(panel, service, card.itemId);
      return;
    }
  }
  panel.owner.showTooltip(
    "No monster with that name was found.",
    panel.x + 49,
    panel.y + 48,
    panel.bookSearch,
  );
}

function addControls(panel, service) {
  panel.button("MonsterBook/BtClose", 429, 8, {
    label: "Close Monster Book",
    action: () => panel.owner.close(panel.name),
  });
  panel.bookSearch = document.createElement("input");
  panel.bookSearch.type = "text";
  panel.bookSearch.maxLength = 128;
  panel.bookSearch.setAttribute("aria-label", "Monster name");
  panel.bookSearch.style.cssText =
    "position:absolute;left:49px;top:30px;width:120px;height:15px;border:0;padding:0;box-sizing:border-box;font:12px Arial;pointer-events:auto;";
  panel.element.append(panel.bookSearch);
  panel.listen(panel.bookSearch, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      searchCard(panel, service);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      panel.bookSearch.blur();
    }
  });
  panel.bookSearchButton = panel.button("MonsterBook/BtSearch", 175, 29, {
    label: "Search monster name",
    action: () => searchCard(panel, service),
  });
  const positions = [
    ["left", -1, 48],
    ["left", 1, 185],
    ["right", -1, 270],
    ["right", 1, 407],
  ];
  panel.bookArrows = positions.map(([side, direction, x]) =>
    panel.button(
      `MonsterBook/arrow${direction < 0 ? "Left" : "Right"}`,
      x,
      285,
      {
        label: `${direction < 0 ? "Previous" : "Next"} ${side === "left" ? "cards" : "detail page"}`,
        action: () => changePage(panel, service, side, direction),
      },
    ),
  );
}

/** Original475x349 book; controller and dynamic art borrow the owning UISurface density/lifecycle. */
export function layoutMonsterBook(panel, service) {
  if (!service) throw new Error("Monster Book service is unavailable");
  panel.nativeClose = true;
  panel.image("MonsterBook/backgrnd", 0, 0);
  panel.monsterBookState = {
    category: 9,
    page: 0,
    selected: 0,
    tab: 0,
    detailPage: 0,
    episode: null,
    locations: null,
  };
  addControls(panel, service);
  panel.localRefresh = () => {
    if (panel.bookRenderedView !== service.snapshot()) {
      renderBook(panel, service);
    }
  };
  panel.cleanups.push(service.subscribe(() => panel.localRefresh()));
  panel.cleanups.push(() => {
    panel.bookRequest?.abort();
    closeContext(panel);
  });
  panel.listen(panel.element, "wheel", (event) => {
    if (event.target === panel.bookSearch || !event.deltaY) return;
    event.preventDefault();
    const point = panel.owner.logicalPointer(event);
    changePage(
      panel,
      service,
      point.x - panel.x < 237 ? "left" : "right",
      Math.sign(event.deltaY),
    );
  });
  panel.listen(panel.element, "pointerdown", (event) => {
    if (
      panel.bookContext &&
      !panel.bookContext.element.contains(event.target)
    ) {
      closeContext(panel);
    }
  });
  panel.listen(panel.element, "keydown", (event) => {
    if (event.key === "Escape" && panel.bookContext) {
      event.stopPropagation();
      closeContext(panel);
    }
  });
  const choices = service.data.categories.map((entry, index) => index);
  choices.push(9);
  const category = panel.owner.restoreTab("MonsterBook.category", choices, 9);
  if (panel.owner.windowTabs.has("MonsterBook.category")) {
    chooseCategory(panel, service, category);
  } else {
    const cover = service.snapshot().cover;
    if (cover) selectCard(panel, service, cover);
    else renderBook(panel, service);
  }
}
