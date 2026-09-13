// Decorative SVGs are paired with readable labels; no icon font or remote assets.
const icons = {
  start: '<path d="m3 10 9-7 9 7v10H3zm6 10v-7h6v7"/>',
  code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-2-16-4 18"/>',
  server:
    '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6h.01M7 17h.01m4-11h6m-6 11h6"/>',
  game: '<path d="M6 7h12l4 12h-5l-3-4h-4l-3 4H2zM5 11h6m-3-3v6m8-3h.01m3 2h.01"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 17 6-6 5 5 3-3 4 4"/><circle cx="16" cy="8" r="2"/>',
  motion: '<path d="M2 12h17m-6-6 6 6-6 6M2 6h5M2 18h5"/>',
  window:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M7 5.5h.01M7 12h10M7 16h6"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7M7 10h6m-3-3v6"/>',
  check: '<path d="m3 12 6 6L21 6"/>',
};

function group(title, icon, pages, collapsed = true) {
  return {
    text: `<span class="service-label"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg><span>${title}</span></span>`,
    collapsed,
    items: pages.map(([text, link]) => ({ text, link })),
  };
}

/** One level of topic groups keeps all services within reach on every page. */
export const sidebar = [
  group(
    "Start & contribute",
    "start",
    [
      ["Documentation home", "/"],
      ["Run the client", "/client/"],
      ["Run the server", "/server/"],
      ["Inputs & provenance", "/client/inputs"],
      ["Coding style", "/client/coding-style"],
      ["Maintain these docs", "/client/documentation-guide"],
    ],
    false,
  ),
  group("Architecture & tools", "code", [
    ["Shared integration contract", "/client/reconstruction-contract"],
    ["Scene & inspection API", "/client/scene-contract"],
    ["Development inspection", "/client/inspection-tools"],
    ["Agent actions & experiments", "/client/agent-interface"],
    ["Browser session ownership", "/client/browser-session"],
  ]),
  group("Server & multiplayer", "server", [
    ["Setup & operations", "/server/"],
    ["Studio dashboard", "/server/studio"],
    ["Custom content & world releases", "/server/content"],
    ["Protocol & transactions", "/server/protocol"],
    ["Online/offline coverage", "/server/offline-parity"],
    ["Remaining implementation work", "/server/remaining-work"],
    ["Trading system & recovery", "/server/market"],
    ["Login & shared maps", "/client/login-shared-map"],
  ]),
  group("Gameplay & persistence", "game", [
    ["Gameplay guide", "/client/offline-gameplay"],
    ["Combat & progression", "/client/offline-combat"],
    ["Skills & effects", "/client/skills"],
    ["NPCs & life", "/client/ingame-life"],
    ["Quests", "/client/ingame-quests"],
    ["Character & presets", "/client/offline-profile"],
    ["Saves & transactions", "/client/offline-saves"],
    ["Server reference data", "/client/offline-data"],
    ["Reactors & entity families", "/client/ingame-entities"],
  ]),
  group("Movement & physics", "motion", [
    ["Online movement parity", "/client/movement-parity"],
    ["Original motion evidence", "/client/physics-evidence"],
    ["Properties & defaults", "/client/physics-options"],
    ["Motion refinements", "/client/physics-refinements"],
    ["Hitboxes", "/client/hitboxes"],
    ["Avatar actions & clock", "/client/avatar-actions"],
    ["Drop motion & pickup", "/client/drop-motion"],
    ["Portals & camera", "/client/ingame-portals"],
  ]),
  group("Interface & audio", "window", [
    ["In-game windows & input", "/client/ingame-ui"],
    ["Bindings & world map", "/client/offline-binding-actions"],
    ["Login & character creation", "/client/login-creation-recovery"],
    ["Selection & travel", "/client/login-selection-travel"],
    ["NPC & development UI recovery", "/client/native-ui-authority-recovery"],
    ["Audio & visual effects", "/client/ingame-audiovisual"],
  ]),
  group("Assets & delivery", "image", [
    ["Original decoding", "/client/asset-evidence"],
    ["Resource & property audit", "/client/original-resource-audit"],
    ["Asset inventory", "/client/ingame-inventory"],
    ["Extraction & offline delivery", "/client/asset-delivery"],
    ["Streaming & resource lifetime", "/client/streaming"],
  ]),
  group("Reverse engineering", "search", [
    ["Client & rendering evidence", "/client/client-evidence"],
    ["Systematic client audit", "/client/client-audit"],
    ["Windows reference gaps", "/client/windows-reference-captures"],
  ]),
  group("Validation & history", "check", [
    ["Choose a scoped check", "/client/validation-method"],
    ["Results & known limits", "/client/validation"],
    ["Historical reports", "/archive/"],
  ]),
];
