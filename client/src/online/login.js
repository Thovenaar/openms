import { Container } from "pixi.js";
import {
  powMessage,
  satisfiesProofOfWork,
} from "../../../shared/proof-of-work.js";
import { JOB_LABELS } from "../ui/ui-job-labels.js";
import { AvatarVisuals } from "../character/avatar-visuals.js";
import { UIRasterPlane } from "../ui/ui-raster-plane.js";
import { createProfile } from "../profile/profile-validation.js";
import { LoginBackdrop } from "./login-backdrop.js";

const MAX_CHARACTERS = 64;
const MAX_NONCE = 64 * 1024 * 1024;
const POW_YIELD_HASHES = 512;
const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;
const CHARACTER_NAME_PATTERN = /^[A-Za-z0-9]{4,13}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 256;
// Dice policy: four stats, each 4..13, totalling the packaged baseline 25 points.
const STAT_KEYS = ["str", "dex", "int", "luk"];
const STAT_MINIMUM = 4;
const STAT_MAXIMUM = 13;
const STAT_TOTAL = 25;
const DICE_TICKS = 10;
const DICE_TICK_MS = 60;
/** Original create-screen rows in MakeCharInfo.img category order. Gender is its own
 * original surface and the four apparel rows are the packet's always-present gear. */
const CREATE_ROWS = [
  ["gender", "Gender"],
  ["face", "Face"],
  ["hairBase", "Hair"],
  ["hairColor", "Hair colour"],
  ["skin", "Skin"],
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["shoes", "Shoes"],
  ["weapon", "Weapon"],
];
/** Apparel the original create packet always carried, in its transmitted order. */
const CREATE_GEAR = ["top", "bottom", "shoes", "weapon"];
const CREATE_TABLE_VERSION = 1;

/** Local validation text is ours and shown verbatim; server codes map to explicit wording. */
function localError(message) {
  const error = new Error(message);
  error.local = true;
  return error;
}

const FAILURE_TEXT = new Map([
  [
    "CHARACTER_BUSY",
    "That character is still connected elsewhere. Wait a moment and enter again.",
  ],
  ["NAME_TAKEN", "That name is already used. Choose another one."],
  [
    "CHARACTER_LIMIT",
    "This account already has the maximum number of characters.",
  ],
  ["POW_INVALID", "The proof-of-work challenge was rejected. Try again."],
  [
    "RATE_LIMITED",
    "Too many attempts just now. Wait a few seconds and try again.",
  ],
  ["INVALID_CREDENTIALS", "The account name or password was rejected."],
  ["UNAUTHENTICATED", "The account name or password was rejected."],
  [
    "CONTENT_MISMATCH",
    "This client build does not match the server content. Reload the page to update it.",
  ],
  ["TRANSPORT_CLOSED", "The connection to the server was lost. Try again."],
  ["NETWORK_ERROR", "The connection to the server was lost. Try again."],
  ["SOCKET_ERROR", "The connection to the server was lost. Try again."],
  [
    "NOT_ALLOWED",
    "The server refused that request for this session. Sign in again.",
  ],
  [
    "INVALID_MESSAGE",
    "The server rejected those values. Check the name, stats and look.",
  ],
  ["SERVER_BUSY", "The server is busy right now. Try again in a moment."],
  [
    "REQUEST_FAILED",
    "The server request failed. Check the account or connection and retry.",
  ],
]);

function failureText(error, code) {
  if (
    error?.local === true &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return FAILURE_TEXT.get(code) ?? `The server request failed (${code}).`;
}

/** Create rows use the original category name for their fallback label. */
function optionTitle(field) {
  return CREATE_ROWS.find(([name]) => name === field)?.[1] ?? field;
}

function rollStats(random = Math.random) {
  const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, STAT_MINIMUM]));
  for (
    let points = STAT_TOTAL - STAT_MINIMUM * STAT_KEYS.length;
    points > 0;
    points--
  ) {
    const open = STAT_KEYS.filter((key) => stats[key] < STAT_MAXIMUM);
    stats[open[Math.floor(random() * open.length)]]++;
  }
  return stats;
}

function element(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function field(label, input) {
  const row = element("label", "online-login-row");
  row.append(element("span", "online-login-label", label), input);
  return row;
}

function textInput(name, label, maxLength) {
  const input = element("input", `online-login-${name}`);
  input.name = name;
  input.type = "text";
  input.autocomplete = "username";
  input.maxLength = maxLength;
  input.spellcheck = false;
  input.setAttribute("aria-label", label);
  return input;
}

function passwordInput(name, label, autocomplete) {
  const input = element("input", `online-login-${name}`);
  input.name = name;
  input.type = "password";
  input.autocomplete = autocomplete;
  input.maxLength = MAX_PASSWORD;
  input.spellcheck = false;
  input.setAttribute("aria-label", label);
  return input;
}

/** Hashcash over the server challenge; the browser may spend a few hundred milliseconds here. */
async function solveProofOfWork(challenge, { signal, onProgress }) {
  const encoder = new TextEncoder();
  const started = performance.now();
  for (let nonce = 0; nonce <= MAX_NONCE; nonce++) {
    const message = powMessage(challenge.challengeId, String(nonce));
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(message)),
    );
    if (satisfiesProofOfWork(digest, challenge.bits)) {
      return { challengeId: challenge.challengeId, nonce: String(nonce) };
    }
    if (nonce % POW_YIELD_HASHES !== 0) continue;
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    onProgress?.(nonce, performance.now() - started);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error("The proof-of-work challenge was not solved in time");
}

/** Custom Win95 account and character selection surface; the server stays authoritative. */
export class OnlineLogin {
  constructor({ app, services, transport, hooks, audio = null }) {
    this.app = app;
    this.services = services;
    this.transport = transport;
    this.hooks = hooks;
    this.audio = audio;
    this.destroyed = false;
    this.pending = false;
    this.prepared = false;
    this.visible = true;
    this.entered = false;
    this.generation = 0;
    this.mode = "signin";
    this.characters = [];
    this.selected = 0;
    this.stage = "account";
    this.draft = {
      name: "",
      stats: rollStats(),
      gender: 0,
      skin: 0,
      face: 0,
      hairBase: 0,
      hairColor: 0,
      top: 0,
      bottom: 0,
      shoes: 0,
      weapon: 0,
    };
    this.diceTimer = null;
    this.listeners = [];
    this.controller = new AbortController();
    this.previewLayer = new Container({ label: "online-login-preview" });
    this.host = element("section", "online-login");
    this.host.setAttribute("aria-label", "Online MapleStory sign in");
    this.window = element("div", "maple95-window online-login-window");
    const titlebar = element("header", "maple95-titlebar");
    titlebar.append(element("span", "maple95-title", "MapleStory"));
    this.window.append(titlebar);
    const body = element("div", "maple95-body");
    this.buildAccountStage(body);
    this.buildCharacterStage(body);
    this.buildCreateStage(body);
    this.message = element(
      "p",
      "online-login-message",
      "Preparing the sign in window…",
    );
    this.message.setAttribute("role", "status");
    this.message.setAttribute("aria-live", "polite");
    body.append(this.message);
    this.window.append(body);
    this.host.append(this.window);
    app.canvas.parentElement.append(this.host);
    this.resize(app.screen.width, app.screen.height);
    this.installCues();
    this.renderStage();
  }

  /** Original UI cues: every button answers hover and activation through the one audio
   * owner. Nothing is queued before a trusted gesture, and a locked graph stays silent. */
  installCues() {
    const cue = (event, name) => {
      const button = event.target?.closest?.("button");
      if (!button || button.disabled) return;
      this.playCue(name);
    };
    this.listen(this.host, "click", (event) => cue(event, "BtMouseClick"));
    this.listen(
      this.host,
      "pointerenter",
      (event) => cue(event, "BtMouseOver"),
      true,
    );
  }

  /** A missing or still-locked login cue never blocks sign in. */
  playCue(name) {
    this.audio
      ?.playSound("UI", name)
      .catch((error) => this.hooks.report(error));
  }

  /** Title music is remembered while audio is locked; a committed field replaces it. */
  playTitleBgm() {
    const descriptor = this.catalog?.audiovisual?.login?.bgm;
    if (!descriptor) return;
    this.audio
      ?.setTitleBgm(descriptor)
      .catch((error) => this.hooks.report(error));
  }

  buildAccountStage(body) {
    const stage = element("div", "online-login-account");
    const tabs = element("nav", "maple95-tabs");
    tabs.setAttribute("role", "tablist");
    this.signInTab = element("button", "maple95-tab", "Sign in");
    this.signUpTab = element("button", "maple95-tab", "Create account");
    for (const [tab, mode] of [
      [this.signInTab, "signin"],
      [this.signUpTab, "signup"],
    ]) {
      tab.type = "button";
      tab.setAttribute("role", "tab");
      this.listen(tab, "click", () => this.selectMode(mode));
      tabs.append(tab);
    }
    stage.append(tabs);
    const form = element("form", "online-login-form");
    form.autocomplete = "on";
    this.name = textInput("name", "Account name", 16);
    this.password = passwordInput("password", "Password", "current-password");
    this.confirm = passwordInput("confirm", "Confirm password", "new-password");
    this.confirmRow = field("Confirm password", this.confirm);
    form.append(
      field("Account name", this.name),
      field("Password", this.password),
      this.confirmRow,
    );
    this.hint = element(
      "p",
      "online-login-hint",
      "Accounts use a proof-of-work challenge instead of a captcha; clients may compute it in parallel.",
    );
    form.append(this.hint);
    this.submitButton = element(
      "button",
      "maple95-button primary online-login-submit",
      "Sign in",
    );
    this.submitButton.type = "submit";
    form.append(this.submitButton);
    this.listen(form, "submit", (event) => {
      event.preventDefault();
      this.submit().catch((error) => this.report(error));
    });
    this.listen(form, "keydown", (event) => event.stopPropagation());
    this.accountStage = stage;
    stage.append(form);
    body.append(stage);
  }

  buildCharacterStage(body) {
    const stage = element("div", "online-login-characters");
    stage.hidden = true;
    stage.append(element("h2", "online-login-heading", "Select a character"));
    stage.append(this.buildSpotlight());
    this.dots = element("div", "online-login-dots");
    this.dots.setAttribute("role", "tablist");
    this.dots.setAttribute("aria-label", "Characters");
    stage.append(this.dots, this.buildCharacterActions());
    this.characterStage = stage;
    body.append(stage);
    this.listen(this.host, "keydown", (event) => this.onKey(event));
  }

  buildSpotlight() {
    const spotlight = element("div", "online-login-spotlight");
    this.previous = element(
      "button",
      "maple95-button online-login-previous",
      "◀",
    );
    this.next = element("button", "maple95-button online-login-next", "▶");
    for (const [button, delta, label] of [
      [this.previous, -1, "Previous character"],
      [this.next, 1, "Next character"],
    ]) {
      button.type = "button";
      button.setAttribute("aria-label", label);
      this.listen(button, "click", () => this.step(delta));
    }
    this.card = element("div", "online-login-card");
    this.card.setAttribute("role", "group");
    this.card.setAttribute("aria-label", "Selected character");
    this.portrait = element("div", "online-login-portrait");
    this.portrait.setAttribute("aria-hidden", "true");
    this.portraitMark = element("span", "online-login-mark", "★");
    this.portrait.append(this.portraitMark);
    this.characterName = element("p", "online-login-character-name", "—");
    this.characterDetail = element("p", "online-login-character-detail");
    this.characterSlot = element("p", "online-login-character-slot");
    this.card.append(
      this.portrait,
      this.characterName,
      this.characterDetail,
      this.characterSlot,
    );
    spotlight.append(this.previous, this.card, this.next);
    return spotlight;
  }

  buildCharacterActions() {
    const actions = element("div", "online-login-actions");
    this.enterButton = element(
      "button",
      "maple95-button primary online-login-enter",
      "Enter the world",
    );
    this.createButton = element(
      "button",
      "maple95-button online-login-new",
      "Create character",
    );
    this.refreshButton = element(
      "button",
      "maple95-button online-login-refresh",
      "Refresh",
    );
    this.signOutButton = element(
      "button",
      "maple95-button online-login-signout",
      "Sign out",
    );
    for (const button of [
      this.enterButton,
      this.createButton,
      this.refreshButton,
      this.signOutButton,
    ]) {
      button.type = "button";
      actions.append(button);
    }
    this.listen(this.enterButton, "click", () =>
      this.enter().catch((error) => this.report(error)),
    );
    this.listen(this.createButton, "click", () => this.showCreate());
    this.listen(this.refreshButton, "click", () =>
      this.refreshCharacters().catch((error) => this.report(error)),
    );
    this.listen(this.signOutButton, "click", () =>
      this.signOut().catch((error) => this.report(error)),
    );
    return actions;
  }

  /** One screen: roll the dice, choose gender, basic gear and a name, then create. */
  buildCreateStage(body) {
    const stage = element("div", "online-login-create");
    stage.hidden = true;
    stage.append(element("h2", "online-login-heading", "Create a character"));
    stage.append(this.buildRollStep());
    const layout = element("div", "online-login-create-layout");
    const look = element("div", "online-login-look");
    this.createPreviewElement = element("div", "online-login-preview");
    this.createPreviewElement.setAttribute("role", "img");
    this.createPreviewElement.setAttribute("aria-label", "Character preview");
    this.previewNote = element("p", "online-login-note", "");
    look.append(this.createPreviewElement, this.previewNote);
    layout.append(look, this.buildCreateOptions());
    stage.append(layout, this.buildNameStep());
    const actions = element("div", "online-login-actions");
    this.backButton = element(
      "button",
      "maple95-button online-login-back",
      "Back",
    );
    this.submitCreate = element(
      "button",
      "maple95-button primary online-login-create-submit",
      "Create",
    );
    for (const button of [this.backButton, this.submitCreate]) {
      button.type = "button";
      actions.append(button);
    }
    this.listen(this.backButton, "click", () => this.stepBack());
    this.listen(this.submitCreate, "click", () =>
      this.createCharacter().catch((error) => this.report(error)),
    );
    stage.append(actions);
    this.createStage = stage;
    body.append(stage);
  }

  buildRollStep() {
    const step = element("div", "online-login-roll");
    const stats = element("div", "online-login-stats");
    this.statOutputs = {};
    for (const key of STAT_KEYS) {
      const box = element("div", "online-login-stat");
      const output = element(
        "output",
        "online-login-stat-value",
        String(STAT_MINIMUM),
      );
      this.statOutputs[key] = output;
      box.append(
        element("span", "online-login-stat-label", key.toUpperCase()),
        output,
      );
      stats.append(box);
    }
    this.statTotal = element("output", "online-login-stat-total", "");
    this.rollButton = element(
      "button",
      "maple95-button online-login-roll-button",
      "Roll",
    );
    this.rollButton.type = "button";
    this.listen(this.rollButton, "click", () => this.rollDice());
    step.append(stats, this.statTotal, this.rollButton);
    this.rollStep = step;
    return step;
  }

  buildCreateOptions() {
    const options = element("div", "online-login-options");
    this.optionRows = {};
    for (const [field, label] of CREATE_ROWS) {
      const row = element("div", "online-login-option");
      const previous = element(
        "button",
        "maple95-button online-login-option-previous",
        "◀",
      );
      const value = element("output", "online-login-option-value", "—");
      const next = element(
        "button",
        "maple95-button online-login-option-next",
        "▶",
      );
      for (const button of [previous, next]) {
        button.type = "button";
        button.setAttribute("aria-label", `${label} choice`);
      }
      this.listen(previous, "click", () => this.cycleOption(field, -1));
      this.listen(next, "click", () => this.cycleOption(field, 1));
      row.append(
        element("span", "online-login-label", label),
        previous,
        value,
        next,
      );
      this.optionRows[field] = { label, previous, next, value };
      options.append(row);
    }
    return options;
  }

  buildNameStep() {
    const step = element("div", "online-login-name-step");
    this.characterNameInput = textInput("character", "Character name", 13);
    this.characterNameInput.autocomplete = "off";
    this.nameNote = element(
      "p",
      "online-login-note",
      "Names use 4 to 13 letters or digits and must be free on this account.",
    );
    step.append(
      field("Character name", this.characterNameInput),
      this.nameNote,
    );
    this.nameStep = step;
    return step;
  }

  showCreate() {
    if (this.pending || this.destroyed) return;
    if (!this.prepared) {
      this.message.textContent =
        "Still preparing the character choices from the server content.";
      return;
    }
    this.stage = "create";
    this.draft.name = "";
    this.draft.stats = rollStats();
    this.draft.gender = 0;
    this.adoptCreateDefaults();
    this.renderStage();
    this.renderCreate();
    this.rollDice();
    this.refreshCreatePreview();
    this.characterNameInput.focus();
  }

  stepBack() {
    if (this.pending || this.destroyed) return;
    if (this.characters.length) {
      this.draft.name = this.characterNameInput.value;
      this.showCharacters(this.characters);
      return;
    }
    this.message.textContent =
      "Roll the dice, choose a look and name your first character.";
  }

  rollDice() {
    if (this.pending || this.destroyed || this.rollTimer) return;
    this.draft.stats = rollStats();
    let ticks = DICE_TICKS;
    this.rollButton.disabled = true;
    this.rollStep.classList.add("rolling");
    this.rollTimer = setInterval(() => {
      ticks--;
      if (ticks > 0) {
        this.renderStats(rollStats());
        return;
      }
      clearInterval(this.rollTimer);
      this.rollTimer = null;
      this.rollStep.classList.remove("rolling");
      this.rollButton.disabled = this.pending;
      this.renderStats(this.draft.stats);
    }, DICE_TICK_MS);
  }

  renderStats(stats) {
    let total = 0;
    for (const key of STAT_KEYS) {
      this.statOutputs[key].textContent = String(stats[key]);
      total += stats[key];
    }
    this.statTotal.textContent = `Total ${total} of ${STAT_TOTAL}`;
  }

  /** Recovered original new-character choices; there is no catalog-wide fallback,
   * because the original screen only ever offered these values. */
  createTable() {
    const table = this.catalog?.ui?.characterCreate;
    if (table?.schemaVersion !== CREATE_TABLE_VERSION) {
      throw new Error("Packaged original character-create choices are missing");
    }
    return table;
  }

  /** One gender's authored option sets; every appearance row belongs to exactly one. */
  createSet(gender = this.draft.gender) {
    const set = this.createTable().genders?.[String(gender)];
    if (!set) {
      throw new Error(`No original create choices for gender ${gender}`);
    }
    return set;
  }

  /** Legal values of one row in original file order. */
  createValues(field) {
    if (field === "gender") return [0, 1];
    const values = this.createSet()[field];
    if (!Array.isArray(values) || !values.length) {
      throw new Error(`Packaged create choices lack ${field}`);
    }
    return values;
  }

  /** Authored label when the original names the value, otherwise its position. */
  createLabel(field, value) {
    if (field === "gender") return value === 0 ? "Male" : "Female";
    if (CREATE_GEAR.includes(field)) return this.itemLabel(value);
    const set = this.createSet();
    const authored = set.names?.[field]?.[String(value)];
    if (typeof authored === "string" && authored) return authored;
    const values = set[field];
    const index = values.indexOf(value);
    return `${optionTitle(field)} ${index + 1} of ${values.length}`;
  }

  /** An item row shows the catalog's own name; the profile is never invented. */
  itemLabel(id) {
    const item = this.catalog?.ui?.items?.[String(id)];
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!name) throw new Error(`Packaged starter item ${id} has no name`);
    return name;
  }

  /** First authored equip slot of a packaged starter item. Presentation only:
   * the server derives the committed slot from the same catalog entry. */
  equipSlot(id) {
    const entry = this.catalog?.ui?.avatar?.entries?.[String(id)];
    const slots = entry?.equippedSlots;
    if (!Array.isArray(slots) || !slots.length || !Number.isInteger(slots[0])) {
      throw new Error(`Packaged starter item ${id} has no authored equip slot`);
    }
    return slots[0];
  }

  /** Every row keeps a value the selected gender's original set allows. */
  adoptCreateDefaults() {
    const set = this.createSet();
    for (const [field] of CREATE_ROWS) {
      if (field === "gender") continue;
      if (!set[field].includes(this.draft[field])) {
        this.draft[field] = set[field][0];
      }
    }
  }

  /** The original packet submitted base hair plus its colour suffix. */
  draftHair() {
    const hair = this.draft.hairBase + this.draft.hairColor;
    if (!Number.isSafeInteger(hair)) {
      throw new Error("Character hair choice is not an original id");
    }
    return hair;
  }

  cycleOption(field, delta) {
    if (this.pending || this.destroyed) return;
    const values = this.createValues(field);
    const index = values.indexOf(this.draft[field]);
    this.draft[field] = values[(index + delta + values.length) % values.length];
    // Male and female sets differ, so a gender change re-selects the other rows.
    if (field === "gender") this.adoptCreateDefaults();
    this.renderCreate();
    this.refreshCreatePreview();
  }

  /** Create-screen choices and their packaged artwork, for verification surfaces only. */
  publishOptions() {
    const set = this.createSet();
    const counts = {};
    for (const field of [
      "face",
      "hairBase",
      "hairColor",
      "skin",
      ...CREATE_GEAR,
    ]) {
      counts[field] = set[field].length;
    }
    this.host.dataset.options = JSON.stringify({
      gender: this.draft.gender,
      counts,
      source: this.createTable().source,
    });
  }

  renderCreate() {
    // The catalog streams after the account form is usable, so the create screen
    // renders a preparing state instead of failing the sign-in path.
    if (!this.prepared) {
      for (const row of Object.values(this.optionRows)) {
        row.value.textContent = "Preparing…";
        row.previous.disabled = true;
        row.next.disabled = true;
      }
      this.previewNote.textContent =
        "Reading the original starting choices from the server content…";
      this.backButton.hidden = !this.characters.length;
      this.submitCreate.disabled = true;
      return;
    }
    for (const [field, row] of Object.entries(this.optionRows)) {
      row.value.textContent = this.createLabel(field, this.draft[field]);
      const single = field !== "gender" && this.createValues(field).length < 2;
      row.previous.disabled = single || this.pending;
      row.next.disabled = single || this.pending;
    }
    this.publishOptions();
    const set = this.createSet();
    this.previewNote.textContent = `${set.face.length} faces, ${set.hairBase.length} hairs with ${set.hairColor.length} colours and ${set.skin.length} skin tones are the original starting choices.`;
    this.backButton.hidden = !this.characters.length;
    this.submitCreate.disabled = this.pending;
  }

  draftProfile() {
    const profile = createProfile({
      mapId: this.catalog?.defaultMap ?? "100000000",
      x: 0,
      y: 0,
      facing: 1,
    });
    profile.name = this.draft.name || "Maple";
    profile.gender = this.draft.gender;
    profile.appearance = {
      skin: this.draft.skin,
      face: this.draft.face,
      hair: this.draftHair(),
    };
    profile.equipment = CREATE_GEAR.map((field) => this.draft[field]).map(
      (id) => ({ id, slot: this.equipSlot(id) }),
    );
    Object.assign(profile, this.draft.stats);
    return profile;
  }

  /** The carousel portrait composes the character's own appearance and equipped items.
   * A summary without them is a server contract violation: showing a default look instead
   * would present a character the player cannot play. */
  characterProfile(character) {
    const appearance = character.appearance;
    if (
      ![0, 1].includes(character.gender) ||
      !Number.isInteger(appearance?.skin) ||
      !Number.isInteger(appearance?.face) ||
      !Number.isInteger(appearance?.hair) ||
      !Array.isArray(character.equipment)
    ) {
      throw new Error(
        `Character ${character.id} is missing its authoritative look`,
      );
    }
    const profile = createProfile({
      mapId: this.catalog?.defaultMap ?? "100000000",
      x: 0,
      y: 0,
      facing: 1,
    });
    profile.name = character.name;
    profile.gender = character.gender;
    profile.appearance = {
      skin: appearance.skin,
      face: appearance.face,
      hair: appearance.hair,
    };
    profile.equipment = character.equipment.map((item) => ({
      id: item.id,
      slot: item.slot,
    }));
    return profile;
  }

  /** One composed-avatar plane per surface; each owns one prepared animation at a time.
   * The plane scans its root's children at the host origin, so the root itself is never
   * transformed: a nested view carries the preview scale and placement. */
  previewSlot(name, element, maxScale) {
    const root = new Container({ label: `online-login-preview-${name}` });
    const view = new Container({ label: `online-login-preview-view-${name}` });
    root.addChild(view);
    return {
      name,
      element,
      root,
      view,
      maxScale,
      plane: new UIRasterPlane(root, element),
      prepared: null,
      controller: null,
      generation: 0,
    };
  }

  previewSlots() {
    return [this.createSlot, this.cardSlot].filter(Boolean);
  }

  /** Centre the composed avatar above the surface floor, bounded by the element box. */
  placePreview(slot, prepared) {
    const bounds = prepared.bounds;
    const height = Math.max(1, bounds.bottom - bounds.top);
    const width = Math.max(1, bounds.right - bounds.left);
    const scale = Math.max(
      0.6,
      Math.min(
        slot.maxScale,
        slot.element.clientWidth / (width + 16),
        (slot.element.clientHeight - 10) / height,
      ),
    );
    slot.view.scale.set(scale);
    slot.view.position.set(
      (slot.element.clientWidth - (bounds.left + bounds.right) * scale) / 2,
      slot.element.clientHeight - bounds.bottom * scale - 5,
    );
    if (slot === this.cardSlot) this.portraitMark.hidden = true;
  }

  async showPreview(slot, profile, clear = false) {
    if (!this.visuals || this.destroyed || !slot) return;
    const generation = ++slot.generation;
    slot.controller?.abort();
    const controller = new AbortController();
    slot.controller = controller;
    // A selection change empties the portrait first, so the previous character's
    // pixels never sit under the newly selected name.
    if (clear) this.clearPreview(slot);
    let prepared;
    try {
      prepared = await this.visuals.preparePreview({
        profile,
        signal: controller.signal,
      });
    } catch (error) {
      this.previewFailure(slot, error);
      return;
    }
    if (this.destroyed || generation !== slot.generation) {
      prepared.destroy();
      return;
    }
    slot.prepared?.destroy();
    slot.prepared = prepared;
    slot.view.removeChildren();
    slot.view.addChild(prepared.root);
    this.placePreview(slot, prepared);
  }

  /** Empty one portrait and restore its placeholder mark. */
  clearPreview(slot) {
    slot.prepared?.destroy();
    slot.prepared = null;
    slot.view.removeChildren();
    if (slot === this.cardSlot) this.portraitMark.hidden = false;
  }

  /** A cancelled compose is silent; a real failure is stated where the player can see it. */
  previewFailure(slot, error) {
    if (error?.name === "AbortError" || this.destroyed) return;
    this.clearPreview(slot);
    if (slot === this.createSlot) {
      this.previewNote.textContent =
        "The packaged avatar artwork could not be prepared.";
    }
  }

  refreshCreatePreview() {
    this.showPreview(this.createSlot, this.draftProfile()).catch((error) =>
      this.report(error),
    );
  }

  async createCharacter() {
    const name = this.characterNameInput.value.trim();
    if (!CHARACTER_NAME_PATTERN.test(name)) {
      this.message.textContent =
        "Character names use 4 to 13 letters or digits.";
      return;
    }
    const generation = ++this.generation;
    this.setPending(true, `Creating ${name}…`);
    try {
      const created = await this.transport.createCharacter({
        name,
        gender: this.draft.gender,
        skin: this.draft.skin,
        face: this.draft.face,
        hair: this.draftHair(),
        ...this.draft.stats,
        ...this.gearPayload(),
      });
      if (this.destroyed || generation !== this.generation) return;
      this.acceptCreated(created);
    } catch (error) {
      if (!this.destroyed && generation === this.generation) {
        this.reportCreationFailure(error);
      }
    } finally {
      if (!this.destroyed && generation === this.generation) {
        this.setPending(false);
      }
    }
  }

  /** The original create packet always carried top, bottom, shoes and weapon. */
  gearPayload() {
    const payload = {};
    for (const field of CREATE_GEAR) payload[field] = this.draft[field];
    return payload;
  }

  acceptCreated(created) {
    this.stage = "characters";
    this.characters = this.transport.characters?.slice(0, MAX_CHARACTERS) ?? [];
    this.selected = Math.max(
      0,
      this.characters.findIndex((character) => character.id === created.id),
    );
    this.selecting = this.characters.length > 0;
    this.renderStage();
    this.message.textContent = `${created.name} is ready. Enter the world when you are.`;
    this.enterButton.focus();
  }

  reportCreationFailure(error) {
    this.message.textContent = failureText(error, safeCode(error));
    this.hooks.report(
      new Error(`Character creation failed (${safeCode(error)})`, {
        cause: error,
      }),
    );
  }

  async prepare(catalog, signal) {
    if (signal?.aborted) return;
    this.catalog = catalog;
    this.visuals = new AvatarVisuals(this.services, catalog);
    this.createSlot = this.previewSlot(
      "create",
      this.createPreviewElement,
      2.4,
    );
    this.cardSlot = this.previewSlot("card", this.portrait, 1.9);
    this.prepared = true;
    this.adoptCreateDefaults();
    this.renderStats(this.draft.stats);
    this.renderCreate();
    this.playTitleBgm();
    this.startBackdrop(signal);
    this.message.textContent =
      this.mode === "signup"
        ? "Choose an account name and password."
        : "Sign in with your server account.";
    this.renderStage();
    this.name?.focus();
  }

  /** The account window never waits for scenery; an unavailable map is skipped and reported. */
  startBackdrop(signal) {
    if (this.destroyed || this.backdrop) return;
    const backdrop = new LoginBackdrop({
      app: this.app,
      services: this.services,
      catalog: this.catalog,
      network: this.services.network,
      onError: (error) => this.hooks.report(error),
    });
    this.backdrop = backdrop;
    backdrop.prepare(signal).catch((error) => {
      if (error?.name === "AbortError" || this.destroyed) return;
      this.hooks.report(error);
      if (this.backdrop === backdrop) this.backdrop = null;
    });
  }

  /** The field owns the canvas once the character is in; falling back re-creates the scenery. */
  stopBackdrop() {
    this.backdrop?.destroy();
    this.backdrop = null;
  }

  selectMode(mode) {
    if (this.pending || this.mode === mode || this.accountStage.hidden) return;
    this.mode = mode;
    this.message.textContent =
      mode === "signup"
        ? "Choose an account name and password."
        : "Sign in with your server account.";
    this.renderStage();
  }

  /** Stage visibility and tab state derive from the active stage plus the character list. */
  renderStage() {
    const creating = this.stage === "create";
    const selecting =
      !creating && (this.characters.length > 0 || this.selecting === true);
    this.accountStage.hidden = creating || selecting;
    this.characterStage.hidden = creating || !selecting;
    this.createStage.hidden = !creating;
    this.host.dataset.stage = creating
      ? "create"
      : selecting
        ? "characters"
        : "account";
    this.signInTab.setAttribute(
      "aria-selected",
      String(this.mode === "signin"),
    );
    this.signUpTab.setAttribute(
      "aria-selected",
      String(this.mode === "signup"),
    );
    const signup = this.mode === "signup";
    this.confirmRow.hidden = !signup;
    this.submitButton.textContent = signup ? "Create account" : "Sign in";
    if (creating) {
      this.host.setAttribute(
        "aria-label",
        "Online MapleStory character creation",
      );
      this.renderCreate();
    } else if (selecting) {
      this.host.setAttribute(
        "aria-label",
        "Online MapleStory character selection",
      );
      this.renderCarousel();
    } else {
      this.host.setAttribute("aria-label", "Online MapleStory sign in");
    }
  }

  validate() {
    const name = this.name.value.trim();
    const password = this.password.value;
    if (!ACCOUNT_NAME_PATTERN.test(name)) {
      throw localError(
        "Account names use 3 to 16 letters, digits, underscore or hyphen.",
      );
    }
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      throw localError(
        `Passwords use ${MIN_PASSWORD} to ${MAX_PASSWORD} characters; this one has ${password.length}.`,
      );
    }
    if (this.mode === "signup" && password !== this.confirm.value) {
      throw new Error("The confirmation password does not match.");
    }
    return { name, password };
  }

  async submit() {
    if (this.pending || this.destroyed) return;
    const credentials = this.validate();
    const generation = ++this.generation;
    this.setPending(true, "Requesting a proof-of-work challenge…");
    try {
      const proof = await this.mineProof();
      if (this.cancelled(generation)) return;
      const characters = await this.authorize(credentials, proof);
      if (this.cancelled(generation)) return;
      this.acceptCharacters(characters);
    } catch (error) {
      if (!this.cancelled(generation)) this.report(error);
    } finally {
      if (!this.cancelled(generation)) this.setPending(false);
    }
  }

  /** Every awaited step checks this so a stale attempt never publishes over a newer one. */
  cancelled(generation) {
    return this.destroyed || generation !== this.generation;
  }

  async mineProof() {
    // Verify the compiled identity before spending the client's proof-of-work budget.
    await this.transport.initialize();
    const challenge = await this.transport.challenge();
    return solveProofOfWork(challenge, {
      signal: this.controller.signal,
      onProgress: (nonce, elapsed) => {
        const rate = Math.round((nonce / Math.max(1, elapsed)) * 1000);
        this.message.textContent = `Solving the proof-of-work challenge… ${nonce} hashes (${rate}/s)`;
      },
    });
  }

  async authorize(credentials, proof) {
    this.message.textContent =
      this.mode === "signup" ? "Creating the account…" : "Signing in…";
    return this.mode === "signup"
      ? this.transport.register({ ...credentials, proof })
      : this.transport.login({ ...credentials, proof });
  }

  acceptCharacters(characters) {
    this.password.value = "";
    this.confirm.value = "";
    if (!characters.length) {
      // A fresh account creates its first character instead of dead-ending.
      this.characters = [];
      this.selecting = false;
      this.showCreate();
      this.message.textContent =
        "No characters yet. Roll the dice, choose a look and name your first character.";
      return;
    }
    this.showCharacters(characters);
  }

  showCharacters(characters) {
    this.characters = characters.slice(0, MAX_CHARACTERS);
    this.selected = Math.min(this.selected, this.characters.length - 1);
    this.selecting = true;
    this.stage = "characters";
    this.renderStage();
    this.enterButton.focus();
  }

  step(delta) {
    if (this.pending || this.characters.length === 0) return;
    const count = this.characters.length;
    this.selected = (this.selected + delta + count) % count;
    this.renderCarousel();
  }

  selectCharacter(index) {
    if (this.pending || index === this.selected) return;
    this.selected = index;
    this.renderCarousel();
  }

  renderCarousel() {
    const character = this.characters[this.selected];
    if (!character) return;
    const job = JOB_LABELS[character.job] ?? `Job ${character.job}`;
    this.characterName.textContent = character.name;
    this.characterDetail.textContent = `Level ${character.level} · ${job}`;
    this.characterSlot.textContent = `Character ${this.selected + 1} of ${this.characters.length}`;
    this.renderPortrait(character);
    const single = this.characters.length < 2;
    this.previous.disabled = single || this.pending;
    this.next.disabled = single || this.pending;
    this.dots.replaceChildren();
    for (let index = 0; index < this.characters.length; index++) {
      const dot = element(
        "button",
        "online-login-dot",
        index === this.selected ? "●" : "○",
      );
      dot.type = "button";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-selected", String(index === this.selected));
      dot.setAttribute(
        "aria-label",
        `Character ${index + 1}: ${this.characters[index].name}`,
      );
      this.listen(dot, "click", () => this.selectCharacter(index));
      this.dots.append(dot);
    }
  }

  /** A summary that cannot compose is reported and left empty, never defaulted. */
  renderPortrait(character) {
    let profile;
    try {
      profile = this.characterProfile(character);
    } catch (error) {
      this.clearPreview(this.cardSlot);
      this.message.textContent =
        "This character's look could not be read from the server. Sign in again.";
      this.hooks.report(error);
      return;
    }
    this.showPreview(this.cardSlot, profile, true).catch((error) =>
      this.report(error),
    );
  }

  /** Carousel keys enter the world; the creation screen keys create or step back. */
  onKey(event) {
    if (this.pending) return;
    if (this.stage === "create" && !this.createStage.hidden) {
      if (event.key === "Enter") {
        this.createCharacter().catch((error) => this.report(error));
      } else if (event.key === "Escape") {
        this.stepBack();
      } else {
        return;
      }
      event.preventDefault();
      return;
    }
    if (this.characterStage.hidden) return;
    if (event.key === "ArrowLeft") this.step(-1);
    else if (event.key === "ArrowRight") this.step(1);
    else if (event.key === "Enter") {
      this.enter().catch((error) => this.report(error));
    } else return;
    event.preventDefault();
  }

  async refreshCharacters() {
    if (this.pending || this.destroyed) return;
    const generation = ++this.generation;
    this.setPending(true, "Refreshing characters…");
    try {
      const characters = await this.transport.listCharacters();
      if (this.destroyed || generation !== this.generation) return;
      if (!characters.length) {
        this.selecting = false;
        this.characters = [];
        this.showCreate();
        this.message.textContent =
          "No characters yet. Roll the dice, choose a look and name your first character.";
        return;
      }
      this.characters = characters.slice(0, MAX_CHARACTERS);
      this.selected = Math.min(this.selected, this.characters.length - 1);
      this.renderCarousel();
      this.message.textContent =
        "Choose a character, then enter the authoritative field.";
    } catch (error) {
      if (!this.destroyed && generation === this.generation) this.report(error);
    } finally {
      if (!this.destroyed && generation === this.generation) {
        this.setPending(false);
      }
    }
  }

  async enter() {
    if (this.pending || this.destroyed || !this.characters.length) return;
    const generation = ++this.generation;
    this.playCue("CharSelect");
    this.setPending(true, "Connecting to the authoritative field…");
    try {
      await this.connectField(this.characters[this.selected].id);
    } catch (error) {
      if (!this.destroyed && generation === this.generation) this.report(error);
    } finally {
      if (!this.destroyed && generation === this.generation) {
        this.setPending(false);
      }
    }
  }

  /** The server closes a busy character's previous session; one bounded retry follows its delay. */
  async connectField(characterId) {
    try {
      await this.transport.connect({ characterId });
    } catch (error) {
      if (error?.code !== "CHARACTER_BUSY") throw error;
      const delay = Number(this.transport.retryAfterMs);
      if (!Number.isFinite(delay) || delay < 0 || delay > 5000) throw error;
      this.message.textContent = "That character is still connected. Retrying…";
      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
      if (this.destroyed) return;
      await this.transport.connect({ characterId });
    }
  }

  async signOut() {
    if (this.pending || this.destroyed) return;
    const generation = ++this.generation;
    this.setPending(true, "Signing out…");
    try {
      await this.transport.revoke();
      if (this.destroyed || generation !== this.generation) return;
      this.selectionReset();
      this.message.textContent =
        "Signed out. Sign in with your server account.";
      this.name.focus();
    } catch (error) {
      if (!this.destroyed && generation === this.generation) this.report(error);
    } finally {
      if (!this.destroyed && generation === this.generation) {
        this.setPending(false);
      }
    }
  }

  selectionReset() {
    this.characters = [];
    this.selected = 0;
    this.selecting = false;
    this.stage = "account";
    this.password.value = "";
    this.confirm.value = "";
    this.releasePreview();
    this.renderStage();
  }

  setPending(pending, message) {
    this.pending = pending;
    this.host.setAttribute("aria-busy", String(pending));
    if (message) this.message.textContent = message;
    for (const control of [
      this.name,
      this.password,
      this.confirm,
      this.submitButton,
      this.characterNameInput,
      this.submitCreate,
    ]) {
      control.disabled = pending;
    }
    for (const control of [
      this.enterButton,
      this.createButton,
      this.refreshButton,
      this.signOutButton,
      this.previous,
      this.next,
    ]) {
      control.disabled = pending || !this.characters.length || !this.prepared;
    }
    if (this.characters.length) {
      const single = this.characters.length < 2;
      this.previous.disabled = this.next.disabled = pending || single;
    }
    this.rollButton.disabled = pending || this.rollTimer !== null;
    this.backButton.disabled = pending;
    this.renderCreate();
  }

  status(value) {
    if (this.destroyed) return;
    if (value.status === "active") {
      if (!this.visible) return;
      this.visible = false;
      this.host.hidden = true;
      this.password.value = "";
      this.confirm.value = "";
      this.stopBackdrop();
      this.entered = true;
      this.hooks.entered?.();
      return;
    }
    if (value.status !== "disconnected") return;
    const wasHidden = !this.visible;
    this.visible = true;
    this.host.hidden = false;
    if (wasHidden) {
      this.selectionReset();
      this.startBackdrop(this.controller.signal);
      this.playTitleBgm();
      this.message.textContent =
        "Connection closed. Sign in again, or press Enter to reconnect.";
    }
  }

  resize(width, height) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error("Invalid online login viewport");
    }
    this.width = width;
    this.height = height;
    this.host.dataset.viewport = width < 900 ? "compact" : "wide";
  }

  /** Each composed preview plane redraws only when its sprite tree changed. */
  draw(elapsedMs) {
    this.backdrop?.update(elapsedMs);
    const ratio = window.devicePixelRatio || 1;
    for (const slot of this.previewSlots()) {
      if (!slot.prepared) continue;
      slot.prepared.update(elapsedMs);
      slot.plane.sync(ratio, ratio);
    }
  }

  releasePreview() {
    for (const slot of this.previewSlots()) {
      slot.controller?.abort();
      slot.controller = null;
      slot.prepared?.destroy();
      slot.prepared = null;
      slot.view.removeChildren();
      slot.generation++;
    }
  }

  report(error) {
    // Local validation text is ours; server codes map to explicit wording (never raw server text).
    const code = safeCode(error);
    this.message.textContent = failureText(error, code);
    this.hooks.report(
      new Error(`Online login request failed (${code})`, { cause: error }),
    );
  }

  listen(target, type, handler, capture = false) {
    target.addEventListener(type, handler, { capture });
    this.listeners.push({ target, type, handler, capture });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.abort();
    this.generation++;
    clearInterval(this.rollTimer);
    this.rollTimer = null;
    this.releasePreview();
    this.stopBackdrop();
    for (const slot of this.previewSlots()) {
      slot.plane.canvas.remove();
      slot.root.destroy({ children: false });
    }
    for (const { target, type, handler, capture } of this.listeners) {
      target.removeEventListener(type, handler, { capture });
    }
    this.host.remove();
    this.listeners.length = 0;
  }
}

/** Server codes are surfaced only while they match the bounded protocol vocabulary shape. */
function safeCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,31}$/.test(code)
    ? code
    : "REQUEST_FAILED";
}
