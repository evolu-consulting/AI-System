// CR-116 · cr116-db-reliable · vòng thử lại DÙNG CHUNG của withScope / withHubScope / withPackScope / withPackJobScope.
// - 40P01/40001: Postgres đã rollback cả tx ⇒ chạy lại ngay (kể cả khi lỗi đến lúc COMMIT).
// - Mất kết nối (CONNECTION_CLOSED/ECONNRESET/EPIPE/57P01-03/08xxx) khi `fn` CHƯA xong ⇒ tx chưa tới COMMIT, server đã
//   rollback ⇒ chạy lại sau backoff ngắn (pool nối lại). Mất kết nối khi `fn` ĐÃ xong (đang/sau COMMIT) ⇒ không biết đã
//   commit hay chưa ⇒ KHÔNG chạy lại mù, ném `TxOutcomeError` (code TX_OUTCOME_UNKNOWN); đường idempotent tự đọc lại.
// Tối đa SCOPE_MAX_ATTEMPTS lần; mỗi lần thử lại một dòng log kv qua `setTxRetryObserver`.
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import type { Db } from "./client";

// Kiểu Tx khai báo lại ở đây (không import scope.ts ⇒ không vòng import).
type Tx = Parameters<Parameters<Db["db"]["transaction"]>[0]>[0];

export const SCOPE_MAX_ATTEMPTS = 3;
export const TX_OUTCOME_UNKNOWN = "TX_OUTCOME_UNKNOWN";

export function sqlState(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

const SERIAL = new Set(["40P01", "40001"]);
const CONN_LOST = new Set([
  "CONNECTION_CLOSED", // postgres.js: socket đóng khi còn câu chạy / tx đang giữ
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "EPIPE",
  "57P01", // admin_shutdown (pg_terminate_backend)
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

/** `retry` = chạy lại an toàn; `unknown` = có thể đã commit; `fatal` = ném nguyên lỗi. */
export type TxErrorClass = "serial" | "conn-retry" | "unknown" | "fatal";

/** `bodyDone`: callback của tx đã trả về (lỗi đến lúc COMMIT hoặc sau đó). */
export function classifyTxError(err: unknown, bodyDone: boolean): TxErrorClass {
  const s = sqlState(err);
  if (!s) return "fatal";
  if (SERIAL.has(s)) return "serial";
  if (CONN_LOST.has(s) || s.startsWith("08")) return bodyDone ? "unknown" : "conn-retry";
  return "fatal";
}

/** Mất kết nối lúc/sau COMMIT: kết quả không biết. `cause` = lỗi gốc của driver. */
export class TxOutcomeError extends Error {
  readonly code = TX_OUTCOME_UNKNOWN;
  constructor(override readonly cause: unknown) {
    super(`transaction outcome unknown (connection lost at commit: ${sqlState(cause) ?? "?"})`);
    this.name = "TxOutcomeError";
  }
}

export type TxRetryEvent = {
  reason: "serial" | "conn-retry" | "unknown" | "exhausted";
  code: string;
  attempt: number;
  backoffMs: number;
};
const defaultObserver = (e: TxRetryEvent): void => {
  if (Bun.env.NODE_ENV === "test") return;
  console.warn(
    `level=warn msg=db.tx.retry reason=${e.reason} code=${e.code} attempt=${e.attempt} backoff_ms=${e.backoffMs}`,
  );
};
let observer: (e: TxRetryEvent) => void = defaultObserver;

/** Thay nơi nhận sự kiện thử lại (logger app / metric / test). Trả hàm khôi phục. */
export function setTxRetryObserver(fn: (e: TxRetryEvent) => void): () => void {
  const prev = observer;
  observer = fn;
  return () => {
    observer = prev;
  };
}

/** Backoff mất kết nối: 20 ms, 80 ms (+ jitter ≤ 50%) — đủ cho pool nối lại, không kéo dài request. */
export const connBackoffMs = (attempt: number): number => {
  const base = 20 * 4 ** (attempt - 1);
  return Math.round(base + Math.random() * base * 0.5);
};

/** Sau một lần thử hỏng: ném (lỗi gốc / TxOutcomeError) hoặc trả số ms chờ trước lần thử kế. */
function afterFailure(err: unknown, bodyDone: boolean, attempt: number): number {
  const k = classifyTxError(err, bodyDone);
  if (k === "fatal") throw err;
  const code = sqlState(err) ?? "?";
  if (k === "unknown") {
    observer({ reason: "unknown", code, attempt, backoffMs: 0 });
    throw new TxOutcomeError(err);
  }
  if (attempt >= SCOPE_MAX_ATTEMPTS) {
    observer({ reason: "exhausted", code, attempt, backoffMs: 0 });
    throw err;
  }
  const backoffMs = k === "conn-retry" ? connBackoffMs(attempt) : 0;
  observer({ reason: k, code, attempt, backoffMs });
  return backoffMs;
}

/** Chạy `body` trong `db.db.transaction` với chính sách thử lại ở trên. */
export async function runTx<T>(
  db: Db,
  body: (tx: Tx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let bodyDone = false;
    try {
      return await db.db.transaction(async (tx) => {
        const r = await body(tx);
        bodyDone = true;
        return r;
      }, config);
    } catch (err) {
      const backoffMs = afterFailure(err, bodyDone, attempt);
      // Backoff giữa hai lần thử (pool nối lại), không phải chờ trạng thái (Luật 4c).
      if (backoffMs) await Bun.sleep(backoffMs);
    }
  }
}
