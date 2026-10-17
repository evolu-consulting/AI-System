// HUB-FR-112 · HUB-FR-115 · CR-093 · plan-addendum A10 · PD-P15: đếm câu SQL Hub gửi trong khoảng gọi một vòng nền.
// Cách đếm: pool postgres.js của Hub (`hub.db.db.$client`, `Db` từ `connectDb` — drizzle trên postgres.js) có
// `options.debug(connId, query, params, types)` được gọi cho MỌI câu gửi đi ⇒ gắn hàm ghi tạm trong khoảng `fn()` rồi gỡ.
// Bỏ câu điều khiển giao dịch (BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE) và câu đặt phạm vi RLS đầu tx
// (`select set_config('app.scope', …)` — hạ tầng scope, không phải câu của lô), câu nội bộ postgres.js nạp kiểu mảng
// (`pg_catalog.pg_type`, một lần mỗi pool). Không chứa `it`.
import type { HubPa } from "../../P-a/_support/pa";
import type { Json } from "../_support/pd";

const TX_CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\('app\.scope'|select b\.oid, b\.typarray from pg_catalog\.pg_type)/i;

/** Gọi `fn` và trả các câu SQL (trừ điều khiển giao dịch) mà pool DB của `hub` gửi trong lúc đó. */
export async function countQueries<R>(
  hub: HubPa,
  fn: () => Promise<R>,
): Promise<{ n: number; queries: string[]; r: R }> {
  const opts = ((hub.db as Json)?.db?.$client as Json)?.options as Json;
  if (!opts) throw new Error("không thấy pool postgres.js của Hub (hub.db.db.$client.options)");
  const prev = opts.debug;
  const queries: string[] = [];
  opts.debug = (_conn: number, q: string) => {
    if (!TX_CTL.test(q)) queries.push(q.replace(/\s+/g, " ").slice(0, 160));
  };
  try {
    const r = await fn();
    return { n: queries.length, queries, r };
  } finally {
    opts.debug = prev;
  }
}
