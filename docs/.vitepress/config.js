import { defineConfig } from "vitepress";
import {
  configureRepositoryLinks,
  documentationRoute,
} from "./repository-links.js";

/** Decorative SVGs inherit the accessible text label beside them. */
const icons = {
  client:
    '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  server:
    '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M7 6h.01M7 17h.01m4-11h6m-6 11h6"/>',
  group: '<path d="M3 7h7l2-3h9v15H3z"/>',
};

/** @param {string} text @param {keyof typeof icons} icon */
function sectionLabel(text, icon) {
  return `<span class="service-label"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg><span>${text}</span></span>`;
}

/** Published routes are namespaced; authoritative source/evidence paths stay intact.
 * @type {import('vitepress').DefaultTheme.SidebarItem[]}
 */
const clientSidebar = [
  {
    text: "Client setup",
    items: [
      { text: "Client overview and setup", link: "/client/" },
      { text: "Inputs and provenance", link: "/client/inputs" },
      { text: "JavaScript coding style", link: "/client/coding-style" },
    ],
  },
  {
    text: "Architecture",
    items: [
      {
        text: "Reconstruction contract",
        link: "/client/reconstruction-contract",
      },
      { text: "Scene and inspection contract", link: "/client/scene-contract" },
      {
        text: "Agent actions and reversible experiments",
        link: "/client/agent-interface",
      },
      {
        text: "Inspection console and port tools",
        link: "/client/inspection-tools",
      },
      {
        text: "Offline integration contract",
        link: "/client/offline-integration-contract",
      },
    ],
  },
  {
    text: "Asset decoding and streaming",
    items: [
      { text: "Original asset decoding", link: "/client/asset-evidence" },
      { text: "Original in-game inventory", link: "/client/ingame-inventory" },
      { text: "Deterministic asset delivery", link: "/client/asset-delivery" },
      { text: "Progressive streaming", link: "/client/streaming" },
    ],
  },
  {
    text: "Physics",
    items: [
      { text: "Original motion evidence", link: "/client/physics-evidence" },
      { text: "Physics options", link: "/client/physics-options" },
      { text: "Motion refinements", link: "/client/physics-refinements" },
      { text: "Character and attack geometry", link: "/client/hitboxes" },
      {
        text: "Avatar actions and movement clock",
        link: "/client/avatar-actions",
      },
    ],
  },
  {
    text: "UI",
    items: [
      { text: "In-game UI reconstruction", link: "/client/ingame-ui" },
      {
        text: "Native binding actions and world map",
        link: "/client/offline-binding-actions",
      },
      { text: "Audio and visual effects", link: "/client/ingame-audiovisual" },
    ],
  },
  {
    text: "Offline gameplay",
    items: [
      {
        text: "Gameplay and acceptance checklist",
        link: "/client/offline-gameplay",
      },
      { text: "Combat and progression", link: "/client/offline-combat" },
      { text: "Drop motion and atomic pickup", link: "/client/drop-motion" },
      { text: "Authorized Cosmic SQL data", link: "/client/offline-data" },
      { text: "Learned skills and passive effects", link: "/client/skills" },
      { text: "Life and local authority", link: "/client/ingame-life" },
      { text: "Quests", link: "/client/ingame-quests" },
      { text: "Character development", link: "/client/offline-profile" },
      { text: "Character persistence", link: "/client/offline-saves" },
      { text: "Portals", link: "/client/ingame-portals" },
      { text: "Reactors and entity families", link: "/client/ingame-entities" },
    ],
  },
  {
    text: "Reverse-engineering evidence",
    items: [
      {
        text: "Original client and rendering",
        link: "/client/client-evidence",
      },
      {
        text: "Original Windows reference requests",
        link: "/client/windows-reference-captures",
      },
    ],
  },
  {
    text: "Browser validation",
    items: [
      {
        text: "Native offline UI acceptance",
        link: "/client/native-ui-validation",
      },
      { text: "Validation method", link: "/client/validation-method" },
      { text: "Systematic client audit", link: "/client/client-audit" },
      {
        text: "Integrated in-game results",
        link: "/client/ingame-validation/results",
      },
      {
        text: "Physics and streaming results",
        link: "/client/physics-validation/results",
      },
      {
        text: "Validation results and rendering baseline",
        link: "/client/validation",
      },
    ],
  },
];

/** @type {import('vitepress').DefaultTheme.SidebarItem[]} */
const serverSidebar = [
  {
    text: "Runtime and operations",
    items: [
      { text: "Overview and implementation status", link: "/server/" },
      { text: "Workspace", link: "/server/#workspace" },
      { text: "Online setup", link: "/server/#online-development" },
      { text: "Production gates", link: "/server/#production" },
      { text: "Reference data", link: "/server/#reference-data" },
      { text: "Authority boundaries", link: "/server/#authority-boundaries" },
    ],
  },
  {
    text: "Protocol and authority",
    items: [
      { text: "Authoritative browser protocol", link: "/server/protocol" },
      {
        text: "Development requests",
        link: "/server/protocol#development-requests",
      },
      {
        text: "Motion checkpoints",
        link: "/server/protocol#motion-checkpoints",
      },
      {
        text: "Durability and recovery",
        link: "/server/protocol#transactions-duplication-and-reconnect",
      },
    ],
  },
];

/** Keep both services available on every route; headings never navigate. */
const sidebar = [
  {
    text: sectionLabel("Client", "client"),
    collapsed: false,
    items: clientSidebar,
  },
  {
    text: sectionLabel("Server", "server"),
    collapsed: false,
    items: serverSidebar,
  },
];
for (const group of [...clientSidebar, ...serverSidebar]) {
  group.text = sectionLabel(group.text, "group");
  group.collapsed = true;
}

export default defineConfig({
  lang: "en-US",
  title: "openms.dev",
  description:
    "openms.dev client and server documentation: original assets, offline gameplay, service boundaries, and measured evidence.",
  ignoreDeadLinks: false,
  rewrites: documentationRoute,
  markdown: { config: configureRepositoryLinks },
  themeConfig: {
    nav: [
      {
        text: "Client",
        activeMatch: "^/client/",
        items: [
          { text: "Overview and setup", link: "/client/" },
          { text: "Online development", link: "/client/#online-development" },
          { text: "Offline gameplay", link: "/client/offline-gameplay" },
          { text: "Measured validation", link: "/client/validation" },
        ],
      },
      {
        text: "Server",
        activeMatch: "^/server/",
        items: [
          { text: "Overview and setup", link: "/server/" },
          { text: "Authoritative protocol", link: "/server/protocol" },
          { text: "Production gates", link: "/server/#production" },
        ],
      },
    ],
    sidebar,
    search: { provider: "local" },
    outline: { level: [2, 3] },
    socialLinks: [
      { icon: "github", link: "https://github.com/tensorfish/maple-mono" },
    ],
    editLink: {
      pattern: "https://github.com/tensorfish/maple-mono/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
