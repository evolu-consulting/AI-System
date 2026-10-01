// ADM-FR-60, ADM-FR-63, ADM-NFR-01 · đọc lỗi Postgres qua lớp bọc của Drizzle (DrizzleQueryError.cause).
// Message của DrizzleQueryError chứa câu SQL + tham số (có thể là hash/email) → không bao giờ log nguyên văn.

type PgLike = { code?: unknown; constraint_name?: unknown; message?: unknown; stack?: unknown };

function pgCause(err: unknown): PgLike | null {
  if (!err || typeof err !== "object") return null;
  const e = err as PgLike & { cause?: unknown; query?: unknown };
  if (typeof e.code === "string") return e;
  if ("query" in e && e.cause && typeof e.cause === "object") return e.cause as PgLike;
  return null;
}

/** 23505 (unique) với tên constraint/index → tên đó; khác → null. */
export function uniqueViolation(err: unknown): string | null {
  const c = pgCause(err);
  return c?.code === "23505" && typeof c.constraint_name === "string" ? c.constraint_name : null;
}

const isDrizzleWrapper = (err: unknown): boolean =>
  !!err && typeof err === "object" && "query" in (err as object);

/**
 * Trường an toàn để log: bỏ SQL/tham số của Drizzle, giữ message + SQLSTATE của Postgres. DrizzleQueryError không có
 * `cause` → chỉ "query failed" (không có cause thì cũng không có SQLSTATE), không log message/stack gốc.
 */
export function safeErrorFields(err: unknown): { error: string; code?: string; stack?: string } {
  const c = pgCause(err);
  const code = typeof c?.code === "string" ? { code: c.code } : {};
  if (!c && isDrizzleWrapper(err)) return { error: "query failed" };
  const src = c ?? (err as PgLike | null);
  const message = typeof src?.message === "string" ? src.message : String(err);
  return {
    error: message,
    ...code,
    ...(typeof src?.stack === "string" ? { stack: src.stack } : {}),
  };
}
