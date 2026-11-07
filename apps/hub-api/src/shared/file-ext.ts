// Rule thuan tach duoi file (arch-a7: la chung, khong import module).
const EXT_RE = /^[\p{L}\p{N}]{1,10}$/u;

/** `.` cuối ở vị trí > 0, sau là 1–10 chữ/số Unicode → `{stem, ext}`; khác → `{stem: name, ext: null}`. */
export function splitExt(name: string): { stem: string; ext: string | null } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: null };
  const ext = name.slice(dot + 1);
  if (!EXT_RE.test(ext)) return { stem: name, ext: null };
  return { stem: name.slice(0, dot), ext };
}
