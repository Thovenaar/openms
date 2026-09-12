export const POW_MIN_BITS = 8;
export const POW_MAX_BITS = 24;

export function powMessage(challengeId, nonce) {
  return `${challengeId}.${nonce}`;
}

/** Count the most-significant zero bits in a digest without allocating. */
export function leadingZeroBits(bytes) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) bits += 8;
    else return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export function satisfiesProofOfWork(bytes, bits) {
  return leadingZeroBits(bytes) >= bits;
}

export function validPowNonce(nonce) {
  return typeof nonce === "string" && /^[0-9]{1,10}$/.test(nonce);
}

export function validChallengeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id);
}
