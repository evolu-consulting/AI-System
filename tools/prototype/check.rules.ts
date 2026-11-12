// Kiểm bản mẫu sau khi đã qua lược đồ: số màn hình và từ kỹ thuật lộ ra trong chữ người xem.
import type { Prototype } from "./schema";

export const WARN_SCREENS = 8;
export const MAX_SCREENS = 12;

const WORD = "(?<![\\p{L}\\p{N}_])(?:slot|khe|def|tenant|rls|endpoint|payload)(?![\\p{L}\\p{N}_])";
const BANNED = new RegExp(`${WORD}|(?<![\\p{L}\\p{N}_])id\\s*=`, "iu");

/** Khoá không hiển thị cho người xem (mã nội bộ, kiểu khối). */
const HIDDEN = new Set([
  "id",
  "key",
  "type",
  "kind",
  "variant",
  "status",
  "tone",
  "goto",
  "role",
  "by",
  "from",
  "to",
  "screen",
  "default",
  "danger",
  "required",
]);

export function visibleStrings(v: unknown, path = "$"): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => visibleStrings(x, `${path}[${i}]`));
  if (v && typeof v === "object")
    return Object.entries(v).flatMap(([k, x]) =>
      HIDDEN.has(k) ? [] : visibleStrings(x, `${path}.${k}`),
    );
  return [];
}

export function checkPrototype(p: Prototype): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const n = p.screens.length;
  if (n > MAX_SCREENS) errors.push(`Có ${n} màn hình, tối đa ${MAX_SCREENS}. Hãy tách bớt.`);
  else if (n > WARN_SCREENS) warnings.push(`Có ${n} màn hình (> ${WARN_SCREENS}): nên gọn lại.`);
  for (const [path, s] of visibleStrings(p)) {
    const m = BANNED.exec(s);
    if (m) errors.push(`${path}: từ kỹ thuật «${m[0]}» trong chữ người xem: "${s}"`);
  }
  return { errors, warnings };
}
