import { join } from "node:path";
import tutorialDrops from "./tutorial-drops.js";
import { clickLabel, focusCanvas, openConsoleSection, TIMEOUT } from "./native.js";

const PROMPT = '.maple-ui-panel[aria-label="Quest ready notification"]';

async function enableAudio(page) {
  await openConsoleSection(page, "settings");
  if (!(await page.$eval("#sound-inspection", (element) => element.open))) {
    await page.click("#sound-inspection > summary");
  }
  await clickLabel(page, "Enable / resume audio", "#audio-controls");
  for (const [category, muted] of [
    ["BGM", true],
    ["SE", false],
  ]) {
    const selector = `[data-audio-mute="${category}"]`;
    if ((await page.$eval(selector, (input) => input.checked)) !== muted) {
      await page.click(selector);
    }
  }
  await focusCanvas(page);
  await page.waitForFunction(
    () => {
      const audio = window.maple.snapshot().inGame.audiovisual;
      return (
        audio.state === "running" &&
        audio.pending === 0 &&
        audio.settings.BGM.mute &&
        !audio.settings.SE.mute &&
        audio.settings.SE.volume > 0 &&
        audio.voices <= (audio.bgm ? 1 : 0)
      );
    },
    { timeout: TIMEOUT },
  );
}

async function capture(page, seconds) {
  return page.evaluate(async (duration) => {
    const startedAt = performance.now();
    const { pcm, ...result } = await window.maple.captureAudio(duration);
    return { ...result, startedAt, pcmBytes: pcm.byteLength };
  }, seconds);
}

async function readyProof(context, recording) {
  const { page, assert, snapshot, checkpoint } = context;
  await page.waitForSelector(PROMPT, { visible: true, timeout: TIMEOUT });
  const captured = await recording;
  if (!captured.ok) throw captured.error;
  const pcm = captured.result;
  assert(
    pcm.audible && pcm.peak > 0 && pcm.rms > 0,
    "The real post-master recording contains sound during final pickup and readiness",
    pcm,
  );
  const state = await snapshot();
  assert(
    state.field.gameplay.player.quests[1035].state === 1,
    "Ready notification does not complete the quest before Peter's turn-in",
  );
  assert(
    state.inGame.questReadyNotification.shown === 1,
    "Only the final item, not the prior accepted quest or kill, produces readiness",
  );
  const geometry = await page.$eval(PROMPT, (element) => ({
    questId: Number(element.dataset.questId),
    x: parseFloat(element.style.left),
    y: parseFloat(element.style.top),
    width: parseFloat(element.style.width),
    height: parseFloat(element.style.height),
    text: element.textContent,
  }));
  assert(
    geometry.questId === 1035 &&
      geometry.x === 639 &&
      geometry.y === 508 &&
      geometry.width === 155 &&
      geometry.height === 44,
    "Original quest artwork uses the existing bottom-right FadeYesNo plane",
    geometry,
  );
  await checkpoint("quest-ready-original-art-and-audio");
  await page.screenshot({
    path: join(context.output, "quest-ready-notification.png"),
  });
  const silent = await capture(page, 2);
  assert(
    !silent.audible && silent.peak === 0,
    "A retained ready notice does not replay audio during idle repaint",
    silent,
  );
  assert(
    (await snapshot()).inGame.questReadyNotification.shown === 1,
    "Idle repaint retains one readiness event",
  );
  return { pcm, geometry, silent };
}

async function run(context) {
  let recording = null;
  let proof = null;
  let baseline = null;
  const wrapped = {
    ...context,
    async checkpoint(name) {
      if (name === "source-backed-tutorial-shellpiece-on-ground") {
        context.assert(
          !(await context.snapshot()).inGame.questReadyNotification.active,
          "The required kill alone cannot announce readiness before the item is collected",
        );
        await enableAudio(context.page);
        baseline = await capture(context.page, 1);
        context.assert(
          !baseline.audible && baseline.peak === 0,
          "BGM-muted idle field is silent before final pickup",
          baseline,
        );
        // Retain rejection explicitly while trusted movement/pickup proceeds.
        recording = capture(context.page, 5).then(
          (result) => ({ ok: true, result }),
          (error) => ({ ok: false, error }),
        );
      }
      if (name === "native-tutorial-pickup-credited") {
        proof = await readyProof(context, recording);
      }
      return context.checkpoint(name);
    },
  };
  const tutorial = await tutorialDrops.run(wrapped);
  context.assert(
    proof !== null,
    "The native tutorial path exercised final pickup readiness",
  );
  const restored = await context.snapshot();
  context.assert(
    !restored.inGame.questReadyNotification.active &&
      restored.inGame.questReadyNotification.shown === 0,
    "Reloading already-ready durable progress establishes a silent baseline",
  );
  const sound = context.catalog.audiovisual.sounds.UI.Invite;
  return {
    tutorial,
    baseline,
    proof,
    loadedReadyPolicy: "silent-baseline",
    cueReference: {
      source: sound.source,
      sha256: sound.sha256,
      bytes: sound.bytes,
    },
    audioProofBoundary:
      "Post-gain PCM observes mixed final-pickup/readiness output and silent idle, not an isolated source start. Exact UI/Invite identity comes from original WZ/Ghidra evidence and production GameUI.sound dispatch; no audio prototype or graph is intercepted.",
  };
}

export default {
  name: "quest-ready-notification",
  recipe: 1,
  mapIds: tutorialDrops.mapIds,
  dependencies: [
    ...tutorialDrops.dependencies,
    "client/tools/scenarios/quest-ready-notification.js",
    "client/src/ui/ui-quest-ready-notification.js",
    "client/src/audio/*.js",
    "client/src/ingame.js",
  ],
  fixture: tutorialDrops.fixture,
  run,
};
