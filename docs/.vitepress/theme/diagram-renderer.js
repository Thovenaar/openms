const MAX_DIAGRAM_CHARACTERS = 20000;

/** Theme-owned queue: Mermaid has shared configuration, so renders serialize.
 * Each request is local and bounded; strict mode disallows diagram click actions.
 */
export function createDiagramRenderer() {
  let pending = Promise.resolve();
  let engine = null;
  let sequence = 0;
  async function render(source, dark) {
    if (source.length > MAX_DIAGRAM_CHARACTERS) {
      throw new Error("Diagram exceeds 20,000 characters");
    }
    engine ??= (await import("mermaid")).default;
    engine.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      theme: "base",
      fontFamily: "Arial, sans-serif",
      themeVariables: {
        darkMode: dark,
        fontSize: "14px",
        primaryColor: dark ? "#203b2c" : "#e8f4ec",
        primaryTextColor: dark ? "#d7eddf" : "#193b26",
        primaryBorderColor: dark ? "#73bd8d" : "#4f8d65",
        lineColor: dark ? "#aebbb4" : "#68776e",
        secondaryColor: dark ? "#293a35" : "#f0f5f2",
        tertiaryColor: dark ? "#293a35" : "#f0f5f2",
      },
      maxTextSize: MAX_DIAGRAM_CHARACTERS,
      maxEdges: 200,
      suppressErrorRendering: true,
      flowchart: { useMaxWidth: true, wrappingWidth: 180, rankSpacing: 32 },
    });
    const { svg } = await engine.render(`docs-diagram-${++sequence}`, source);
    return svg;
  }
  return {
    render(source, dark) {
      const result = pending.then(() => render(source, dark));
      // A failed diagram is reported by its component and cannot block later pages.
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
