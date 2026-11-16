/** Deterministic uniform(0,1) from a string key, for common random numbers. */
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

/** A seeded stream of uniforms for a key (used for the baseline's random driver choice). */
export function streamFromKey(key: string, seed: number): () => number {
  let i = 0;
  return () => uniformFromKey(`${key}#${i++}`, seed);
}
