// HUB-FR-146 · HUB-FR-147 · CR-093 Luật 4c · plan-d2 §9 PD2-P01…P04: ngưỡng hiệu năng P-d2 + đếm câu SQL (số câu cố định, không
// phụ thuộc số tham số / số bước nhảy). Báo số thật (console). Thiếu 0012/0037/contract ⇒ đỏ NGAY ở `needD2` (không đo trên
// code vắng). Chờ tool-driver bằng `handles.settled()`; không ngủ chờ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  defBody,
  G1,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
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
  c = await startD2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] ?? 0;
};
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

describe("PD2-P01 · lưu def 30 stage / 10 tool [plan-d2 §9]", () => {
  it("HUB-FR-146 · PD2-P01 · PUT def 30 stage (10 tool) × 20 lần: p95 ≤ 50 ms; lưu def có tool = +1 câu so với không tool", async () => {
    await prep();
    const stages: Json[] = [
      agentStage({
        key: "s0",
        step: 0,
        fields: [{ key: "tong_tien", type: "number", required: true }],
      }),
    ];
    for (let i = 1; i < 30; i++)
      stages.push(
        i % 3 === 0 ? toolStage({ key: `t${i}`, step: i }) : agentStage({ key: `a${i}`, step: i }),
      );
    const key = `pd2-p01-${++seq}`;
    const def = await createDef(c, defBody(key, stages, { inputs: MA_KH_INPUT }));
    let version = def.version as number;
    const put = async () => {
      const r = await c.call("Adm", "PUT", `/process-defs/${def.id}`, {
        ...defBody(key, stages, { inputs: MA_KH_INPUT }),
        version,
      });
      expect(r.status).toBe(200);
      version = r.json?.version as number;
    };
    const ms = await timed(20, put);
    console.log(`PD2-P01 p95=${p95(ms).toFixed(1)} ms (n=20)`);
    expect(p95(ms)).toBeLessThanOrEqual(50);
    const withTool = await countQueries(c.hub, put);
    const noToolStages = stages.map((s, i) =>
      i % 3 === 0 && i > 0 ? agentStage({ key: s.key, step: i }) : s,
    );
    const k2 = `pd2-p01b-${++seq}`;
    const d2 = await createDef(c, defBody(k2, noToolStages, { inputs: MA_KH_INPUT }));
    const noTool = await countQueries(c.hub, () =>
      c.call("Adm", "PUT", `/process-defs/${d2.id}`, {
        ...defBody(k2, noToolStages, { inputs: MA_KH_INPUT }),
        version: d2.version,
      }),
    );
    console.log(`PD2-P01 câu SQL: có tool=${withTool.n}, không tool=${noTool.n}`);
    expect(withTool.n - noTool.n).toBe(1);
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
      select gen_random_uuid(), 'p02-wf-' || g, 'WF ' || g, '', 'workflow', ${c.dify.baseUrl}, ${sec?.secret_id ?? null},
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
    await get();
    const ms = await timed(30, get);
    const q = await countQueries(c.hub, get);
    console.log(`PD2-P02 p95=${p95(ms).toFixed(1)} ms câu SQL=${q.n}`);
    expect(p95(ms)).toBeLessThanOrEqual(20);
    expect(q.n).toBe(2);
  }, 120_000);
});

/** Def s0 agent → s1 tool `tool_key` với `args`; chạy tới s0 xong; đếm câu SQL từ kết quả job s0 tới khi tool-driver xong. */
async function toolRun(tool_key: string, args?: Json): Promise<{ n: number; ms: number }> {
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
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", value: "KH1" }] });
  const job = await nextStageJob(c, runId);
  await jobDone(c, job, mdOut({ tong_tien: 25_000_000 }));
  await waitStageStatus(c.sql, runId, 0, "done");
  const t0 = performance.now();
  const q = await countQueries(c.hub, () => settled(c));
  const ms = performance.now() - t0;
  await waitStageStatus(c.sql, runId, 1, "done", 0);
  return { n: q.n, ms };
}

describe("PD2-P03 · một stage tool — số câu cố định [plan-d2 §9]", () => {
  it("HUB-FR-146 · PD2-P03 · 1 tham số vs 20 tham số ⇒ số câu SQL bằng nhau (≤ 14 ngoài launch); phần Hub p95 ≤ 60 ms", async () => {
    await prep();
    const one = await toolRun(WF.W20.key, {
      p0: { from: "field", stage_key: "s0", field: "tong_tien" },
    });
    const args20: Json = {};
    for (let i = 0; i < 20; i++)
      args20[`p${i}`] = { from: "field", stage_key: "s0", field: "tong_tien" };
    const twenty = await toolRun(WF.W20.key, args20);
    console.log(`PD2-P03 câu SQL 1 tham số=${one.n}, 20 tham số=${twenty.n}`);
    expect(twenty.n).toBe(one.n);
    const ms: number[] = [];
    for (let i = 0; i < 10; i++) ms.push((await toolRun(WF.W.key)).ms);
    console.log(`PD2-P03 p95=${p95(ms).toFixed(1)} ms (n=10, Dify giả trả ngay)`);
    expect(p95(ms)).toBeLessThanOrEqual(60);
  }, 120_000);
});

/** Def `steps` bước (0…steps-1): s1 bước 1 rẽ nhánh `goto`; đếm câu SQL của lời gọi Đạt (join + nhánh). */
async function branchPass(
  steps: number,
  goto: number,
  tong = 25_000_000,
): Promise<{ n: number; ms: number }> {
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
              branch: [{ field: "tong_tien", op: "gt", value: 20_000_000, goto_step: goto }],
            },
          })
        : agentStage({ key: `s${i}`, step: i }),
    );
  await createDef(c, defBody(key, stages));
  const runId = await startRun(c, key);
  await jobDone(c, await nextStageJob(c, runId));
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: tong }));
  await waitStageStatus(c.sql, runId, 1, "waiting_review");
  const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
    and kind = 'review' and status = 'open' limit 1`;
  const t0 = performance.now();
  const q = await countQueries(c.hub, async () => {
    const r = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, { result: "pass" });
    expect(r.status).toBe(200);
    await settled(c);
  });
  return { n: q.n, ms: performance.now() - t0 };
}

describe("PD2-P04 · nhánh +4 câu dù nhảy 1 hay 18 bước [plan-d2 §9]", () => {
  it("HUB-FR-147 · PD2-P04 · nhảy 1 bước vs 18 bước ⇒ số câu SQL bằng nhau; join p95 ≤ 30 ms", async () => {
    await prep();
    const skip1 = await branchPass(21, 3);
    const skip18 = await branchPass(21, 20);
    console.log(`PD2-P04 câu SQL nhảy 1=${skip1.n}, nhảy 18=${skip18.n}`);
    expect(skip18.n).toBe(skip1.n);
    const ms: number[] = [];
    for (let i = 0; i < 10; i++) ms.push((await branchPass(5, 3)).ms);
    console.log(`PD2-P04 p95=${p95(ms).toFixed(1)} ms (n=10)`);
    expect(p95(ms)).toBeLessThanOrEqual(30);
  }, 120_000);
  it("HUB-FR-147 · PD2-P04 · nhánh khớp = không nhánh + 4 câu", async () => {
    await prep();
    const hit = await branchPass(5, 3);
    const miss = await branchPass(5, 3, 1000);
    console.log(`PD2-P04 câu SQL khớp=${hit.n}, không khớp=${miss.n}`);
    expect(hit.n - miss.n).toBe(4);
  }, 60_000);
});
