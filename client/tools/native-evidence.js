import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_EVENTS = 48;
const MAX_CHECKPOINTS = 96;
const MAX_FRAMES = 8;
const MAX_TEXT = 2000;

/** Retain elapsed milliseconds on both success and failure, without changing the outcome. */
export async function measureStage(timings, stage, operation) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    timings[stage] = (timings[stage] ?? 0) + performance.now() - started;
  }
}
export function assertion(condition, message, details = {}) {
  if (condition) return;
  const error = new Error(message);
  error.name = "ScenarioAssertionError";
  error.actual = details.actual;
  error.expected = details.expected;
  throw error;
}

export function failureDetails(error) {
  return {
    name: error.name,
    message: String(error.message),
    stack: String(error.stack ?? "").slice(0, 6000),
    actual: error.actual,
    expected: error.expected,
  };
}

/** Project in the browser, before large artwork and release inventories cross the protocol. */
export function compactState() {
  const state = window.maple?.snapshot();
  if (!state) return null;
  const result = {};
  for (const key of [
    "currentMap",
    "sourceBuildId",
    "buildId",
    "loading",
    "paused",
    "fieldTransition",
    "lastError",
    "simulation",
    "camera",
    "follow",
    "input",
    "inGame",
    "save",
    "agent",
  ]) {
    if (state[key] !== undefined) result[key] = state[key];
  }
  if (state.field) {
    const field = state.field;
    result.field = {
      gameplay: field.gameplay,
      portals: field.portals,
      reactors: field.reactors,
      skills: field.skills,
      drops: field.drops,
      combatPresentation: field.combatPresentation,
    };
  }
  if (state.offline) {
    result.offline = {
      launchReady: state.offline.launchReady,
      error: state.offline.error,
      startupStatus: state.offline.startupStatus,
      map: state.offline.map,
    };
  }
  return result;
}

export function stateDelta(before, after) {
  const result = {};
  for (const key of new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
      result[key] = {
        before: before?.[key] ?? null,
        after: after?.[key] ?? null,
      };
    }
  }
  return result;
}

export async function createEvidence(page, output) {
  const events = [];
  const frames = [];
  const checkpoints = [];
  const started = performance.now();
  const state = { page, output, frames, checkpoints, events, started };
  const record = (kind, text) => {
    if (events.length === MAX_EVENTS) events.shift();
    events.push({
      atMs: performance.now() - started,
      kind,
      text: String(text).slice(0, MAX_TEXT),
    });
  };
  const onConsole = (message) => {
    if (["error", "warn"].includes(message.type())) {
      record(message.type(), message.text());
    }
  };
  const onError = (error) => record("pageerror", error.message);
  const onRequest = (request) =>
    record("requestfailed", `${request.url()} ${request.failure()?.errorText}`);
  const onResponse = (response) => {
    if (response.status() >= 400) {
      record("http", `${response.status()} ${response.url()}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onError);
  page.on("requestfailed", onRequest);
  page.on("response", onResponse);
  const session = await page.createCDPSession();
  state.session = session;
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const onFrame = ({ data, metadata, sessionId }) => {
    if (frames.length === MAX_FRAMES) frames.shift();
    frames.push({
      data,
      timestamp: metadata.timestamp,
      atMs: performance.now() - started,
    });
    session
      .send("Page.screencastFrameAck", { sessionId })
      .catch((error) => record("capture", error.message));
  };
  session.on("Page.screencastFrame", onFrame);
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 45,
    maxWidth: 640,
    maxHeight: 450,
    everyNthFrame: 6,
  });
  state.record = record;
  state.listeners = { onConsole, onError, onRequest, onResponse, onFrame };
  return evidenceHandle(state);
}

function evidenceHandle(state) {
  return {
    events: state.events,
    checkpoints: state.checkpoints,
    async checkpoint(label) {
      if (state.checkpoints.length === MAX_CHECKPOINTS) {
        throw new Error("Scenario checkpoint budget exhausted");
      }
      const current = await state.page.evaluate(compactState);
      const previous = state.checkpoints.at(-1)?.state ?? null;
      state.checkpoints.push({
        label: String(label).slice(0, 200),
        atMs: performance.now() - state.started,
        state: current,
        delta: stateDelta(previous, current),
      });
      return current;
    },
    async failure() {
      const files = [];
      try {
        await state.page.screenshot({
          path: join(state.output, "failure.png"),
        });
        files.push("failure.png");
      } catch (error) {
        state.record("screenshot", error.message);
      }
      for (let index = 0; index < state.frames.length; index++) {
        const frame = state.frames[index];
        const file = `frame-${String(index).padStart(2, "0")}.jpg`;
        await writeFile(
          join(state.output, file),
          Buffer.from(frame.data, "base64"),
        );
        files.push({ file, atMs: frame.atMs, timestamp: frame.timestamp });
      }
      return files;
    },
    async close() {
      await state.session
        .send("Page.stopScreencast")
        .catch((error) => state.record("capture", error.message));
      state.session.off("Page.screencastFrame", state.listeners.onFrame);
      await state.session.detach();
      state.page.off("console", state.listeners.onConsole);
      state.page.off("pageerror", state.listeners.onError);
      state.page.off("requestfailed", state.listeners.onRequest);
      state.page.off("response", state.listeners.onResponse);
    },
  };
}
