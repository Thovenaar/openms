import { buildOnlineBrowser } from "./browser-build.js";

const build = await buildOnlineBrowser({
  development: false,
  progress: console.log,
});
console.log(
  `Production online bundle ${build.sourceBuildId}: ${build.outputs.length} bundles; site ${build.deployment.directory}; development mutation UI omitted`,
);
console.log(
  "Deploy site with the existing client/public/generated tree mounted at /generated/ and the matching authoritative server at /api/. Exact roots, resource hashes and HTTP requirements: site/deployment.json.",
);
