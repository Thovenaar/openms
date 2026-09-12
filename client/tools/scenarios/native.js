import {
  createProfile,
  validateProfile,
} from "../../src/profile/profile-validation.js";

export const TIMEOUT = 30000;
export const PANEL = ".maple-ui-panel";

/** Fixtures are detached, validated setup, never earned progression or live mutations. */
export function seededProfile(catalog, location) {
  const profile = createProfile(location);
  validateProfile(profile, catalog.ui.items);
  return profile;
}

export async function mapManifest(catalog, loadJSON, id) {
  const descriptor = catalog.maps[id];
  if (!descriptor) {
    throw new Error(`Required source-backed map ${id} is not packaged`);
  }
  const manifest = await loadJSON(descriptor);
  if (manifest.id !== id) {
    throw new Error(`Map descriptor identity mismatch: ${id}`);
  }
  return manifest;
}

export function npcPlacement(manifest, id) {
  const placement = manifest.life.placements.find(
    (entry) => entry.kind === "npc" && Number(entry.authored.id) === id,
  );
  if (!placement) {
    throw new Error(`Map ${manifest.id} lacks authored NPC ${id}`);
  }
  return placement;
}

export function groundAt(manifest, footholdId, x) {
  const foothold = manifest.physics.footholds.find(
    (entry) => entry.id === footholdId,
  );
  if (
    !foothold ||
    foothold.x1 >= foothold.x2 ||
    x < foothold.x1 ||
    x > foothold.x2
  ) {
    throw new Error(`Fixture feet are outside authored foothold ${footholdId}`);
  }
  return (
    foothold.y1 +
    ((x - foothold.x1) * (foothold.y2 - foothold.y1)) /
      (foothold.x2 - foothold.x1)
  );
}

export function player(state) {
  return state.field.gameplay.player;
}

export async function settled(page, mapId) {
  await page.waitForFunction(
    (id) => {
      const state = window.maple.snapshot();
      return (
        state.currentMap === id &&
        !state.loading &&
        state.fieldTransition.phase === "idle" &&
        state.pendingLoads === 0 &&
        state.inGame.ui.pending.length === 0 &&
        !state.field.skills.preparing
      );
    },
    { timeout: TIMEOUT },
    mapId,
  );
}

export async function clickLabel(page, label, scope = "") {
  const handle = await page.waitForFunction(
    (name, rootSelector) => {
      const root = rootSelector
        ? document.querySelector(rootSelector)
        : document;
      if (!root) return false;
      const controls = root.querySelectorAll("button,[aria-label]");
      if (controls.length > 4096) {
        throw new Error("Native control lookup exceeds4096nodes");
      }
      return (
        Array.from(controls).find(
          (element) =>
            (element.getAttribute("aria-label") === name ||
              element.textContent === name) &&
            element.getBoundingClientRect().width > 0 &&
            !element.disabled &&
            element.getAttribute("aria-disabled") !== "true",
        ) || false
      );
    },
    { timeout: TIMEOUT },
    label,
    scope,
  );
  try {
    await handle.asElement().click();
  } finally {
    await handle.dispose();
  }
}

export async function dialogueStep(page, selector) {
  const panel = `${PANEL}[aria-label="UtilDlgEx"]`;
  await page.waitForSelector(`${panel} ${selector}`, {
    visible: true,
    timeout: TIMEOUT,
  });
  const before = await page.$eval(panel, (element) => element.textContent);
  await page.click(`${panel} ${selector}`);
  await page.waitForFunction(
    (root, text) => {
      const element = document.querySelector(root);
      return !element || element.textContent !== text;
    },
    { timeout: TIMEOUT },
    panel,
    before,
  );
}

/** Camera inspection buttons change only the view; NPC admission stays the native pointer path. */
export async function viewNpc(page, placement) {
  await page.click("#console-tab-inspect");
  const cameraDetails = await page.$(
    'xpath///summary[text()="Camera"]/parent::details',
  );
  if (!(await cameraDetails.evaluate((element) => element.open))) {
    await page.click('xpath///summary[text()="Camera"]');
  }
  const geometry = await page.evaluate(() => {
    const state = window.maple.snapshot();
    const canvas = document.querySelector("#viewport canvas");
    return {
      camera: state.camera,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
  });
  const dx = placement.authored.x - geometry.width / 2 - geometry.camera.x;
  const dy = placement.authored.cy - geometry.height / 2 - geometry.camera.y;
  const moves = [
    [dx < 0 ? "Camera left" : "Camera right", Math.round(Math.abs(dx) / 32)],
    [dy < 0 ? "Camera up" : "Camera down", Math.round(Math.abs(dy) / 32)],
  ];
  if (moves[0][1] + moves[1][1] > 256) {
    throw new Error("NPC camera path exceeds 256 native clicks");
  }
  for (const [label, count] of moves) {
    for (let index = 0; index < count; index++) await clickLabel(page, label);
  }
  await page.waitForFunction(
    (id) => {
      const entry = window.maple
        .snapshot()
        .field.life.placements.find((value) => value.id === id);
      return entry?.resident && entry.npcInteraction;
    },
    { timeout: TIMEOUT },
    placement.id,
  );
}

export async function clickNpc(page, placement) {
  const point = await page.evaluate((id) => {
    const state = window.maple.snapshot();
    const entry = state.field.life.placements.find((value) => value.id === id);
    const bounds = entry?.npcInteraction;
    if (!bounds) {
      throw new Error(
        `NPC ${id} has no resident original interaction rectangle`,
      );
    }
    const canvas = document.querySelector("#viewport canvas");
    const rect = canvas.getBoundingClientRect();
    const x = (bounds.left + bounds.right) / 2 - state.camera.x;
    const y = (bounds.top + bounds.bottom) / 2 - state.camera.y;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) {
      throw new Error(`NPC ${id} is outside the visible native canvas`);
    }
    return { x: rect.left + x, y: rect.top + y };
  }, placement.id);
  await page.mouse.click(point.x, point.y);
}

/** Keep fixture focus below the tools toggle and above the native windows. */
export async function focusCanvas(page) {
  const point = await page.$eval("#viewport canvas", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + 120;
    const y = rect.top + 60;
    if (document.elementFromPoint(x, y) !== canvas) {
      throw new Error("Native fixture canvas focus point is covered");
    }
    return { x, y };
  });
  await page.mouse.click(point.x, point.y);
}

export async function openWindow(page, key, name) {
  await page.keyboard.press(key);
  await page.waitForSelector(`${PANEL}[aria-label=${JSON.stringify(name)}]`, {
    visible: true,
    timeout: TIMEOUT,
  });
}

export async function retainWindow(page, name) {
  const selector = `${PANEL}[aria-label=${JSON.stringify(name)}]`;
  const handle = await page.waitForSelector(selector, {
    visible: true,
    timeout: TIMEOUT,
  });
  if (!handle) throw new Error(`Native window ${name} did not open`);
  const bounds = await handle.boundingBox();
  return { name, selector, handle, bounds };
}

export async function assertWindow(context, retained) {
  const { assert } = context;
  const identity = await retained.handle.evaluate(
    (element, selector) =>
      element.isConnected && element === document.querySelector(selector),
    retained.selector,
  );
  assert(identity, `${retained.name} keeps its actual DOM identity`);
  const bounds = await retained.handle.boundingBox();
  assert(
    bounds.x === retained.bounds.x && bounds.y === retained.bounds.y,
    `${retained.name} keeps its native position`,
    { actual: bounds, expected: retained.bounds },
  );
  return {
    name: retained.name,
    identity,
    before: retained.bounds,
    after: bounds,
  };
}

export async function dragWindow(page, retained, dx, dy) {
  const box = await retained.handle.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 50 + dx, box.y + 8 + dy, { steps: 8 });
  await page.mouse.up();
  retained.bounds = await retained.handle.boundingBox();
}
