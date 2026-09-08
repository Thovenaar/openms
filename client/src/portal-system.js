const MAX_PORTALS = 4096;
// 0094df9b -> 00712ab1 and 00950555 -> 00712c57, respectively.
const ENTRY_HALF_WIDTH = 20;
const REVEAL_HALF_WIDTH = 100;
const HALF_HEIGHT = 50;
const REQUEST_INTERVAL_MS = 500; // 0053035d: elapsed > 499, cross-map request only.

/** Original Win32 PtInRect uses exclusive right/bottom boundaries and integer feet. */
function contains(portal, sim, halfWidth) {
  const x = Math.trunc(sim.x),
    y = Math.trunc(sim.y);
  return (
    x >= portal.x - halfWidth &&
    x < portal.x + halfWidth &&
    y >= portal.y - HALF_HEIGHT &&
    y < portal.y + HALF_HEIGHT
  );
}

/** Preserve unsupported records rather than silently redirecting or running WZ scripts. */
function unsupported(portal, raw) {
  if (raw.script !== undefined && raw.script !== "") {
    return "server-script-unavailable";
  }
  if (portal.type === 0) return "spawn-only";
  if (![1, 2, 10].includes(portal.type)) return "unsupported-portal-type";
  return unsupportedConditions(raw) ?? unsupportedDestination(portal);
}

function unsupportedConditions(raw) {
  if (raw.reactorName !== undefined && raw.reactorName !== "") {
    return "reactor-condition-unavailable";
  }
  if (Number(raw.onlyOnce ?? 0) !== 0) return "onlyOnce-lifetime-unavailable";
  if (Number(raw.delay ?? 0) !== 0) {
    return "authored-delay-semantics-unavailable";
  }
  if (
    Number(raw.horizontalImpact ?? 0) !== 0 ||
    Number(raw.verticalImpact ?? 0) !== 0
  ) {
    return "impact-semantics-unavailable";
  }
  return null;
}

function unsupportedDestination(portal) {
  if (!Number.isInteger(portal.targetMap) || portal.targetMap === 999999999) {
    return "no-route";
  }
  if (!/^\d{9}$/.test(String(portal.targetMap))) return "invalid-target-map";
  if (typeof portal.targetName !== "string" || !portal.targetName.length) {
    return "missing-target-name";
  }
  return null;
}

/** Validate one presentation entry against the sole original field metadata. */
function prepareRecord(presentation, portals, raw) {
  const portal = portals.get(presentation.portalId);
  if (!portal || !Number.isFinite(portal.x) || !Number.isFinite(portal.y)) {
    throw new Error("Portal presentation has no valid physics record");
  }
  if (
    presentation.entityId !== null &&
    presentation.entityId !== `portal:${portal.id}`
  ) {
    throw new Error("Portal presentation identity mismatch");
  }
  return {
    portal,
    entityId: presentation.entityId,
    status: presentation.status,
    denied: unsupported(portal, raw[String(portal.id)] ?? {}),
    phase: presentation.status === "looping-graphics" ? "looping" : "hidden",
    animation: null,
    desired: false,
  };
}

/** Offline traversal is not server permission. Owns state, never scene artwork/resources.
 * Main advances entity animations before update(), then renders. travel must validate
 * the catalog and exact named destination before atomically replacing even the same map.
 */
export class PortalSystem {
  constructor(scene, hooks) {
    const presentation = scene.manifest.portalPresentation;
    const portals = scene.manifest.physics.portals;
    if (
      presentation?.schemaVersion !== 1 ||
      !Array.isArray(presentation.records) ||
      !Array.isArray(portals) ||
      presentation.records.length > MAX_PORTALS ||
      portals.length !== presentation.records.length
    ) {
      throw new Error("Invalid portal presentation coverage");
    }
    if (
      typeof hooks.travel !== "function" ||
      typeof hooks.onError !== "function"
    ) {
      throw new Error("Portal travel and error hooks are required");
    }
    const byId = new Map(portals.map((portal) => [portal.id, portal]));
    const raw = scene.manifest.physics.map.$portalProperties ?? {};
    const seen = new Set();
    this.records = presentation.records.map((record) => {
      if (seen.has(record.portalId)) {
        throw new Error("Duplicate portal presentation record");
      }
      seen.add(record.portalId);
      return prepareRecord(record, byId, raw);
    });
    this.scene = scene;
    this.hooks = hooks;
    this.destroyed = false;
    this.pending = false;
    this.generation = 0;
    this.cooldownMs = 0;
    this.candidate = null;
    this.reveal = null;
    this.lastOutcome = "offline-traversal-not-server-authorization";
    this.requests = 0;
    this.completed = 0;
  }

  /** Bounded, allocation-free tick; ms follows the integration's active simulation clock. */
  update(ms, inputState) {
    if (this.destroyed) return;
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid portal update input");
    }
    this.cooldownMs = Math.max(0, this.cooldownMs - ms);
    this.handleInput(inputState);
    if (this.destroyed) return;
    this.selectNearby(this.scene.simulation);
    for (const record of this.records) this.updateGraphics(record);
  }

  /** Original Up dispatch precedes movement/ladder capture; edge ownership is shared
   * with update() so standalone callers retain the same API without duplicate requests. */
  handleInput(inputState) {
    if (this.destroyed) return;
    if (typeof inputState.upPressed !== "boolean") {
      throw new Error("Invalid portal input state");
    }
    const pressed = inputState.upPressed;
    inputState.upPressed = false;
    if (!pressed || this.pending) return;
    const sim = this.scene.simulation;
    this.selectNearby(sim);
    if (!this.candidate) return;
    if (!sim.footholdId || sim.action === "attack") {
      this.lastOutcome = "requires-grounded-unblocked-local-user";
      return;
    }
    this.request(this.candidate);
  }

  /** Original searches run in reverse source order. pt6 belongs to a separate collection. */
  selectNearby(sim) {
    this.candidate = null;
    this.reveal = null;
    for (let index = this.records.length - 1; index >= 0; index--) {
      const record = this.records[index],
        portal = record.portal;
      if (portal.type === 0 || portal.type === 6) continue;
      if (!this.candidate && contains(portal, sim, ENTRY_HALF_WIDTH)) {
        this.candidate = record;
      }
      if (
        !this.reveal &&
        (portal.type === 10 || portal.type === 11) &&
        contains(portal, sim, REVEAL_HALF_WIDTH)
      ) {
        this.reveal = record;
      }
    }
  }

  /** Region replacement is detected by identity: do not hold sprites/leases after eviction. */
  updateGraphics(record) {
    if (!record.entityId || record.portal.type !== 10) return;
    const animation = this.scene.byId.get(record.entityId);
    if (!animation) {
      record.animation = null;
      record.phase = "hidden";
      return;
    }
    if (record.animation !== animation) {
      record.animation = animation;
      record.phase = "hidden";
      record.desired = false;
      animation.container.visible = false;
    }
    const desired = this.reveal === record;
    if (desired !== record.desired) {
      record.desired = desired;
      record.phase = desired ? "portalStart" : "portalExit";
      animation.container.visible = true;
      animation.setAction(record.phase);
    }
    if (
      record.phase === "portalStart" &&
      animation.elapsedMs >= animation.current.duration
    ) {
      record.phase = "portalContinue";
      animation.setAction(record.phase);
    } else if (
      record.phase === "portalExit" &&
      animation.elapsedMs >= animation.current.duration
    ) {
      record.phase = "hidden";
      animation.container.visible = false;
    }
  }

  /** Named route errors stay visible and retain the current scene; no rejection is swallowed. */
  request(record) {
    if (this.destroyed || this.pending) return;
    if (record.denied) {
      this.lastOutcome = record.denied;
      this.hooks.onError(
        new Error(`Portal ${record.portal.name}: ${record.denied}`),
      );
      return;
    }
    const crossMap =
      String(record.portal.targetMap) !== String(this.scene.manifest.id);
    if (crossMap && this.cooldownMs > 0) {
      this.lastOutcome = "cross-map-request-cooldown";
      return;
    }
    this.pending = true;
    this.requests++;
    const generation = ++this.generation;
    if (crossMap) this.cooldownMs = REQUEST_INTERVAL_MS;
    this.lastOutcome = "offline-request-pending";
    this.finishTravel(record, generation);
  }

  async finishTravel(record, generation) {
    try {
      await this.hooks.travel(
        String(record.portal.targetMap),
        record.portal.targetName,
      );
      if (this.destroyed || generation !== this.generation) return;
      this.completed++;
      this.lastOutcome = "offline-request-committed";
    } catch (error) {
      if (this.destroyed || generation !== this.generation) return;
      this.lastOutcome = error instanceof Error ? error.message : String(error);
      this.hooks.onError(error);
    } finally {
      if (!this.destroyed && generation === this.generation) {
        this.pending = false;
      }
    }
  }

  snapshot() {
    return {
      mode: "offline-packaged-traversal-not-server-authorization",
      records: this.records.length,
      pending: this.pending,
      cooldownMs: this.cooldownMs,
      requests: this.requests,
      completed: this.completed,
      lastOutcome: this.lastOutcome,
      candidate: this.candidate?.portal.id ?? null,
      graphics: this.records
        .filter((record) => record.entityId)
        .map((record) => ({
          portalId: record.portal.id,
          entityId: record.entityId,
          phase: record.phase,
          resident: this.scene.byId.has(record.entityId),
          status: record.status,
        })),
      unsupported: this.records
        .filter((record) => record.denied)
        .map((record) => ({
          portalId: record.portal.id,
          reason: record.denied,
        })),
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.pending = false;
    this.candidate = null;
    this.reveal = null;
    for (const record of this.records) record.animation = null;
  }
}
