import { buildOnlineBrowser } from "./browser-build.js";
import { logPrefix } from "../../shared/development-log.js";

function log(message) {
  console.log(`${logPrefix("client")} ${message}`);
}

const build = await buildOnlineBrowser({
  development: false,
  progress: log,
});
log(
  `Production online bundle ${build.sourceBuildId}: ${build.outputs.length} bundles; site ${build.deployment.directory}; development sidebar omitted`,
);
log(
  "Deploy site with the existing client/public/generated tree mounted at /generated/ and the matching authoritative server at /api/. Exact roots, resource hashes and HTTP requirements: site/deployment.json.",
);
