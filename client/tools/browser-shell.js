import { resolve } from "node:path";

/** Derive the online field chrome from the sole authored offline shell. */
export async function onlineShell(root) {
  const counts = { title: 0, entry: 0, manifest: 0, download: 0 };
  const response = new HTMLRewriter()
    .on("title", {
      element(node) {
        counts.title++;
        node.setInnerContent("openms.dev · Online client");
      },
    })
    .on('link[rel="manifest"]', {
      element(node) {
        counts.manifest++;
        node.remove();
      },
    })
    .on("#offline-inspection", {
      element(node) {
        counts.download++;
        node.remove();
      },
    })
    .on('script[src="/dist/main.js"]', {
      element(node) {
        counts.entry++;
        node.setAttribute("src", "/dist/online/main.js");
      },
    })
    .on("head", {
      element(node) {
        node.append('<link rel="stylesheet" href="/online.css" />', {
          html: true,
        });
      },
    })
    .transform(new Response(Bun.file(resolve(root, "index.html"))));
  const html = await response.text();
  if (Object.values(counts).some((count) => count !== 1)) {
    throw new Error(
      "Authored browser shell changed; online derivation is incomplete",
    );
  }
  return html;
}
