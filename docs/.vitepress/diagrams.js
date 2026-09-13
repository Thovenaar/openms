/** Compile Mermaid fences as escaped Vue string props; ordinary code stays code.
 * Local, browser-only rendering preserves the original Markdown for agents.
 * @param {import('vitepress').MarkdownRenderer} markdown
 */
export function configureDiagrams(markdown) {
  const fence = markdown.renderer.rules.fence;
  markdown.renderer.rules.fence = (...args) => {
    const [tokens, index] = args;
    const token = tokens[index];
    if (token.info.trim() !== "mermaid") {
      return fence(...args);
    }
    const source = markdown.utils.escapeHtml(JSON.stringify(token.content));
    return `<MermaidDiagram :source="${source}" />\n`;
  };
}
