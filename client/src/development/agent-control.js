const MAX_LABEL_LENGTH = 80;
const COMMAND_TYPES = new Set([
  "key",
  "action",
  "interact",
  "chat",
  "inventory",
  "ui",
  "keyConfig",
]);

/**
 * @typedef {object} DispatchLease
 * @property {AbortSignal} signal Aborted immediately when ownership is revoked.
 * @property {() => void} assertActive Recheck before effects after every await.
 */

/** Append owned inspection chrome; runtime labels always enter as text. */
function appendText(parent, tag, text, className = "") {
  const node = parent.ownerDocument.createElement(tag);
  node.textContent = text;
  node.className = className;
  parent.append(node);
  return node;
}

function appendState(parent, label) {
  const row = appendText(parent, "div", "", "agent-state");
  appendText(row, "dt", label);
  return appendText(row, "dd", "", "agent-state-value");
}

/** Build browser-policy lease controls inside the keyboard-accessible Agent tab. */
function createPanel(root) {
  const panel = appendText(
    root,
    "section",
    "",
    "maple-agent-control agent-card",
  );
  panel.setAttribute("aria-label", "Agent control");
  appendText(panel, "h3", "Local automation bridge");
  appendText(
    panel,
    "p",
    "Lets an external tool observe this game and request normal player actions. No built-in autonomous agent or chat assistant runs here.",
  );
  const states = appendText(panel, "dl", "", "agent-state-grid");
  states.setAttribute("role", "status");
  states.setAttribute("aria-live", "polite");
  const permission = appendState(states, "Permission");
  const owner = appendState(states, "Control owner");
  const activity = appendState(states, "Command activity");
  const actions = appendText(panel, "div", "", "agent-actions");
  const grant = appendText(actions, "button", "Allow agent control");
  grant.type = "button";
  const stop = appendText(actions, "button", "Stop agent");
  stop.type = "button";
  appendText(
    panel,
    "p",
    "Allow grants permission for this session, not a running agent. Stop cancels the lease and held input; resuming needs a fresh human grant.",
  );
  const warning = appendText(panel, "div", "", "agent-warning");
  appendText(warning, "h4", "Last interruption or refusal");
  const notice = appendText(warning, "p", "", "agent-reason");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  return { panel, permission, owner, activity, notice, grant, stop };
}

/** Reject unknown command families; the shared human-action adapter validates fields. */
function validateCommand(command) {
  if (
    !command ||
    typeof command !== "object" ||
    Array.isArray(command) ||
    !Object.hasOwn(command, "type") ||
    !COMMAND_TYPES.has(command.type)
  ) {
    throw new TypeError("Unknown agent command type.");
  }
}

/**
 * Ephemeral human-granted control lease. No setting is persisted. Trusted native
 * window-capture input revokes permission before canvas/UI bubble handlers run;
 * the native event is never consumed. Window blur and hidden documents revoke too.
 *
 * Only one act may be pending: concurrent calls reject without queuing. Revocation
 * aborts its signal and invalidates its guard; even a fresh grant cannot dispatch
 * another command until that promise settles. The adapter MUST check the supplied
 * guard before effects after awaits; abort cannot undo effects already admitted.
 */
export class AgentControl {
  /**
   * @param {object} options Control dependencies, owned elsewhere.
   * @param {{clear: () => void}} options.input Shared physical input owner.
   * @param {HTMLCanvasElement} options.canvas Native gameplay focus target.
   * @param {HTMLElement} options.root Visible host outside the original game HUD.
   * @param {object} options.hooks Normal-action and read-only observation adapters.
   * @param {(command: object, lease: DispatchLease) => unknown} options.hooks.dispatch
   * @param {(options?: object) => unknown} options.hooks.observe
   * @param {() => unknown} options.hooks.capture
   * @param {() => boolean} options.hooks.ready
   * @param {(reason: string) => void} [options.hooks.onInterrupt] Synchronous takeover hook.
   */
  constructor({ input, canvas, root, hooks }) {
    this.input = input;
    this.canvas = canvas;
    this.hooks = hooks;
    this.document = root.ownerDocument;
    this.window = this.document.defaultView;
    this.permission = false;
    this.active = false;
    this.generation = 0;
    this.label = "";
    this.reason = "Agent control is off.";
    this.notice = "No interruption or refusal in this session.";
    this.pending = null;
    this.destroyed = false;
    this.ui = createPanel(root);
    this.handlers = {
      human: this.onHuman.bind(this),
      blur: this.onBlur.bind(this),
      visibility: this.onVisibility.bind(this),
      grant: this.onGrant.bind(this),
      stop: this.onStop.bind(this),
    };
    this.api = Object.freeze({
      acquire: this.acquire.bind(this),
      release: this.release.bind(this),
      act: this.act.bind(this),
      observe: this.observe.bind(this),
      capture: this.capture.bind(this),
      status: this.status.bind(this),
    });
    this.listen(true);
    this.updatePanel();
  }

  /** Register capture interruption ahead of target/bubble gameplay consumption. */
  listen(attach) {
    if (attach) {
      this.window.addEventListener("keydown", this.handlers.human, true);
      this.window.addEventListener("keyup", this.handlers.human, true);
      this.window.addEventListener("pointerdown", this.handlers.human, true);
      this.window.addEventListener("wheel", this.handlers.human, {
        capture: true,
        passive: true,
      });
      this.window.addEventListener("blur", this.handlers.blur);
      this.document.addEventListener(
        "visibilitychange",
        this.handlers.visibility,
      );
      this.ui.grant.addEventListener("click", this.handlers.grant);
      this.ui.stop.addEventListener("click", this.handlers.stop);
    } else {
      this.window.removeEventListener("keydown", this.handlers.human, true);
      this.window.removeEventListener("keyup", this.handlers.human, true);
      this.window.removeEventListener("pointerdown", this.handlers.human, true);
      this.window.removeEventListener("wheel", this.handlers.human, true);
      this.window.removeEventListener("blur", this.handlers.blur);
      this.document.removeEventListener(
        "visibilitychange",
        this.handlers.visibility,
      );
      this.ui.grant.removeEventListener("click", this.handlers.grant);
      this.ui.stop.removeEventListener("click", this.handlers.stop);
    }
  }

  /** Agent-off input takes a single ownership check and never touches gameplay. */
  onHuman(event) {
    if (!this.permission || !event.isTrusted) return;
    if (event.type === "keyup" && !this.active) return;
    this.revoke(`Human ${event.type} interrupted agent control.`);
  }

  /** Window focus loss is distinct from normal chat/UI element focus changes. */
  onBlur() {
    if (this.permission) this.revoke("Window lost focus.");
  }

  /** A visible-tab transition alone never grants control. */
  onVisibility() {
    if (this.document.hidden && this.permission) {
      this.revoke("Document became hidden.");
    }
  }

  /** Only a browser-trusted activation grants fresh, non-persisted permission. */
  onGrant(event) {
    if (!event.isTrusted || this.destroyed || this.document.hidden) return;
    this.revoke("Fresh permission granted.", this.notice);
    this.permission = true;
    this.generation++;
    this.reason = "Permission granted; waiting for an agent lease.";
    this.canvas.focus({ preventScroll: true });
    this.updatePanel();
  }

  /** Stopping is deliberately allowed even for untrusted/programmatic clicks. */
  onStop() {
    this.release();
  }

  /** @param {string} label Explicit nonempty agent identity, at most 80 characters. */
  acquire(label) {
    this.assertAlive();
    if (
      typeof label !== "string" ||
      !label.trim() ||
      label.length > MAX_LABEL_LENGTH
    ) {
      throw this.refusal(
        "Agent label must contain 1–80 characters.",
        TypeError,
      );
    }
    if (!this.permission) {
      throw this.refusal("A human must allow agent control first.");
    }
    if (this.active) {
      throw this.refusal("An agent already owns the control lease.");
    }
    if (this.pending) {
      throw this.refusal("A revoked command is still settling.");
    }
    if (!this.hooks.ready()) {
      throw this.refusal("Gameplay is not ready for agent control.");
    }
    this.input.clear();
    this.active = true;
    this.label = label.trim();
    this.generation++;
    this.reason = "Agent lease active.";
    this.canvas.focus({ preventScroll: true });
    this.updatePanel();
    return this.status();
  }

  /** Releasing consumes permission: reacquisition always needs a fresh human grant. */
  release() {
    if (!this.destroyed) {
      this.revoke("Agent control stopped; fresh permission required.");
    }
    return this.status();
  }

  /** Revoke before abort listeners run, and never clear a later human-owned hold. */
  revoke(reason, notice = reason) {
    const owned = this.permission || this.active;
    this.permission = false;
    this.active = false;
    this.label = "";
    this.reason = reason;
    this.notice = notice;
    if (owned) {
      this.generation++;
      this.input.clear();
    }
    this.pending?.controller.abort();
    this.updatePanel();
    if (owned) this.hooks.onInterrupt?.(reason);
  }

  /** Throw unless this live lease can currently admit normal gameplay actions. */
  assertActive() {
    this.assertAlive();
    if (!this.permission || !this.active) {
      throw this.refusal("Agent control lease is inactive.");
    }
    if (!this.hooks.ready()) {
      throw this.refusal("Gameplay is not ready for agent actions.");
    }
  }

  /** Guard asynchronous adapter continuations against revoke/reacquire races. */
  dispatchLease(pending) {
    const assertActive = () => {
      if (
        pending.controller.signal.aborted ||
        this.generation !== pending.generation
      ) {
        throw new Error("Agent command was interrupted.");
      }
      this.assertActive();
    };
    return { signal: pending.controller.signal, assertActive };
  }

  /**
   * Dispatch once through normal human admission. Failure clears held input and
   * consumes the current permission; stale completions cannot clear human input.
   * @param {object} command A shared player-actions command (never a DOM event).
   * @returns {Promise<unknown>} Adapter result, or an explicit admission/interruption error.
   */
  async act(command) {
    this.assertActive();
    if (this.pending) {
      throw this.refusal(
        "An agent command is pending; commands are not queued.",
      );
    }
    const pending = {
      generation: this.generation,
      controller: new AbortController(),
    };
    this.pending = pending;
    this.updatePanel();
    const lease = this.dispatchLease(pending);
    try {
      validateCommand(command);
      const result = await this.hooks.dispatch(command, lease);
      lease.assertActive();
      if (result?.accepted === false) {
        this.notice = result.reason || "The game refused this command.";
      }
      return result;
    } catch (error) {
      if (this.generation === pending.generation) {
        this.revoke(
          "Agent command failed; fresh permission required.",
          error?.message || "Agent command failed.",
        );
      }
      throw error;
    } finally {
      this.pending = null;
      this.updatePanel();
    }
  }

  /** Read-only observations do not require an input lease. */
  observe(options) {
    this.assertAlive();
    return this.hooks.observe(options);
  }

  /** Read-only canvas capture does not require an input lease. */
  capture() {
    this.assertAlive();
    return this.hooks.capture();
  }

  /** Demand-only ownership snapshot; generation changes on grants, acquire and revoke. */
  status() {
    return {
      permission: this.permission,
      active: this.active,
      generation: this.generation,
      label: this.label,
      pending: this.pending !== null,
      ready: !this.destroyed && this.hooks.ready(),
      destroyed: this.destroyed,
      reason: this.reason,
      concurrency: "reject-while-pending",
    };
  }

  /** Retain one refusal without changing the underlying admission or lease policy. */
  refusal(message, ErrorType = Error) {
    this.notice = message;
    this.updatePanel();
    return new ErrorType(message);
  }

  /** Update on ownership/command transitions, never by polling scene snapshots. */
  updatePanel() {
    this.ui.permission.textContent = this.permission
      ? "Granted · this session only"
      : "Off · human grant required";
    this.ui.owner.textContent = this.active
      ? this.label
      : this.permission
        ? "Waiting for an external lease"
        : "Human";
    this.ui.activity.textContent = this.pending
      ? this.pending.controller.signal.aborted
        ? "Interrupted · command settling"
        : "Command pending · no queue"
      : "Idle · no pending command";
    this.ui.notice.textContent = this.notice;
    this.ui.grant.disabled = this.permission || this.destroyed;
    this.ui.stop.disabled = this.destroyed;
  }

  /** Reject retained public API calls once this owner has been torn down. */
  assertAlive() {
    if (this.destroyed) throw new Error("Agent control has been destroyed.");
  }

  /** Remove owned listeners and DOM; pending adapters receive cancellation. */
  destroy() {
    if (this.destroyed) return;
    this.revoke("Agent control destroyed.");
    this.destroyed = true;
    this.listen(false);
    this.ui.panel.remove();
  }
}
