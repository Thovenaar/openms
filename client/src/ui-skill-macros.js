import { PROFILE_DOMAIN_LIMITS } from "./profile-domains.js";
import { NativeScrollbar } from "./ui-scrollbar.js";
import { replaceIcons, retireBindingLayer } from "./ui-icons.js";
import { skillTooltip } from "./ui-tooltip.js";

const VISIBLE_ROWS = 3;
const SLOT_SIZE = 32;

/** Native008a8504/008a8926:207x289 child; all coordinates are authored logical pixels. */
export function layoutSkillMacros(panel, service) {
  const result = service.begin();
  if (!result.ok) throw new Error(result.reason);
  panel.macroService = service;
  panel.canClose = () => !service.saving;
  panel.macroSelected = -1;
  panel.macroStart = 0;
  panel.macroSignature = null;
  panel.image("SkillMacro/backgrnd", 0, 0);
  panel.image("SkillMacro/line01", 17, 49);
  panel.image("SkillMacro/line02", 7, 190);
  panel.image("SkillMacro/macroname", 17, 195);
  panel.macroScrollbar = new NativeScrollbar(
    panel,
    { x: 185, y: 54, extent: 125 },
    (position) => {
      panel.macroStart = position;
      refreshMacros(panel);
    },
  );
  panel.macroScrollbar.setRange(3, 0);
  createNameEditor(panel);
  createShoutControl(panel);
  panel.macroSave = panel.button("BtOK2", 154, 265, {
    label: "Save skill macros",
    action: () => saveMacros(panel),
    disabled: true,
  });
  // Detached browser drafts add an explicit Cancel using original Basic art; no network save on drag.
  panel.macroCancel = panel.button("BtCancel2", 103, 265, {
    label: "Cancel skill macro changes",
    action: () => cancelMacros(panel),
  });
  panel.localRefresh = () => refreshMacros(panel);
  panel.cleanups.push(service.subscribe(panel.localRefresh));
  panel.cleanups.push(() => service.cancel());
  panel.listen(panel.element, "keydown", (event) =>
    macroEditorKey(panel, event),
  );
  refreshMacros(panel);
}

function reportOutcome(panel, result) {
  if (!result.ok) panel.owner.status(result.reason);
  return result.ok;
}

function createNameEditor(panel) {
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = PROFILE_DOMAIN_LIMITS.macroName;
  input.setAttribute("aria-label", "Skill macro name");
  input.style.cssText =
    "position:absolute;left:59px;top:215px;width:117px;height:16px;box-sizing:border-box;padding:0;border:0;outline:0;background:transparent;color:#000;font:12px Arial,sans-serif;line-height:16px;pointer-events:auto;user-select:text;";
  panel.element.append(input);
  panel.macroName = input;
  panel.listen(input, "input", () => {
    const result = panel.macroService.name(panel.macroSelected, input.value);
    if (!reportOutcome(panel, result)) refreshMacros(panel);
  });
  panel.listen(input, "focus", () => panel.owner.hooks.clearInput());
  panel.listen(input, "blur", () => panel.owner.hooks.clearInput());
}

function createShoutControl(panel) {
  panel.macroChecks = [
    panel.image("CheckBox/0", 166, 241),
    panel.image("CheckBox/1", 166, 241),
  ];
  panel.macroShout = panel.hit(
    "Shout skill name",
    { x: 42, y: 239, width: 136, height: 16 },
    {
      click: () => {
        const record = panel.macroService.draft?.[panel.macroSelected];
        if (record) {
          reportOutcome(
            panel,
            panel.macroService.shout(panel.macroSelected, !record.shout),
          );
        }
      },
    },
  );
  panel.macroShout.setAttribute("role", "checkbox");
}

function refreshMacros(panel) {
  if (panel.disposed) return;
  const service = panel.macroService;
  const records = service.draft ?? service.store.profile.skillMacros;
  refreshMacroEditor(panel, service, records[panel.macroSelected]);
  const signature = JSON.stringify([
    records,
    panel.macroStart,
    panel.macroSelected,
  ]);
  if (signature === panel.macroSignature) return;
  panel.macroSignature = signature;
  drawMacroRows(panel, records);
}

function refreshMacroEditor(panel, service, record) {
  const disabled =
    service.saving || service.store.profileTransactionPending || !record;
  panel.macroName.disabled = disabled;
  if (panel.macroName.value !== (record?.name ?? "")) {
    panel.macroName.value = record?.name ?? "";
  }
  panel.macroShout.disabled = disabled;
  panel.macroShout.setAttribute("aria-checked", String(record?.shout ?? false));
  panel.macroChecks[0].container.visible = !record?.shout;
  panel.macroChecks[1].container.visible = Boolean(record?.shout);
  panel.macroSave.setDisabled(disabled);
  panel.macroCancel.setDisabled(service.saving);
}

function drawMacroRows(panel, records) {
  retireBindingLayer(panel.macroLayer);
  const layer = panel.layer("Macro groups");
  panel.macroLayer = layer;
  const entries = [];
  for (let row = 0; row < VISIBLE_ROWS; row++) {
    const index = panel.macroStart + row;
    const y = 56 + 45 * row;
    if (panel.macroSelected === index) {
      layer.image("SkillMacro/macroslot2", 15, y - 5);
    }
    layer.image("SkillMacro/macroslot", 17, y - 3);
    layer.image("SkillMacro/macroslot1", 143, y - 3);
    drawMacroIcon(panel, layer, { index, x: 146, y });
    for (let slot = 0; slot < PROFILE_DOMAIN_LIMITS.macroSkills; slot++) {
      const id = records[index].skills[slot];
      entries.push({
        index,
        slot,
        id,
        x: 20 + 37 * slot,
        y,
        template: panel.owner.index.skills[id],
      });
    }
  }
  if (panel.macroSelected >= 0) {
    drawMacroIcon(panel, layer, { index: panel.macroSelected, x: 22, y: 200 });
  }
  replaceIcons(panel, entries, (icons, entry) =>
    drawMacroSkill(panel, icons, entry),
  ).catch((error) => panel.owner.report(error));
}

function drawMacroIcon(panel, layer, entry) {
  const path = `SkillMacro/Macroicon/${entry.index}/icon`;
  layer.image(path, entry.x, entry.y);
  const hit = layer.hit(
    `Skill macro ${entry.index + 1}`,
    {
      x: entry.x,
      y: entry.y,
      width: SLOT_SIZE,
      height: SLOT_SIZE,
    },
    {
      pointerdown: (event) => {
        if (event.button !== 0) return;
        panel.macroSelected = entry.index;
        panel.owner.beginBindingDrag(
          event,
          { type: 8, id: entry.index },
          null,
          { source: layer, path },
        );
        refreshMacros(panel);
      },
      click: () => {
        panel.macroSelected = entry.index;
        refreshMacros(panel);
      },
    },
    { tooltip: () => macroTooltip(panel, entry.index) },
  );
  hit.dataset.macroIndex = String(entry.index);
}

function macroTooltip(panel, index) {
  const record = (panel.macroService.draft ??
    panel.macroService.store.profile.skillMacros)[index];
  const lines = [];
  for (const id of record.skills) {
    if (id) {
      lines.push({
        text:
          panel.owner.index.skills[id]?.name ||
          "Original skill data unavailable",
        tone: "normal",
      });
    }
  }
  return { title: record.name || `Skill macro ${index + 1}`, lines };
}

function drawMacroSkill(panel, layer, entry) {
  const path = entry.template?.iconPath;
  if (path) layer.image(path, entry.x, entry.y);
  const rect = { x: entry.x, y: entry.y, width: SLOT_SIZE, height: SLOT_SIZE };
  const hit = layer.hit(
    entry.template?.name || "Empty macro skill slot",
    rect,
    {
      pointerdown: (event) => carryMacroSkill(panel, layer, entry, event),
      contextmenu: (event) => {
        event.preventDefault();
        reportOutcome(
          panel,
          panel.macroService.remove(entry.index, entry.slot),
        );
      },
      keydown: (event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        event.preventDefault();
        reportOutcome(
          panel,
          panel.macroService.remove(entry.index, entry.slot),
        );
      },
    },
    {
      tooltip: path
        ? () => ({
            ...skillTooltip(panel.owner, entry.template),
            source: { surface: layer, path },
          })
        : undefined,
    },
  );
  hit.dataset.macroIndex = String(entry.index);
  hit.dataset.macroSlot = String(entry.slot);
}

function carryMacroSkill(panel, layer, entry, event) {
  if (event.button !== 0) return;
  panel.macroSelected = entry.index;
  if (entry.template?.iconPath && !panel.owner.bindingDrag) {
    panel.owner.beginBindingDrag(event, { type: 1, id: entry.id }, null, {
      source: layer,
      path: entry.template.iconPath,
    });
    const drag = panel.owner.bindingDrag;
    if (drag?.source === layer) {
      drag.macroSource = { index: entry.index, slot: entry.slot };
    }
  }
  refreshMacros(panel);
}

/** Main routes its existing click-carried skill here BEFORE ordinary key/quickslot placement. */
export function skillMacroTarget(panel, point) {
  if (!panel || panel.disposed || !panel.macroService?.draft) return null;
  const x = point.x - panel.x;
  const y = point.y - panel.y;
  for (let row = 0; row < VISIBLE_ROWS; row++) {
    const top = 56 + row * 45;
    if (y < top || y > top + SLOT_SIZE) continue;
    for (let slot = 0; slot < PROFILE_DOMAIN_LIMITS.macroSkills; slot++) {
      const left = 20 + slot * 37;
      if (x >= left && x <= left + SLOT_SIZE) {
        return { index: panel.macroStart + row, slot };
      }
    }
  }
  return null;
}

/** null means no original slot; a refusal must NOT fall through and bind elsewhere. */
export function placeMacroSkill(panel, drag, point) {
  const target = skillMacroTarget(panel, point);
  if (!target) return null;
  if (drag.binding.type !== 1) {
    return {
      ok: false,
      code: "type",
      reason: "Only skills can be placed in macro slots",
    };
  }
  panel.macroSelected = target.index;
  const result = panel.macroService.assign(
    target.index,
    target.slot,
    drag.binding.id,
    drag.macroSource ?? null,
  );
  refreshMacros(panel);
  return result;
}

async function saveMacros(panel) {
  if (panel.macroService.saving) return;
  const result = await panel.macroService.save();
  if (!panel.disposed) reportOutcome(panel, result);
}

function cancelMacros(panel) {
  if (reportOutcome(panel, panel.macroService.cancel())) {
    panel.owner.close(panel.name, true);
  }
}

function macroEditorKey(panel, event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelMacros(panel);
  } else if (event.key === "Enter" && event.target === panel.macroName) {
    event.preventDefault();
    saveMacros(panel).catch((error) => panel.owner.report(error));
  }
}
