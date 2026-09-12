import { createHash, randomBytes } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import {
  powMessage,
  satisfiesProofOfWork,
  validPowNonce,
  validChallengeId,
} from "../../shared/proof-of-work.js";

export const POW_TTL_MS = 120000;
const MAX_CHALLENGES = 4096;

/** Only the bounded challenge map is stateful; proof hashing never performs password work. */
export class ProofOfWorkAuthority {
  constructor(bits) {
    this.bits = bits;
    this.challenges = new Map();
  }

  prune(now) {
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
  }

  issue(owner, now = Date.now()) {
    this.prune(now);
    if (this.challenges.size >= MAX_CHALLENGES) {
      throw protocolError("SERVER_BUSY");
    }
    const challengeId = randomBytes(24).toString("base64url");
    const challenge = {
      challengeId,
      bits: this.bits,
      expiresAt: now + POW_TTL_MS,
    };
    this.challenges.set(challengeId, { ...challenge, owner });
    return challenge;
  }

  consume(owner, proof, now = Date.now()) {
    const challenge = this.challenges.get(proof.challengeId);
    this.challenges.delete(proof.challengeId);
    if (
      !validChallengeId(proof.challengeId) ||
      !validPowNonce(proof.nonce) ||
      !challenge
    ) {
      throw protocolError("POW_INVALID");
    }
    if (challenge.owner !== owner || challenge.expiresAt <= now) {
      throw protocolError("POW_INVALID");
    }
    const digest = createHash("sha256")
      .update(powMessage(proof.challengeId, proof.nonce))
      .digest();
    if (!satisfiesProofOfWork(digest, challenge.bits)) {
      throw protocolError("POW_INVALID");
    }
  }
}
