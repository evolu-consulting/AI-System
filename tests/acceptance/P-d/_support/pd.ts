// HUB-FR-143…145 · HUB-FR-115 · P-d1 · hạ tầng int (test-plan §1–§2, test-plan-int đầu file): hub-api THẬT + launcher thật
// (`startPf1`, `processLoops:false`) + đồng hồ LỆCH (`skewClock`: thời gian vẫn chạy, `advance` cộng lệch — ca cũ dùng SQL
// `now()` không vỡ). Group G2 "Giám đốc" (H q01, H2 q02, ngoài phòng) luôn seed (bảng 0001 có sẵn). Def P-d đi QUA API
// `POST /process-defs` (đúng luật lưu + ép) ⇒ trước code đỏ ở `expect(201)`. Chèn bảng/cột 0036 CHỈ sau `needPdSchema`.
// Không chứa `it(...)`. jsonb qua `sql.json` (CONVENTIONS §2 bẫy).
import { expect } from "bun:test";
import { type Json, PA, PA_FIX, type Role, type Sql, T } from "../../P-a/_support/pa";
import {
  type CtxPf1,
  handles,
  type Job,
  P1,
  type Pf1Opts,
  runRow as runRowOf,
  startPf1,
} from "../../P-a/pf1/_local";
import { hubActivity } from "../d1/_count";

export * from "../../P-a/pf1/_local";
export { type Json, PA, PA_FIX, type Role, type Sql, T };

// ---------- chờ nhanh, thất bại nhanh (CLAUDE.md Luật 4c) ----------
// Không chờ hết giờ: đo trạng thái ngay, chỉ lặp ngắn (10 ms) ở CHỖ DUY NHẤT còn một bước bất đồng bộ thật
// (Runtime XADD kết quả job → Hub tiêu thụ stream; Hub chưa có tín hiệu "đã xử lý xong" — xem
// test-plan-addendum §4). Gặp trạng thái cuối SAI (`bad`) hoặc thiếu tính năng thì ném lỗi NGAY.
// `timeoutMs` chỉ là lưới an toàn cho lỗi treo.
const POLL_MS = 10;
/** Lỗi "chưa có tính năng" — đỏ ngay với lý do rõ (không đợi timeout). */
export function noFeature(what: string, task: string, detail = ""): never {
  throw new Error(`chưa có tính năng: ${what} (${task})${detail ? ` — ${detail}` : ""}`);
}
/** Lặp tới khi `ok(v)`; `bad(v)` trả chuỗi ⇒ ném lỗi ngay (trạng thái cuối sai, không đợi nữa). */
export async function waitFor<V>(
  fn: () => Promise<V>,
  ok: (v: V) => boolean,
  timeoutMs: number,
  bad?: (v: V) => string | null,
): Promise<V> {
  const end = Date.now() + timeoutMs;
  let v = await fn();
  for (;;) {
    if (ok(v)) return v;
    const why = bad?.(v);
    if (why) throw new Error(why);
    if (Date.now() >= end) return v;
    await new Promise((r) => setTimeout(r, POLL_MS));
    v = await fn();
  }
}
const RUN_DEAD = new Set(["cancelled", "failed", "expired", "done", "needs_decision"]);
/** Process run đã ở trạng thái cuối/dừng ⇒ không còn job mới tự đến. */
const runDead = (sql: Sql, runId: string) => async (): Promise<string | null> => {
  const st = (await runRowOf(sql, runId))?.status as string | undefined;
  return st !== undefined && RUN_DEAD.has(st) ? st : null;
};
/** Job `queued` kế của process run rồi claim; run đã dừng mà không có job ⇒ đỏ ngay. */
export async function nextStageJob(c: CtxPf1, processRunId: string, ms = 8_000): Promise<Job> {
  const dead = runDead(c.sql, processRunId);
  const row = await waitFor(
    async () =>
      (
        await c.sql<
          { run_id: string; dead?: string | null }[]
        >`select j.run_id from hub.jobs j join hub.runs r on r.id = j.run_id
          where r.process_run_id = ${processRunId} and j.status = 'queued' order by j.created_at limit 1`
      )[0] ?? { run_id: "", dead: await dead() },
    (v) => v.run_id !== "",
    ms,
    (v) => (v.dead ? `run ở "${v.dead}" và không có job queued (job kế không bao giờ tới)` : null),
  );
  expect({ queuedJob: row.run_id !== "" }).toEqual({ queuedJob: true });
  return c.rt.next(row.run_id);
}
/** Không có job `queued` NGAY SAU lời gọi đã `await` (sweep/API đồng bộ) — không ngủ chờ. */
export async function noStageJob(c: CtxPf1, processRunId: string, _ms = 0): Promise<boolean> {
  const [r] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.jobs j
    join hub.runs r on r.id = j.run_id where r.process_run_id = ${processRunId} and j.status = 'queued'`;
  return (r?.n ?? 0) === 0;
}
/** Chờ trạng thái process run; run đã ở trạng thái cuối khác ⇒ đỏ ngay. */
export async function waitStatus(sql: Sql, id: string, status: string, ms = 8_000): Promise<Json> {
  const r = await waitFor(
    () => runRowOf(sql, id),
    (v) => v?.status === status,
    ms,
    (v) =>
      v?.status && RUN_DEAD.has(v.status) && v.status !== status
        ? `run ở "${v.status}", không còn chuyển sang "${status}" — chưa có tính năng tương ứng`
        : null,
  );
  expect(r?.status).toBe(status);
  return r;
}

// ---------- điều kiện tiền đề (đỏ ngay khi thiếu tính năng) ----------
const probed = new WeakMap<object, Promise<void>>();
/** Stage `wait_until` (T8): luật lưu def phải từ chối nguồn input kiểu text bằng 422 `WAIT_INVALID`. Chưa có ⇒ Hub lưu
 *  def như stage agent thường (có job, không bao giờ `waiting_timer`) nên mọi ca chờ sẽ treo tới hết giờ. */
export function needWaitUntil(c: CtxPf1): Promise<void> {
  let p = probed.get(c);
  if (!p) {
    p = (async () => {
      const key = "pd-probe-wait-invalid";
      const body = {
        key,
        name: "Dò wait_until",
        description: "Dò điều kiện tiền đề P-d.",
        input_hint: "x",
        run_group_ids: [],
        stages: [waitStage({ key: "cho", step: 0, from: { kind: "input", key: "han" } })],
        token_budget: null,
        enabled: true,
        inputs: [{ key: "han", type: "text", label: "Hạn", required: true }],
      };
      const res = await c.call("Adm", "POST", "/process-defs", body);
      const rules = (res.json?.error?.details?.rules ?? []) as string[];
      if (res.status === 422 && rules.includes("WAIT_INVALID")) return;
      if (res.status === 201) {
        await c.sql`delete from hub.process_defs where key = ${key}`.catch(() => undefined);
      }
      noFeature(
        "stage wait_until",
        "T8",
        `POST /process-defs nguồn input text ⇒ ${res.status}, đòi 422 WAIT_INVALID`,
      );
    })();
    probed.set(c, p);
  }
  return p;
}

// ---------- id cố định (dải `a5d1…`) ----------
const x = (n: number) => `a5d10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PD = {
  gG2: x(1), // Group "Giám đốc" (acme): H q01, H2 q02 — chuyển cấp
  gBetaKT: x(2), // Group beta `ke-toan` (D an) — Group tenant khác
} as const;
export const G1 = PA_FIX.gKeToan; // Group duyệt "Kế toán": B hoa, T cuc

// ---------- đồng hồ lệch ----------
export type SkewClock = { now: () => Date; advance: (ms: number) => void; set: (d: Date) => void };
/** `now()` = giờ thật + lệch; `set(d)` đặt lệch sao cho `now()` ≈ d; `advance(ms)` cộng lệch. */
export function skewClock(start?: Date): SkewClock {
  let skew = start ? start.getTime() - Date.now() : 0;
  return {
    now: () => new Date(Date.now() + skew),
    advance: (ms) => {
      skew += ms;
    },
    set: (d) => {
      skew = d.getTime() - Date.now();
    },
  };
}
export const SEC = 1_000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// ---------- schema 0036 + 0011 ----------
/** `hub.process_timers` ∧ `stage_runs.retry_count` ∧ `admin.tenants.timezone` (test-plan §8). */
export async function hasPdSchema(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select
      to_regclass('hub.process_timers') is not null
      and exists (select 1 from information_schema.columns
                  where table_schema = 'hub' and table_name = 'stage_runs' and column_name = 'retry_count')
      and exists (select 1 from information_schema.columns
                  where table_schema = 'admin' and table_name = 'tenants' and column_name = 'timezone') as ok`;
  return r?.ok === true;
}
/** Đầu mỗi ca int P-d: chưa có migration ⇒ đỏ ở đây (không PostgresError trong fixture). */
export function needPdSchema(ready: boolean): void {
  expect({ migration0036_0011: ready }).toEqual({ migration0036_0011: true });
}

// ---------- seed ----------
async function seedPd(sql: Sql): Promise<void> {
  const nm = (vi: string, en: string) => sql.json({ vi, en });
  await sql`insert into admin.groups (id, tenant_id, key, name) values
    (${PD.gG2}, ${T.acme}, 'giam-doc', ${nm("Giám đốc", "Directors")}),
    (${PD.gBetaKT}, ${T.beta}, 'ke-toan', ${nm("Kế toán", "Accounting")})`;
  await sql`insert into admin.group_members ${sql([
    { tenant_id: T.acme, group_id: PD.gG2, user_id: PA.H.id },
    { tenant_id: T.acme, group_id: PD.gG2, user_id: PA.H2.id },
    { tenant_id: T.beta, group_id: PD.gBetaKT, user_id: PA.D.id },
  ])}`;
}

export type CtxPd = CtxPf1 & { clk: SkewClock; pd: boolean };
/** DB sạch + persona P-a + seed PF1 (khi 0019) + G2 + hub thật dùng `clk.now`. `pd` = có migration 0036/0011. */
export async function startPd(o: Pf1Opts & { clk?: SkewClock } = {}): Promise<CtxPd> {
  const clk = o.clk ?? skewClock();
  const c = await startPf1({ now: clk.now, ...o });
  await seedPd(c.sql);
  return { ...c, clk, pd: await hasPdSchema(c.sql) };
}

// ---------- vòng nền (seam N3) ----------
/** `sweepOnce()` n lần (trả kết quả lần cuối). */
export async function sweepN(c: CtxPf1, n = 1): Promise<Json> {
  let r: Json = null;
  for (let i = 0; i < n; i++) r = await handles(c).sweepOnce();
  return r;
}
/** `remindOnce()` (vắng ⇒ đỏ ở expect). */
export async function remind(c: CtxPf1): Promise<number> {
  const h = c.hub.handles();
  expect({ remindOnce: typeof h?.remindOnce }).toEqual({ remindOnce: "function" });
  return (h as Json).remindOnce();
}

// ---------- def P-d (test-plan §2) ----------
const agentStage = (o: Json): Json => ({
  key: o.key,
  name: o.name ?? `Bước ${o.key}`,
  ...(o.step === undefined ? {} : { step: o.step }),
  executor: o.executor ?? { kind: "agent", agent_id: P1.agRead },
  instruction: "Làm việc của bước.",
  output: o.output ?? {
    filename: `${o.key}.md`,
    template: "## Bảng ý\n",
    required_sections: ["Bảng ý"],
    fields: o.fields ?? [],
  },
  after: o.after ?? { kind: "auto" },
  real_action: o.real_action ?? false,
  answerer: { kind: "starter" },
  timeout_s: 600,
  token_budget: null,
});
/** Stage `wait_until` (contract plan-contract §3); output gửi tuỳ ý (Hub ép, plan-addendum A3). */
export const waitStage = (o: Json): Json =>
  agentStage({
    key: o.key ?? "cho",
    name: o.name ?? "Chờ hạn",
    step: o.step,
    executor: {
      kind: "wait_until",
      from: o.from ?? { kind: "field", stage_key: "doc", field: "ngay_het_han" },
      offset_days: o.offset_days ?? -3,
      time: o.time ?? "09:00",
    },
    after: o.after ?? { kind: "auto" },
    real_action: o.real_action ?? false,
    output: o.output,
  });
export const FIELD_NGAY = [{ key: "ngay_het_han", type: "date", required: false }];
/** Body `POST /process-defs` (Adm acme). */
export function defBody(key: string, stages: Json[], o: Json = {}): Json {
  return {
    key,
    name: o.name ?? `Quy trình ${key}`,
    description: "Quy trình của bộ test P-d.",
    input_hint: "Mã hồ sơ",
    run_group_ids: [],
    stages,
    token_budget: null,
    enabled: true,
    ...(o.inputs ? { inputs: o.inputs } : {}),
    ...(o.ttl_days === undefined ? {} : { ttl_days: o.ttl_days }),
  };
}
/** Def mẫu P-d (test-plan §2) — gọi `createDef(c, PD_DEFS.x())`. */
export const PD_DEFS = {
  retry: () =>
    defBody("pd-retry", [agentStage({ key: "s0", step: 0 }), agentStage({ key: "s1", step: 1 })]),
  waitField: () =>
    defBody("pd-wait-field", [
      agentStage({ key: "doc", name: "Đọc hồ sơ", step: 0, fields: FIELD_NGAY }),
      waitStage({ key: "cho", step: 1 }),
      agentStage({ key: "xong", name: "Hoàn tất", step: 2 }),
    ]),
  waitInput: () =>
    defBody(
      "pd-wait-input",
      [
        waitStage({ key: "cho", step: 0, from: { kind: "input", key: "han" } }),
        agentStage({ key: "xong", step: 1 }),
      ],
      { inputs: [{ key: "han", type: "date", label: "Hạn", required: true }] },
    ),
  remind: (o: { remind?: number | null; escalate?: Json | null } = {}) =>
    defBody("pd-remind", [
      agentStage({
        key: "doc",
        step: 0,
        after: {
          kind: "review",
          group_id: G1,
          back_to_steps: [],
          remind_every_h: o.remind === undefined ? 4 : o.remind,
          escalate: o.escalate === undefined ? { after_h: 24, group_id: PD.gG2 } : o.escalate,
        },
      }),
      agentStage({ key: "ghi", step: 1 }),
    ]),
  ttlNull: () =>
    defBody(
      "pd-ttl-null",
      [
        agentStage({
          key: "doc",
          step: 0,
          after: { kind: "review", group_id: G1, back_to_steps: [] },
        }),
      ],
      { ttl_days: null },
    ),
  parWait: () =>
    defBody("pd-par-wait", [
      agentStage({ key: "doc", step: 0, fields: FIELD_NGAY }),
      waitStage({ key: "cho", step: 1 }),
      agentStage({ key: "song", step: 1 }),
      agentStage({ key: "xong", step: 2 }),
    ]),
  /** PD-I05: 2 agent song song ở bước 1. */
  par2: () =>
    defBody("pd-par2", [
      agentStage({ key: "doc", step: 0 }),
      agentStage({ key: "a", step: 1 }),
      agentStage({ key: "b", step: 1 }),
    ]),
};
export { agentStage };

/** `POST /process-defs` ⇒ đòi 201, trả def (json). */
export async function createDef(c: CtxPf1, body: Json, r: Role = "Adm"): Promise<Json> {
  const res = await c.call(r, "POST", "/process-defs", body);
  expect({ status: res.status, code: res.json?.error?.code ?? null }).toEqual({
    status: 201,
    code: null,
  });
  return res.json;
}
/** `POST /process-runs` (origin none) ⇒ đòi 201, trả id run. */
export async function startRun(
  c: CtxPf1,
  key: string,
  o: { role?: Role; inputs?: Json[]; input?: string } = {},
): Promise<string> {
  const res = await c.call(o.role ?? "A", "POST", "/process-runs", {
    process_key: key,
    input: o.input ?? "HS-01",
    origin: { kind: "none" },
    ...(o.inputs ? { inputs: o.inputs } : {}),
  });
  expect({ status: res.status, code: res.json?.error?.code ?? null }).toEqual({
    status: 201,
    code: null,
  });
  return res.json?.id as string;
}
export const decide = (c: CtxPf1, r: Role, runId: string, option: string, stageIdx?: number) =>
  c.call(r, "POST", `/process-runs/${runId}/decide`, {
    option,
    ...(stageIdx === undefined ? {} : { stage_idx: stageIdx }),
  });
export const cancelRun = (c: CtxPf1, r: Role, runId: string) =>
  c.call(r, "POST", `/process-runs/${runId}/cancel`, {});
export const viewRun = (c: CtxPf1, r: Role, runId: string) =>
  c.call(r, "GET", `/process-runs/${runId}`);

// ---------- output agent ----------
/** Output .md hợp lệ với `agentStage` (mục "Bảng ý" + "Bàn giao" Hub tự thêm vào mục bắt buộc) + khối ```fields```
 *  (R-TM04) khi có `fields`. */
export function mdOut(fields?: Json): string {
  const base = "## Bảng ý\nHồ sơ HS-01.\n\n## Bàn giao\nĐã đọc hồ sơ HS-01.";
  return fields ? `${base}\n\n\`\`\`fields\n${JSON.stringify(fields)}\n\`\`\`` : base;
}

// ---------- đọc trạng thái (owner) ----------
export const timersOf = (sql: Sql, runId: string) =>
  sql<Json[]>`select * from hub.process_timers where process_run_id = ${runId}
    order by created_at, idempotency_key`;
export const openTimers = (sql: Sql, runId: string) =>
  sql<Json[]>`select * from hub.process_timers where process_run_id = ${runId}
    and fired_at is null and cancelled_at is null order by created_at`;
export const jobsOfRun = (sql: Sql, runId: string) =>
  sql<Json[]>`select j.id, j.status, r.stage_run_id, r.status as run_status from hub.jobs j
    join hub.runs r on r.id = j.run_id where r.process_run_id = ${runId} order by j.created_at`;
export async function decisionOf(sql: Sql, runId: string): Promise<Json | undefined> {
  return (
    await sql<Json[]>`select * from hub.review_tasks where process_run_id = ${runId}
      and kind = 'decision' and status = 'open' order by created_at limit 1`
  )[0];
}
/** Hàng `stage_runs` mới nhất (round/attempt lớn nhất) của stage `idx`. */
export async function stageOf(sql: Sql, runId: string, idx: number): Promise<Json | undefined> {
  return (
    await sql<Json[]>`select * from hub.stage_runs where process_run_id = ${runId}
      and stage_idx = ${idx} order by round desc, attempt desc limit 1`
  )[0];
}
const STAGE_DEAD = new Set(["failed", "cancelled", "expired", "needs_decision"]);
/** Trạng thái stage mà từ đó KHÔNG còn tự chuyển sang `want` (đỏ ngay, không đợi). */
function wrongStage(idx: number, want: string, cur: string | undefined): string | null {
  if (cur === undefined || cur === want) return null;
  const dead = STAGE_DEAD.has(cur);
  const skipped =
    want === "waiting_timer" && ["done", "waiting_review", "waiting_answer"].includes(cur);
  return dead || skipped
    ? `stage ${idx} ở "${cur}", không còn chuyển sang "${want}" — chưa có tính năng tương ứng (T8 chờ hẹn / T9 retry)`
    : null;
}
/**
 * Chờ stage `idx` của run tới `status` (trả hàng) — chờ TÍN HIỆU, không poll/ngủ (Luật 4c): đọc ngay; chưa tới thì đợi
 * Hub gửi câu SQL kế (`hubActivity` — mỗi bước của driver ghi DB) rồi đợi `handles.settled()` HOẶC câu kế (lượt commit
 * cuối; không đợi `settled()` đơn thuần vì lời gọi tool đang giữ làm nó treo) và đọc lại. `ms` chỉ là lưới an toàn cho
 * lỗi treo; `ms = 0` ⇒ chỉ đo một lần (sau lời gọi đã `await`).
 */
export async function waitStageStatus(
  c: CtxPf1,
  runId: string,
  idx: number,
  status: string,
  ms = 8_000,
) {
  const act = hubActivity(c.hub);
  const end = Date.now() + ms;
  let seen = act.tick();
  let r = await stageOf(c.sql, runId, idx);
  while (ms > 0 && r?.status !== status) {
    const why = wrongStage(idx, status, r?.status);
    if (why) throw new Error(why);
    const left = end - Date.now();
    if (left <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<void>((res) => {
      timer = setTimeout(res, left); // lưới an toàn, không phải cơ chế chờ
    });
    try {
      await Promise.race([act.after(seen), guard]);
      seen = act.tick();
      await Promise.race([handles(c).settled(), act.after(seen), guard]);
    } finally {
      clearTimeout(timer);
    }
    seen = act.tick();
    r = await stageOf(c.sql, runId, idx);
  }
  expect({ stage: idx, status: r?.status }).toEqual({ stage: idx, status });
  return r as Json;
}
