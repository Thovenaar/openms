import { admitNpcScript } from "./npc-script-admission.js";
import {
  admitNpcForceQuests,
  validateNpcDraft,
  validateNpcEnvironment,
} from "./npc-script-authority.js";
import { executeNpcTurn } from "./npc-script-vm.js";
import {
  NPC_RUNTIME_LIMITS as LIMITS,
  npcInteger,
  requireNpc,
} from "./npc-script-values.js";
import { validateProfile } from "./profile-validation.js";

export {
  NPC_SCRIPT_REQUIREMENTS,
  NPC_DEPENDENCY_FAMILIES,
} from "./npc-script-admission.js";
export {
  NPC_RUNTIME_LIMITS,
  NPC_DIALOG_TYPES,
  NPC_READ_TYPES,
} from "./npc-script-values.js";

export const NPC_RESPONSE_ACTIONS = Object.freeze([
  "next",
  "previous",
  "acknowledge",
  "yes",
  "no",
  "accept",
  "decline",
  "choose",
  "number",
  "text",
  "close",
]);
const NO_EFFECTS = Object.freeze([]);

function failure(error, view) {
  return {
    ok: false,
    code: error.code ?? "npc-runtime",
    reason: error.message ?? String(error),
    view,
  };
}

function responseShape(response, view) {
  requireNpc(
    response && typeof response === "object" && !Array.isArray(response),
    "Invalid NPC response",
    "npc-response",
  );
  const keys = Object.keys(response);
  requireNpc(
    keys.length <= 4 &&
      keys.every((key) =>
        ["sessionId", "revision", "action", "value"].includes(key),
      ),
    "Unknown NPC response field",
    "npc-response",
  );
  requireNpc(
    response.sessionId === view.sessionId &&
      response.revision === view.revision,
    "NPC response belongs to a stale session or revision",
    "npc-stale",
  );
  requireNpc(
    NPC_RESPONSE_ACTIONS.includes(response.action),
    "Unknown NPC response action",
    "npc-response",
  );
  if (!["choose", "number", "text"].includes(response.action)) {
    requireNpc(
      !Object.hasOwn(response, "value"),
      "Unexpected NPC response value",
      "npc-response",
    );
  }
}

function sayResponse(view, action) {
  if (action === "next" && view.next) return [1, 0, -1];
  if (action === "previous" && view.prev) return [0, 0, -1];
  // Native 009a7c8b creates BtOK whenever next==0, independently of Prev.
  // Command1 is not BtNext command0x2001: response mapping 007468c0..d9.
  if ((action === "acknowledge" && !view.next) || action === "close") {
    return [-1, 0, -1];
  }
  requireNpc(false, "NPC say action is unavailable", "npc-response");
}

function binaryResponse(view, action) {
  const accepting = view.kind === "accept-decline";
  if (action === (accepting ? "accept" : "yes")) return [1, view.rawType, -1];
  if (action === (accepting ? "decline" : "no")) return [0, view.rawType, -1];
  if (action === "close") return [-1, view.rawType, -1];
  requireNpc(false, "NPC confirmation action is unavailable", "npc-response");
}

function valueResponse(view, response) {
  const { action, value } = response;
  if (action === "close") {
    return { args: [0, view.rawType, -1], local: view.kind === "text" };
  }
  if (view.kind === "choice" && action === "choose") {
    npcInteger(value, 0);
    requireNpc(
      view.choices.some((choice) => choice.id === value),
      "NPC choice ID is not offered",
      "npc-response",
    );
    return { args: [1, 4, value] };
  }
  if (view.kind === "number" && action === "number") {
    return { args: [1, 3, npcInteger(value, view.min, view.max)] };
  }
  if (view.kind === "text" && action === "text") {
    requireNpc(
      typeof value === "string" &&
        value.length >= view.minLength &&
        value.length <= view.maxLength,
      "NPC text input is outside authored bounds",
      "npc-response",
    );
    return { args: [1, 2, -1], text: value };
  }
  requireNpc(false, "NPC input action is unavailable", "npc-response");
}

/** NPCMoreTalkHandler:38-56 closes text without invoking action; raw12 retains type12. */
function decodeResponse(view, response) {
  responseShape(response, view);
  requireNpc(
    !["closed", "blocked"].includes(view.kind),
    "NPC view cannot receive a response",
    "npc-response",
  );
  let result;
  if (view.kind === "say") {
    result = { args: sayResponse(view, response.action) };
  } else if (["yes-no", "accept-decline"].includes(view.kind)) {
    result = { args: binaryResponse(view, response.action) };
  } else if (view.kind === "shop") {
    requireNpc(
      response.action === "close",
      "Shop commerce belongs to the shop owner",
      "npc-response",
    );
    result = { local: true };
  } else result = valueResponse(view, response);
  if (view.disposed) result.local = true;
  return result;
}

function freezeGlobals(globals) {
  // Arrays produced by the VM are immutable; only their scalar binding root is new each turn.
  return Object.freeze(globals);
}

function publication(sessionId, revision, turn) {
  const effects = turn.effects.length
    ? Object.freeze(turn.effects.map((effect) => Object.freeze(effect)))
    : NO_EFFECTS;
  return {
    state: Object.freeze({
      globals: freezeGlobals(turn.globals),
      inputText: turn.inputText,
    }),
    view: Object.freeze({ ...turn.view, sessionId, revision }),
    effects,
  };
}

/**
 * Owns one fully admitted authored program and one live-NPC/profile lease.
 * environment: {npcId,items,quests,names,mapNames,portraits,shops,artwork?,isCurrent,isBusy}.
 * Catalogs are immutable packaged data; the router authenticates their bytes/provenance.
 * The owner MUST forbid scene/profile/reset/remount/close transitions while pending is true.
 * isBusy MUST NOT include this session's pending or its own ProfileStore transaction lock.
 * Effects are returned only after durable success; UI/gameplay dispatch remains the caller's job.
 */
export class NpcScriptSession {
  #context;
  #store;
  #environment;
  #state;
  #view;
  #sessionId;
  #pending = false;
  #started = false;
  #closed = false;
  #turns = 0;

  constructor(compilation, store, environment) {
    this.#context = admitNpcScript(compilation);
    requireNpc(
      store?.profile && typeof store.commitProfile === "function",
      "NPC session requires a ProfileStore",
      "npc-profile",
    );
    this.#environment = { ...environment };
    validateNpcEnvironment(this.#context, this.#environment);
    admitNpcForceQuests(this.#context, this.#environment);
    validateProfile(store.profile, environment.items);
    this.#store = store;
    this.#sessionId = crypto.randomUUID();
    const globals = Object.create(null);
    for (const name of this.#context.program.globals) globals[name] = undefined;
    // Java NPCConversationManager.getText is null until the first accepted text response.
    this.#state = Object.freeze({
      globals: freezeGlobals(globals),
      inputText: null,
    });
    this.#view = Object.freeze({
      kind: "closed",
      npcId: environment.npcId,
      sessionId: this.#sessionId,
      revision: 0,
      disposed: false,
    });
  }

  get view() {
    return this.#view;
  }
  get pending() {
    return this.#pending;
  }
  get sessionId() {
    return this.#sessionId;
  }

  #ownership(profile, insideCommit = false) {
    requireNpc(
      !this.#closed &&
        profile &&
        profile.hp > 0 &&
        this.#environment.isCurrent(),
      "The authored NPC interaction no longer owns this live character",
      "npc-ownership",
    );
    requireNpc(
      !this.#environment.isBusy() &&
        (insideCommit || !this.#store.profileTransactionPending),
      "The character is busy with another operation",
      "npc-busy",
    );
  }

  #prepare(profile, input) {
    this.#ownership(profile, input.insideCommit === true);
    validateNpcEnvironment(this.#context, this.#environment);
    const turn = executeNpcTurn(this.#context, this.#state, profile, {
      ...input,
      environment: this.#environment,
    });
    validateNpcDraft(turn);
    this.#ownership(profile, input.insideCommit === true);
    return turn;
  }

  async #turn(input) {
    this.#pending = true;
    try {
      this.#ownership(this.#store.profile);
      requireNpc(
        this.#turns < LIMITS.turnsPerSession,
        "NPC session exhausted its turn budget",
        "npc-budget",
      );
      validateProfile(this.#store.profile, this.#environment.items);
      const request = { ...input, now: Date.now() };
      let turn = this.#prepare(structuredClone(this.#store.profile), request);
      let ready = publication(this.#sessionId, this.#view.revision + 1, turn);
      const committed = turn.effects.length > 0;
      if (committed) {
        this.#ownership(this.#store.profile);
        // The preview cannot authorize a fresh profile. Reexecute all gates and effects in
        // the locked detached draft after accepted prior saves have drained, without retry.
        await this.#store.commitProfile((draft) => {
          turn = this.#prepare(draft, { ...request, insideCommit: true });
          ready = publication(this.#sessionId, this.#view.revision + 1, turn);
        });
      }
      // No user callbacks/awaits between durable completion and publishing the session.
      this.#state = ready.state;
      this.#view = ready.view;
      this.#started = true;
      this.#closed = ready.view.kind === "closed";
      this.#turns++;
      return { ok: true, view: this.#view, committed, effects: ready.effects };
    } catch (error) {
      return failure(error, this.#view);
    } finally {
      this.#pending = false;
    }
  }

  async start() {
    try {
      requireNpc(!this.#pending, "NPC turn is already pending", "npc-busy");
      requireNpc(
        !this.#started && !this.#closed,
        "NPC session has already started or closed",
        "npc-response",
      );
      return await this.#turn({ start: true });
    } catch (error) {
      return failure(error, this.#view);
    }
  }

  async respond(response) {
    try {
      requireNpc(!this.#pending, "NPC turn is already pending", "npc-busy");
      requireNpc(
        this.#started && !this.#closed,
        "NPC session is not active",
        "npc-response",
      );
      this.#ownership(this.#store.profile);
      const input = decodeResponse(this.#view, response);
      if (input.local) return this.close();
      return await this.#turn(input);
    } catch (error) {
      return failure(error, this.#view);
    }
  }

  /** Local owner teardown only. User button responses must use respond for source semantics. */
  close() {
    try {
      requireNpc(
        !this.#pending,
        "Cannot release an NPC lease while its turn is pending",
        "npc-busy",
      );
      if (!this.#closed) {
        this.#view = Object.freeze({
          kind: "closed",
          npcId: this.#environment.npcId,
          sessionId: this.#sessionId,
          revision: this.#view.revision + 1,
          disposed: true,
        });
        this.#closed = true;
      }
      return {
        ok: true,
        view: this.#view,
        committed: false,
        effects: NO_EFFECTS,
      };
    } catch (error) {
      return failure(error, this.#view);
    }
  }
}
