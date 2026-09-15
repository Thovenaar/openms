import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { localChat, localCast } from "./local-feedback.js";
import { downloadDetails, portalTravel } from "./online-downloads.js";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, ready } from "./online-ui-repairs.js";
import { login } from "./online-recycling-scrolls.js";

/** Native cast → published skill visual → resident effect artwork and started skill voice. */
export async function runSkillEffect({ browser, url, output, network }) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    errors: [],
    results: [],
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await measureStage(report.timings, "identity", () =>
      onlineIdentity(url, ["000050000"]),
    );
    const page = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "login", () =>
      login(page, url, "caster"),
    );
    await measureStage(report.timings, "chat", () =>
      localChat(page, network, report),
    );
    await measureStage(report.timings, "cast", () =>
      localCast(page, network, output, report),
    );
    await measureStage(report.timings, "downloads", () =>
      downloadDetails(page, output, report),
    );
    await measureStage(report.timings, "portal", () =>
      portalTravel(page, output, report, report.identity.maps["000050000"]),
    );
    await ready(page);
    assertion(report.errors.length === 0, "Browser errors", report.errors);
    assertion(
      (await onlineIdentity(url)).sourceBuildId ===
        report.identity.sourceBuildId,
      "Source changed during check",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
    }
  } finally {
    await measureStage(report.timings, "teardown", async () => {
      for (const context of contexts) await context.close();
    });
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}
