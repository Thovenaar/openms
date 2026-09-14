// Decorative SVGs are paired with readable labels; no icon font or remote assets.
const icons = {
  start: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5"/>',
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

/** Pair a static navigation label with its decorative sidebar icon. */
function iconLabel(title, icon) {
  return `<span class="service-label"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg><span>${title}</span></span>`;
}

function group(title, icon, pages, collapsed = true) {
  return {
    text: iconLabel(title, icon),
    collapsed,
    items: pages.map((page) =>
      Array.isArray(page) ? { text: page[0], link: page[1] } : page,
    ),
  };
}

/** Quick Start leads into authoring; client/server details share a reference. */
export const nav = [
  { text: "Quick Start", link: "/" },
  { text: "Server", link: "/development#server" },
  { text: "Client", link: "/development#client" },
  { text: "Studio", link: "/development#studio" },
  { text: "Contribute", link: "/client/documentation-guide" },
];

export const sidebar = [
  {
    items: [
      { text: iconLabel("Quick Start", "start"), link: "/" },
      { text: iconLabel("Custom content", "edit"), link: "/custom-content" },
    ],
  },
  group("Server", "server", [
    ["Overview", "/development#server"],
    ["Database", "/development#database"],
    ["Migrations", "/development#migrations"],
    ["Settings", "/development#server-settings"],
    ["Troubleshooting", "/development#troubleshooting"],
    ["Production", "/development#production"],
    ["Protocol", "/server/protocol"],
    ["Content", "/server/content"],
    ["Coverage", "/server/offline-parity"],
    ["Roadmap", "/server/remaining-work"],
    ["Market", "/server/market"],
  ]),
  group("Client", "game", [
    ["Overview", "/development#client"],
    ["Online", "/development#online"],
    ["Offline", "/development#offline"],
    ["Controls", "/development#controls"],
    group("Gameplay", "game", [
      ["Overview", "/client/offline-gameplay"],
      ["Combat", "/client/offline-combat"],
      ["Skills", "/client/skills"],
      ["NPCs", "/client/ingame-life"],
      ["Quests", "/client/ingame-quests"],
      ["Characters", "/client/offline-profile"],
      ["Saves", "/client/offline-saves"],
      ["Definitions", "/client/offline-data"],
      ["Reactors", "/client/ingame-entities"],
    ]),
    group("Movement", "motion", [
      ["Online", "/client/movement-parity"],
      ["Evidence", "/client/physics-evidence"],
      ["Properties", "/client/physics-options"],
      ["Refinements", "/client/physics-refinements"],
      ["Hitboxes", "/client/hitboxes"],
      ["Actions", "/client/avatar-actions"],
      ["Drops", "/client/drop-motion"],
      ["Portals", "/client/ingame-portals"],
    ]),
    group("Interface", "window", [
      ["Windows", "/client/ingame-ui"],
      ["Bindings", "/client/offline-binding-actions"],
      ["Login", "/client/login-creation-recovery"],
      ["Shared maps", "/client/login-shared-map"],
      ["Travel", "/client/login-selection-travel"],
      ["Dialogs", "/client/native-ui-authority-recovery"],
      ["Audio & effects", "/client/ingame-audiovisual"],
    ]),
    group("Assets", "image", [
      ["Decoding", "/client/asset-evidence"],
      ["Resources", "/client/original-resource-audit"],
      ["Inventory", "/client/ingame-inventory"],
      ["Extraction", "/client/asset-delivery"],
      ["Streaming", "/client/streaming"],
    ]),
    group("Evidence", "search", [
      ["Rendering", "/client/client-evidence"],
      ["Client audit", "/client/client-audit"],
      ["Windows gaps", "/client/windows-reference-captures"],
    ]),
  ]),
  group("Studio", "window", [
    ["Overview", "/development#studio"],
    ["Authoring", "/server/studio"],
    ["Publishing", "/server/content"],
  ]),
  group("Development", "code", [
    ["Architecture", "/client/reconstruction-contract"],
    ["Scene API", "/client/scene-contract"],
    ["Inspection", "/client/inspection-tools"],
    ["Agent API", "/client/agent-interface"],
    ["Sessions", "/client/browser-session"],
    ["Coding style", "/client/coding-style"],
    ["Documentation", "/client/documentation-guide"],
  ]),
  group("Validation", "check", [
    ["Method", "/client/validation-method"],
    ["Results", "/client/validation"],
    ["Archive", "/archive/"],
  ]),
];
