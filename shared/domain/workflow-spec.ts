/**
 * Pure TypeScript Canonical JSON and SHA-256 Hashing.
 *
 * PERMANENT RULE: Zero Node built-ins (no node:crypto, fs, path).
 * Zero React dependencies. 100% portable across Browser and Server.
 */

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/**
 * Standard FIPS 180-4 SHA-256 implementation in pure TypeScript.
 * Takes a UTF-8 string, returns a 64-character lowercase hex digest.
 */
export function pureSha256(ascii: string): string {
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = "";
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, boolean> = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = true;
      hash[primeCounter] = ((candidate ** 0.5 % 1) * maxWord) | 0;
      k[primeCounter++] = ((candidate ** (1 / 3) % 1) * maxWord) | 0;
    }
  }

  hash = hash.slice(0, 8);
  ascii += "\x80";
  while ((ascii.length % 64) !== 56) ascii += "\x00";

  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - (i % 4)) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength | 0;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = [...hash];

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const a = hash[0];
      const e = hash[4];
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & hash[5]) ^ (~e & hash[6]);
      const temp1 = (hash[7] + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (S0 + maj) | 0;

      hash = [
        (temp1 + temp2) | 0,
        a,
        hash[1],
        hash[2],
        (hash[3] + temp1) | 0,
        e,
        hash[5],
        hash[6],
      ];
    }

    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }

  return result;
}

/**
 * Canonically stringifies any JSON-serializable value.
 * Recursively sorts all object keys alphabetically so that key order is completely irrelevant.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeJson).join(",") + "]";
  }

  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();

  const keyValues: string[] = [];
  for (const key of sortedKeys) {
    const val = record[key];
    if (val !== undefined) {
      keyValues.push(`${JSON.stringify(key)}:${canonicalizeJson(val)}`);
    }
  }

  return "{" + keyValues.join(",") + "}";
}

/**
 * Computes the deterministic content hash for a WorkflowSpec.
 * Excludes content_hash itself if present on the input object.
 */
export function computeWorkflowSpecHash(spec: Record<string, unknown>): string {
  const { content_hash: _omit, ...rest } = spec;
  const canonical = canonicalizeJson(rest);
  return `sha256:${pureSha256(canonical)}`;
}
