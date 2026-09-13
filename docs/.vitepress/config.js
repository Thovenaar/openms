import { defineConfig } from "vitepress";
import {
  configureRepositoryLinks,
  documentationRoute,
  repositoryUrl,
} from "./repository-links.js";
import { configureDiagrams } from "./diagrams.js";
import { sidebar } from "./navigation.js";

export default defineConfig({
  lang: "en-US",
  title: "openms.dev",
  description:
    "Build and understand the MapleStory browser client: setup, shared gameplay, server authority, and original-source evidence.",
  ignoreDeadLinks: false,
  rewrites: documentationRoute,
  markdown: {
    config(markdown) {
      configureRepositoryLinks(markdown);
      configureDiagrams(markdown);
    },
  },
  themeConfig: {
    nav: [
      { text: "Start here", link: "/" },
      { text: "Client", link: "/client/" },
      { text: "Server", link: "/server/" },
      { text: "Feature coverage", link: "/server/offline-parity" },
      { text: "Contribute", link: "/client/documentation-guide" },
    ],
    sidebar,
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
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
