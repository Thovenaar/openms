import { statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { documentationRoute } from "../.vitepress/repository-links.js";
import { nav, sidebar } from "../.vitepress/navigation.js";
import { PROFILE_VERSION } from "../../client/src/profile/profile-validation.js";
import { PROTOCOL } from "../../shared/protocol.js";

const ROOT = resolve(import.meta.dir, "..");
const MAX_PAGES = 256;
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_LINKS = 4096;

function route(path) {
  return (
    "/" +
    documentationRoute(path)
      .replace(/(^|\/)index\.md$/, "$1")
      .replace(/\.md$/, "")
  );
}

function addAnchors(token, headings) {
  if (token.type !== "html_inline" && token.type !== "html_block") return;
  for (const match of token.content.matchAll(/\bid="([^"]+)"/g)) {
    headings.add(match[1]);
  }
}

/** Parsed Markdown avoids mistaking code examples for authored links/headings. */
function pageData(markdown, source, path) {
  const headings = new Set();
  const links = [];
  let diagrams = 0;
  const tokens = markdown.parse(source, { path, realPath: path });
  for (const token of tokens) {
    if (token.type === "heading_open") headings.add(token.attrGet("id"));
    if (token.type === "fence" && token.info.trim() === "mermaid") diagrams++;
    for (const child of token.children ?? []) {
      const href =
        child.type === "image" ? child.attrGet("src") : child.attrGet("href");
      if (href) links.push(href);
      addAnchors(child, headings);
    }
    // Explicit compatibility anchors are deliberate, source-authored HTML only.
    addAnchors(token, headings);
  }
  if (links.length > MAX_LINKS) {
    throw new Error(`Documentation link bound exceeded: ${path}`);
  }
  return { headings, links, diagrams };
}

async function pages(markdown) {
  const paths = [...new Bun.Glob("**/*.md").scanSync({ cwd: ROOT })].sort();
  if (paths.length > MAX_PAGES) {
    throw new Error("Documentation page bound exceeded");
  }
  const result = new Map();
  for (const path of paths) {
    const file = Bun.file(resolve(ROOT, path));
    if (file.size > MAX_PAGE_BYTES) {
      throw new Error(`Documentation byte bound exceeded: ${path}`);
    }
    result.set(
      path,
      pageData(markdown, await file.text(), resolve(ROOT, path)),
    );
  }
  return result;
}

function linkTarget(pathname, source, routes) {
  if (pathname.startsWith("/")) {
    const page = routes.get(pathname.replace(/\.html$/, ""));
    return page ? resolve(ROOT, page) : resolve(ROOT, "." + pathname);
  }
  if (!pathname) return resolve(ROOT, source);
  return resolve(ROOT, dirname(source), pathname);
}

/** Check repository targets and Markdown fragments; external URLs are not fetched. */
function checkLink(href, source, context) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return;
  const [pathname, fragment] = decodeURIComponent(href).split("#");
  const target = linkTarget(pathname.split("?")[0], source, context.routes);
  const status = statSync(target, { throwIfNoEntry: false });
  if (!status) {
    context.failures.push({ source, href, error: "missing target" });
    return;
  }
  const page = context.pages.get(relative(ROOT, target));
  if (fragment && page && !page.headings.has(fragment)) {
    context.failures.push({ source, href, error: "missing heading" });
  }
}

/** Check both navigation trees, including nested sections and page anchors. */
function checkNavigation(context) {
  const pending = [...nav, ...sidebar];
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > MAX_LINKS) {
      throw new Error("Documentation navigation bound exceeded");
    }
    const item = pending[index];
    if (item.link) checkLink(item.link, ".vitepress/navigation.js", context);
    for (const child of item.items ?? []) {
      if (pending.length >= MAX_LINKS) {
        throw new Error("Documentation navigation bound exceeded");
      }
      pending.push(child);
    }
  }
}

async function check() {
  const markdown = await createMarkdownRenderer(ROOT);
  const documents = await pages(markdown);
  const context = {
    pages: documents,
    routes: new Map([...documents.keys()].map((path) => [route(path), path])),
    failures: [],
  };
  let linkCount = 0;
  let diagrams = 0;
  for (const [source, page] of documents) {
    diagrams += page.diagrams;
    linkCount += page.links.length;
    for (const link of page.links) checkLink(link, source, context);
  }
  checkNavigation(context);
  disposeMdItInstance();
  const workspace = await Bun.file(resolve(ROOT, "../package.json")).json();
  console.log(
    JSON.stringify(
      {
        pages: documents.size,
        links: linkCount,
        diagrams,
        facts: {
          profileVersion: PROFILE_VERSION,
          motionTickMs: PROTOCOL.TICK_MS,
          commands: Object.keys(workspace.scripts),
        },
        failures: context.failures,
      },
      null,
      2,
    ),
  );
  if (context.failures.length) process.exitCode = 1;
}

await check();
