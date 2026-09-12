import { buildOnlineBrowser } from "./browser-build.js";

const build = await buildOnlineBrowser({
  development: false,
  progress: console.log,
});
console.log(
  `Production online bundle ${build.sourceBuildId}: ${build.outputs.length} outputs; development mutation UI omitted`,
);
