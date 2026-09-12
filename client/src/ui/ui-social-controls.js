import { NativeScrollbar } from "./ui-scrollbar.js";
import { JOB_LABELS } from "./ui-job-labels.js";
import { tabParts, showTabPart, tabLabel } from "./ui-layout.js";

const MAX_SOCIAL_ROWS = 4096;

/** A normal UISurface observes LocalSocial; it never owns or edits saved profiles. */
export function socialView(panel, social, draw) {
  const state = {
    panel,
    social,
    draw,
    view: social.snapshot(),
    selected: null,
    position: 0,
    pending: false,
    layer: null,
  };
  state.refresh = () => {
    if (panel.disposed) return;
    state.view = social.snapshot();
    draw(state);
    panel.renderArtwork();
  };
  panel.localRefresh = state.refresh;
  panel.cleanups.push(social.subscribe(state.refresh));
  return state;
}

export function replaceSocialLayer(state, background = null) {
  const active = document.activeElement;
  const focus = state.layer?.element.contains(active)
    ? active.getAttribute("aria-label")
    : null;
  state.layer?.destroy();
  state.layer = state.panel.layer(`${state.panel.name} content`);
  state.buttons = [];
  state.panel.root.setChildIndex(state.layer.root, 0);
  if (background) state.layer.image(background, 0, 0);
  state.restoreFocus = () => {
    if (!focus) return;
    for (const button of state.layer.element.querySelectorAll("button")) {
      if (button.getAttribute("aria-label") === focus) {
        button.focus({ preventScroll: true });
        break;
      }
    }
  };
  return state.layer;
}

export function socialText(layer, text, rect, options = {}) {
  const node = layer.text(String(text), rect.x, rect.y, rect.width);
  node.style.font = `${options.bold ? "bold " : ""}${options.size || 11}px ${options.font || "Tahoma"},sans-serif`;
  node.style.lineHeight = `${options.lineHeight || 16}px`;
  node.style.color = options.color || "#333333";
  node.style.whiteSpace = options.wrap ? "pre-wrap" : "nowrap";
  node.style.overflow = "hidden";
  node.style.textOverflow = "ellipsis";
  if (rect.height) node.style.height = `${rect.height}px`;
  return node;
}

/** Native button state/sound/cursor ownership remains in UISurface. */
export function socialButton(state, config) {
  const { path, x, y, label, action, enabled = true, tooltip } = config;
  const control = state.layer.button(path, x, y, {
    label,
    disabled:
      state.pending ||
      state.view.busy ||
      !(typeof enabled === "function" ? enabled() : enabled),
    tooltip,
    action: () => runSocialAction(state, action),
  });
  state.buttons.push({ control, enabled });
  return control;
}

export function refreshSocialSelection(state) {
  for (const { control, enabled } of state.buttons) {
    control.setDisabled(
      state.pending ||
        state.view.busy ||
        !(typeof enabled === "function" ? enabled() : enabled),
    );
  }
  for (const row of state.layer.element.querySelectorAll("[data-social-row]")) {
    const selected = row.dataset.socialRow === String(state.selected);
    row.setAttribute("aria-pressed", String(selected));
    row.style.background = selected ? "rgba(99,143,184,0.28)" : "";
  }
  state.panel.renderArtwork();
}

export async function runSocialAction(state, action) {
  if (state.pending || state.panel.disposed) return;
  state.pending = true;
  try {
    const outcome = await action();
    if (outcome?.ok === false && outcome.code !== "cancelled") {
      state.panel.owner.notice(outcome.reason || outcome.code);
    }
    if (outcome?.ok === true) {
      await state.panel.owner.hooks.socialOutcome?.(outcome);
    }
  } catch (error) {
    state.panel.owner.report(error);
  } finally {
    state.pending = false;
    if (!state.panel.disposed) state.refresh();
  }
}

export function admitted(state, action, targetRequired = false) {
  return (
    state.view.permissions[action] === true &&
    (!targetRequired || Boolean(state.selected))
  );
}

export async function socialPrompt(state, options) {
  const prompt = state.panel.owner.prompt;
  if (typeof prompt !== "function") {
    throw new Error(
      "Native social text/number/YesNo dialog owner is not connected",
    );
  }
  const result = await prompt.call(state.panel.owner, {
    ...options,
    owner: state.panel,
  });
  return state.panel.disposed ? null : result;
}

export async function requestText(state, action, options, payload = {}) {
  const text = await socialPrompt(state, { kind: "text", ...options });
  if (text === null) return { ok: false, code: "cancelled" };
  return state.social.execute(action, { ...payload, text, name: text });
}

export async function requestTarget(state, action, text) {
  const name = await socialPrompt(state, { kind: "text", text, maxLength: 12 });
  if (name === null) return { ok: false, code: "cancelled" };
  const target = state.social
    .participants()
    .find((member) => member.name.toLowerCase() === name.trim().toLowerCase());
  if (!target) {
    return {
      ok: false,
      code: "character-not-loaded",
      reason: `No local character named ${name} is loaded. Create or load a saved character in Local simulation controls.`,
    };
  }
  return state.social.execute(action, { targetId: target.id });
}

export async function confirmSocial(state, action, text, payload = {}) {
  const accepted = await socialPrompt(state, { kind: "confirm", text });
  if (accepted !== true) return { ok: false, code: "cancelled" };
  return state.social.execute(action, payload);
}

export function socialTabs(state, config) {
  if (config.nativeSpan) return nativeSocialTabs(state, config);
  let x = config.x;
  for (let index = 0; index < config.labels.length; index++) {
    const path = `${config.path}/${config.selected === index ? "enabled" : "disabled"}/${index}`;
    const asset = state.panel.assets[path];
    if (!asset) throw new Error(`Missing original tab ${path}`);
    const width = config.width || asset.width;
    const height = config.height || asset.height;
    state.layer.image(
      path,
      x + Math.floor((width - asset.width) / 2),
      config.y + Math.floor((height - asset.height) / 2),
    );
    const button = state.layer.hit(
      config.labels[index],
      {
        x,
        y: config.y,
        width,
        height,
      },
      {
        click: () => {
          state.panel.owner.sound("BtMouseClick");
          config.select(index);
        },
        pointerenter: () => state.panel.owner.sound("BtMouseOver"),
      },
    );
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(config.selected === index));
    if (config.selected === index) {
      button.style.background = "rgba(255,255,255,0.16)";
      button.style.boxShadow = "inset 0 -2px #fff3a1";
    }
    x += config.width || asset.width + (config.gap || 0);
  }
}

/** 00919d34: UserList uses the same type1 Tab2 controller as inventory. */
function nativeSocialTabs(state, config) {
  const count = config.labels.length;
  const width = Math.trunc((config.nativeSpan - (count - 1) * 8 - 8) / count);
  const remainder = config.nativeSpan - (width + 8) * count;
  const left = tabParts(state.layer, "left", config.x, 4);
  showTabPart(left, config.selected === 0 ? 1 : 0);
  let x = config.x + 4;
  for (let index = 0; index < count; index++) {
    const size = width + (index < remainder ? 1 : 0);
    const last = index === count - 1;
    const selected = index === config.selected;
    showTabPart(tabParts(state.layer, "fill", x, size), selected ? 1 : 0);
    const edge = tabParts(
      state.layer,
      last ? "right" : "middle",
      x + size,
      last ? 4 : 8,
    );
    showTabPart(edge, selected ? 1 : index + 1 === config.selected ? 2 : 0);
    tabLabel(
      state.layer,
      `${config.path}/${selected ? "enabled" : "disabled"}/${index}`,
      x,
      size,
    );
    const hit = state.layer.hit(
      config.labels[index],
      {
        x: x - 4,
        y: 23,
        width: size + 8,
        height: 19,
      },
      {
        click: () => {
          state.panel.owner.sound("BtMouseClick");
          config.select(index);
        },
        pointerenter: () => state.panel.owner.sound("BtMouseOver"),
      },
    );
    hit.setAttribute("role", "tab");
    hit.setAttribute("aria-selected", String(selected));
    x += size + 8;
  }
}

export function memberText(member) {
  const level = Number.isInteger(member.level)
    ? `Lv. ${member.level}`
    : "Level unavailable";
  return `${member.name}  ${level}  ${JOB_LABELS[member.job] || "Job unavailable"}`;
}

export function memberTooltip(member) {
  return `${memberText(member)}\n${member.online ? "Online" : "Offline"}\n${member.mapName || ""}\n${member.leader ? "Leader" : member.rankTitle || ""}`;
}

function socialRowMetrics(rows, geometry, options) {
  const heights = rows.map((row) =>
    typeof options.rowHeight === "function"
      ? options.rowHeight(row)
      : options.rowHeight || 18,
  );
  const offsets = [0];
  for (const height of heights) {
    offsets.push(offsets[offsets.length - 1] + height);
  }
  const pixelScroll =
    typeof options.rowHeight === "function" || Boolean(options.scrollStep);
  const scrollStep = options.scrollStep || 1;
  const maximumScroll = Math.max(0, offsets[rows.length] - geometry.height);
  const visible = pixelScroll
    ? 0
    : Math.max(1, Math.floor(geometry.height / (options.rowHeight || 18)));
  const count = pixelScroll
    ? Math.ceil(maximumScroll / scrollStep) + 1
    : Math.max(1, rows.length - visible + 1);
  return { heights, offsets, pixelScroll, scrollStep, maximumScroll, count };
}

/** Bounded native scrollbar with clipped rows; arrow keys remain gameplay keys outside its own focused thumb. */
export function socialList(state, rows, geometry, options = {}) {
  if (rows.length > MAX_SOCIAL_ROWS) {
    throw new Error("Social row budget exceeded");
  }
  const { heights, offsets, pixelScroll, scrollStep, maximumScroll, count } =
    socialRowMetrics(rows, geometry, options);
  state.position = Math.max(0, Math.min(state.position, count - 1));
  let body = null;
  const drawRows = () => {
    body?.destroy();
    body = state.layer.layer("Clipped social rows");
    body.root.rasterClip = geometry;
    body.element.style.clipPath = `inset(${geometry.y}px ${state.panel.width - geometry.x - geometry.width}px ${state.panel.height - geometry.y - geometry.height}px ${geometry.x}px)`;
    if (!rows.length) {
      socialText(
        body,
        options.empty || "No entries.",
        { ...geometry, height: 48 },
        { wrap: true },
      );
    }
    const scrollY = pixelScroll
      ? Math.min(state.position * scrollStep, maximumScroll)
      : offsets[state.position];
    for (let index = 0; index < rows.length; index++) {
      if (offsets[index + 1] <= scrollY) continue;
      if (offsets[index] >= scrollY + geometry.height) break;
      socialMemberRow(state, body, rows[index], {
        ...options,
        x: geometry.x,
        y: geometry.y + offsets[index] - scrollY,
        width: geometry.width,
        height: heights[index],
      });
    }
    state.panel.renderArtwork();
  };
  const scrollbar = new NativeScrollbar(
    state.layer,
    {
      x: geometry.x + geometry.width,
      y: geometry.y,
      extent: geometry.height,
      style: options.style ?? 3,
    },
    (position) => {
      state.position = position;
      drawRows();
    },
  );
  scrollbar.setRange(count, state.position);
  drawRows();
  state.restoreFocus?.();
}

export function socialMemberRow(state, layer, row, options) {
  const key = row.uid || row.id;
  const label = options.label ? options.label(row) : memberText(row);
  const background =
    typeof options.background === "function"
      ? options.background(row)
      : options.background;
  if (background) layer.image(background, options.x, options.y);
  if (row.passive) {
    options.render?.(layer, row, options);
    return;
  }
  const hit = layer.hit(
    label,
    options,
    {
      click: () => {
        state.selected = key;
        options.select?.(row);
        refreshSocialSelection(state);
      },
      dblclick: () => {
        if (options.activate) {
          runSocialAction(state, () => options.activate(row));
        }
      },
    },
    { tooltip: options.tooltip ? options.tooltip(row) : memberTooltip(row) },
  );
  hit.dataset.socialRow = key;
  hit.setAttribute("aria-pressed", String(state.selected === key));
  if (state.selected === key) hit.style.background = "rgba(99,143,184,0.28)";
  if (options.render) {
    options.render(layer, row, options);
    return;
  }
  socialText(
    layer,
    label,
    {
      x: options.x + 5,
      y: options.y + 1,
      width: options.width - 8,
      height: options.height - 1,
    },
    { wrap: options.wrap, color: row.online === false ? "#888888" : "#333333" },
  );
}

/** WZ row dividers define independent clipping columns, not space-padded strings. */
export function socialColumns(layer, member, rect, columns) {
  for (const column of columns) {
    let text = member[column.field];
    if (column.field === "job") text = JOB_LABELS[member.job] || "—";
    if (text === undefined || text === null) text = "—";
    socialText(
      layer,
      text,
      {
        x: rect.x + column.x,
        y: rect.y + 2,
        width: column.width,
        height: rect.height - 2,
      },
      {
        color: member.online === false ? "#888888" : "#333333",
        bold: column.field === "name" && member.leader,
      },
    );
  }
}

/** Native social sections use 27px headings, 18px column/member rows, and WZ footer strips. */
export function appendSocialSection(rows, section, members) {
  rows.push({
    id: `${section.id}:heading`,
    passive: true,
    height: 27,
    art: section.header,
    title: section.title,
    count: members.length,
  });
  if (section.columns) {
    rows.push({ passive: true, height: 18, art: section.columns });
  }
  for (const member of members) {
    rows.push({ ...member, height: 18, art: section.row });
  }
  if (!members.length) {
    rows.push({
      passive: true,
      height: 18,
      art: section.row,
      empty: "No members.",
    });
  }
  rows.push({
    passive: true,
    height: section.footerHeight || 6,
    art: section.footer,
  });
}

export function socialRoster(state, rows, geometry, options) {
  socialList(state, rows, geometry, {
    rowHeight: (row) => row.height,
    background: (row) => row.art,
    label: (row) => (row.passive ? row.title || "" : memberText(row)),
    // 0091beab copies all five native social viewports at position*0x21.
    scrollStep: 33,
    tooltip: memberTooltip,
    activate: options.activate,
    render: (layer, row, rect) => {
      if (!row.passive) return socialColumns(layer, row, rect, options.columns);
      if (row.title) {
        socialText(
          layer,
          row.title,
          {
            x: rect.x + 5,
            y: rect.y + 6,
            width: rect.width - 64,
          },
          { bold: true, color: "#ffffff" },
        );
      }
      if (row.count !== undefined) {
        const count = socialText(
          layer,
          row.count,
          {
            x: rect.x + rect.width - 54,
            y: rect.y + 6,
            width: 46,
          },
          { color: "#ffffff" },
        );
        count.style.textAlign = "right";
      }
      if (row.empty) {
        socialText(
          layer,
          row.empty,
          {
            x: rect.x + 5,
            y: rect.y + 2,
            width: rect.width - 10,
          },
          { color: "#888888" },
        );
      }
    },
  });
}

export function socialHook(state, name, payload) {
  const hook = state.panel.owner.hooks[name];
  if (typeof hook !== "function") {
    throw new Error(`Social integration hook ${name} is not connected`);
  }
  return hook(payload);
}
