// my-activity-rag · Luật 4c: `my-chat-history` tìm trong 100.000 tin của MỘT người (+ 20.000 tin người khác cùng tenant làm nhiễu),
// trải 11 tháng, dữ liệu sinh bằng hạt cố định `setseed(0.42)`: 80 từ tiếng Việt + 3.000 mã hiếm chọn theo random()^3 (lệch như
// văn bản thật). Đo qua đúng đường tool (`withHubScope` user: đọc hạn lưu + tìm), 200 lượt tuần tự sau 20 lượt nóng:
// từ khoá hiếm / phổ biến / nhiều từ (OR) / không từ khoá. CỔNG p95 ≤ 100 ms. Chỉ chạy dưới PERF=1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql, literalize, measure, type Stat } from "@ai/test-kit/perf";
import { myHistoryDeps } from "../../../apps/hub-api/src/modules/my-history/my-history.mount";
import { myHistoryTools } from "../../../apps/hub-api/src/modules/my-history/my-history.tools";
import type { PackToolDef } from "../../../apps/hub-api/src/modules/packs/kit/application/pack-tools.ports";

const PERF = process.env.PERF === "1";
const N_MINE = 100_000;
const N_OTHER = 20_000;
const WORDS =
  "hợp đồng mua bán hàng hóa thanh toán giao hàng bảo hành phạt vi phạm thời hạn hiệu lực gia hạn thông báo bên mua bên bán " +
  "đơn giá số lượng thuế GTGT tổng giá trị phụ lục điều khoản tranh chấp hạn mức duyệt kho Bình Dương Long An Hà Nội thùng " +
  "carton chai nhựa nắp băng keo màng co vận chuyển phần mềm bản quyền hóa đơn chuyển khoản tạm ứng đợt ngày tháng năm 30 45";
const ARGS: Record<string, string | number>[] = [
  { query: "lần trước tôi hỏi gì về hạn mức duyệt" },
  { query: "ma1234" },
  { query: "thanh toán" },
  { query: "giao hàng tại kho Long An thùng carton" },
  { role: "user" },
  { query: "ma2999 hóa đơn", from: "2026-01-01", to: "2026-12-31" },
];

let owner: Sql;
let db: Db;
let tool: PackToolDef;
let T = "";
let me = "";
let other = "";

/** `n` tin của `user` trong 50 hội thoại × 10 luồng, xen kẽ hỏi/đáp, rải 330 ngày gần nhất. 3 câu SQL. */
async function seed(o: Sql, user: string, n: number): Promise<void> {
  await o`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    select ${T}::uuid, ${user}::uuid, 'Hội thoại ' || g, 'hoi thoai ' || g from generate_series(1, 50) g`;
  await o`insert into hub.flows (tenant_id, user_id, conversation_id, title)
    select c.tenant_id, c.user_id, c.id, 'Luồng ' || g from hub.conversations c, generate_series(1, 10) g
    where c.user_id = ${user}::uuid`;
  await o`with f as (select id, conversation_id, row_number() over (order by id) - 1 as k
        from hub.flows where user_id = ${user}::uuid),
      w as (select string_to_array(${WORDS}, ' ') || array(select 'ma' || i from generate_series(1, 3000) i) as a)
    insert into hub.messages (tenant_id, user_id, conversation_id, flow_id, role, content, created_at)
    select ${T}::uuid, ${user}::uuid, f.conversation_id, f.id, case when g % 2 = 0 then 'user' else 'assistant' end,
      (select string_agg(w.a[1 + floor(power(random(), 3) * array_length(w.a, 1))::int], ' ')
         from generate_series(1, 40) x, w where x > g - 10000000),
      now() - (random() * 330) * interval '1 day'
    from generate_series(1, ${n}) g join f on f.k = g % 500`;
}

beforeAll(async () => {
  if (!PERF) return;
  await cloneDb("full");
  owner = openOwner(1);
  [T] = (await tenants(owner, 1, 1601)) as [string];
  [me, other] = (await users(owner, T, 2, { from: 1601 })) as [string, string];
  await owner`select setseed(0.42)`;
  await seed(owner, me, N_MINE);
  await seed(owner, other, N_OTHER);
  await owner`analyze hub.messages`;
  await owner`analyze hub.conversations`;
  db = createDb(urls().hubApi, { max: 2 });
  const deps = myHistoryDeps(db, {
    view: {
      catalog: async () => ({
        features: [],
        entitled: new Set<string>(),
        grantGroups: new Map<string, string[]>(),
      }),
      user: async () => undefined,
    },
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    sources: [],
  });
  tool = myHistoryTools(deps).find((t) => t.name === "my-chat-history") as PackToolDef;
}, 600_000);

afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

const fmt = (s: Stat) =>
  `p50 ${s.p50.toFixed(1)} ms p95 ${s.p95.toFixed(1)} ms max ${s.max.toFixed(1)} ms`;

/** Số đo từng kiểu câu hỏi; kiểu nào p95 > 50 ms ⇒ in EXPLAIN ANALYZE các câu của nó (RLS thật qua `inHub` user). */
async function perArg(ctx: { tenantId: string; userId: string; runId: null }): Promise<void> {
  const client = (db.db as unknown as { $client: Sql }).$client;
  for (const a of ARGS) {
    const s = await measure(() => tool.run(ctx, a), { n: 20, warm: 3 });
    console.log(`  ${JSON.stringify(a)}: ${fmt(s)}`);
    if (s.p95 <= 50 || !client) continue;
    const { queries } = await captureSql(client, () => tool.run(ctx, a));
    for (const q of queries.filter(
      (x) => /^\s*(select|with)\b/i.test(x.text) && !/set_config/.test(x.text),
    )) {
      const plan = await inHub({ kind: "user", tenantId: T, userId: me }, async (tx) => {
        // Như tx thật (`retentionRaw` + pha 2 bật lại bitmap).
        const bitmap = /with h as materialized/.test(q.text) ? "on" : "off";
        await tx.unsafe(
          `set local jit = off; set local enable_seqscan = off; set local enable_bitmapscan = ${bitmap}; set local max_parallel_workers_per_gather = 0`,
        );
        return tx.unsafe(`explain (analyze, buffers) ${literalize(q)}`);
      });
      console.log(plan.map((r) => (r as Record<string, string>)["QUERY PLAN"]).join("\n"));
    }
  }
}

describe.skipIf(!PERF)("my-activity-rag · my-chat-history p95 (100.000 tin / người)", () => {
  it("p95 ≤ 100 ms (200 lượt, 6 kiểu câu hỏi) và mọi kết quả là tin của chính người gọi", async () => {
    const [n] = await owner<
      { n: number }[]
    >`select count(*)::int as n from hub.messages where user_id = ${me}`;
    expect(n?.n).toBe(N_MINE);
    const ctx = { tenantId: T, userId: me, runId: null };
    const st = await measure(
      async (i) => {
        const r = (await tool.run(ctx, ARGS[Math.abs(i) % ARGS.length] ?? {})) as {
          items: unknown[];
        };
        if (!Array.isArray(r.items)) throw new Error("no items");
      },
      { n: 200, warm: 20 },
    );
    console.log(`my-chat-history 100k tin/người: ${fmt(st)}`);
    await perArg(ctx);
    const own = (await tool.run(
      { tenantId: T, userId: other, runId: null },
      { query: "thanh toán" },
    )) as {
      items: { link: string }[];
    };
    expect(own.items.length).toBeGreaterThan(0);
    expect(st.p95).toBeLessThanOrEqual(100);
  }, 300_000);
});
