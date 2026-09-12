import { spawn } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGUSR1"];
const COMMANDS = [
  {
    name: "extract",
    file: "extract.js",
    description:
      "Convert original assets incrementally; --full forces conversion.",
    usage:
      "[--full] [--assets DIR] [--map ID | --maps ID,ID] [--cache-dir DIR] [--preflight-report FILE]",
  },
  {
    name: "preflight",
    file: "preflight.js",
    description: "Check the selected original-world dependency closure.",
    usage:
      "[--assets DIR] [--map ID | --maps ID,ID] [--server-reference DIR] [--report FILE]",
  },
  {
    name: "scenario",
    file: "native-scenarios.js",
    description:
      "List or run native browser scenarios, or replay saved inputs.",
    usage:
      "[list | all | NAME...] [--list] [--rerun FILE] [--url URL] [--output DIR] [--chrome PATH] [--browserWSEndpoint URL] [--concurrency 1..4] [--headed]",
  },
  {
    name: "smoothness",
    file: "movement-smoothness.js",
    description:
      "Measure presented player motion in the offline or online client.",
    usage:
      "[--mode offline|online] [--url URL] [--account NAME] [--password VALUE] [--seconds N] [--key CODE] [--output DIR] [--chrome PATH] [--headed]",
  },
  {
    name: "smoke",
    file: "smoke.js",
    description: "Own the incremental rebuild/browser loop; SIGUSR1 reruns it.",
    usage:
      "[--once] [--scenarios NAME,NAME] [--concurrency 1..4] [--port PORT] [--url URL] [--output DIR] [--chrome PATH] [--assets DIR] [--server-reference DIR]",
  },
  {
    name: "scan",
    file: "scan.js",
    description: "Inventory and checksum original archive metadata.",
    usage: "[--assets DIR] [--archives Map,Character,UI]",
  },
  {
    name: "data server",
    file: "server-data.js",
    description: "Convert authorized server-reference SQL and script metadata.",
    usage: "--output DIR [--server-root DIR]",
  },
  {
    name: "audit skills",
    file: "skill-report.js",
    description: "Report packaged skill coverage for a scene and profile.",
    usage: "CATALOG.json MAP.json|default REPORT.json [PROFILE.json]",
  },
  {
    name: "audit origins",
    file: "inspect-origins.js",
    description:
      "Inspect original NPC and background origins for selected maps.",
    usage: "SOURCE MAP_ID[,MAP_ID...] OUTPUT.json",
  },
  {
    name: "audit worldmap",
    file: "worldmap-data.js",
    description: "Inspect authored world-map metadata from original assets.",
    usage: "ORIGINAL_ASSET_DIRECTORY",
  },
  {
    name: "validate",
    file: "validate.js",
    description: "Run the explicit broad browser world/physics oracle.",
    usage:
      "[--url URL] [--chrome PATH] [--duration SECONDS] [--maps ID,ID] [--output DIR] [--headed]",
  },
];

/** Print bounded command metadata without importing or starting any tool. */
function printHelp(command = null, group = "") {
  if (command) {
    console.log(`Usage: bun tools/openms.js ${command.name} ${command.usage}`);
    console.log(`\n${command.description}`);
    console.log(
      "Options and positional arguments are passed unchanged to the existing tool.",
    );
    return;
  }
  console.log(`Usage: bun tools/openms.js ${group || "<command>"} [arguments]`);
  console.log("\nCommands:");
  for (const entry of COMMANDS) {
    if (!group || entry.name.startsWith(`${group} `)) {
      console.log(`  ${entry.name.padEnd(17)} ${entry.description}`);
    }
  }
  console.log("\nHelp: --help, help <command>, or <command> --help.");
  console.log(
    "Tool arguments are forwarded unchanged; paths are relative to the repository root.",
  );
  console.log(
    "SIGINT/SIGTERM/SIGHUP stop the active tool; SIGUSR1 is forwarded for smoke reruns.",
  );
}

/** Forward a parent-only signal while the tool owns its own cleanup. */
function forwardSignal(child, signal) {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

/** Resolve ordinary exit status or preserve a child's terminating signal. */
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

/** Run one allowlisted implementation with inherited terminal I/O and environment. */
async function runTool(command, args) {
  const child = spawn(
    process.execPath,
    [`client/tools/${command.file}`, ...args],
    {
      cwd: ROOT,
      stdio: "inherit",
      // Only the wrapper receives terminal group signals, avoiding duplicate delivery.
      detached: process.platform !== "win32",
    },
  );
  const handlers = SIGNALS.map((signal) =>
    forwardSignal.bind(null, child, signal),
  );
  for (let index = 0; index < SIGNALS.length; index++) {
    process.on(SIGNALS[index], handlers[index]);
  }
  let result;
  try {
    result = await waitForExit(child);
  } finally {
    for (let index = 0; index < SIGNALS.length; index++) {
      process.off(SIGNALS[index], handlers[index]);
    }
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 128 + constants.signals[result.signal];
  }
  return result.code;
}

function isHelp(value) {
  return value === "--help" || value === "-h";
}

/** Inspect only the allowlisted command prefix; leave tool parsing to its owner. */
async function main(args) {
  if (!args.length || isHelp(args[0])) {
    printHelp();
    return 0;
  }
  const help = args[0] === "help";
  if (help) args = args.slice(1);
  const group = ["audit", "data"].includes(args[0]) ? args[0] : "";
  const count = group ? 2 : 1;
  if (args.length < count || isHelp(args[count - 1])) {
    printHelp(null, group);
    return 0;
  }
  const name = args.slice(0, count).join(" ");
  const command = COMMANDS.find((entry) => entry.name === name);
  if (!command) {
    console.error(`Unknown command: ${name}. Run bun tools/openms.js --help.`);
    return 2;
  }
  const forwarded = args.slice(count);
  if (help || forwarded.some(isHelp)) {
    printHelp(command);
    return 0;
  }
  return runTool(command, forwarded);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`openms: ${error.message}`);
  process.exitCode = 1;
}
