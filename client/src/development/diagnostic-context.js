import {
  validateProfile,
  validateCharacterId,
  PROFILE_LIMITS,
} from "../profile/profile-validation.js";
import { validateAccountStorage } from "../profile/account-storage.js";
import { snapshotSimulation } from "../physics/simulation.js";

/** Full bounded loaded account roster, not the paginated agent observation projection. */
export function diagnosticPeers(systems) {
  const result = [];
  for (const store of systems.native.social._stores.values()) {
    if (store === systems.store) continue;
    if (result.length >= PROFILE_LIMITS.characters - 1) {
      throw new Error("Diagnostic roster exceeds profile limit");
    }
    validateProfile(store.profile);
    result.push({
      id: store.id,
      profile: structuredClone(store.profile),
      accountStorage: store.storageSnapshot(),
    });
  }
  return result;
}

export function validateDiagnosticPeers(peers, ownerId) {
  validateCharacterId(ownerId);
  if (!Array.isArray(peers) || peers.length >= PROFILE_LIMITS.characters) {
    throw new Error("Invalid diagnostic roster");
  }
  const ids = new Set([ownerId]);
  for (const peer of peers) {
    if (
      !peer ||
      Object.keys(peer).length !== 3 ||
      Object.keys(peer).some(
        (key) => !["id", "profile", "accountStorage"].includes(key),
      )
    ) {
      throw new Error("Invalid diagnostic peer fields");
    }
    validateCharacterId(peer.id);
    if (ids.has(peer.id)) throw new Error("Duplicate diagnostic peer");
    ids.add(peer.id);
    validateProfile(peer.profile);
    if (peer.accountStorage !== null) {
      validateAccountStorage(peer.accountStorage, peer.profile);
    }
  }
}

export function diagnosticContext(hooks) {
  const systems = hooks.systems();
  const scene = hooks.scene();
  if (!systems?.store?.profile || !scene) {
    return initialDiagnosticContext(systems, hooks);
  }
  const store = systems.store;
  validateProfile(store.profile);
  return {
    characterId: store.id,
    profile: structuredClone(store.profile),
    accountStorage: store.storageSnapshot(),
    peers: diagnosticPeers(systems),
    participantErrors: structuredClone(systems.native.social.participantErrors),
    mapId: scene.manifest.id,
    mapSource: scene.manifest.source ?? null,
    simulation: snapshotSimulation(scene.simulation),
    world: scene.fieldSystems.snapshot(),
    input: hooks.input.checkpoint(),
    ui: systems.ui.diagnosticSnapshot(),
    systems: systems.snapshot(),
    physics: structuredClone(scene.simulation.effectiveSettings),
    random: hooks.random(),
    status: hooks.status(),
    externalSources: {
      wallTime: Date.now(),
      policy:
        "Native browser tasks/audio/assets, social UTC timestamps and crypto UUID generation are external inputs, not claimed deterministic. Their resulting account/world values are captured and replay divergence is reported.",
    },
    streaming: hooks.streaming(),
    offline: diagnosticOffline(hooks),
    viewport: {
      width: systems.app.screen.width,
      height: systems.app.screen.height,
      density: systems.app.renderer.resolution,
    },
  };
}

function initialDiagnosticContext(systems, hooks) {
  return {
    profile: systems?.store?.profile
      ? structuredClone(systems.store.profile)
      : null,
    accountStorage: systems?.store?.storageSnapshot() ?? null,
    status: hooks.status(),
    offline: diagnosticOffline(hooks),
    streaming: hooks.streaming(),
    ui: systems?.ui?.diagnosticSnapshot() ?? null,
  };
}

/** Immutable publication inventories are identified by release, not copied into replay state. */
function diagnosticOffline(hooks) {
  const status = hooks.offline();
  if (!status?.available) return status;
  const { releaseId, buildId, totalBytes, resources, maps, unavailableMaps } =
    status.available;
  return {
    ...status,
    available: {
      releaseId,
      buildId,
      totalBytes,
      resources: resources.length,
      maps,
      unavailableMaps,
    },
  };
}

/** Compare authoritative contract facts, not renderer residency, wall-clock stack URLs or save metadata. */
export function compareDiagnosticState(expected, actual) {
  const changed = [];
  compareAuthorityState(expected, actual, changed);
  for (const key of ["gameplay", "reactors", "drops", "skills"]) {
    if (
      JSON.stringify(expected.world[key]) !== JSON.stringify(actual.world[key])
    ) {
      changed.push(`world.${key}`);
    }
  }
  for (const key of [
    "windows",
    "panelStates",
    "keyDraft",
    "quickCaptureDraft",
    "chatSession",
  ]) {
    if (JSON.stringify(expected.ui[key]) !== JSON.stringify(actual.ui[key])) {
      changed.push(`ui.${key}`);
    }
  }
  for (const key of [
    "x",
    "y",
    "vx",
    "vy",
    "state",
    "footholdId",
    "ladderId",
    "facing",
  ]) {
    if (expected.simulation[key] !== actual.simulation[key]) {
      changed.push(`simulation.${key}`);
    }
  }
  return changed.length
    ? `State divergence: ${changed.join(", ")}.`
    : "Compared profile/account/peers, gameplay world, UI drafts, random stream and physical state match; external/render timing is not asserted.";
}

function compareAuthorityState(expected, actual, changed) {
  if (expected.mapId !== actual.mapId) changed.push("map");
  if (JSON.stringify(expected.profile) !== JSON.stringify(actual.profile)) {
    changed.push("profile");
  }
  if (
    JSON.stringify(expected.accountStorage) !==
    JSON.stringify(actual.accountStorage)
  ) {
    changed.push("account");
  }
  if (JSON.stringify(expected.peers) !== JSON.stringify(actual.peers)) {
    changed.push("peer profiles");
  }
  if (expected.random.state !== actual.random.state) {
    changed.push("gameplay random stream");
  }
}
