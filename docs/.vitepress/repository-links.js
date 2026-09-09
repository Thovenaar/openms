import { statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = resolve(docsRoot, "..");
const repositoryUrl = "https://github.com/tensorfish/maple-mono";

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
  if (inDocs && [".md", ".html"].includes(extension)) return href;
  const status = statSync(target, { throwIfNoEntry: false });
  if (!status) {
    if (inDocs && extension === "") return href;
    throw new Error(`Missing documentation link target: ${href} (${target})`);
  }
  if (inDocs && status.isDirectory()) {
    const index = statSync(resolve(target, "index.md"), {
      throwIfNoEntry: false,
    });
    if (index?.isFile()) return href;
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
  const source = state.env.path;
  if (typeof source !== "string") {
    throw new Error("Repository links require the Markdown source path");
  }
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
