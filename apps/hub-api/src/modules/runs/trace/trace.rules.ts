// HUB-FR-52 · H3b-R17/R18 · quyền xem trace và che `detail` (plan H3b §4.3).
import type { Role } from "@ai/contracts";
import { MASK } from "@ai/contracts/hub-admin";

/** H3b-R17 · quyết TRƯỚC khi mở scope system. `ownRun` = đã tìm thấy run bằng scope user {tid, sub}. */
export function traceAccess(
  user: { role: Role },
  ownRun: boolean,
): "own" | "platform" | "not_found" {
  if (ownRun) return "own";
  // tenant_admin cũng not_found (Q-U2): trace run người khác chỉ platform_admin xem.
  return user.role === "platform_admin" ? "platform" : "not_found";
}

/** `token(?!s)` (PL16) giữ nguyên `input_tokens`/`output_tokens`. */
export const SENSITIVE_KEY_RE =
  /(api[_-]?key|secret|token(?!s)|password|passwd|authorization|cookie|credential|private[_-]?key)/i;
export const SENSITIVE_VALUE_RE =
  /(^bearer\s+\S+|\bapp-[A-Za-z0-9]{16,}|\bsk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

/**
 * H3b-R18 · bản sao đã che: khoá khớp SENSITIVE_KEY_RE → MASK; chuỗi khớp SENSITIVE_VALUE_RE → MASK; sâu > 6 → MASK;
 * JSON > 16 KiB → {truncated: true}; view `own` bỏ khoá gốc `message`, `upstream` (PL15).
 */
export function redactTraceDetail(
  detail: unknown,
  view: "own" | "platform",
): Record<string, unknown> | null {
  if (detail === null || typeof detail !== "object") return null;
  // Thứ tự PL15: bỏ khoá → che → đo (đo sau che để khoá nhạy cảm dài không làm truncated oan).
  const root: Record<string, unknown> = Array.isArray(detail)
    ? { items: detail }
    : dropOwnKeys(detail as Record<string, unknown>, view);
  const masked = maskValue(root, 1) as Record<string, unknown>;
  return Buffer.byteLength(JSON.stringify(masked), "utf8") > MAX_DETAIL_BYTES
    ? { truncated: true }
    : masked;
}

/** PL15: gốc = mức 1; giá trị ở mức > 6 thay MASK. */
const MAX_DEPTH = 6;
/** PL15: 16 KiB UTF-8 của JSON sau khi che. */
const MAX_DETAIL_BYTES = 16_384;
/** H1 P11/R26: message thô của Runtime/upstream không ra client chủ run. */
const OWN_HIDDEN_ROOT_KEYS: ReadonlySet<string> = new Set(["message", "upstream"]);

function dropOwnKeys(
  d: Record<string, unknown>,
  view: "own" | "platform",
): Record<string, unknown> {
  if (view === "platform") return d;
  return Object.fromEntries(Object.entries(d).filter(([k]) => !OWN_HIDDEN_ROOT_KEYS.has(k)));
}

/** Bản sao mới, không sửa input. */
function maskValue(v: unknown, level: number): unknown {
  if (level > MAX_DEPTH) return MASK;
  if (typeof v === "string") return SENSITIVE_VALUE_RE.test(v) ? MASK : v;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => maskValue(x, level + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? MASK : maskValue(x, level + 1);
  }
  return out;
}

/** ms = finished − started (≥ 0), null khi chưa xong. */
export function stepMs(startedAt: Date, finishedAt: Date | null): number | null {
  if (finishedAt === null) return null;
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}
