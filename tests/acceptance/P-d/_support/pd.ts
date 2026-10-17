// HUB-FR-143…145 · HUB-FR-115 · P-d1 · hạ tầng int (test-plan §1–§2, test-plan-int đầu file): hub-api THẬT + launcher thật
// (`startPf1`, `processLoops:false`) + đồng hồ LỆCH (`skewClock`: thời gian vẫn chạy, `advance` cộng lệch — ca cũ dùng SQL
// `now()` không vỡ). Group G2 "Giám đốc" (H q01, H2 q02, ngoài phòng) luôn seed (bảng 0001 có sẵn). Def P-d đi QUA API
// `POST /process-defs` (đúng luật lưu + ép) ⇒ trước code đỏ ở `expect(201)`. Chèn bảng/cột 0036 CHỈ sau `needPdSchema`.
// Không chứa `it(...)`. jsonb qua `sql.json` (CONVENTIONS §2 bẫy).
import { expect } from "bun:test";
import { type Json, PA, PA_FIX, type Role, type Sql, T, waitFor } from "../../P-a/_support/pa";
import { type CtxPf1, handles, P1, type Pf1Opts, startPf1 } from "../../P-a/pf1/_local";

export * from "../../P-a/pf1/_local";
export { type Json, PA, PA_FIX, type Role, type Sql, T, waitFor };

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
/** Chờ stage `idx` của run tới `status` (trả hàng). */
export async function waitStageStatus(
  sql: Sql,
  runId: string,
  idx: number,
  status: string,
  ms = 8_000,
) {
  const r = await waitFor(
    () => stageOf(sql, runId, idx),
    (v) => v?.status === status,
    ms,
  );
  expect({ stage: idx, status: r?.status }).toEqual({ stage: idx, status });
  return r as Json;
}
