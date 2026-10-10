// AC-H34 · HUB-FR-117 · P4-07 ⇢PF1 (cả file; test-plan-int §5): run THẬT (PF1 `POST /process-runs` + launcher + stage-driver,
// mẫu P1-30 `p-auto` 2 stage auto) chạy xong ⇒ `GET usage` totals khớp tuyệt đối Σ usage_logs. Runtime giả `ScriptRuntime`
// trả job + ghi `usage_logs` như runtime thật (job_id, step_id từ payload, N4). Chỉ xanh khi PF1 vào `main` (cổng merge bước 4).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPa,
  defInput,
  insertDef,
  type Json,
  PA,
  PA_FIX,
  stageDef,
  T,
  waitFor,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import { startPaReal, usageSum } from "./_local";

const DOC = "## Bảng ý\nHoá đơn HD-12.\n## Số tiền\n12 000 000";
let c: CtxPa;
beforeAll(async () => {
  c = await startPaReal();
  if (!c.ready) return;
  const d = defInput({
    key: "p-auto",
    name: "Tự chạy",
    stages: [
      stageDef({ key: "a", after: { kind: "auto" } }),
      stageDef({ key: "b", name: "Tóm tắt", after: { kind: "auto" } }),
    ],
  });
  await insertDef(c.sql, { id: PA_FIX.defAuto, tenantId: T.acme, input: d });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P4-07 ⇢PF1 · token run thật [AC-H34]", () => {
  it("AC-H34 · P4-07 ⇢PF1 · p-auto chạy xong (2 stage) ⇒ usage totals.total/calls = Σ usage_logs của mọi hub.runs có process_run_id", async () => {
    needSchema(c.ready);
    const s = await c.call("A", "POST", "/process-runs", {
      process_key: "p-auto",
      input: "HD-12",
      origin: { kind: "none" },
    });
    expect(s.status).toBe(201);
    const id = s.json?.id as string;
    const done = new Set<string>();
    for (let stage = 0; stage < 2; stage++) {
      const rows = await waitFor(
        () => c.sql<Json[]>`select id, user_id from hub.runs where process_run_id = ${id}`,
        (rs) => rs.some((r) => !done.has(r.id)),
        10_000,
      );
      const hr = rows.find((r) => !done.has(r.id));
      expect(hr).toBeDefined();
      done.add(hr?.id);
      const job = await c.rt.next(hr?.id);
      const p = job.payload as Json;
      await c.sql`insert into hub.usage_logs (tenant_id, run_id, step_id, user_id, agent_id, provider_key, model, billing,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, job_id, at)
        values (${T.acme}, ${hr?.id}, ${p.step_id ?? null}, ${hr?.user_id}, ${p.agent_id ?? null}, 'fake-cli', 'claude-sonnet',
          'subscription', ${1000 + stage}, ${200 + stage}, ${stage ? 50 : null}, null, 900, ${job.id}, now())
        on conflict (job_id) where job_id is not null do nothing`;
      await c.rt.agent(job, { status: "done", text: DOC });
    }
    const st = await waitFor(
      async () =>
        (await c.sql<Json[]>`select status from hub.process_runs where id = ${id}`)[0]?.status,
      (v) => v === "done",
      15_000,
    );
    expect(st).toBe("done");
    const u = await c.call("A", "GET", `/process-runs/${id}/usage`);
    expect(u.status).toBe(200);
    const sum = await usageSum(c, id);
    expect(sum.calls).toBeGreaterThanOrEqual(2);
    expect({ total: u.json?.totals?.total, calls: u.json?.totals?.calls }).toEqual(sum);
    const owners = await c.sql<
      Json[]
    >`select distinct ul.user_id from hub.usage_logs ul join hub.runs r on r.id = ul.run_id
      where r.process_run_id = ${id}`;
    expect(owners.map((o) => o.user_id)).toEqual([PA.A.id]);
  }, 60_000);
});
