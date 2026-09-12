import {
  clickLabel,
  dragWindow,
  openWindow,
  retainWindow,
  TIMEOUT,
} from "./native.js";

export async function bindClawSkills(context) {
  const { page, assert } = context;
  const origin = await page.$eval("#viewport canvas", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
  await openWindow(page, "k", "Skill");
  const skills = await retainWindow(page, "Skill");
  await dragWindow(
    page,
    skills,
    origin.x + 12 - skills.bounds.x,
    origin.y + 50 - skills.bounds.y,
  );
  await page.click("#input-config");
  const keys = await retainWindow(page, "KeyConfig");
  await dragWindow(
    page,
    keys,
    origin.x + 200 - keys.bounds.x,
    origin.y + 50 - keys.bounds.y,
  );
  await bindSkill(page, { id: 4001344, tab: 2, index: 30 });
  await bindSkill(page, { id: 4101003, tab: 3, index: 32 });
  await clickLabel(page, "Save key configuration");
  await page.waitForSelector('.maple-ui-panel[aria-label="KeyConfig"]', {
    hidden: true,
    timeout: TIMEOUT,
  });
  await page.keyboard.press("k");
  await page.waitForSelector('.maple-ui-panel[aria-label="Skill"]', {
    hidden: true,
    timeout: TIMEOUT,
  });
  const saved = await page.evaluate(
    () => window.maple.snapshot().field.gameplay.player.keyBindings.keys,
  );
  assert(
    saved[30].type === 1 &&
      saved[30].id === 4001344 &&
      saved[32].id === 4101003,
    "Native skill carry and explicit Save publish Lucky Seven and Claw Booster bindings",
  );
  await skills.handle.dispose();
  await keys.handle.dispose();
}

async function bindSkill(page, binding) {
  const root = '.maple-ui-panel[aria-label="Skill"]';
  await clickLabel(page, `Skill tab ${binding.tab}`, root);
  const selector = `${root} [data-skill-id="${binding.id}"]`;
  let visible = false;
  for (let step = 0; step < 16; step++) {
    await page.waitForFunction(
      () => window.maple.snapshot().inGame.ui.pending.length === 0,
      { timeout: TIMEOUT },
    );
    await page.waitForSelector(`${root} [data-skill-id]`, { timeout: TIMEOUT });
    if (await page.$(selector)) {
      visible = true;
      break;
    }
    const first = await page.$eval(
      `${root} [data-skill-id]`,
      (element) => element.dataset.skillId,
    );
    const box = await (await page.$(root)).boundingBox();
    await page.mouse.move(box.x + 60, box.y + 180);
    await page.mouse.wheel({ deltaY: 100 });
    await page.waitForFunction(
      (prefix, id) =>
        document.querySelector(`${prefix} [data-skill-id]`)?.dataset.skillId !==
        id,
      { timeout: TIMEOUT },
      root,
      first,
    );
  }
  if (!visible) {
    throw new Error(
      `Learned original skill ${binding.id} exceeds16native scroll steps`,
    );
  }
  await clickControl(page, selector);
  await clickControl(
    page,
    `.maple-ui-panel[aria-label="KeyConfig"] [data-key-index="${binding.index}"]`,
  );
  await page.waitForFunction(
    (entry) => {
      const binding =
        window.maple.snapshot().inGame.ui.keyBindings.active.keys[entry.index];
      return binding.type === 1 && binding.id === entry.id;
    },
    { timeout: TIMEOUT },
    binding,
  );
}

async function clickControl(page, selector) {
  const point = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
}

/** Native movement pursues actual live source mobs; no spawn or physics assignment. */
export async function moveToRange(page, minimum, maximum) {
  const outsidePack = minimum >= 100;
  for (let attempt = 0; attempt < 12; attempt++) {
    const target = await page.evaluate((outside) => {
      const state = window.maple.snapshot();
      const candidates = state.field.gameplay.mobs.filter(
        (mob) =>
          mob.alive && mob.active && Math.abs(mob.y - state.simulation.y) < 45,
      );
      candidates.sort((a, b) =>
        outside
          ? a.x - b.x
          : Math.abs(a.x - state.simulation.x) -
            Math.abs(b.x - state.simulation.x),
      );
      const mob = candidates[0];
      if (!mob) {
        throw new Error("No actual live mob on the player's authored platform");
      }
      return {
        id: mob.id,
        dx: mob.x - state.simulation.x,
        facing: state.simulation.facing,
      };
    }, outsidePack);
    const distance = outsidePack ? target.dx : Math.abs(target.dx);
    const facing = target.dx < 0 ? -1 : 1;
    if (distance >= minimum && distance <= maximum) {
      if (target.facing !== facing) {
        await page.keyboard.press(facing < 0 ? "ArrowLeft" : "ArrowRight");
      }
      return target.id;
    }
    const direction =
      (distance < minimum ? -1 : 1) * (outsidePack ? 1 : facing);
    const key = direction < 0 ? "ArrowLeft" : "ArrowRight";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        (bounds) => {
          const state = window.maple.snapshot();
          const mob = state.field.gameplay.mobs.find(
            (entry) => entry.id === bounds.id,
          );
          if (!mob?.alive || Math.abs(mob.y - state.simulation.y) >= 45) {
            return true;
          }
          const dx = mob.x - state.simulation.x;
          const distance = bounds.outsidePack ? dx : Math.abs(dx);
          return distance >= bounds.minimum && distance <= bounds.maximum;
        },
        { timeout: TIMEOUT },
        { id: target.id, minimum, maximum, outsidePack },
      );
    } finally {
      await page.keyboard.up(key);
    }
  }
  throw new Error("Native mob approach exceeded12bounded steering decisions");
}

export async function attackSnapshot(page, fired) {
  const handle = await page.waitForFunction(
    (expected) => {
      const state = window.maple.snapshot();
      const gameplay = state.field.gameplay;
      return gameplay.phase === "attack" &&
        gameplay.attackTiming.fired === expected
        ? state
        : false;
    },
    { timeout: TIMEOUT },
    fired,
  );
  try {
    return await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
}

export async function attackIdle(page) {
  await page.waitForFunction(
    () => window.maple.snapshot().field.gameplay.phase === "idle",
    { timeout: TIMEOUT },
  );
}
