import { LIFE_PLACEMENT_PATTERN } from "../../../shared/content-identity.js";

const MAX_PLACEMENTS = 4096;
const MAX_ACTIONS = 128;
const MAX_FRAMES = 1024;
const MAX_SPEECH = 4096;

/** Validate the independent metadata boundary before allocating preview graphics. */
export function validateLife(life) {
  if (
    !life ||
    life.schemaVersion !== 1 ||
    life.mode !== "metadata-preview" ||
    life.activationKnown !== false
  ) {
    throw new Error("Unsupported life metadata manifest");
  }
  if (
    !Array.isArray(life.placements) ||
    life.placements.length > MAX_PLACEMENTS
  ) {
    throw new Error("Life preview placement count exceeds policy");
  }
  validatePlacements(life.placements, life.templates);
}

function validatePlacements(placements, templates) {
  const ids = new Set();
  for (const record of placements) {
    if (!LIFE_PLACEMENT_PATTERN.test(record.id) || ids.has(record.id)) {
      throw new Error("Invalid life preview identity");
    }
    ids.add(record.id);
    const template = templates[record.template];
    if (!template || !["npc", "mob"].includes(template.kind)) {
      throw new Error("Missing life template");
    }
    validateTemplate(template);
    for (const key of ["x", "y", "fh", "cy", "rx0", "rx1"]) {
      if (key !== "x" && key !== "y" && record.authored[key] === undefined) {
        continue;
      }
      if (!Number.isSafeInteger(record.authored[key])) {
        throw new Error("Invalid authored life geometry");
      }
    }
  }
}

function validateTemplate(template) {
  const actions = Object.values(template.actions);
  if (actions.length > MAX_ACTIONS) {
    throw new Error("Invalid life actions");
  }
  for (const action of actions) validateAction(action);
  if (template.name !== null && typeof template.name !== "string") {
    throw new Error("Invalid life name");
  }
  if (template.function !== null && typeof template.function !== "string") {
    throw new Error("Invalid life function");
  }
  validateNpcSpeech(template.speech, template.actions);
}

function validateNpcSpeech(speech, actions) {
  if (speech === null || speech === undefined) return;
  validateSpeechLines(speech.lines);
  if (!Array.isArray(speech.actions) || speech.actions.length > MAX_ACTIONS) {
    throw new Error("Invalid NPC speech action inventory");
  }
  for (const action of speech.actions) {
    if (
      !Object.hasOwn(actions, action.action) ||
      !Number.isSafeInteger(action.durationMs) ||
      action.durationMs < 1
    ) {
      throw new Error("Invalid NPC speech action");
    }
    validateSpeechLines(action.lines);
  }
}

function validateSpeechLines(lines) {
  if (!Array.isArray(lines) || lines.length > MAX_SPEECH) {
    throw new Error("NPC speech inventory exceeds policy");
  }
  for (const line of lines) {
    if (
      !line ||
      (line.text !== null &&
        (typeof line.text !== "string" || line.text.length > MAX_SPEECH))
    ) {
      throw new Error("Invalid original NPC speech text");
    }
  }
}

function validateAction(action) {
  if (
    !Array.isArray(action.frames) ||
    !action.frames.length ||
    action.frames.length > MAX_FRAMES
  ) {
    throw new Error("Invalid life frame metadata");
  }
  for (const frame of action.frames) {
    if (
      frame.body &&
      ![
        frame.body.left,
        frame.body.top,
        frame.body.right,
        frame.body.bottom,
      ].every(Number.isFinite)
    ) {
      throw new Error("Invalid life body metadata");
    }
  }
}
