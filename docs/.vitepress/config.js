import { defineConfig } from "vitepress";
import { configureRepositoryLinks } from "./repository-links.js";

/** All authoritative Markdown pages remain at their existing repository paths.
 * @type {import('vitepress').DefaultTheme.SidebarItem[]}
 */
const sidebar = [
  {
    text: "Setup",
    items: [
      { text: "Documentation home", link: "/" },
      { text: "Setup and project overview", link: "/README" },
      { text: "Inputs and provenance", link: "/inputs" },
      { text: "JavaScript coding style", link: "/coding-style" },
    ],
  },
  {
    text: "Architecture",
    items: [
      { text: "Reconstruction contract", link: "/reconstruction-contract" },
      { text: "Scene and inspection contract", link: "/scene-contract" },
      { text: "Agent actions and reversible experiments", link: "/agent-interface" },
      { text: "Inspection console and port tools", link: "/inspection-tools" },
      {
        text: "Offline integration contract",
        link: "/offline-integration-contract",
      },
    ],
  },
  {
    text: "Asset decoding and streaming",
    items: [
      { text: "Original asset decoding", link: "/asset-evidence" },
      { text: "Original in-game inventory", link: "/ingame-inventory" },
      { text: "Deterministic asset delivery", link: "/asset-delivery" },
      { text: "Progressive streaming", link: "/streaming" },
    ],
  },
  {
    text: "Physics",
    items: [
      { text: "Original motion evidence", link: "/physics-evidence" },
      { text: "Physics options", link: "/physics-options" },
      { text: "Motion refinements", link: "/physics-refinements" },
      { text: "Character and attack geometry", link: "/hitboxes" },
      { text: "Avatar actions and movement clock", link: "/avatar-actions" },
    ],
  },
  {
    text: "UI",
    items: [
      { text: "In-game UI reconstruction", link: "/ingame-ui" },
      { text: "Native binding actions and world map", link: "/offline-binding-actions" },
      { text: "Audio and visual effects", link: "/ingame-audiovisual" },
    ],
  },
  {
    text: "Offline gameplay",
    items: [
      { text: "Gameplay and acceptance checklist", link: "/offline-gameplay" },
      { text: "Combat and progression", link: "/offline-combat" },
      { text: "Drop motion and atomic pickup", link: "/drop-motion" },
      { text: "Authorized Cosmic SQL data", link: "/offline-data" },
      { text: "Learned skills and passive effects", link: "/skills" },
      { text: "Life and local authority", link: "/ingame-life" },
      { text: "Quests", link: "/ingame-quests" },
      { text: "Character development", link: "/offline-profile" },
      { text: "Character persistence", link: "/offline-saves" },
      { text: "Portals", link: "/ingame-portals" },
      { text: "Reactors and entity families", link: "/ingame-entities" },
    ],
  },
  {
    text: "Reverse-engineering evidence",
    items: [
      { text: "Original client and rendering", link: "/client-evidence" },
      {
        text: "Original Windows reference requests",
        link: "/windows-reference-captures",
      },
    ],
  },
  {
    text: "Browser validation",
    items: [
      { text: "Validation method", link: "/validation-method" },
      { text: "Systematic client audit", link: "/client-audit" },
      {
        text: "Integrated in-game results",
        link: "/ingame-validation/results",
      },
      {
        text: "Physics and streaming results",
        link: "/physics-validation/results",
      },
      { text: "Validation results and rendering baseline", link: "/validation" },
    ],
  },
];

export default defineConfig({
  lang: "en-US",
  title: "Maple Mono",
  description:
    "Original-asset browser reconstruction: setup, JavaScript architecture, offline gameplay, recovered evidence, and measured browser validation.",
  ignoreDeadLinks: false,
  markdown: { config: configureRepositoryLinks },
  themeConfig: {
    nav: [
      { text: "Setup", link: "/README" },
      { text: "Architecture", link: "/reconstruction-contract" },
      { text: "Gameplay", link: "/offline-gameplay" },
      { text: "Evidence", link: "/client-evidence" },
      { text: "Validation", link: "/validation-method" },
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
