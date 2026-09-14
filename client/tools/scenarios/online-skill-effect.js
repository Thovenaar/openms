import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, ready } from "./online-ui-repairs.js";
import { login } from "./online-recycling-scrolls.js";

/** Native cast → published skill visual → resident effect artwork and started skill voice. */
export async function runSkillEffect({ browser, url, output }) {
  await mkdir(output, { recursive: true });
  const report = { status: "running", checks: [], errors: [] };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    const page = await participant(browser, contexts, pages, report);
    await login(page, url, "caster");
    await cast(page, output, report);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
    }
  } finally {
    for (const context of contexts) await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function cast(page, output, report) {
  await page.bringToFront();
  // A native key is the trusted gesture that enables browser audio output.
  await page.keyboard.press("d");
  await page
    .waitForFunction(() => window.maple.snapshot().audio.state === "running", {
      timeout: 10000,
    })
    .catch(() => {});
  await page.waitForFunction(
    () =>
      window.mapleOnline
        .observation()
        .entities.some(
          (entity) =>
            entity.appearance?.name === "Caster" &&
            (entity.skillVisuals?.length ?? 0) > 0,
        ),
    { timeout: 10000 },
  );
  // Capture mid-effect: the 1.17 s authored animation's opening frame is faint.
  await new Promise((resolve) => {
    setTimeout(resolve, 450);
  });
  await page.screenshot({ path: join(output, "cast.png") });
  // The Use voice starts asynchronously after the published cast.
  await page
    .waitForFunction(() => (window.maple.snapshot().audio.voices ?? 0) > 0, {
      timeout: 5000,
    })
    .catch(() => {});
  const state = await page.evaluate(() => {
    const entity = window.mapleOnline
      .observation()
      .entities.find((entry) => entry.appearance?.name === "Caster");
    return {
      status: window.maple.snapshot().online.status,
      audio: window.maple.snapshot().audio.state,
      voices: window.maple.snapshot().audio.voices ?? 0,
      visuals: entity?.skillVisuals?.length ?? 0,
      visual: entity?.skillVisuals?.[0] ?? null,
    };
  });
  report.cast = state;
  assertion(
    state.status === "active",
    "Client left the field after a cast",
    state,
  );
  assertion(state.visuals > 0, "Server cast published no skill visual", state);
  assertion(
    state.audio === "running" && state.voices > 0,
    "Skill voice did not start",
    state,
  );
  assertion(report.errors.length === 0, "Browser exceptions", report.errors);
  report.checks.push(
    "A seeded self-cast published a visual and started its Use voice",
  );
  await ready(page);
}
