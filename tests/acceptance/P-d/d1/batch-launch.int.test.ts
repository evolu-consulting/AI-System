// CR-115 · cr115-batch-launch · AC-H41 · HUB-FR-143/144 · PD-B01..B03: bắn hẹn `retry` + kick theo LÔ (một tx
// `systemEach` + `kickMany`) phải ra ĐÚNG các hàng như đường từng hàng cũ (seam `processTimerBatch: false`) trên cùng
// fixture — flows, runs, messages, jobs, run_steps, trạng thái stage_runs/timer, cli_sessions — trừ id/thời điểm/owner;
// hàng lỗi (hội thoại không thuộc người bắt đầu ⇒ kick 404) không làm hỏng lô; 2 Hub lô quét song song ⇒ đúng 1 lần.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { HubPa } from "../../P-a/_support/pa";
import {
  type CtxPd,
  DEFS,
  type Json,
  needPdSchema,
  PA,
  SEC,
  secondHub,
  startPd,
  sweepN,
  T,
  waitFor,
} from "../_support/pd";
import { fireStats, insertDueRetries } from "./_bulk";
import { settle, sweepOn } from "./_wait";

let c: CtxPd;
let old: HubPa | undefined;
let h3: HubPa | undefined;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await old?.stop();
  await h3?.stop();
  await c?.stop();
});

const N = 6;
const BAD = 2; // chỉ số hàng lỗi trong mỗi bộ

/** N hẹn retry tới hạn của A; hàng `BAD` có hội thoại chuyển cho B (RLS ⇒ kick 404); mỗi hội thoại một `cli_sessions`. */
async function seed(
  n: number,
  bad: number | null,
): Promise<{ runIds: string[]; stageIds: string[] }> {
  await settle(c.sql);
  const now = c.clk.now();
  const r = await insertDueRetries(c.sql, {
    def: DEFS.single,
    who: PA.A,
    n,
    dueAt: new Date(now.getTime() - 60 * SEC),
    now,
  });
  const convs = await c.sql<{ id: string; conversation_id: string }[]>`select id, conversation_id
    from hub.process_runs where id = any(${c.sql.array(r.runIds, 2950)})`;
  const agent = (DEFS.single.stages[0] as Json).executor.agent_id as string;
  for (const x of convs)
    await c.sql`insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id, session_id)
      values (${x.conversation_id}, ${agent}, 'fake-cli', ${T.acme}, ${`s-${x.id}`})`;
  if (bad !== null) {
    const conv = convs.find((x) => x.id === r.runIds[bad])?.conversation_id as string;
    await c.sql`update hub.conversations set user_id = ${PA.B.id} where id = ${conv}`;
  }
  return { runIds: r.runIds, stageIds: r.stageRunIds };
}

const VOLATILE =
  /(^id$|_id$|_ids$|_at$|^owner$|^lease_until$|^traceparent$|^seq$|^last_seq$|^step_id$)/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g;
/** Bỏ id/thời điểm/owner (đệ quy), thay uuid trong chuỗi bằng `<id>`. */
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !VOLATILE.test(k))
        .map(([k, x]) => [k, norm(x)]),
    );
  return typeof v === "string" ? v.replace(UUID, "<id>").replace(ISO, "<ts>") : v;
}

/** Ảnh hàng theo run (thứ tự `input`), đã chuẩn hoá. */
async function snapshot(runIds: string[]): Promise<unknown> {
  const rows = await c.sql<Json[]>`select r.input, r.status as run_status,
      to_jsonb(s) as stage,
      (select jsonb_agg(to_jsonb(t)) from hub.process_timers t where t.stage_run_id = s.id) as timers,
      (select jsonb_agg(to_jsonb(h)) from hub.runs h where h.stage_run_id = s.id) as runs,
      (select jsonb_agg(to_jsonb(m) order by m.created_at, m.role) from hub.messages m
        where m.conversation_id = r.conversation_id) as messages,
      (select jsonb_agg(to_jsonb(f) order by f.created_at) from hub.flows f
        where f.conversation_id = r.conversation_id) as flows,
      (select jsonb_agg(to_jsonb(j)) from hub.jobs j join hub.runs h on h.id = j.run_id
        where h.stage_run_id = s.id) as jobs,
      (select jsonb_agg(to_jsonb(st)) from hub.run_steps st join hub.runs h on h.id = st.run_id
        where h.stage_run_id = s.id) as steps,
      (select count(*)::int from hub.cli_sessions cs where cs.conversation_id = r.conversation_id) as sessions
    from hub.process_runs r join hub.stage_runs s on s.process_run_id = r.id and s.stage_idx = 0
    where r.id = any(${c.sql.array(runIds, 2950)}) order by r.input`;
  return norm(rows);
}

/** Quét tới khi hẹn hết mở + đủ job (hàng lỗi không job). */
async function fireAll(sweep: () => Promise<Json>, ids: { stageIds: string[] }, jobs: number) {
  await sweep();
  return waitFor(
    () => fireStats(c.sql, ids.stageIds),
    (s) => s.open === 0 && s.jobs >= jobs,
    20_000,
  );
}

describe("CR-115 · bắn hẹn retry theo lô ⇔ từng hàng [AC-H41]", () => {
  it("AC-H41 · PD-B01 · cùng fixture: đường cũ (từng hàng) và đường lô ra cùng hàng flows/runs/messages/jobs/run_steps/stage/timer/cli_sessions (trừ id/thời điểm); hàng lỗi cô lập (PD-B03)", async () => {
    needPdSchema(c.pd);
    old = await secondHub(c, { now: c.clk.now, extraDeps: { processTimerBatch: false } });
    const hubOld = old;
    const a = await seed(N, BAD);
    const sa = await fireAll(() => sweepOn(hubOld), a, N - 1);
    expect(sa).toEqual({ fired: N, open: 0, jobs: N - 1, dupJobs: 0, noJob: 1 });
    const snapOld = await snapshot(a.runIds);
    const b = await seed(N, BAD);
    const sb = await fireAll(() => sweepN(c, 1), b, N - 1);
    expect(sb).toEqual({ fired: N, open: 0, jobs: N - 1, dupJobs: 0, noJob: 1 });
    const snapBatch = await snapshot(b.runIds);
    expect(snapBatch).toEqual(snapOld);
    // hàng lỗi: hẹn đã bắn, stage `queued` (kick 404 ⇒ chưa có hub run) — như đường cũ.
    const [badStage] = await c.sql<{ status: string }[]>`select status from hub.stage_runs
      where id = ${b.stageIds[BAD] as string}`;
    expect(badStage?.status).toBe("queued");
  }, 120_000);

  it("AC-H41 · PD-B04 · lô không lấy khoá tư vấn theo user (`hub.runs.user`): đang có tx khác giữ khoá của A, lô vẫn bắn + tạo run/job ⇒ lô không chặn chat của A", async () => {
    needPdSchema(c.pd);
    const ids = await seed(10, null);
    const st = await c.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('hub.runs.user'), hashtext(${PA.A.id}::text))`;
      const run = (async () => {
        await sweepN(c, 1);
        return waitFor(
          () => fireStats(c.sql, ids.stageIds),
          (s) => s.jobs >= 10,
          8_000,
        );
      })();
      const timeout = new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 10_000));
      return Promise.race([run, timeout]);
    });
    expect(st).toEqual({ fired: 10, open: 0, jobs: 10, dupJobs: 0, noJob: 0 });
  }, 60_000);

  it("AC-H41 · PD-B02 · 2 Hub lô quét song song 60 hẹn ⇒ 60 bắn đúng 1 lần, 60 job, 0 trùng", async () => {
    needPdSchema(c.pd);
    h3 = await secondHub(c, { now: c.clk.now, instanceId: "qc-pf1-3" });
    const other = h3;
    const ids = await seed(60, null);
    for (let i = 0; i < 2; i++) await Promise.all([sweepN(c, 1), sweepOn(other)]);
    const st = await waitFor(
      () => fireStats(c.sql, ids.stageIds),
      (s) => s.jobs >= 60,
      30_000,
    );
    expect(st).toEqual({ fired: 60, open: 0, jobs: 60, dupJobs: 0, noJob: 0 });
  }, 120_000);
});
