// HD-NFR-02 · m-13 · đếm bước nhảy chỉ trên kết nối của request (tách khỏi hd1.ts cho đủ cỡ file). Không chứa `it(...)`.
import { type CtxN1, countHops as countHopsAll } from "../../N1/_support/n1";
import type { HubPa } from "../../P-a/_support/pa";
import { hubActivity } from "../../P-d/d1/_count";

// biome-ignore lint/suspicious/noExplicitAny: pool postgres.js của Hub, truy qua thuộc tính nội bộ
type Json = any;
type PoolOpts = {
  debug?: (conn: number, q: string, params: unknown[], ...rest: unknown[]) => void;
};
const TX_CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\('app\.scope'|select b\.oid, b\.typarray from pg_catalog\.pg_type|select "(hub_)?config_version" from "(admin|hub)"\."config_meta")/i;
// ---------- đếm bước nhảy chỉ trên kết nối của request (m-13) ----------
// Pool Hub dùng chung: lượt nạp lại cấu hình admin (NOTIFY `config_changed`) chạy NỀN trên kết nối khác và có thể chồng vào
// cửa sổ đếm ⇒ thấy dư câu. Đếm riêng các câu của giao dịch request (từ `set_config('app.scope'…)` tới commit/rollback trên
// CÙNG kết nối); câu nạp cấu hình nền nằm ngoài khoảng đó nên không tính. Redis/HTTP giữ nguyên số của `countHopsAll`.
const SCOPE_Q = /^\s*select set_config\('role'/i;
const END_Q = /^\s*(commit|rollback)\b/i;
export async function countHops<R>(
  c: CtxN1,
  fn: () => Promise<R>,
  externalOrigins: string[] = [],
): Promise<Awaited<ReturnType<typeof countHopsAll<R>>>> {
  hubActivity(c.hub as unknown as HubPa);
  const opts = ((c.hub.db as Json)?.db?.$client as Json)?.options as PoolOpts | undefined;
  if (!opts) throw new Error("không thấy pool postgres.js của Hub (hub.db.db.$client.options)");
  const prev = opts.debug;
  const log: { conn: number; q: string }[] = [];
  opts.debug = (conn, q, params, ...rest) => {
    if (typeof prev === "function") prev(conn, q, params, ...rest);
    log.push({ conn, q });
  };
  let h: Awaited<ReturnType<typeof countHopsAll<R>>>;
  try {
    h = await countHopsAll(c, fn, externalOrigins);
  } finally {
    opts.debug = prev;
  }
  const mine: string[] = [];
  const open = new Set<number>();
  for (const { conn, q } of log) {
    if (SCOPE_Q.test(q)) {
      open.add(conn);
      mine.push(q.replace(/\s+/g, " ").slice(0, 160));
    } else if (open.has(conn)) {
      if (END_Q.test(q)) open.delete(conn);
      else if (!TX_CTL.test(q)) mine.push(q.replace(/\s+/g, " ").slice(0, 160));
    }
  }
  return { ...h, sql: mine.length, queries: mine };
}
