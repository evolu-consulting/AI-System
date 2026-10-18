// HUB-FR-112 · HUB-FR-115 · CR-093 · plan-addendum A10 · PD-P15: đếm câu SQL Hub gửi trong khoảng gọi một vòng nền.
// Cách đếm: pool postgres.js của Hub (`hub.db.db.$client`, `Db` từ `connectDb` — drizzle trên postgres.js) có
// `options.debug(connId, query, params, types)` được gọi cho MỌI câu gửi đi ⇒ gắn hàm ghi tạm trong khoảng `fn()` rồi gỡ.
// Bỏ câu điều khiển giao dịch (BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE) và câu đặt phạm vi RLS đầu tx
// (`select set_config('app.scope', …)` — hạ tầng scope, không phải câu của lô), câu nội bộ postgres.js nạp kiểu mảng
// (`pg_catalog.pg_type`, một lần mỗi pool). Không chứa `it`.
import type { HubPa } from "../../P-a/_support/pa";
import type { Json } from "../_support/pd";

const TX_CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\('app\.scope'|select b\.oid, b\.typarray from pg_catalog\.pg_type|select "(hub_)?config_version" from "(admin|hub)"\."config_meta")/i;

type PoolOpts = { debug?: (conn: number, q: string, ...rest: unknown[]) => void };
const poolOf = (hub: HubPa): PoolOpts => {
  const opts = ((hub.db as Json)?.db?.$client as Json)?.options as PoolOpts | undefined;
  if (!opts) throw new Error("không thấy pool postgres.js của Hub (hub.db.db.$client.options)");
  return opts;
};
/** Bộ phát sự kiện "Hub vừa gửi một câu SQL" — gắn MỘT lần vào `options.debug` của pool (giữ hàm debug cũ), để nhiều bên
 *  (đếm câu, chờ tín hiệu) cùng nghe mà không giẫm lên nhau. */
type Tap = { tick: number; sinks: Set<(q: string) => void>; waiters: (() => void)[] };
const taps = new WeakMap<object, Tap>();
function tapOf(hub: HubPa): Tap {
  const opts = poolOf(hub);
  let t = taps.get(opts);
  if (t) return t;
  const tap: Tap = { tick: 0, sinks: new Set(), waiters: [] };
  const prev = opts.debug;
  opts.debug = (conn, q, ...rest) => {
    if (typeof prev === "function") prev(conn, q, ...rest);
    tap.tick++;
    for (const s of tap.sinks) s(q);
    const ws = tap.waiters;
    tap.waiters = [];
    for (const w of ws) w();
  };
  taps.set(opts, tap);
  t = tap;
  return t;
}
/** Tín hiệu hoạt động của Hub (Luật 4c): `tick()` = số câu đã gửi; `after(n)` resolve khi có câu mới sau mốc `n`
 *  (ngay nếu đã có). Thay cho poll `setTimeout` khi chờ Hub xử lý sự kiện tới qua stream. */
export function hubActivity(hub: HubPa): { tick(): number; after(n: number): Promise<void> } {
  const tap = tapOf(hub);
  return {
    tick: () => tap.tick,
    after: (n) =>
      tap.tick > n ? Promise.resolve() : new Promise<void>((r) => void tap.waiters.push(r)),
  };
}

/** Gọi `fn` và trả các câu SQL (trừ điều khiển giao dịch) mà pool DB của `hub` gửi trong lúc đó. */
export async function countQueries<R>(
  hub: HubPa,
  fn: () => Promise<R>,
): Promise<{ n: number; queries: string[]; at: number[]; r: R }> {
  const tap = tapOf(hub);
  const queries: string[] = [];
  const at: number[] = []; // `performance.now()` lúc gửi từng câu (song song với `queries`)
  const sink = (q: string) => {
    if (TX_CTL.test(q)) return;
    queries.push(q.replace(/\s+/g, " ").slice(0, 160));
    at.push(performance.now());
  };
  tap.sinks.add(sink);
  try {
    const r = await fn();
    return { n: queries.length, queries, at, r };
  } finally {
    tap.sinks.delete(sink);
  }
}
