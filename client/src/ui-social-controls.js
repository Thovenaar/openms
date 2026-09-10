import { NativeScrollbar } from "./ui-scrollbar.js";
import { JOB_LABELS } from "./ui-job-labels.js";

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
  let x = config.x;
  for (let index = 0; index < config.labels.length; index++) {
    const path = `${config.path}/${config.selected === index ? "enabled" : "disabled"}/${index}`;
    const asset = state.panel.assets[path];
    if (!asset) throw new Error(`Missing original tab ${path}`);
    state.layer.image(path, x, config.y);
    const button = state.layer.hit(
      config.labels[index],
      {
        x,
        y: config.y,
        width: config.width || asset.width,
        height: asset.height,
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
    x += config.width || asset.width + (config.gap || 0);
  }
}

export function memberText(member) {
  return `${member.name}  Lv. ${member.level}  ${JOB_LABELS[member.job] || "Unknown job"}`;
}

export function memberTooltip(member) {
  return `${memberText(member)}\n${member.mapName}\n${member.leader ? "Leader" : member.rank ? `Rank ${member.rank}` : ""}`;
}

/** Bounded native scrollbar with clipped rows; arrow keys remain gameplay keys outside its own focused thumb. */
export function socialList(state, rows, geometry, options = {}) {
  if (rows.length > MAX_SOCIAL_ROWS) {
    throw new Error("Social row budget exceeded");
  }
  const rowHeight = options.rowHeight || 18;
  const visible = Math.max(1, Math.floor(geometry.height / rowHeight));
  const count = Math.max(1, rows.length - visible + 1);
  state.position = Math.min(state.position, count - 1);
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
    for (
      let index = state.position;
      index < Math.min(rows.length, state.position + visible);
      index++
    ) {
      drawSocialRow(state, body, rows[index], {
        ...options,
        x: geometry.x,
        y: geometry.y + (index - state.position) * rowHeight,
        width: geometry.width,
        height: rowHeight,
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

function drawSocialRow(state, layer, row, options) {
  const key = row.uid || row.id;
  const label = options.label ? options.label(row) : memberText(row);
  if (options.background) layer.image(options.background, options.x, options.y);
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

export function socialHook(state, name, payload) {
  const hook = state.panel.owner.hooks[name];
  if (typeof hook !== "function") {
    throw new Error(`Social integration hook ${name} is not connected`);
  }
  return hook(payload);
}
