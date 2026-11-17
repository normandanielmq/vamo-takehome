/**
 * Deterministic uniform [0, 1) value derived from a string key and seed, for common random numbers.
 *
 * Uses an FNV-1a hash with a murmur-style finalizer so the same key gives the same value across policies.
 *
 * @param key - Key identifying the random event.
 * @param seed - Seed mixed into the hash.
 * @returns A uniform value in [0, 1).
 */
export function uniformFromKey(key: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Creates a seeded stream of uniforms for a key (used for the baseline's random driver choice).
 *
 * @param key - Base key; each call appends an incrementing counter.
 * @param seed - Seed mixed into the hash.
 * @returns A function returning the next uniform value on each call.
 */
export function streamFromKey(key: string, seed: number): () => number {
  let i = 0;
  return () => uniformFromKey(`${key}#${i++}`, seed);
}
