// AC-H41 · HUB-FR-144 · HUB-BR-42 · helper riêng `d1/` cho ca hẹn giờ (test-plan-int §3): dọn run, def lười, đưa run tới
// stage `wait_until` đang chờ, job theo stage, quét trên hub bất kỳ. Không chứa `it(...)`. Mọi hàm đụng `process_timers`/
// trạng thái `waiting_timer` CHỈ gọi sau `needPdSchema` (trong `it`). jsonb qua `sql.json`.
import { expect } from "bun:test";
import type { HubPa } from "../../P-a/_support/pa";
import {
  type CtxPd,
  createDef,
  type Job,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  PD_DEFS,
  type Sql,
  startRun,
  T,
  waitFor,
} from "../_support/pd";

/** Mốc đồng hồ chuẩn các ca `wait_until` (test-plan-int PD-I20). */
export const T_START = new Date("2026-11-01T03:00:00Z");
/** `pd-wait-field` với `ttl_days: 30` — ttl mặc định 7 làm hạn 2026-11-17 > `expires_at` ⇒ `after_expiry` (xem báo cáo). */
export const WAIT_DEF = (): Json => ({ ...PD_DEFS.waitField(), ttl_days: 30 });
/** Biến thể `pd-wait-field` khác key (PD-I26 b/c). */
export const waitDefVariant = (key: string, ttl: number | null): Json => ({
  ...PD_DEFS.waitField(),
  key,
  name: `Quy trình ${key}`,
  ttl_days: ttl,
});

const ACTIVE = [
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
  "waiting_timer",
] as const;
/** Huỷ mọi run chưa kết thúc + job/hub.runs còn chạy + hẹn mở (giữ trần 5 run/tenant giữa các ca). */
export async function settle(sql: Sql): Promise<void> {
  await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ${sql(ACTIVE as unknown as string[])}`;
  await sql`update hub.jobs set status = 'cancelled', finished_at = now() where status in ('queued', 'running')`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
  await sql`update hub.process_timers set cancelled_at = now()
    where fired_at is null and cancelled_at is null`;
}

/** Tạo def qua API nếu tenant acme chưa có key đó (def đi đúng luật lưu + ép). */
export async function ensureDef(c: CtxPd, body: Json): Promise<string> {
  const [d] = await c.sql<{ id: string }[]>`select id from hub.process_defs
    where tenant_id = ${T.acme} and key = ${body.key as string} and deleted_at is null`;
  if (d) return d.id;
  return (await createDef(c, body)).id as string;
}

/** Dọn, đặt đồng hồ, tạo def (lười), A bắt đầu, job s0 trả output có `fields` (vắng ⇒ không khối fields). */
export async function startWait(
  c: CtxPd,
  o: { fields?: Json; def?: Json; at?: Date } = {},
): Promise<{ runId: string; job: Job }> {
  await settle(c.sql);
  c.clk.set(o.at ?? T_START);
  const def = o.def ?? WAIT_DEF();
  await ensureDef(c, def);
  const runId = await startRun(c, def.key as string);
  const job = await nextStageJob(c, runId);
  await jobDone(c, job, mdOut(o.fields));
  return { runId, job };
}

/** id `stage_runs` mới nhất của stage `idx`. */
export async function stageId(sql: Sql, runId: string, idx: number): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select id from hub.stage_runs
    where process_run_id = ${runId} and stage_idx = ${idx} order by round desc, attempt desc limit 1`;
  expect({ stage: idx, found: r !== undefined }).toEqual({ stage: idx, found: true });
  return r?.id as string;
}

/** Chờ job `queued` của stage `idx` rồi claim (đỏ ở expect nếu Hub không tạo). */
export async function jobOfStage(c: CtxPd, runId: string, idx: number, ms = 8_000): Promise<Job> {
  const row = await waitFor(
    async () =>
      (
        await c.sql<{ run_id: string }[]>`select j.run_id from hub.jobs j
          join hub.runs r on r.id = j.run_id join hub.stage_runs s on s.id = r.stage_run_id
          where r.process_run_id = ${runId} and s.stage_idx = ${idx} and j.status = 'queued'
          order by j.created_at limit 1`
      )[0],
    (v) => v !== undefined,
    ms,
  );
  expect({ stage: idx, queuedJob: row !== undefined }).toEqual({ stage: idx, queuedJob: true });
  return c.rt.next((row as { run_id: string }).run_id);
}

/** Số `hub.runs` của stage `idx` (mọi round). */
export async function hubRunsOfStage(sql: Sql, runId: string, idx: number): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs r
    join hub.stage_runs s on s.id = r.stage_run_id
    where r.process_run_id = ${runId} and s.stage_idx = ${idx}`;
  return r?.n ?? 0;
}

/** `process_outputs` của stage `idx`. */
export const stageOutputs = (sql: Sql, runId: string, idx: number) =>
  sql<Json[]>`select * from hub.process_outputs where process_run_id = ${runId}
    and stage_idx = ${idx} order by version`;

/** `sweepOnce()` của một hub cụ thể (hub thứ hai, hub sau khởi động lại). */
export async function sweepOn(h: HubPa): Promise<Json> {
  const hd = h.handles();
  expect({ handles: typeof hd?.sweepOnce }).toEqual({ handles: "function" });
  return (hd as Json).sweepOnce();
}

/** .md Hub sinh cho stage `wait_until` (plan-domain §4.12 `waitOutputMd`). */
export const waitMd = (name: string, line: string): string =>
  `# ${name}\n\n${line}\n\n## Bàn giao\n${line}\n`;

/** Đặt múi giờ tenant (owner). */
export async function setTz(sql: Sql, tz: string, tenantId: string = T.acme): Promise<void> {
  await sql`update admin.tenants set timezone = ${tz} where id = ${tenantId}`;
}
