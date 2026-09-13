import { createHash } from "node:crypto";
import { SignedTokens } from "./signed-token.js";
import { protocolError } from "../../shared/protocol.js";
import {
  powMessage,
  satisfiesProofOfWork,
  validPowNonce,
  validChallengeId,
} from "../../shared/proof-of-work.js";

export const POW_TTL_MS = 120000;
const MAX_CONSUMED_PROOFS = 4096;

/** Issuance is stateless; only verified proofs occupy the bounded replay cache. */
export class ProofOfWorkAuthority {
  constructor(bits) {
    this.bits = bits;
    this.tokens = new SignedTokens();
    this.consumed = new Map();
  }

  prune(now) {
    for (const [id, expiresAt] of this.consumed) {
      if (expiresAt <= now) this.consumed.delete(id);
    }
  }

  issue(owner, now = Date.now(), deadline = now + POW_TTL_MS) {
    const expiresAt = Math.min(deadline, now + POW_TTL_MS);
    return {
      challengeId: this.tokens.issue(owner, expiresAt),
      bits: this.bits,
      expiresAt,
    };
  }

  consume(owner, proof, now = Date.now()) {
    const expiresAt = this.tokens.read(proof.challengeId, owner, now);
    if (
      !validChallengeId(proof.challengeId) ||
      !validPowNonce(proof.nonce) ||
      !expiresAt ||
      this.consumed.has(proof.challengeId)
    ) {
      throw protocolError("POW_INVALID");
    }
    const digest = createHash("sha256")
      .update(powMessage(proof.challengeId, proof.nonce))
      .digest();
    if (!satisfiesProofOfWork(digest, this.bits)) {
      throw protocolError("POW_INVALID");
    }
    this.prune(now);
    if (this.consumed.size >= MAX_CONSUMED_PROOFS) {
      throw protocolError("SERVER_BUSY");
    }
    this.consumed.set(proof.challengeId, expiresAt);
  }
}
