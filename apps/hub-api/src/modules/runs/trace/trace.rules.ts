// HUB-FR-52 · H3b-R17/R18 · quyền xem trace và che `detail` (plan H3b §4.3). Stub B0, thân ở B5.
import type { Role } from "@ai/contracts";

/** H3b-R17 · quyết TRƯỚC khi mở scope system. `ownRun` = đã tìm thấy run bằng scope user {tid, sub}. */
export function traceAccess(
  _user: { role: Role },
  _ownRun: boolean,
): "own" | "platform" | "not_found" {
  throw new Error("not implemented");
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
  _detail: unknown,
  _view: "own" | "platform",
): Record<string, unknown> | null {
  throw new Error("not implemented");
}

/** ms = finished − started (≥ 0), null khi chưa xong. */
export function stepMs(_startedAt: Date, _finishedAt: Date | null): number | null {
  throw new Error("not implemented");
}
