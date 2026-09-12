import { readFile, stat } from "node:fs/promises";
import { validateProfileRecord } from "../src/profile/profile-validation.js";
import {
  createAccountStorage,
  validateAccountStorage,
} from "../src/profile/account-storage.js";
import { HASH } from "../public/offline-manifest.js";

export const MAX_INPUT_BYTES = 2 * 1024 * 1024;

/** JSON is the replay boundary; reject oversized inputs rather than truncating them. */
export function boundedJSON(value) {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > MAX_INPUT_BYTES) {
    throw new Error("Scenario inputs exceed the 2 MiB replay limit");
  }
  return text;
}

export async function readRerun(path, names) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("Invalid or oversized rerun artifact");
  }
  const bytes = await readFile(path);
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new Error("Oversized rerun artifact");
  }
  const value = JSON.parse(bytes.toString("utf8"));
  validateRerun(value, names);
  return value;
}

function validateRerun(value, names) {
  if (
    value?.schemaVersion !== 1 ||
    !names.includes(value.scenario) ||
    value.recipe !== 1
  ) {
    throw new Error("Invalid native scenario rerun identity");
  }
  const inputs = value.inputs;
  if (
    !inputs ||
    !inputs.fixture?.record ||
    !inputs.parameters ||
    typeof inputs.parameters !== "object" ||
    Array.isArray(inputs.parameters)
  ) {
    throw new Error("Invalid native scenario rerun inputs");
  }
  validateOriginalIdentities(value.originalIdentities);
}

function validateOriginalIdentities(identities) {
  for (const key of ["sourceBuildId", "assetBuildId", "catalogSha256"]) {
    if (!HASH.test(identities?.[key] ?? "")) {
      throw new Error(`Invalid native scenario original ${key}`);
    }
  }
}

/** Validate through the production persistence boundary before opening any browser. */
export function prepareFixture(fixture, catalog) {
  boundedJSON(fixture);
  const copy = structuredClone(fixture);
  const record = copy.record ?? {
    id: "local",
    generation: crypto.randomUUID(),
    revision: 0,
    createdAt: 0,
    updatedAt: 0,
    profile: copy.profile,
  };
  if (record.id !== "local") {
    throw new Error("Scenario fixture must own only the local character");
  }
  if (
    copy.record &&
    JSON.stringify(copy.profile) !== JSON.stringify(copy.record.profile)
  ) {
    throw new Error("Rerun profile differs from its persistence envelope");
  }
  validateProfileRecord(record, catalog.ui.items);
  const accountStorage = copy.accountStorage ?? createAccountStorage();
  validateAccountStorage(accountStorage, record.profile, catalog.ui.items);
  return { ...copy, profile: record.profile, accountStorage, record };
}

/** Execute only in a blank intercepted document in a newly owned BrowserContext. */
function seedDatabase(fixture) {
  if (window.maple || document.scripts.length !== 0) {
    throw new Error("Fixture seeding requires a stopped page");
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("maple-offline-save", 2);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Fixture database is blocked"));
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("profiles", { keyPath: "id" });
      database.createObjectStore("accountStorage", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(
        ["profiles", "accountStorage"],
        "readwrite",
      );
      const profiles = transaction.objectStore("profiles");
      const accounts = transaction.objectStore("accountStorage");
      const count = profiles.count();
      count.onsuccess = () => {
        if (count.result !== 0) return transaction.abort();
        profiles.add(fixture.record);
        accounts.add(fixture.accountStorage);
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        reject(
          transaction.error ??
            new Error("Nonempty or invalid fixture database"),
        );
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

export async function seedFixture(page, url, fixture) {
  await page.setRequestInterception(true);
  const interceptionErrors = [];
  const stopDocument = (request) => {
    const result =
      request.isNavigationRequest() && request.frame() === page.mainFrame()
        ? request.respond({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Native fixture preparation</title>",
          })
        : request.abort();
    result.catch((error) => interceptionErrors.push(error.message));
  };
  page.on("request", stopDocument);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.evaluate(seedDatabase, fixture);
    if (interceptionErrors.length) {
      throw new Error(
        `Fixture interception failed: ${interceptionErrors.join("; ")}`,
      );
    }
  } finally {
    page.off("request", stopDocument);
    await page.setRequestInterception(false);
  }
}
