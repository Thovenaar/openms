import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  leadingZeroBits,
  satisfiesProofOfWork,
  validPowNonce,
  validChallengeId,
  powMessage,
} from "../../shared/proof-of-work.js";
import { ProofOfWorkAuthority, POW_TTL_MS } from "../src/proof-of-work.js";
import { SessionAuthority } from "../src/auth.js";

function solve(challenge) {
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const value = String(nonce);
    const digest = createHash("sha256")
      .update(powMessage(challenge.challengeId, value))
      .digest();
    if (satisfiesProofOfWork(digest, challenge.bits)) return value;
  }
  throw new Error("Proof search bound exceeded");
}

const owner = "login-cookie-address";

test("proof difficulty compares the exact most-significant bit boundary", () => {
  const digest = Uint8Array.of(0, 0, 0x10, 0xff);
  expect(leadingZeroBits(digest)).toBe(19);
  expect(satisfiesProofOfWork(digest, 19)).toBe(true);
  expect(satisfiesProofOfWork(digest, 20)).toBe(false);
  expect(leadingZeroBits(new Uint8Array(32))).toBe(256);
  expect(leadingZeroBits(Uint8Array.of(0x80))).toBe(0);
});

test("nonce and challenge grammars reject coercion and ambiguous malformed values", () => {
  for (const nonce of [0, null, "", "-1", "1.0", "1e2", "12345678901", "1\n"]) {
    expect(validPowNonce(nonce)).toBe(false);
  }
  expect(validPowNonce("9999999999")).toBe(true);
  for (const id of [
    null,
    16,
    "a".repeat(15),
    "a".repeat(65),
    "abcdefghijklmnop.",
    "abcdefghijklmnop\n",
  ]) {
    expect(validChallengeId(id)).toBe(false);
  }
  expect(validChallengeId("a_b-cdefghijklmnop")).toBe(true);
  expect(powMessage("abcdefghijklmnop", "001")).toBe("abcdefghijklmnop.001");
});

test("a valid challenge proof succeeds exactly once", () => {
  const authority = new ProofOfWorkAuthority(8);
  const challenge = authority.issue(owner, 1000);
  const proof = { challengeId: challenge.challengeId, nonce: solve(challenge) };
  authority.consume(owner, proof, 1001);
  expect(() => authority.consume(owner, proof, 1002)).toThrow("POW_INVALID");
});

test("verified proof capacity is bounded, rejects replays and becomes available after expiry", () => {
  const authority = new ProofOfWorkAuthority(8);
  for (let index = 0; index < 4096; index++) {
    const challenge = authority.issue(owner, 1000);
    authority.consume(
      owner,
      { challengeId: challenge.challengeId, nonce: solve(challenge) },
      1001,
    );
  }
  const challenge = authority.issue(owner, 1000);
  expect(() =>
    authority.consume(
      owner,
      { challengeId: challenge.challengeId, nonce: solve(challenge) },
      1001,
    ),
  ).toThrow("SERVER_BUSY");
  expect(authority.consumed.size).toBe(4096);
  const fresh = authority.issue(owner, 1000 + POW_TTL_MS);
  const proof = { challengeId: fresh.challengeId, nonce: solve(fresh) };
  authority.consume(owner, proof, 1001 + POW_TTL_MS);
  expect(authority.consumed.size).toBe(1);
  expect(() => authority.consume(owner, proof, 1002 + POW_TTL_MS)).toThrow(
    "POW_INVALID",
  );
});

test("expired and unknown challenges expose the same invalid proof result", () => {
  const authority = new ProofOfWorkAuthority(8);
  const challenge = authority.issue(owner, 1000);
  const proof = { challengeId: challenge.challengeId, nonce: solve(challenge) };
  expect(() => authority.consume(owner, proof, 1000 + POW_TTL_MS)).toThrow(
    "POW_INVALID",
  );
  expect(() =>
    authority.consume(
      owner,
      { challengeId: "abcdefghijklmnop", nonce: "0" },
      1001,
    ),
  ).toThrow("POW_INVALID");
});

test("malformed proofs cannot reserve memory or invalidate another browser challenge", () => {
  const authority = new ProofOfWorkAuthority(8);
  for (const invalid of [
    { owner, nonce: "-1" },
    { owner: "another-owner", nonce: null },
  ]) {
    const challenge = authority.issue(owner, 1000);
    const proof = {
      challengeId: challenge.challengeId,
      nonce: solve(challenge),
    };
    const consumed = authority.consumed.size;
    expect(() =>
      authority.consume(
        invalid.owner,
        { ...proof, nonce: invalid.nonce ?? proof.nonce },
        1001,
      ),
    ).toThrow("POW_INVALID");
    expect(authority.consumed.size).toBe(consumed);
    authority.consume(owner, proof, 1002);
  }
});

test("unsolved challenge flooding leaves issuance available and cannot consume proofs", () => {
  const authority = new ProofOfWorkAuthority(8);
  const challenge = authority.issue(owner, 1000);
  const valid = solve(challenge);
  let invalid = "0";
  for (let nonce = 0; nonce < 1000000; nonce++) {
    invalid = String(nonce);
    const digest = createHash("sha256")
      .update(powMessage(challenge.challengeId, invalid))
      .digest();
    if (!satisfiesProofOfWork(digest, challenge.bits)) break;
  }
  expect(() =>
    authority.consume(
      owner,
      { challengeId: challenge.challengeId, nonce: invalid },
      1001,
    ),
  ).toThrow("POW_INVALID");
  expect(authority.consumed.size).toBe(0);
  authority.consume(
    owner,
    { challengeId: challenge.challengeId, nonce: valid },
    1002,
  );
  for (let index = 0; index < 5000; index++) authority.issue(owner, 1000);
  expect(authority.issue(owner, 1001).expiresAt).toBe(1001 + POW_TTL_MS);
  expect(authority.consumed.size).toBe(1);
});

test("same-origin browser challenge GET needs its cookie but not an Origin header", () => {
  const config = {
    origin: "http://127.0.0.1:3102",
    powBits: 8,
    secureCookie: false,
  };
  const auth = new SessionAuthority(config, null);
  const bootstrap = auth.bootstrap(
    new Request(`${config.origin}/api/v1/config`),
  );
  const cookie = bootstrap.cookie.split(";")[0];
  const request = new Request(`${config.origin}/api/v1/challenge`, {
    headers: { Cookie: cookie },
  });
  const challenge = auth.challenge(request, "127.0.0.1");
  expect(validChallengeId(challenge.challengeId)).toBe(true);
  expect(() => auth.challenge(new Request(request.url), "127.0.0.1")).toThrow(
    "NOT_ALLOWED",
  );
  expect(() =>
    auth.challenge(
      new Request(request.url, {
        headers: { Cookie: cookie, Origin: "https://other.example" },
      }),
      "127.0.0.1",
    ),
  ).toThrow("NOT_ALLOWED");
  const body = {
    name: "example",
    password: "example-password",
    csrfToken: challenge.loginToken,
    challengeId: challenge.challengeId,
    nonce: solve(challenge),
  };
  expect(() =>
    auth.admitLogin(
      new Request(`${config.origin}/api/v1/session`, {
        method: "POST",
        headers: { Cookie: cookie },
      }),
      body,
      "127.0.0.1",
    ),
  ).toThrow("NOT_ALLOWED");
});

test("a challenge binds login CSRF to the shared cookie after concurrent bootstraps", async () => {
  const config = {
    origin: "http://127.0.0.1:3102",
    powBits: 8,
    maxSessions: 4,
    sessionMs: 60000,
  };
  const password = "example-password";
  const account = {
    id: "account",
    role: "player",
    passwordHash: await Bun.password.hash(password),
  };
  const auth = new SessionAuthority(config, {
    async accountByName(name) {
      return name === "example" ? account : null;
    },
  });
  // Both initial requests leave without a cookie; the later response owns the cookie jar.
  const initial = new Request(`${config.origin}/api/v1/config`);
  const firstTab = auth.bootstrap(initial);
  const secondTab = auth.bootstrap(initial);
  const cookie = secondTab.cookie.split(";")[0];
  const challengeRequest = new Request(`${config.origin}/api/v1/challenge`, {
    headers: { Cookie: cookie },
  });
  const loginRequest = new Request(`${config.origin}/api/v1/session`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: config.origin },
  });
  const stale = auth.challenge(challengeRequest, "127.0.0.1");
  const body = {
    name: "example",
    password,
    csrfToken: firstTab.loginToken,
    challengeId: stale.challengeId,
    nonce: solve(stale),
  };
  await expect(auth.login(loginRequest, body, "127.0.0.1")).rejects.toThrow(
    "NOT_ALLOWED",
  );
  body.csrfToken = stale.loginToken;
  await expect(auth.login(loginRequest, body, "127.0.0.1")).rejects.toThrow(
    "POW_INVALID",
  );
  const fresh = auth.challenge(challengeRequest, "127.0.0.1");
  const result = await auth.login(
    loginRequest,
    {
      ...body,
      csrfToken: fresh.loginToken,
      challengeId: fresh.challengeId,
      nonce: solve(fresh),
    },
    "127.0.0.1",
  );
  const authenticated = new Request(`${config.origin}/api/v1/characters`, {
    headers: { Cookie: result.cookie.split(";")[0] },
  });
  expect(auth.session(authenticated).accountId).toBe(account.id);
});

test("anonymous bootstrap and proxy-shared challenge traffic cannot exhaust issuance", () => {
  const config = {
    origin: "http://localhost:3102",
    maxSessions: 4,
    sessionMs: 60000,
    powBits: 8,
  };
  const auth = new SessionAuthority(config, null);
  for (let index = 0; index < 5000; index++) {
    const bootstrap = auth.bootstrap(
      new Request(`${config.origin}/api/v1/config`),
    );
    const request = new Request(`${config.origin}/api/v1/challenge`, {
      headers: { Cookie: bootstrap.cookie.split(";")[0] },
    });
    expect(auth.challenge(request, "proxy").bits).toBe(8);
  }
  const issued = auth.issueSession({ id: "account", role: "player" });
  expect(
    auth.bootstrap(
      new Request(`${config.origin}/api/v1/config`, {
        headers: { Cookie: issued.cookie.split(";")[0] },
      }),
    ).csrfToken,
  ).toBe(issued.session.csrfToken);
  expect(auth.rates.size).toBe(0);
  expect(auth.proofs.consumed.size).toBe(0);
});

test("signed login cookies reject tampering and restart without leaking token comparisons", () => {
  const auth = new SessionAuthority(
    { origin: "http://localhost:3102", maxSessions: 4, sessionMs: 60000 },
    null,
  );
  const issued = auth.issueLoginNonce();
  const request = (id) =>
    new Request("http://localhost:3102", {
      headers: { Cookie: `openms_login=${id}` },
    });
  expect(auth.loginNonce(request(issued.id)).csrfToken).toBe(issued.csrfToken);
  const tampered = `${issued.id[0] === "A" ? "B" : "A"}${issued.id.slice(1)}`;
  expect(auth.loginNonce(request(tampered))).toBeNull();
  expect(
    new SessionAuthority(auth.config, null).loginNonce(request(issued.id)),
  ).toBeNull();
  const session = auth.issueSession({ id: "a", role: "player" }).session;
  expect(() =>
    auth.csrf(session, "é".repeat(session.csrfToken.length)),
  ).toThrow("NOT_ALLOWED");
});
