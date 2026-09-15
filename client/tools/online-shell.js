/** Remove development chrome from the deployed shell, retaining native error reporting. */
export async function onlineShell(html, development) {
  if (development) return html;
  const response = new HTMLRewriter()
    .on("#console-access, #gm-console", {
      element(element) {
        element.remove();
      },
    })
    .on("main", {
      element(element) {
        element.append(
          '<div hidden><p id="ui-status" role="status"></p>' +
            '<textarea id="error" aria-label="Game error records"></textarea></div>',
          { html: true },
        );
      },
    })
    .transform(new Response(html));
  return response.text();
}
