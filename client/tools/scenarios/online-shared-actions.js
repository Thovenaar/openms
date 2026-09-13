import { join } from "node:path";
import { assertion, measureStage } from "../native-evidence.js";
import { clickLabel, focusCanvas } from "./native.js";

const TIMEOUT = 15000;

/** Explicit GM setup in an isolated fixture; attack and pickup below use native inputs. */
export async function prepareSharedActions(page, report) {
  report.fixture = {
    str: 100,
    baseMaxHP: 500,
    hp: 500,
    meso: 1000,
    monster: 100100,
  };
  await development(page, {
    kind: "profile",
    patch: { str: 100, baseMaxHP: 500, hp: 500, meso: 1000 },
  });
  await page.waitForFunction(
    () => {
      const state = window.mapleOnline.observation();
      return (
        state.self.hp === 500 &&
        state.self.entity.foothold !== null &&
        !window.maple.snapshot().loading
      );
    },
    { timeout: TIMEOUT },
  );
  await development(page, { kind: "spawn", templateId: 100100, count: 1 });
}

async function development(page, action) {
  const result = await page.evaluate(async (value) => {
    const config = await (await fetch("/api/v1/config")).json();
    const response = await fetch("/api/v1/development", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        csrfToken: config.csrfToken,
        connectionEpoch: window.mapleOnline.snapshot().connectionEpoch,
        operationId: crypto.randomUUID(),
        action: value,
      }),
    });
    const receipt = await response.json();
    if (!response.ok) {
      throw new Error(`Development HTTP ${response.status}: ${receipt.code}`);
    }
    return receipt;
  }, action);
  assertion(
    result.status === "committed",
    "Fixture development request failed",
  );
  await page.waitForFunction(
    () =>
      window.maple.snapshot().online.status === "active" &&
      !window.maple.snapshot().loading,
    { timeout: TIMEOUT },
  );
}

/** Record public field events, bounded and excluding authentication/session payloads. */
export async function recordSharedEvents(page, report, index) {
  const wire = await page.createCDPSession();
  await wire.send("Network.enable");
  wire.on("Network.webSocketFrameReceived", ({ response }) => {
    const message = JSON.parse(response.payloadData);
    const event = message.event;
    if (
      !event ||
      !["combat.attack", "combat.impact", "drop.spawn", "drop.pickup"].includes(
        event.kind,
      )
    ) {
      return;
    }
    if (report.events[index].length >= 128) return;
    report.events[index].push(event);
  });
}

export async function exerciseSharedActions(tools, id) {
  const { report } = tools;
  await measureStage(report.timings, "sharedCombat", () =>
    attackMob(tools, id),
  );
  await measureStage(report.timings, "sharedLoot", () => loot(tools, id));
}

async function attackMob({ pages, report, output }, id) {
  const page = pages[0];
  await focusCanvas(page);
  const mob = await page.evaluate(() =>
    window.mapleOnline
      .observation()
      .entities.find((entity) => entity.kind === "mob"),
  );
  assertion(Boolean(mob), "Fixture monster is absent");
  await approachMob(page, mob);
  for (let attempt = 0; attempt < 8; attempt++) {
    // Authority samples held attack at 30 ms; a zero-duration synthetic press
    // can begin and end between samples without proposing any attack.
    await page.keyboard.press("ControlLeft", { delay: 120 });
    await page.waitForFunction(
      () =>
        !window.mapleOnline.observation().self.entity.combatState
          ?.movementLocked,
      { timeout: TIMEOUT },
    );
    if (
      report.events[1].some(
        (event) =>
          event.kind === "combat.impact" &&
          event.actorId === id &&
          event.targetId === mob.id,
      )
    ) {
      break;
    }
    await page.waitForFunction(
      (tick) => window.maple.snapshot().online.serverTick > tick + 20,
      { timeout: TIMEOUT },
      await page.evaluate(() => window.maple.snapshot().online.serverTick),
    );
  }
  for (const events of report.events) {
    assertion(
      events.some((e) => e.kind === "combat.attack" && e.actorId === id),
      "Client missed the other player's attack",
    );
    assertion(
      events.some(
        (e) =>
          e.kind === "combat.impact" &&
          e.actorId === id &&
          e.targetId === mob.id &&
          e.damage > 0,
      ),
      "Client missed confirmed monster damage",
    );
  }
  report.combat = await Promise.all(
    pages.map((p) => p.evaluate(() => window.maple.snapshot().combat)),
  );
  await pages[1].screenshot({ path: join(output, "peer-combat.png") });
  report.checks.push(
    "Native attack and positive monster damage reach both clients",
  );
}

export async function approachMob(page, mob) {
  const position = await page.evaluate(
    () => window.maple.snapshot().presentation,
  );
  const direction = mob.position.x > position.x ? "ArrowRight" : "ArrowLeft";
  await page.keyboard.down(direction);
  try {
    await page.waitForFunction(
      (mobId) => {
        const state = window.mapleOnline.observation();
        const target = state.entities.find((entity) => entity.id === mobId);
        return Math.abs(target.position.x - state.self.entity.position.x) < 35;
      },
      { timeout: TIMEOUT },
      mob.id,
    );
  } finally {
    await page.keyboard.up(direction);
  }
}

async function loot({ pages, report, output }, id) {
  const page = pages[0];
  await dropMesos(page);
  for (const peer of pages) {
    await peer.waitForFunction(
      () =>
        window.mapleOnline
          .observation()
          .entities.some(
            (e) =>
              e.kind === "drop" &&
              e.templateId === 0 &&
              e.dropInfo.quantity === 10 &&
              e.dropMotion.state === "grounded",
          ),
      { timeout: TIMEOUT },
    );
  }
  report.drop = await page.evaluate(() =>
    window.mapleOnline
      .observation()
      .entities.find(
        (e) =>
          e.kind === "drop" && e.templateId === 0 && e.dropInfo.quantity === 10,
      ),
  );
  await pages[1].screenshot({ path: join(output, "peer-drop.png") });
  await focusCanvas(page);
  await page.keyboard.press("z");
  for (const peer of pages) {
    await peer.waitForFunction(
      (dropId) =>
        !window.mapleOnline.observation().entities.some((e) => e.id === dropId),
      { timeout: TIMEOUT },
      report.drop.id,
    );
  }
  for (const events of report.events) {
    assertion(
      events.some(
        (e) =>
          e.kind === "drop.pickup" &&
          e.actorId === id &&
          e.dropId === report.drop.id,
      ),
      "Client missed confirmed pickup",
    );
  }
  await pages[1].screenshot({ path: join(output, "peer-pickup.png") });
  report.checks.push(
    "Native mesos drop and pickup appear and disappear on both clients",
  );
}

async function dropMesos(page) {
  await focusCanvas(page);
  await page.keyboard.press("i");
  await page.waitForSelector('.maple-ui-panel[aria-label="Item"]', {
    visible: true,
    timeout: TIMEOUT,
  });
  await clickLabel(page, "Drop Mesos", '.maple-ui-panel[aria-label="Item"]');
  await page.waitForSelector('[aria-label="Mesos to drop"]', {
    visible: true,
    timeout: TIMEOUT,
  });
  await clickLabel(
    page,
    "Drop Mesos",
    '.maple-ui-panel[aria-label="Drop Mesos"]',
  );
  await page.waitForSelector('.maple-ui-panel[aria-label="Drop Mesos"]', {
    hidden: true,
    timeout: TIMEOUT,
  });
  await focusCanvas(page);
  await page.keyboard.press("i");
}
