import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Process-local, 64-character tokens: 8-byte expiry, 16-byte entropy, 24-byte MAC. */
export class SignedTokens {
  constructor() {
    this.key = randomBytes(32);
  }

  mac(payload, owner) {
    return createHmac("sha256", this.key)
      .update(owner)
      .update("\0")
      .update(payload)
      .digest()
      .subarray(0, 24);
  }

  issue(owner, expiresAt) {
    const payload = randomBytes(24);
    payload.writeBigUInt64BE(BigInt(expiresAt));
    return Buffer.concat([payload, this.mac(payload, owner)]).toString(
      "base64url",
    );
  }

  read(token, owner, now = Date.now()) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(token)) {
      return null;
    }
    const bytes = Buffer.from(token, "base64url");
    const payload = bytes.subarray(0, 24);
    if (!timingSafeEqual(bytes.subarray(24), this.mac(payload, owner))) {
      return null;
    }
    const expiresAt = Number(payload.readBigUInt64BE());
    return Number.isSafeInteger(expiresAt) && expiresAt > now
      ? expiresAt
      : null;
  }

  csrf(token) {
    return this.mac(Buffer.from(token), "csrf").toString("base64url");
  }
}
