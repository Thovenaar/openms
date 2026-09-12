import { join } from "node:path";
import { mapManifest, seededProfile } from "./native.js";

const MAP_ID = "000010000";
const FIRST_ERROR = "Controlled inspection log verification: first failure";
const SECOND_ERROR = "Controlled inspection log verification: second failure";

/** Fresh stopped-page beginner fixture; no quest or combat progress is earned. */
async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP_ID);
  const actor = manifest.actors.find((entry) => entry.kind === "character");
  if (!actor) throw new Error("Beginner map lacks its character spawn");
  return {
    profile: seededProfile(catalog, {
      mapId: MAP_ID,
      x: actor.x,
      y: actor.y,
      facing: 1,
    }),
    provenance:
      "Canonical beginner setup; controlled uncaught errors are verification inputs, not gameplay failures.",
  };
}

/** Trigger the actual uncaught-error listener, never write directly into the log DOM. */
async function uncaught(page, text) {
  await page.evaluate((message) => {
    // Invoke a rejecting production API from its own script origin; CDP-authored
    // thrown errors can be redacted by Chrome to the unhelpful "Script error.".
    setTimeout(window.maple.setAction, 0, message, "stand1");
  }, text);
  await page.waitForFunction(
    (message) =>
      window.maple.snapshot().lastError ===
      `Entity is not resident: ${message}`,
    { timeout: 10000 },
    text,
  );
}

async function copyingRetainsSelection(context) {
  const { page, assert } = context;
  await page.click("#error");
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  const before = await page.$eval("#error", (input) => ({
    value: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
  }));
  await uncaught(page, SECOND_ERROR);
  const retained = await page.$eval("#error", (input) => ({
    value: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
  }));
  assert(
    JSON.stringify(before) === JSON.stringify(retained),
    "An incoming error preserves the text being selected for copying",
  );
  await page.click("#error-log summary");
  await page.waitForFunction(
    (message) => document.querySelector("#error").value.includes(message),
    { timeout: 10000 },
    SECOND_ERROR,
  );
  await page.click("#error-log summary");
}

async function run(context) {
  const { page, assert, checkpoint, output } = context;
  await page.click("#console-tab-play");
  const before = await page.$eval(
    "#map-selection",
    (element) => element.getBoundingClientRect().top,
  );
  await uncaught(page, FIRST_ERROR);
  const after = await page.$eval(
    "#map-selection",
    (element) => element.getBoundingClientRect().top,
  );
  assert(
    before === after,
    "A reported error does not displace the Play controls",
    { before, after },
  );
  assert(
    (await page.$("#input-controls")) === null,
    "Play has no Movement keys disclosure",
  );
  await page.click("#console-tab-inspect");
  await page.click("#error-log summary");
  await page.waitForFunction(
    (message) => document.querySelector("#error").value.includes(message),
    { timeout: 10000 },
    FIRST_ERROR,
  );
  await copyingRetainsSelection(context);
  const text = await page.$eval("#error", (input) => input.value);
  assert(
    text.includes(FIRST_ERROR) && text.includes(SECOND_ERROR),
    "The dedicated log retains both uncaught failures after blur",
  );
  const capture = join(output, "inspection-error-log.png");
  await page.screenshot({ path: capture, fullPage: false });
  await checkpoint("dedicated-error-log-visible");
  return {
    controlledErrors: [FIRST_ERROR, SECOND_ERROR],
    playTop: { before, after },
    capture,
  };
}

export default {
  name: "inspection-errors",
  recipe: 1,
  mapIds: [MAP_ID],
  dependencies: [
    "client/tools/scenarios/{native,inspection-errors}.js",
    "client/index.html",
    "client/style.css",
    "client/src/main.js",
    "client/src/ui/ui-game-logs.js",
    "client/src/development/scene-controls.js",
  ],
  fixture,
  run,
};
