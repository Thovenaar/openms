import { Graphics } from "pixi.js";
import { experienceRequired } from "./offline-progression.js";
import { JOB_LABELS } from "./ui-job-labels.js";

// 008d2494: bar (218,567); 008d850b: graduation (218,544), gray suffix y581.
export function layoutGauges(panel) {
  panel.image("gauge/bar", 218, 567);
  panel.gauges = [
    [220, 105],
    [328, 105],
    [441, 115],
  ].map(([x, width]) => {
    const sprite = panel.image("gauge/gray", x, 581);
    const mask = new Graphics().rect(0, 0, 1, 15).fill(0xffffff);
    sprite.container.addChild(mask);
    // Crop source row 15; never rescale the 16px source vertically.
    sprite.container.mask = mask;
    sprite.container.scale.x = width;
    return { sprite, x, width, extent: -1 };
  });
  panel.image("gauge/graduation", 218, 544);
  panel.hudValues = null;
  // 0049c441: soHPFlash/soMPFlash default10, range0..19; HUD multiplies by5.
  panel.gaugeWarnings = [
    {
      setting: 10,
      previous: null,
      path: "gauge/hpFlash/0",
      x: 218,
      flashes: [],
    },
    {
      setting: 10,
      previous: null,
      path: "gauge/mpFlash/0",
      x: 326,
      flashes: [],
    },
  ];
}

export function updateProfileHud(panel, store) {
  if (!panel?.gauges) return;
  const profile = store?.profile;
  if (!profile) {
    clearProfileHud(panel);
    return;
  }
  updateIdentity(panel, profile);
  const required = experienceRequired(profile.level);
  const values = [
    profile.hp,
    profile.maxHP,
    profile.mp,
    profile.maxMP,
    profile.exp,
    required,
  ];
  if (panel.hudValues?.every((value, index) => value === values[index])) return;
  panel.hudValues = values;
  updateWarning(panel, panel.gaugeWarnings[0], profile.hp, profile.maxHP);
  updateWarning(panel, panel.gaugeWarnings[1], profile.mp, profile.maxMP);
  updateGaugeExtents(panel, values);
  panel.hudNumbers?.destroy();
  const numbers = panel.layer("HUD values");
  panel.hudNumbers = numbers;
  resourceNumbers(numbers, profile.hp, profile.maxHP, 237);
  resourceNumbers(numbers, profile.mp, profile.maxMP, 349);
  experienceNumbers(numbers, profile.exp, required);
}

function clearProfileHud(panel) {
  panel.hudNumbers?.destroy();
  panel.identityLayer?.destroy();
  panel.hudNumbers = null;
  panel.identityLayer = null;
  panel.hudValues = null;
  panel.hudName = null;
  for (const gauge of panel.gauges) {
    gauge.extent = 0;
    gauge.sprite.setPosition(gauge.x, 581);
    gauge.sprite.container.scale.x = gauge.width;
    gauge.sprite.container.visible = true;
  }
  for (const warning of panel.gaugeWarnings) {
    warning.previous = null;
    for (const flash of warning.flashes) flash.container.visible = false;
  }
}

function updateGaugeExtents(panel, values) {
  for (let i = 0; i < 3; i++) {
    const gauge = panel.gauges[i];
    const maximum = values[i * 2 + 1];
    const extent =
      maximum > 0
        ? Math.max(
            0,
            Math.min(
              gauge.width,
              Math.floor((gauge.width * values[i * 2]) / maximum),
            ),
          )
        : 0;
    gauge.extent = extent;
    gauge.sprite.setPosition(gauge.x + extent, 581);
    gauge.sprite.container.scale.x = gauge.width - extent;
    gauge.sprite.container.visible = extent < gauge.width;
  }
}

/** 008d82b8: actual LevelNo canvases; name/job are native strings, not bitmap labels. */
function updateIdentity(panel, profile) {
  if (
    panel.hudName === profile.name &&
    panel.hudLevel === profile.level &&
    panel.hudJob === profile.job
  ) {
    return;
  }
  panel.hudName = profile.name;
  panel.hudLevel = profile.level;
  panel.hudJob = profile.job;
  panel.identityLayer?.destroy();
  const layer = panel.layer("Character identity");
  panel.identityLayer = layer;
  const level = String(profile.level);
  let x = 50 - 6 * (level.length - 1);
  for (const digit of level) {
    const path = `LevelNo/${digit}`;
    layer.image(path, x, 554);
    x += layer.assets[path].width + 1;
  }
  layer.text(JOB_LABELS[profile.job] || "", 87, 545, 126);
  layer.text(profile.name, 87, 560, 126);
}

function digits(panel, value, x) {
  const text = String(value);
  for (const digit of text) {
    panel.image(`number/${digit}`, x, 549);
    x += 6;
  }
  return x;
}

function resourceNumbers(panel, current, maximum, x) {
  panel.image("number/Lbracket", x, 548);
  x = digits(panel, current, x + 4);
  panel.image("number/slash", x, 548);
  x = digits(panel, maximum, x + 8);
  panel.image("number/Rbracket", x + 1, 548);
}

function experienceNumbers(panel, experience, required) {
  let x = digits(panel, experience, 466);
  panel.image("number/Lbracket", x, 548);
  x += 4;
  const hundredths =
    required > 0
      ? Math.min(10000, Math.trunc((experience * 10000) / required))
      : 0;
  x = digits(panel, Math.trunc(hundredths / 100), x);
  // The native consumer uses a font-rendered period rather than a number canvas.
  const dot = panel.text(".", x, 544, 4);
  dot.style.cssText += "color:#000;font:12px/12px Arial,sans-serif;";
  x = digits(panel, String(hundredths % 100).padStart(2, "0"), x + 4);
  panel.image("number/percent", x, 549);
  panel.image("number/Rbracket", x + 8, 548);
}

function updateWarning(panel, warning, current, maximum) {
  const threshold = warning.setting * 5;
  if (threshold === 0 || threshold <= Math.floor((current * 100) / maximum)) {
    warning.previous = Math.floor((threshold * maximum) / 100);
    return;
  }
  if (warning.previous !== null && current < warning.previous) {
    let flash = warning.flashes.find(
      (candidate) => !candidate.container.visible,
    );
    if (!flash) {
      if (warning.flashes.length >= 64) {
        throw new Error("HUD warning animation budget exceeded");
      }
      flash = panel.stateImage(warning.path, warning.x, 580);
      flash.setAction("default", "once");
      warning.flashes.push(flash);
    }
    flash.seek(0);
    flash.container.visible = true;
  }
  warning.previous = current;
}

/** Native control0 has no explicit repeat flag; browser lifetime is one authored sequence, without a synthetic fade. */
export function finishGaugeWarnings(panel) {
  if (!panel?.gaugeWarnings) return;
  for (const warning of panel.gaugeWarnings) {
    for (const flash of warning.flashes) {
      if (flash.container.visible && flash.completed) {
        flash.container.visible = false;
      }
    }
  }
}
