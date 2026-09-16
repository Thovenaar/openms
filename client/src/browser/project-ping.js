/** Round-trip bands: one protocol tick is 30ms, so these are roughly 3 and 6 ticks. */
const GOOD_MAX_MS = 100;
const FAIR_MAX_MS = 200;
const PLACEHOLDER = "Ping: —";

/** A measured heartbeat is a positive millisecond value; zero means none yet. */
export function formatProjectPing(roundTripMs) {
  return Number.isFinite(roundTripMs) && roundTripMs > 0
    ? `Ping: ${Math.round(roundTripMs)} ms`
    : PLACEHOLDER;
}

/** Green/orange/red readout; unknown keeps a neutral gray before any heartbeat. */
export function pingQuality(roundTripMs) {
  if (!Number.isFinite(roundTripMs) || roundTripMs <= 0) return "unknown";
  if (roundTripMs <= GOOD_MAX_MS) return "good";
  if (roundTripMs <= FAIR_MAX_MS) return "fair";
  return "poor";
}

/** The project bar survives every game screen; keep its ping node authoritative. */
export function setProjectPing(roundTripMs) {
  const element = document.querySelector("#project-ping");
  if (!element) return;
  const quality = pingQuality(roundTripMs);
  element.textContent = formatProjectPing(roundTripMs);
  element.dataset.quality = quality;
}
