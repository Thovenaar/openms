import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadEnvironment } from "../../shared/environment.js";
import { studioConfig } from "../tools/config.js";

test("Studio loads only its scoped settings and resolves content from the repository", () => {
  const environment = loadEnvironment("studio");
  expect(environment.STUDIO_PORT).toBe(process.env.STUDIO_PORT ?? "3103");
  expect(environment.DATABASE_URL).toBeUndefined();
  expect(environment.OPENMS_DEV_PASSWORD).toBeUndefined();
  expect(environment.ONLINE_PORT).toBeUndefined();
  const config = studioConfig(
    { port: 3198 },
    {
      STUDIO_PORT: "3103",
      OPENMS_SERVER_URL: "http://localhost:3297",
      OPENMS_CLIENT_URL: "https://game.example",
      OPENMS_CONTENT_ROOT: "fixtures/generated",
    },
  );
  expect(config.port).toBe(3198);
  expect(config.upstream).toBe("http://localhost:3297");
  expect(config.clientUrl).toBe("https://game.example");
  expect(config.contentRoot).toBe(
    resolve(import.meta.dir, "../../fixtures/generated"),
  );
});

test("Studio rejects invalid listeners and upstream/public origins", () => {
  for (const port of [0, 65536, 3.5, "invalid"]) {
    expect(() => studioConfig({ port }, {})).toThrow("STUDIO_PORT");
  }
  expect(() => studioConfig({ hostname: " " }, {})).toThrow("STUDIO_HOST");
  for (const origin of [
    "file:///tmp",
    "http://user:pass@localhost",
    "https://example.com/path",
    "https://example.com/?x=1",
    "https://example.com/#x",
  ]) {
    expect(() => studioConfig({ upstream: origin }, {})).toThrow(
      "OPENMS_SERVER_URL",
    );
    expect(() => studioConfig({ clientUrl: origin }, {})).toThrow(
      "OPENMS_CLIENT_URL",
    );
  }
});
