// HUB-FR-69 · H4a-R09 · 409 VERSION_CONFLICT → `{current, updated_at}` (plan-frontend §10 E6: `current` = bản đầy đủ mới nhất).
// Đọc theo cấu trúc (không import ApiError) để component/hook dùng chung không phụ thuộc lib/http.
export type ConflictInfo<T extends { version: number }> = { current: T; updatedAt: string };

export function parseConflict<T extends { version: number }>(err: unknown): ConflictInfo<T> | null {
  const e = err as { code?: unknown; details?: unknown } | null;
  if (e?.code !== "VERSION_CONFLICT") return null;
  const d = e.details as
    | { current?: { version?: unknown }; updated_at?: unknown }
    | null
    | undefined;
  if (!d?.current || typeof d.current.version !== "number") return null;
  return {
    current: d.current as T,
    updatedAt: typeof d.updated_at === "string" ? d.updated_at : "",
  };
}
