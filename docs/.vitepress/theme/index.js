import DefaultTheme from "vitepress/theme";
import MermaidDiagram from "./mermaid-diagram.js";
import { createDiagramRenderer } from "./diagram-renderer.js";
import "./navigation.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.provide("docs-diagram-renderer", createDiagramRenderer());
    app.component("MermaidDiagram", MermaidDiagram);
  },
};
