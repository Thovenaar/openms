import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDiagnosticJSON } from "../../src/development/game-diagnostics.js";
import { clickLabel, TIMEOUT } from "./native.js";

/** Browser download events observe the native Game Logs Blob export, never replace it. */
export async function exportDump(page, output) {
  const directory = join(output, "native-download");
  await mkdir(directory, { recursive: true });
  const session = await page.browser().target().createCDPSession();
  const downloads = new Map();
  let timer;
  let begin;
  let progress;
  const finished = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Native diagnostic download timed out")),
      TIMEOUT,
    );
    begin = (event) => downloads.set(event.guid, event.suggestedFilename);
    progress = (event) => {
      if (event.state === "canceled") {
        reject(new Error("Native diagnostic download cancelled"));
      }
      if (event.state === "completed" && downloads.has(event.guid)) {
        resolve(event.guid);
      }
    };
    session.on("Browser.downloadWillBegin", begin);
    session.on("Browser.downloadProgress", progress);
  });
  // Register rejection before the native click so a failed UI action cannot leak a rejected task.
  const observed = finished.then(
    (guid) => ({ guid }),
    (error) => ({ error }),
  );
  try {
    await session.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: directory,
      eventsEnabled: true,
      browserContextId: page.browserContext().id,
    });
    await clickLabel(
      page,
      "Export JSON",
      '.maple-ui-panel[aria-label="Game Logs"]',
    );
    const result = await observed;
    if (result.error) {
      throw new Error(
        `${result.error.message}; Game Logs: ${await logStatus(page)}`,
        {
          cause: result.error,
        },
      );
    }
    const path = join(directory, result.guid);
    const text = await readFile(path, "utf8");
    return { path, dump: parseDiagnosticJSON(text) };
  } finally {
    clearTimeout(timer);
    session.off("Browser.downloadWillBegin", begin);
    session.off("Browser.downloadProgress", progress);
    await session.detach();
  }
}

/** A readonly IDB transaction proves replay did not publish into the isolated durable save. */
export async function durableRecords(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("maple-offline-save");
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          request.transaction.abort();
          reject(
            new Error("Expected canonical fixture database does not exist"),
          );
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["profiles", "accountStorage"],
            "readonly",
          );
          const profiles = transaction.objectStore("profiles").getAll();
          const account = transaction.objectStore("accountStorage").getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve({
              profiles: profiles.result,
              accountStorage: account.result,
            });
          };
          transaction.onabort = transaction.onerror = () => {
            database.close();
            reject(
              transaction.error ||
                new Error("Diagnostic readonly transaction failed"),
            );
          };
        };
      }),
  );
}

export async function logStatus(page) {
  return page.$eval(
    '.maple-ui-panel[aria-label="Game Logs"] [role="status"]',
    (element) => element.textContent,
  );
}

export async function importDump(page, path) {
  const input = await page.$(
    '[aria-label="Import local game diagnostic JSON"]',
  );
  if (!input) throw new Error("Native Game Logs file input is unavailable");
  await input.uploadFile(path);
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.maple-ui-panel[aria-label="Game Logs"] [role="status"]',
        )
        ?.textContent.includes("Validated local dump"),
    { timeout: TIMEOUT },
  );
  await input.dispose();
}
