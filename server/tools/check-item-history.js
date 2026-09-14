import { SQL } from "bun";
import { parseFlags } from "../../client/tools/source-options.js";
import { readItemHistory } from "../src/database-history.js";

function databaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--database-url must name a PostgreSQL database");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2 ||
    url.hash
  ) {
    throw new Error("--database-url must name a PostgreSQL database");
  }
  return url.href;
}

function historyOptions(args) {
  const values = parseFlags(args, {
    "database-url": { type: "string" },
    item: { type: "string" },
    limit: { type: "string", default: "32" },
    before: { type: "string" },
    help: { type: "boolean", default: false },
  });
  if (values.help) return { help: true };
  const limit = Number(values.limit);
  const before = values.before === undefined ? null : Number(values.before);
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) {
    throw new Error("--limit must be an integer in 1..128");
  }
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
    throw new Error("--before must be a positive sequence number");
  }
  return {
    databaseUrl: databaseUrl(values["database-url"]),
    uid: values.item,
    limit,
    before,
  };
}

if (import.meta.main) {
  try {
    const options = historyOptions(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: bun server/tools/check-item-history.js --database-url URL --item UID [--limit N] [--before SEQ]\nPrints the append-only provenance trail for one item instance, newest first. Read-only; it applies no ownership policy.",
      );
    } else {
      const sql = new SQL(options.databaseUrl, {
        max: 1,
        connectionTimeout: 10,
        idleTimeout: 5,
      });
      try {
        const trail = await readItemHistory(sql, {
          uid: options.uid,
          limit: options.limit,
          before: options.before,
        });
        console.log(JSON.stringify(trail, null, 2));
      } finally {
        await sql.close({ timeout: 5 });
      }
    }
  } catch (error) {
    console.error(error.message || error.code);
    process.exitCode = 1;
  }
}
