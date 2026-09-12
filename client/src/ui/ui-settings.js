const GAME_OPTIONS = [
  ["allowWhisper", "Whisper", 33],
  ["allowFriend", "Friends", 51],
  ["allowMessenger", "Chat invite", 69],
  ["allowTrade", "Trade request", 87],
  ["allowParty", "Party invite", 105],
  ["allowPartySearch", "Party search", 123],
  ["allowGame", "Game invite", 141],
  ["allowGuildChat", "Guild chat", 159],
  ["allowGuildInvite", "Guild invite", 177],
  ["allowAllianceChat", "Alliance chat", 195],
  ["allowAllianceInvite", "Alliance invite", 213],
  ["allowFamily", "Family invite", 231],
];

function checkbox(panel, label, point, state) {
  const unchecked = panel.image(
    `CheckBox/${state.disabled ? 2 : 0}`,
    point.x,
    point.y,
  );
  const checked = panel.image(
    `CheckBox/${state.disabled ? 3 : 1}`,
    point.x,
    point.y,
  );
  const input = panel.hit(
    label,
    { ...point, width: 12, height: 12 },
    {
      click: () => {
        if (panel.settingsPending || state.disabled) return;
        state.set(!state.get());
        refresh();
      },
    },
    { tooltip: state.disabled || null },
  );
  input.setAttribute("role", "checkbox");
  input.setAttribute("aria-disabled", String(Boolean(state.disabled)));
  function refresh() {
    const value = state.get();
    unchecked.container.visible = !value;
    checked.container.visible = value;
    input.setAttribute("aria-checked", String(value));
  }
  refresh();
}

/**00994163: source Slider,20 positions; only its one-pixel middle is stretched. */
function slider(panel, label, geometry, state) {
  const { x, y, width } = geometry;
  panel.image("Slider/left", x, y + 3);
  const middle = panel.image("Slider/mid", x + 3, y + 3);
  middle.container.scale.x = width - 6;
  panel.image("Slider/right", x + width - 3, y + 3);
  const thumbs = ["thumbNormal", "thumbMouseOver", "thumbPressed"].map((part) =>
    panel.image(`Slider/${part}`, x, y),
  );
  const show = (selected) => {
    for (let index = 0; index < thumbs.length; index++) {
      thumbs[index].container.visible = index === selected;
    }
  };
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "19";
  input.step = "1";
  input.value = String(state.get());
  input.setAttribute("aria-label", label);
  input.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:14px;opacity:0;cursor:pointer;margin:0;`;
  const refresh = () => {
    for (const thumb of thumbs) {
      thumb.container.position.x =
        x + Math.trunc(((width - 22) * Number(input.value)) / 19);
    }
    input.setAttribute("aria-valuetext", state.label(Number(input.value)));
  };
  panel.listen(input, "input", () => {
    if (panel.settingsPending) {
      input.value = String(state.get());
      return;
    }
    state.set(Number(input.value));
    refresh();
  });
  panel.listen(input, "keydown", (event) => event.stopPropagation());
  panel.listen(input, "pointerenter", () => show(1));
  panel.listen(input, "pointerleave", () => show(0));
  panel.listen(input, "pointerdown", () => show(2));
  panel.listen(window, "pointerup", () =>
    show(document.activeElement === input ? 1 : 0),
  );
  panel.listen(input, "focus", () => show(1));
  panel.listen(input, "blur", () => show(0));
  show(0);
  panel.element.append(input);
  refresh();
}

function explain(panel, label, rect, reason) {
  const hit = panel.hit(label, rect, {}, { tooltip: reason });
  hit.setAttribute("aria-disabled", "true");
}

function systemOptions(panel) {
  const draft = panel.settingsDraft;
  for (const [category, y] of [
    ["BGM", 70],
    ["SE", 100],
  ]) {
    slider(
      panel,
      category === "BGM" ? "Music volume" : "Sound volume",
      { x: 99, y, width: 105 },
      {
        get: () => Math.round((draft[category].volume * 19) / 128),
        set: (value) => {
          draft[category].volume = Math.round((value * 128) / 19);
          panel.owner.hooks.applyAudioSettings(draft);
        },
        label: (value) => `${Math.round((value * 100) / 19)}%`,
      },
    );
    checkbox(
      panel,
      `Mute ${category}`,
      { x: 239, y },
      {
        get: () => draft[category].mute,
        set: (value) => {
          draft[category].mute = value;
          panel.owner.hooks.applyAudioSettings(draft);
        },
      },
    );
  }
  for (const [kind, y] of [
    ["hp", 190],
    ["mp", 220],
  ]) {
    slider(
      panel,
      `${kind.toUpperCase()} alert threshold`,
      { x: 99, y, width: 147 },
      {
        get: () => draft.alerts[kind],
        set: (value) => {
          draft.alerts[kind] = value;
        },
        label: (value) => (value ? `${value * 5}%` : "Off"),
      },
    );
  }
  unsupportedSystemOptions(panel);
}

function unsupportedSystemOptions(panel) {
  explain(
    panel,
    "Picture quality",
    { x: 62, y: 32, width: 220, height: 27 },
    "The original Direct3D picture-quality modes are not browser renderer modes. Original artwork is retained without a substitute quality filter.",
  );
  explain(
    panel,
    "Screenshot location",
    { x: 62, y: 122, width: 220, height: 26 },
    "Original Windows screenshot directories are not writable from this browser. Use the browser's screenshot/download facility.",
  );
  explain(
    panel,
    "Mouse cursor speed",
    { x: 62, y: 153, width: 220, height: 26 },
    "Pointer speed is controlled by your operating system; changing the saved native Windows mouse setting would not change browser pointer motion.",
  );
  explain(
    panel,
    "Shake up the screen",
    { x: 62, y: 244, width: 220, height: 26 },
    "Only authored skill effects run; no original screen-shake effect is currently admitted by the field renderer.",
  );
  explain(
    panel,
    "Monster information",
    { x: 62, y: 274, width: 220, height: 25 },
    "Original monster name/HP display modes require their field-overlay renderer; the Monster Book is a separate window, not this option.",
  );
  fullscreenOptions(panel);
}

function fullscreenOptions(panel) {
  const controls = [];
  for (const [full, y] of [
    [false, 303],
    [true, 314],
  ]) {
    const off = panel.image("CheckBox/0", 62, y);
    const on = panel.image("CheckBox/1", 62, y);
    const hit = panel.hit(
      full ? "Full screen" : "Window",
      { x: 62, y, width: 190, height: 11 },
      {
        click: async () => {
          try {
            if (full && !document.fullscreenElement) {
              await panel.owner.app.canvas.parentElement.requestFullscreen();
            } else if (!full && document.fullscreenElement) {
              await document.exitFullscreen();
            }
          } catch (error) {
            panel.owner.report(error);
          }
        },
      },
    );
    hit.setAttribute("role", "radio");
    controls.push({ full, off, on, hit });
  }
  const refresh = () => {
    for (const control of controls) {
      const selected = control.full === Boolean(document.fullscreenElement);
      control.on.container.visible = selected;
      control.off.container.visible = !selected;
      control.hit.setAttribute("aria-checked", String(selected));
    }
  };
  panel.listen(document, "fullscreenchange", refresh);
  refresh();
}

function gameOptions(panel) {
  const options = panel.settingsDraft.gameOptions;
  for (const [key, label, y] of GAME_OPTIONS) {
    checkbox(
      panel,
      `Allow ${label.toLowerCase()}`,
      { x: 128, y },
      {
        get: () => options[key],
        set: (value) => {
          options[key] = value;
        },
        disabled:
          key === "allowGame"
            ? "The original Omok/Match Cards invitation and game-room controller is required; no minigame session is simulated."
            : null,
      },
    );
  }
}

function selectedSettings(panel) {
  const settings = structuredClone(panel.owner.store.profile.settings);
  const fields =
    panel.name === "GameOpt" ? ["gameOptions"] : ["BGM", "SE", "alerts"];
  for (const field of fields) {
    settings[field] = structuredClone(panel.settingsDraft[field]);
  }
  return settings;
}

async function saveSettings(panel) {
  if (panel.settingsPending || panel.owner.hooks.isOperationPending?.()) return;
  panel.settingsPending = true;
  panel.settingsSave.setDisabled(true);
  try {
    const draft = panel.settingsDraft;
    if (typeof panel.owner.hooks.saveSettings !== "function") {
      throw new Error("Settings persistence is unavailable.");
    }
    await panel.owner.hooks.saveSettings(selectedSettings(panel));
    panel.settingsCommitted = true;
    if (panel.name === "SysOpt") {
      panel.settingsOriginal = structuredClone({
        BGM: draft.BGM,
        SE: draft.SE,
      });
      panel.owner.hooks.applyAudioSettings({ BGM: draft.BGM, SE: draft.SE });
    }
    panel.owner.refreshProfile();
    panel.owner.close(panel.name, true);
  } catch (error) {
    panel.owner.report(error);
  } finally {
    panel.settingsPending = false;
    if (!panel.disposed) panel.settingsSave.setDisabled(false);
  }
}

/**00993a30/00994163 controls use actual saved local preferences, never pretend remote success. */
export function layoutSettings(panel) {
  panel.nativeClose = true;
  panel.settingsPending = false;
  panel.settingsDraft = structuredClone(panel.owner.store.profile.settings);
  panel.settingsCommitted = false;
  if (panel.name === "SysOpt") {
    panel.settingsOriginal = panel.owner.hooks.getAudioSettings();
    panel.settingsDraft.BGM = { ...panel.settingsOriginal.BGM };
    panel.settingsDraft.SE = { ...panel.settingsOriginal.SE };
    panel.cleanups.push(() => {
      if (!panel.settingsCommitted) {
        panel.owner.hooks.applyAudioSettings(panel.settingsOriginal);
      }
    });
  }
  panel.canClose = () => !panel.settingsPending;
  if (panel.name === "GameOpt") gameOptions(panel);
  else systemOptions(panel);
  const point =
    panel.name === "GameOpt" ? { x: 34, y: 262 } : { x: 194, y: 342 };
  //00994163/00993a30 select string IDs0x4e9/0x4ea: Basic's47×18 controls.
  panel.settingsSave = panel.button("BtOK2", point.x, point.y, {
    label: "Save options",
    action: () => saveSettings(panel),
  });
  panel.button("BtCancel2", point.x + 50, point.y, {
    label: "Cancel options",
    action: () => panel.owner.close(panel.name),
  });
}
