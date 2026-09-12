import {
  tourFixture,
  outbound,
  ORIGIN,
  DESTINATION,
} from "./world-tour-return.js";
import {
  assertWindow,
  dragWindow,
  focusCanvas,
  openWindow,
  retainWindow,
  settled,
} from "./native.js";

async function run(context) {
  const { page, checkpoint, snapshot, assert, inputs } = context;
  await settled(page, ORIGIN);
  await checkpoint("before-native-window-setup");
  await openWindow(page, "i", "Item");
  const inventory = await retainWindow(page, "Item");
  await dragWindow(page, inventory, -100, -45);
  await openWindow(page, "s", "Stat");
  const stats = await retainWindow(page, "Stat");
  await dragWindow(page, stats, 100, -30);
  await page.keyboard.press("Enter");
  await page.type('[aria-label="Chat message"]', "Unsent native travel draft");
  const draft = await page.$('[aria-label="Chat message"]');
  await focusCanvas(page);
  const before = await snapshot();
  await checkpoint("before-travel-with-open-windows-and-draft");
  await outbound(context, true);
  const after = await snapshot();
  const windows = [];
  for (const retained of [inventory, stats]) {
    windows.push(await assertWindow(context, retained));
  }
  const draftState = await draft.evaluate((element) => ({
    identity:
      element.isConnected &&
      element === document.querySelector('[aria-label="Chat message"]'),
    value: element.value,
  }));
  assert(
    draftState.identity && draftState.value === "Unsent native travel draft",
    "Map travel preserves the actual native chat input and unsent draft",
    { actual: draftState },
  );
  assert(
    !after.inGame.ui.windows.includes("UtilDlgEx"),
    "The field-bound NPC dialogue retires while ordinary windows survive",
  );
  assert(
    after.inGame.ui.pending.length === 0,
    "Travel has no orphaned native pending windows",
  );
  assert(
    after.currentMap !== before.currentMap && after.currentMap === DESTINATION,
    "Preservation is observed across a committed authored map change",
  );
  await checkpoint("after-travel-with-same-native-windows");
  for (const retained of [inventory, stats]) await retained.handle.dispose();
  await draft.dispose();
  return {
    provenance: inputs.fixture.provenance,
    windows,
    draft: draftState,
    maps: [before.currentMap, after.currentMap],
  };
}

export default {
  name: "window-map-travel",
  recipe: 1,
  mapIds: [ORIGIN, DESTINATION],
  dependencies: [
    "client/tools/scenarios/{native,world-tour-return,window-map-travel}.js",
    "client/src/main.js",
    "client/src/ingame*.js",
    "client/src/ui/**/*.js",
    "client/src/input/**/*.js",
    "client/src/npc/**/*.js",
    "client/src/world/field-transition.js",
  ],
  fixture: tourFixture,
  run,
};
