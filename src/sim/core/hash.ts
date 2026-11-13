/** Deterministic FNV-1a hash of a JSON-compatible value with sorted object keys. */
export function hashValue(value: unknown): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return feed('n');
    if (typeof v === 'number') return feed(`#${v}`);
    if (typeof v === 'string') return feed(`"${v}`);
    if (typeof v === 'boolean') return feed(v ? 't' : 'f');
    if (Array.isArray(v)) {
      feed('[');
      for (const x of v) walk(x);
      return feed(']');
    }
    if (ArrayBuffer.isView(v)) return walk(Array.from(v as unknown as ArrayLike<number>));
    if (typeof v === 'object') {
      feed('{');
      for (const k of Object.keys(v as object).sort()) {
        feed(k);
        walk((v as Record<string, unknown>)[k]);
      }
      return feed('}');
    }
  };
  walk(value);
  return (h >>> 0).toString(16).padStart(8, '0');
}
