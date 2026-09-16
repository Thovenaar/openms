import { defineConfig } from "vitepress";
import {
  configureRepositoryLinks,
  documentationRoute,
  repositoryUrl,
} from "./repository-links.js";
import { configureDiagrams } from "./diagrams.js";
import { nav, sidebar } from "./navigation.js";

export default defineConfig({
  lang: "en-US",
  title: "docs.openms.dev",
  description:
    "Build and understand the MapleStory browser client: setup, shared gameplay, server authority, and original-source evidence.",
  ignoreDeadLinks: false,
  rewrites: documentationRoute,
  sitemap: { hostname: "https://docs.openms.dev" },
  head: [
    ["link", { rel: "icon", type: "image/png", href: "/openms-icon.png" }],
    [
      "script",
      {
        async: "",
        src: "https://www.googletagmanager.com/gtag/js?id=G-TDW1MB14H6",
      },
    ],
    [
      "script",
      {},
      [
        "window.dataLayer = window.dataLayer || [];",
        "function gtag() {",
        "  dataLayer.push(arguments);",
        "}",
        "gtag('js', new Date());",
        "gtag('config', 'G-TDW1MB14H6');",
      ].join("\n"),
    ],
  ],
  markdown: {
    config(markdown) {
      configureRepositoryLinks(markdown);
      configureDiagrams(markdown);
    },
  },
  themeConfig: {
    logo: { src: "/openms-icon.png", alt: "OpenMS" },
    nav,
    sidebar,
    search: { provider: "local" },
    outline: { level: [2, 4], label: "On this page" },
    socialLinks: [{ icon: "github", link: repositoryUrl }],
    editLink: {
      pattern: `${repositoryUrl}/edit/main/docs/:path`,
      text: "Edit this page",
    },
    footer: {
      message: "Original evidence · Explicit authority · Scoped validation",
    },
  },
});
