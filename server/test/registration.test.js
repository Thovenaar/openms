import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SessionAuthority } from "../src/auth.js";
import {
  powMessage,
  satisfiesProofOfWork,
} from "../../shared/proof-of-work.js";

function proof(challenge) {
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const digest = createHash("sha256")
      .update(powMessage(challenge.challengeId, String(nonce)))
      .digest();
    if (satisfiesProofOfWork(digest, challenge.bits)) {
      return {
        challengeId: challenge.challengeId,
        csrfToken: challenge.loginToken,
        nonce: String(nonce),
      };
    }
  }
  throw new Error("Bounded proof search exhausted");
}

test("registration signs in without map/profile dependencies and duplicate retry uses a fresh proof", async () => {
  const names = new Set(["existing"]);
  const database = {
    async registerPlayer(name, passwordHash) {
      expect(await Bun.password.verify("password", passwordHash)).toBe(true);
      if (names.has(name)) return null;
      names.add(name);
      return { id: name, name, role: "player" };
    },
  };
  const config = {
    origin: "http://127.0.0.1:3110",
    powBits: 8,
    maxSessions: 4,
    sessionMs: 60000,
  };
  const auth = new SessionAuthority(config, database);
  const bootstrap = auth.bootstrap(
    new Request(`${config.origin}/api/v1/config`),
  );
  const request = new Request(`${config.origin}/api/v1/accounts`, {
    method: "POST",
    headers: { origin: config.origin, cookie: bootstrap.cookie.split(";")[0] },
  });
  const first = proof(auth.challenge(request, "address"));
  await expect(
    auth.register(
      request,
      { name: "existing", password: "password", ...first },
      "address",
    ),
  ).rejects.toThrow("NAME_TAKEN");
  const second = proof(auth.challenge(request, "address"));
  const registered = await auth.register(
    request,
    { name: "new_account", password: "password", ...second },
    "address",
  );
  expect(registered.session.role).toBe("player");
  expect(registered.session.accountId).toBe("new_account");
  expect(auth.authWork).toBe(0);
});
