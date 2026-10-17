// AC-H43 · HUB-FR-115 · PD-R24/R25 · PD-I50…PD-I54 (test-plan-int §5; plan-contract §3 `ttl_days`): hạn run theo def
// (`null` = không hết hạn, vắng khi tạo = 7, sửa vắng = giữ, copy chép). Đỏ trước code ở `needPdSchema` (migration 0036).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  type CtxPd,
  createDef,
  DAY,
  defBody,
  G1,
  type Json,
  jobDone,
  MIN,
  needPdSchema,
  nextStageJob,
  PD_DEFS,
  runRow,
  SEC,
  startPd,
  startRun,
  sweepN,
  waitStatus,
} from "../_support/pd";
import { MD_PD } from "./_remind";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 200 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const ms = (d: Date | string | null) => (d === null ? Number.NaN : new Date(d).getTime());
const reviewStage = () =>
  agentStage({ key: "doc", step: 0, after: { kind: "review", group_id: G1, back_to_steps: [] } });
const body = (key: string, o: Json = {}) => defBody(key, [reviewStage()], o);
const getDef = (id: string) => c.call("Adm", "GET", `/process-defs/${id}`);
/** Body PUT = các trường input của def (bỏ `ttl_days` nếu `dropTtl`) + `version`. */
function putBody(d: Json, over: Json = {}, dropTtl = false): Json {
  const { key, name, description, input_hint, run_group_ids, stages, token_budget, enabled } = d;
  const b: Json = {
    key,
    name,
    description,
    input_hint,
    run_group_ids,
    stages,
    token_budget,
    enabled,
  };
  b.sources = d.sources ?? [];
  b.inputs = d.inputs ?? [];
  if (!dropTtl) b.ttl_days = d.ttl_days;
  return { ...b, ...over, version: d.version };
}
/** A start `key` ⇒ job s0 xong ⇒ `waiting_review`. */
async function toReview(key: string): Promise<string> {
  const runId = await startRun(c, key);
  await jobDone(c, await nextStageJob(c, runId), MD_PD);
  await waitStatus(c.sql, runId, "waiting_review");
  return runId;
}

describe("PD-I50, PD-I51 · hạn run theo def [AC-H43, HUB-FR-115]", () => {
  it("AC-H43 · PD-I50 · pd-ttl-null ⇒ expires_at NULL; +8 ngày sweep ⇒ vẫn waiting_review, không expired", async () => {
    needPdSchema(c.pd);
    await createDef(c, PD_DEFS.ttlNull());
    const runId = await toReview("pd-ttl-null");
    expect((await runRow(c.sql, runId)).expires_at).toBeNull();
    c.clk.advance(8 * DAY);
    await sweepN(c, 1);
    expect((await runRow(c.sql, runId)).status).toBe("waiting_review");
  }, 60_000);
  it("AC-H43 · PD-I51 · def tạo vắng ttl_days ⇒ GET ttl_days 7; expires_at = start + 7 ngày; +7 ngày 1 phút sweep ⇒ expired", async () => {
    needPdSchema(c.pd);
    const d = await createDef(c, body("pd-ttl-7"));
    const g = await getDef(d.id);
    expect({ status: g.status, ttl_days: g.json?.ttl_days }).toEqual({ status: 200, ttl_days: 7 });
    const runId = await toReview("pd-ttl-7");
    const r = await runRow(c.sql, runId);
    const gap = ms(r.expires_at) - ms(r.started_at);
    expect({ gapOk: Math.abs(gap - 7 * DAY) <= 5 * SEC, gap }).toMatchObject({ gapOk: true });
    c.clk.set(new Date(ms(r.expires_at) + MIN));
    await sweepN(c, 1);
    await waitStatus(c.sql, runId, "expired");
  }, 60_000);
});

describe("PD-I52, PD-I53 · sửa / chép def [AC-H43, PD-R24]", () => {
  it("AC-H43 · PD-I52 · run đang chờ; PUT def ttl_days 30 ⇒ expires_at của run không đổi", async () => {
    needPdSchema(c.pd);
    const d = await createDef(c, body("pd-ttl-put"));
    const runId = await toReview("pd-ttl-put");
    const before = (await runRow(c.sql, runId)).expires_at;
    const put = await c.call("Adm", "PUT", `/process-defs/${d.id}`, putBody(d, { ttl_days: 30 }));
    expect({ status: put.status, ttl_days: put.json?.ttl_days }).toEqual({
      status: 200,
      ttl_days: 30,
    });
    expect(ms((await runRow(c.sql, runId)).expires_at)).toBe(ms(before));
  }, 60_000);
  it("AC-H43 · PD-I53 · def ttl 30: PUT vắng ttl_days ⇒ giữ 30; PUT null ⇒ null; copy mẫu ttl 30 ⇒ bản sao 30", async () => {
    needPdSchema(c.pd);
    const d = await createDef(c, body("pd-ttl-30", { ttl_days: 30 }));
    expect(d.ttl_days).toBe(30);
    const p1 = await c.call("Adm", "PUT", `/process-defs/${d.id}`, putBody(d, {}, true));
    expect({ status: p1.status, ttl_days: p1.json?.ttl_days }).toEqual({
      status: 200,
      ttl_days: 30,
    });
    expect((await getDef(d.id)).json?.ttl_days).toBe(30);
    const p2 = await c.call(
      "Adm",
      "PUT",
      `/process-defs/${d.id}`,
      putBody(p1.json, { ttl_days: null }),
    );
    expect({ status: p2.status, ttl_days: p2.json?.ttl_days }).toEqual({
      status: 200,
      ttl_days: null,
    });
    // mẫu platform (tenant NULL) ttl 30 ⇒ chép sang acme
    const tpl = "a5d10000-0000-4000-8000-000000000530";
    const stages = [
      agentStage({
        key: "doc",
        step: 0,
        after: { kind: "review", group_id: null, back_to_steps: [] },
      }),
    ];
    await c.sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, stages, token_budget,
        enabled, version, ttl_days)
      values (${tpl}, null, 'pd-ttl-tpl', 'Mẫu hạn 30 ngày', '', 'Mã hồ sơ', ${c.sql.json(stages)}, null, true, 1, 30)`;
    const cp = await c.call("Adm", "POST", `/process-defs/${tpl}/copy`, { key: "pd-ttl-copy" });
    expect({ status: cp.status, ttl_days: cp.json?.ttl_days }).toEqual({
      status: 201,
      ttl_days: 30,
    });
  });
});

describe("PD-I54 · ttl_days ngoài miền [AC-H43, PD-R25]", () => {
  it("AC-H43 · PD-I54 · ttl_days 0 / 366 / 1.5 ⇒ 400 VALIDATION_ERROR", async () => {
    needPdSchema(c.pd);
    for (const [i, ttl] of [0, 366, 1.5].entries()) {
      const r = await c.call(
        "Adm",
        "POST",
        "/process-defs",
        body(`pd-ttl-bad-${i}`, { ttl_days: ttl }),
      );
      expect({ ttl, status: r.status, code: r.json?.error?.code }).toEqual({
        ttl,
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
  });
});
