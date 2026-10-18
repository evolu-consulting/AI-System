// HUB-FR-146 · HUB-FR-147 · CR-093 Luật 4c · plan-d2 §9 PD2-P01…P04: ngưỡng hiệu năng P-d2 + đếm câu SQL (số câu cố định, không
// phụ thuộc số tham số / số bước nhảy). Báo số thật (console). Thiếu 0012/0037/contract ⇒ đỏ NGAY ở `needD2` (không đo trên
// code vắng). Chờ tool-driver bằng `handles.settled()`; không ngủ chờ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PROCESS_STAGES_MAX } from "@ai/contracts/chat";
import { loadChat } from "../_support/modules";
import {
  agentStage,
  createDef,
  defBody,
  G1,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  noFeature,
  startRun,
  waitStageStatus,
} from "../_support/pd";
import { countQueries } from "../d1/_count";
import {
  ACME,
  type CtxD2,
  insertWorkflows,
  MA_KH_INPUT,
  needD2,
  setSwitch,
  settled,
  startD2,
  toolStage,
  WF,
} from "../d2/_d2";

let c: CtxD2;
beforeAll(async () => {
  c = await startD2({ processRunsPerTenant: 200 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};
const p95 = (xs: number[]) => pct(xs, 0.95);
/** "p50/p90/p95 ms (n=…)" để in. */
const dist = (xs: number[]) =>
  `p50=${pct(xs, 0.5).toFixed(1)} p90=${pct(xs, 0.9).toFixed(1)} p95=${p95(xs).toFixed(1)} ms (n=${xs.length})`;
/** Cỡ mẫu đo (D2-48): p95 trên n < 20 = lượt chậm nhất; n ≥ 40 ⇒ p95 là lượt chậm thứ hai. */
const N_MEASURE = 40;
/** Số lượt làm nóng = số kết nối của pool Hub (`options.max` của postgres.js) + 2 (D2-48): pool dùng xoay vòng, mỗi
 *  kết nối phải chuẩn bị xong câu (prepared statement) trước cửa sổ đo; đọc số từ pool thật, không gõ cứng. */
function warmRounds(): number {
  const max = ((c.hub.db as Json)?.db?.$client as Json)?.options?.max;
  return (typeof max === "number" && max > 0 ? max : 10) + 2;
}
async function timed(n: number, fn: (i: number) => Promise<void>): Promise<number[]> {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    ms.push(performance.now() - t0);
  }
  return ms;
}
let ready = false;
async function prep(): Promise<void> {
  await needD2(c);
  if (ready) return;
  await insertWorkflows(c.sql, c.dify.baseUrl);
  for (const w of ["W", "W20"] as const) await setSwitch(c.sql, w, ACME, true);
  ready = true;
}
let seq = 0;

describe("PD2-P01 · lưu def 10 stage / 3 tool [plan-d2 §9; trần PROCESS_STAGES_MAX = 10]", () => {
  it("HUB-FR-146 · PD2-P01 · PUT def 10 stage (3 tool) × 20 lần: p95 ≤ 50 ms và ≤ bản không tool + 5 ms; lưu def có tool = +1 câu so với không tool", async () => {
    await prep();
    const stages: Json[] = [
      agentStage({
        key: "s0",
        step: 0,
        fields: [{ key: "tong_tien", type: "number", required: true }],
      }),
    ];
    for (let i = 1; i < PROCESS_STAGES_MAX; i++)
      stages.push(
        i % 3 === 0 ? toolStage({ key: `t${i}`, step: i }) : agentStage({ key: `a${i}`, step: i }),
      );
    // Bản không tool: CÙNG số stage/bước, stage tool thay bằng agent.
    const plain = stages.map((s, i) =>
      i % 3 === 0 && i > 0 ? agentStage({ key: s.key, step: i }) : s,
    );
    const mk = async (tag: string, st: Json[]) => {
      const key = `pd2-p01${tag}-${++seq}`;
      const def = await createDef(c, defBody(key, st, { inputs: MA_KH_INPUT }));
      let version = def.version as number;
      return async () => {
        const r = await c.call("Adm", "PUT", `/process-defs/${def.id}`, {
          ...defBody(key, st, { inputs: MA_KH_INPUT }),
          version,
        });
        expect(r.status).toBe(200);
        version = r.json?.version as number;
      };
    };
    const putTool = await mk("t", stages);
    const putPlain = await mk("p", plain);
    // Làm nóng CẢ HAI bản như nhau (kết nối, plan SQL, JIT) rồi đo XEN KẼ ⇒ không lệch thứ tự.
    for (let i = 0; i < warmRounds(); i++) {
      await putTool();
      await putPlain();
    }
    const msTool: number[] = [];
    const msPlain: number[] = [];
    for (let i = 0; i < N_MEASURE; i++) {
      msTool.push(...(await timed(1, putTool)));
      msPlain.push(...(await timed(1, putPlain)));
    }
    console.log(`PD2-P01 có tool ${dist(msTool)}; không tool ${dist(msPlain)} (10 stage, 3 tool)`);
    expect(p95(msTool)).toBeLessThanOrEqual(50);
    expect(p95(msTool)).toBeLessThanOrEqual(p95(msPlain) + 5);
    const withTool = await countQueries(c.hub, putTool);
    const noTool = await countQueries(c.hub, putPlain);
    // NOTIFY `config_changed` làm Hub nạp lại cấu hình giữa cửa sổ đếm (nhiễu ±2 câu) ⇒ đếm đúng câu tra công tắc/workflow.
    const lookups = (r: { queries: string[] }) =>
      r.queries.filter((q) => q.includes("tenant_workflow_tools")).length;
    console.log(
      `PD2-P01 câu SQL: có tool=${withTool.n}, không tool=${noTool.n}; câu tra tool: ${lookups(withTool)} vs ${lookups(noTool)}`,
    );
    expect({ withTool: lookups(withTool), noTool: lookups(noTool) }).toEqual({
      withTool: 1,
      noTool: 0,
    });
  }, 60_000);
});
describe("PD2-P02 · catalog editor 200 workflow × 50 tenant [plan-d2 §9]", () => {
  it("HUB-FR-146 · PD2-P02 · 10.000 hàng công tắc ⇒ GET /process-editor/context p95 ≤ 20 ms, 2 câu SQL", async () => {
    await prep();
    const [sec] = await c.sql<
      { secret_id: string }[]
    >`select secret_id from admin.workflows where id = ${WF.W.id}`;
    await c.sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, input_schema,
        output_field, enabled)
      select gen_random_uuid(), 'p02-wf-' || g, 'WF ' || g, 'Workflow phục vụ đo hiệu năng P02', 'workflow', ${c.dify.baseUrl}, ${sec?.secret_id ?? null},
        '[]'::jsonb, 'result', true from generate_series(1, 196) g`;
    await c.sql`insert into admin.tenants (id, key, name)
      select gen_random_uuid(), 'p02-t-' || g, name from admin.tenants, generate_series(1, 48) g where id = ${ACME}`;
    await c.sql`insert into admin.tenant_workflow_tools (workflow_id, tenant_id, granted_at)
      select w.id, t.id, now() from admin.workflows w cross join admin.tenants t
      on conflict do nothing`;
    await c.sql`analyze admin.tenant_workflow_tools`;
    const get = async () => {
      const r = await c.call("Adm", "GET", "/process-editor/context");
      expect(r.status).toBe(200);
    };
    for (let i = 0; i < warmRounds(); i++) await get();
    const ms = await timed(N_MEASURE, get);
    const q = await countQueries(c.hub, get);
    console.log(`PD2-P02 ${dist(ms)} câu SQL=${q.n}`);
    expect(p95(ms)).toBeLessThanOrEqual(20);
    expect(q.n).toBe(2);
  }, 120_000);
});

/** Câu của riêng tool-driver (plan-d2 §9 "chỉ tx của driver"): từ câu `loadCall` (`executor.tool_key`) tới hết tx2
 *  (settle output + kh + join + đóng run) — trước câu đọc mô tả run cho thông báo `run_end` (`select "tenant_id",
 *  "origin_kind", …`, việc của Hub sau tx, kể cả với stage agent). Không gồm settle s0, launch, kết thúc run. */
function driverQueries(qs: string[]): number {
  const from = qs.findIndex((q) => q.includes("->>'tool_key'"));
  expect({ loadCall: from >= 0 }).toEqual({ loadCall: true });
  const rest = qs.slice(from);
  const to = rest.findIndex((q) => q.startsWith('select "tenant_id", "origin_kind"'));
  return to < 0 ? rest.length : to;
} /** Def s0 agent → s1 tool `tool_key` với `args`; chạy tới s0 xong; đếm câu SQL từ kết quả job s0 tới khi tool-driver xong. */
async function toolRun(
  tool_key: string,
  args?: Json,
): Promise<{ n: number; driver: number; ms: number; queries: string[] }> {
  const key = `pd2-p03-${++seq}`;
  await createDef(
    c,
    defBody(
      key,
      [
        agentStage({
          key: "s0",
          step: 0,
          fields: [{ key: "tong_tien", type: "number", required: true }],
        }),
        toolStage({ tool_key, args, fields: [{ key: "so_hd", type: "string", required: true }] }),
      ],
      { inputs: MA_KH_INPUT },
    ),
  );
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", text: "KH1" }] });
  const job = await nextStageJob(c, runId);
  // #110: đếm từ TRƯỚC khi s0 xong (launch stage tool có thể chạy ngay sau job) tới `settled()` ⇒ số câu không dao động.
  // p95 (T18-perf-1): phần của tool-driver = từ câu `loadCall` tới `settled()` (tx1 + invoker + tx2 + kết thúc run), không
  // gồm stream → settle s0 → launch s1 (việc Hub, không phải tool). `waitStageStatus` đã đợi `settled()`; mốc cuối ngay sau.
  let end = 0;
  const q = await countQueries(c.hub, async () => {
    await jobDone(c, job, mdOut({ tong_tien: 25_000_000 }));
    await waitStageStatus(c, runId, 0, "done");
    await settled(c);
    end = performance.now();
  });
  const load = q.queries.findIndex((s) => s.includes("->>'tool_key'"));
  const ms = end - (q.at[load] ?? end);
  await waitStageStatus(c, runId, 1, "done", 0);
  return { n: q.n, driver: driverQueries(q.queries), ms, queries: q.queries };
}

describe("PD2-P03 · một stage tool — số câu cố định [plan-d2 §9]", () => {
  it("HUB-FR-146 · PD2-P03 · 1 tham số vs 20 tham số ⇒ số câu SQL bằng nhau (driver ≤ 14 ngoài launch); s0 done → settled() p95 ≤ 60 ms", async () => {
    await prep();
    const one = await toolRun(WF.W20.key, {
      p0: { from: "field", stage_key: "s0", field: "tong_tien" },
    });
    const args20: Json = {};
    for (let i = 0; i < 20; i++)
      args20[`p${i}`] = { from: "field", stage_key: "s0", field: "tong_tien" };
    const twenty = await toolRun(WF.W20.key, args20);
    console.log(
      `PD2-P03 câu SQL cả cửa sổ: 1 tham số=${one.n}, 20 tham số=${twenty.n}; câu của driver tool: ${one.driver} vs ${twenty.driver}`,
    );
    expect(twenty.n).toBe(one.n);
    expect(twenty.driver).toBe(one.driver);
    // T18-perf-1: ≤ 14 câu NGOÀI launch (plan-d2 §9) = chỉ câu của driver tool (không so với mốc agent: cửa sổ khác nhau).
    expect(one.driver).toBeLessThanOrEqual(14);
    const ms: number[] = [];
    for (let i = 0; i < warmRounds(); i++) await toolRun(WF.W.key); // làm nóng đủ pool (D2-48)
    for (let i = 0; i < N_MEASURE; i++) ms.push((await toolRun(WF.W.key)).ms);
    console.log(`PD2-P03 ${dist(ms)} (Dify giả trả ngay)`);
    expect(p95(ms)).toBeLessThanOrEqual(60);
  }, 120_000);
});

/** Def `steps` bước (0…steps-1): s1 bước 1 rẽ nhánh `goto`; đếm câu SQL của lời gọi Đạt (join + nhánh). */
async function branchPass(
  steps: number,
  goto: number,
  tong = 25_000_000,
  withBranch = true,
): Promise<{ n: number; ms: number; post: number }> {
  const key = `pd2-p04-${++seq}`;
  const stages: Json[] = [];
  for (let i = 0; i < steps; i++)
    stages.push(
      i === 1
        ? agentStage({
            key: "s1",
            step: 1,
            fields: [{ key: "tong_tien", type: "number", required: true }],
            after: {
              kind: "review",
              group_id: G1,
              back_to_steps: [],
              branch: withBranch
                ? [{ field: "tong_tien", op: "gt", value: 20_000_000, goto_step: goto }]
                : [],
            },
          })
        : agentStage({ key: `s${i}`, step: i }),
    );
  await createDef(c, defBody(key, stages));
  const runId = await startRun(c, key);
  await jobDone(c, await nextStageJob(c, runId), mdOut()); // T19-4: s0 cần output hợp lệ + chờ `done` kẻo lấy lại job s0
  await waitStageStatus(c, runId, 0, "done");
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: tong }));
  await waitStageStatus(c, runId, 1, "waiting_review");
  await settled(c); // việc nền của job s1 (đóng run, tin, thông báo) xong HẲN trước cửa sổ đo — kẻo chen vào đếm
  const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
    and kind = 'review' and status = 'open' limit 1`;
  const t0 = performance.now();
  let post = 0;
  const q = await countQueries(c.hub, async () => {
    const r = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, { result: "pass" });
    post = performance.now() - t0;
    expect(r.status).toBe(200);
    await settled(c);
  });
  // Nhiễu nền (như P05): đọc trạng thái job của stream run chen vào cửa sổ ±1 câu ⇒ không đếm `hub.jobs`.
  const n = q.queries.filter((s) => !s.includes('from "hub"."jobs"')).length;
  return { n, ms: performance.now() - t0, post };
}

describe("PD2-P04 · nhánh +4 câu dù nhảy 1 hay 7 bước [plan-d2 §9, readiness #97]", () => {
  it("HUB-FR-147 · PD2-P04 · nhảy 1 bước vs 7 bước ⇒ số câu SQL bằng nhau; join p95 ≤ 30 ms", async () => {
    await prep();
    // T19-3: def tối đa `PROCESS_STAGES_MAX` = 10 bước ⇒ nhảy 1 (goto 3) vs nhảy 7 (goto 9).
    // Làm nóng ≥ số kết nối pool + 2 lượt (D2-48): lượt đầu của tiến trình có thêm câu khởi tạo, và mỗi kết nối pool phải
    // chuẩn bị xong câu lần đầu (xoay vòng) — không do nhánh.
    for (let i = 0; i < warmRounds(); i++) await branchPass(5, 3);
    const skip1 = await branchPass(10, 3);
    const skip7 = await branchPass(10, 9);
    console.log(`PD2-P04 câu SQL nhảy 1=${skip1.n}, nhảy 7=${skip7.n}`);
    expect(skip7.n).toBe(skip1.n);
    const ms: number[] = [];
    const post: number[] = [];
    for (let i = 0; i < N_MEASURE; i++) {
      const r = await branchPass(5, 3);
      ms.push(r.ms);
      post.push(r.post);
    }
    // Khoảng đo theo plan-d2 §9 = POST Đạt + `settled()`; in thêm riêng POST (join + nhánh) để chẩn đoán, không khẳng định.
    console.log(`PD2-P04 ${dist(ms)}; riêng POST ${dist(post)}`);
    expect(p95(ms)).toBeLessThanOrEqual(30);
  }, 120_000);
  it("HUB-FR-147 · PD2-P04 · mốc = def KHÔNG branch: khớp = mốc + 4 câu; không khớp = mốc + 1 (đọc `fields` để đánh giá, #97)", async () => {
    await prep();
    const base = await branchPass(5, 3, 25_000_000, false);
    const hit = await branchPass(5, 3);
    const miss = await branchPass(5, 3, 1000);
    console.log(`PD2-P04 câu SQL mốc=${base.n}, khớp=${hit.n}, không khớp=${miss.n}`);
    expect({ hit: hit.n - base.n, miss: miss.n - base.n }).toEqual({ hit: 4, miss: 1 });
  }, 60_000);
});

// ---------- PD2-P05 · T17b · ProcessRunSummary wait/retry theo tập (D2-32) ----------
/** Trang `n` run (def 2 stage agent); `withTimers` ⇒ mỗi run có 1 hẹn mở ở stage 0 (SQL, không chờ giờ). */
async function listPage(n: number, withTimers: boolean): Promise<{ q: number; ms: number[] }> {
  const key = `pd2-p05-${++seq}`;
  await createDef(
    c,
    defBody(key, [agentStage({ key: "s0", step: 0 }), agentStage({ key: "s1", step: 1 })]),
  );
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await startRun(c, key));
  if (withTimers)
    await c.sql`insert into hub.process_timers (tenant_id, process_run_id, stage_run_id, kind, due_at, timezone, idempotency_key)
      select r.tenant_id, r.id, s.id, 'wait_until', now() + interval '1 day', 'Asia/Ho_Chi_Minh', 'p05-' || s.id
      from hub.process_runs r join hub.stage_runs s on s.process_run_id = r.id and s.stage_idx = 0
      where r.id = any(${ids}::uuid[])`;
  const get = async () => {
    const r = await c.call("Adm", "GET", "/process-runs?scope=tenant&limit=50");
    expect(r.status).toBe(200);
  };
  for (let i = 0; i < warmRounds(); i++) await get();
  const ms = await timed(N_MEASURE, get);
  // Nhiễu nền: đọc trạng thái job của run vừa tạo (stream run, không thuộc lời gọi GET) chen vào cửa sổ đếm ±1 câu.
  const cq = await countQueries(c.hub, get);
  return { q: cq.queries.filter((s) => !s.includes('from "hub"."jobs"')).length, ms };
}

describe("PD2-P05 · danh sách run: wait/retry theo tập [plan-d2 §9, D2-32]", () => {
  it("HUB-FR-147 · PD2-P05 · trang 50 run: số câu SQL bằng nhau với 1 vs 50 run có hẹn; p95 ≤ 40 ms và ≤ không hẹn + 5 ms", async () => {
    await prep();
    const chat = (await loadChat()) as Json;
    const shape = Object.keys(chat.ProcessRunSummarySchema?.shape ?? {});
    if (!shape.some((k) => /^(wait|retry)/.test(k)))
      noFeature("ProcessRunSummary wait/retry (contract)", "T17b", "Tranh chấp T15c-2");
    const one = await listPage(50, false);
    const full = await listPage(50, true);
    console.log(
      `PD2-P05 câu SQL không hẹn=${one.q}, 50 hẹn=${full.q}; ${dist(full.ms)} (mốc p95=${p95(one.ms).toFixed(1)})`,
    );
    expect(full.q).toBe(one.q);
    expect(p95(full.ms)).toBeLessThanOrEqual(40);
    expect(p95(full.ms)).toBeLessThanOrEqual(p95(one.ms) + 5);
  }, 120_000);
});
