import { join } from "node:path";
import { validateProfile } from "../../src/profile/profile-validation.js";
import { clickLabel, mapManifest, openConsoleSection, seededProfile, TIMEOUT } from "./native.js";

const MAP_ID = "000010000";
const PRODUCER = "[data-local-simulation]:not([hidden])";
const PROMPT = '.maple-ui-panel[aria-label="SocialInvitation"]';
const PEER = "InvitePeer";
const SELECTORS = {
  actor: `${PRODUCER} select[aria-label="Act as local character"]`,
  target: `${PRODUCER} select[aria-label="Target local character"]`,
  action: `${PRODUCER} select[aria-label="Local peer action"]`,
};

/** Detached production profile; level is explicit setup, not earned progression. */
async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP_ID);
  const actor = manifest.actors.find((entry) => entry.kind === "character");
  if (!actor) {
    throw new Error("Beginner map lacks its original character spawn");
  }
  const profile = seededProfile(catalog, {
    mapId: MAP_ID,
    x: actor.x,
    y: actor.y,
    facing: 1,
  });
  profile.level = 10;
  validateProfile(profile, catalog.ui.items);
  return {
    profile,
    provenance: {
      kind: "seeded-not-earned",
      grants: { level: 10 },
      policy:
        "Canonical createProfile plus validator; peer creation and level10 setup use normal outside-game DOM controls. No seeded social membership or invitations.",
    },
  };
}

async function enableAudio(page) {
  await openConsoleSection(page, "settings");
  if (!(await page.$eval("#sound-inspection", (element) => element.open))) {
    await page.click("#sound-inspection > summary");
  }
  await clickLabel(page, "Enable / resume audio", "#audio-controls");
  for (const [category, checked] of [
    ["BGM", true],
    ["SE", false],
  ]) {
    const selector = `[data-audio-mute="${category}"]`;
    if ((await page.$eval(selector, (input) => input.checked)) !== checked) {
      await page.click(selector);
    }
  }
  await page.waitForFunction(
    () => {
      const audio = window.maple.snapshot().inGame.audiovisual;
      return (
        audio.state === "running" &&
        audio.settings.BGM.mute &&
        !audio.settings.SE.mute &&
        audio.settings.SE.volume > 0
      );
    },
    { timeout: TIMEOUT },
  );
}

async function producerReady(page) {
  await page.waitForFunction(
    (selector) => {
      const root = document.querySelector(selector);
      const button =
        root &&
        Array.from(root.querySelectorAll("button")).find(
          (entry) =>
            entry.textContent === "Perform as selected local character",
        );
      return button && !button.disabled;
    },
    { timeout: TIMEOUT },
    PRODUCER,
  );
}

async function createPeer(page) {
  await openConsoleSection(page, "character");
  if (!(await page.$eval(PRODUCER, (element) => element.open))) {
    await page.click(`${PRODUCER} > summary`);
  }
  const primary = await page.$eval(SELECTORS.actor, (select) => {
    if (select.options.length !== 1) {
      throw new Error("Scenario requires an isolated single-character fixture");
    }
    return select.options[0].value;
  });
  await page.type(
    `${PRODUCER} input[aria-label="New local character name"]`,
    PEER,
  );
  await clickLabel(page, "Create local character", PRODUCER);
  await page.waitForFunction(
    (selector, name) => {
      const select = document.querySelector(selector);
      return (
        select &&
        Array.from(select.options).some((option) =>
          option.textContent.startsWith(`${name} —`),
        )
      );
    },
    { timeout: TIMEOUT },
    SELECTORS.actor,
    PEER,
  );
  await producerReady(page);
  const peer = await page.$eval(
    SELECTORS.actor,
    (select, name) =>
      Array.from(select.options).find((option) =>
        option.textContent.startsWith(`${name} —`),
      ).value,
    PEER,
  );
  await page.select(SELECTORS.actor, peer);
  await page.select(SELECTORS.target, primary);
  const level = `${PRODUCER} input[aria-label="Peer level"]`;
  await page.click(level, { clickCount: 3 });
  await page.keyboard.type("10");
  await clickLabel(page, "Save peer level", PRODUCER);
  await producerReady(page);
  await page.waitForFunction(
    (selector, id) => {
      const option = Array.from(document.querySelector(selector).options).find(
        (entry) => entry.value === id,
      );
      return option?.textContent.includes("Lv. 10");
    },
    { timeout: TIMEOUT },
    SELECTORS.actor,
    peer,
  );
  return { primary, peer, peerLevel: 10, earned: false };
}

/** Observation only: actual post-master worklet PCM, no synthetic audio or live mutations. */
async function capture(page, seconds) {
  return page.evaluate(async (duration) => {
    const { pcm, ...metadata } = await window.maple.captureAudio(duration);
    return { ...metadata, pcmBytes: pcm.byteLength };
  }, seconds);
}

async function quiet(page) {
  await page.waitForFunction(
    () => {
      const audio = window.maple.snapshot().inGame.audiovisual;
      return audio.pending === 0 && audio.voices <= (audio.bgm ? 1 : 0);
    },
    { timeout: TIMEOUT },
  );
}

async function geometry(context, kind) {
  const measured = await context.page.$eval(PROMPT, (panel) => {
    const bounds = panel.getBoundingClientRect();
    const root = panel.closest(".maple-ui-root").getBoundingClientRect();
    const state = window.maple.snapshot().inGame.ui;
    const logical = state.windowBounds.find(
      (entry) => entry.name === "SocialInvitation",
    );
    return {
      top: bounds.top,
      left: bounds.left,
      width: bounds.width,
      height: bounds.height,
      expectedTop: root.top + (508 * root.height) / 600,
      logical,
      scale: state.scale,
      offsetY: state.offsetY,
    };
  });
  context.assert(
    Math.abs(measured.top - measured.expectedTop) < 1,
    `${kind} uses FadeYesNo y508 through the actual HUD transform, without status-client +22`,
    measured,
  );
  return measured;
}

async function incoming(context, kind) {
  const { page, assert, output, checkpoint } = context;
  await producerReady(page);
  await page.select(SELECTORS.action, `${kind}.invite`);
  await quiet(page);
  // The outside-game submit has no generic native button cue. Protocol evaluation
  // starts the worklet capture before Puppeteer dispatches the trusted submit click.
  const [pcm] = await Promise.all([
    capture(page, 5),
    clickLabel(page, "Perform as selected local character", PRODUCER),
  ]);
  await page.waitForSelector(PROMPT, { visible: true, timeout: TIMEOUT });
  await page.waitForFunction(
    (selector) => Number(document.querySelector(selector)?.style.opacity) === 1,
    { timeout: TIMEOUT },
    PROMPT,
  );
  const decoded = await page.evaluate(
    () => window.maple.snapshot().inGame.audiovisual.lastDecode,
  );
  assert(
    pcm.audible &&
      pcm.rms > 0 &&
      pcm.peak > 0 &&
      pcm.pcmBytes === pcm.frames * 8,
    `${kind} incoming request reaches the actual post-master PCM output`,
    pcm,
  );
  const bounds = await geometry(context, kind);
  const screenshot = join(output, `${kind}-invitation.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  await checkpoint(`${kind}-incoming-prompt`);
  await quiet(page);
  const idle = await capture(page, 2);
  assert(
    !idle.audible && idle.peak === 0 && idle.rms === 0,
    `${kind} pending prompt does not replay its cue during idle repaint`,
    idle,
  );
  await declineInvitation(page, kind);
  return { kind, pcm, idle, decoded, bounds, screenshot, declined: true };
}

async function declineInvitation(page, kind) {
  const decline = await page.$eval(
    PROMPT,
    (panel, requestKind) => {
      const buttons = panel.querySelectorAll("button[aria-label]");
      if (buttons.length > 16) {
        throw new Error("Invitation control budget exceeded");
      }
      const button = Array.from(buttons).find((entry) => {
        const label = entry.getAttribute("aria-label");
        return (
          label === `Decline ${requestKind}` ||
          label.startsWith(`Decline ${requestKind} (`)
        );
      });
      if (!button) {
        throw new Error(`Missing native decline control for ${requestKind}`);
      }
      return button.getAttribute("aria-label");
    },
    kind,
  );
  await clickLabel(page, decline, PROMPT);
  await page.waitForSelector(PROMPT, { hidden: true, timeout: TIMEOUT });
  await producerReady(page);
}

async function run(context) {
  await enableAudio(context.page);
  const participants = await createPeer(context.page);
  await quiet(context.page);
  const baseline = await capture(context.page, 2);
  context.assert(
    !baseline.audible && baseline.peak === 0,
    "Muted BGM and idle beginner field give a silent pre-invitation baseline",
    baseline,
  );
  const observations = [];
  observations.push({ kind: "silent-baseline", pcm: baseline });
  for (const kind of ["friend", "party"]) {
    observations.push(await incoming(context, kind));
  }
  return {
    checkedKinds: ["friend", "party"],
    uncheckedKinds: ["guild"],
    guildBoundary:
      "Guild requires six consenting founders at Guild Headquarters and1,500,000 mesos. This common FadeYesNo native producer/PCM proof does not claim that separate guild founding workflow or guild invitation was exercised.",
    participants,
    observations,
    originalEvidence:
      "notification-instructions-50-58.txt:00522cf4/00522ee6/005233da ->00989588;00522c73/00522e65/00523359 y508, top-level0051f9ad ->009de4d2, not HUD-client +22.",
  };
}

export default {
  name: "social-invitations",
  recipe: 1,
  mapIds: [MAP_ID],
  dependencies: [
    "client/tools/scenarios/{native,social-invitations}.js",
    "client/src/development/local-simulation-controls.js",
    "client/src/social/*.js",
    "client/src/ui/{game-ui,ui-trade-invitation,ui-local-windows}.js",
    "client/src/audio/*.js",
    "client/index.html",
  ],
  fixture,
  run,
};
