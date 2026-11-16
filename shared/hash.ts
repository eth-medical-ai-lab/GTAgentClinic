/** FNV-1a, 32-bit: a small, stable string hash (case brief ids, content versions) */
export function fnv1a(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
