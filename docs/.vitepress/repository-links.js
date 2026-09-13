import { statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = resolve(docsRoot, "..");
export const repositoryUrl = "https://github.com/tensorfish/openms";

/** Publish client/server sections without moving retained Markdown or evidence.
 * @param {string} path Markdown path relative to docs/.
 */
export function documentationRoute(path) {
  if (path === "README.md") return "client/index.md";
  if (path === "index.md" || /^(client|server|archive)\//.test(path)) {
    return path;
  }
  return `client/${path}`;
}

/** @param {string} target Absolute Markdown source. @param {string} suffix */
function pageHref(target, suffix) {
  const source = relative(docsRoot, target).split(sep).join("/");
  const path = documentationRoute(source)
    .replace(/(^|\/)index\.md$/, "$1")
    .replace(/\.md$/, "");
  return `/${path.split("/").map(encodeURIComponent).join("/")}${suffix}`;
}

/** Resolve source-style Markdown links before converting their public routes.
 * @param {string} target Absolute candidate source.
 */
function markdownTarget(target) {
  const extension = extname(target);
  if (extension === ".md") return target;
  if (extension !== ".html" && extension !== "") return null;
  const path = `${target.slice(0, target.length - extension.length)}.md`;
  return statSync(path, { throwIfNoEntry: false })?.isFile() ? path : null;
}

/** @param {string} directory @param {string} target */
function isInside(directory, target) {
  const path = relative(directory, target);
  return path !== ".." && !path.startsWith(`..${sep}`);
}

/**
 * Preserve site routes; publish existing evidence/source targets at their exact
 * repository paths instead of copying large archives into the generated site.
 * @param {string} href Markdown destination, including any query or fragment.
 * @param {string} source Absolute path of the Markdown source document.
 * @returns {string} Original site URL or checked GitHub blob/tree URL.
 */
function repositoryHref(href, source) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(href)) return href;
  if (typeof source !== "string") {
    throw new Error(
      "Relative repository links require the Markdown source path",
    );
  }
  const suffixIndex = href.search(/[?#]/);
  const pathname = suffixIndex < 0 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? "" : href.slice(suffixIndex);
  const decoded = decodeURIComponent(pathname);
  const target = decoded.startsWith("/")
    ? resolve(docsRoot, `.${decoded}`)
    : resolve(dirname(source), decoded);
  return targetHref(target, href, suffix);
}

/**
 * @param {string} target Absolute local target.
 * @param {string} href Original portable Markdown destination.
 * @param {string} suffix Original query and fragment.
 */
function targetHref(target, href, suffix) {
  const inDocs = isInside(docsRoot, target);
  const extension = extname(target);
  if (inDocs) {
    const page = markdownTarget(target);
    if (page) return pageHref(page, suffix);
  }
  const status = statSync(target, { throwIfNoEntry: false });
  if (!status) {
    if (inDocs && extension === "") return href;
    throw new Error(`Missing documentation link target: ${href} (${target})`);
  }
  if (inDocs && status.isDirectory()) {
    const path = resolve(target, "index.md");
    const index = statSync(path, { throwIfNoEntry: false });
    if (index?.isFile()) return pageHref(path, suffix);
  }
  if (!isInside(repositoryRoot, target)) {
    throw new Error(`Documentation link leaves the repository: ${href}`);
  }
  const kind = status.isDirectory() ? "tree" : "blob";
  const encodedPath = relative(repositoryRoot, target)
    .split(sep)
    .map(encodeURIComponent)
    .join("/");
  return `${repositoryUrl}/${kind}/main/${encodedPath}${suffix}`;
}

/**
 * Rewrite inline link tokens before VitePress records its internal dead links.
 * Images are untouched and use VitePress's standard relative-asset pipeline.
 * Iteration is bounded by the parsed block and inline token collections.
 * @param {Parameters<import('vitepress').MarkdownRenderer['core']['process']>[0]} state
 */
function adaptRepositoryLinks(state) {
  const source = state.env.realPath ?? state.env.path;
  for (const block of state.tokens) {
    if (!block.children) continue;
    for (const token of block.children) {
      if (token.type !== "link_open") continue;
      const href = token.attrGet("href");
      if (href) token.attrSet("href", repositoryHref(href, source));
    }
  }
}

/** @param {import('vitepress').MarkdownRenderer} markdown */
export function configureRepositoryLinks(markdown) {
  markdown.core.ruler.after("inline", "repository-links", adaptRepositoryLinks);
}
