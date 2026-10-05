// HUB-FR-91, HUB-FR-92, HUB-FR-94, HUB-FR-62 · hạ tầng test int H2b (test-plan H2b §1, §2, §2.1): agent `writer`,
// `llmbot`, `orch-acme`, `orch-alt` + tên vi/en cho `assistant` bằng SQL owner; hub-api thật kèm `maxConcurrentRuns: 2`
// (L1, seam deps — `startHubH2a` khoá không sửa); Orchestrator theo tenant; dọn run đang chạy giữa ca (limit 2);
// đọc lỗi định tuyến; `ScriptRuntime3` (XADD `job.delta`, hở `seq`, JSON hỏng — dùng ở QW-A2). Không chứa `it(...)`.
// Dùng chung QW-A1 và QW-A2.
//
// Seam test ↔ hub-api (ghi cho backend-lead, test-plan §10 QW-A1): `createApp(cfg, deps)` nhận thêm dep **tuỳ chọn**
// `maxConcurrentRuns` (= `HUB_MAX_CONCURRENT_RUNS`; vắng ⇒ không giới hạn, readiness #3). Fixture H1 có run `runLive`
// của `lan` đang `running` (instance khác) — `setupH2b` kết thúc nó để ngưỡng 2 đo đúng (test-plan §2.1).
import { expect } from "bun:test";
import {
  AgentMenuResponseSchema,
  AgentNotFoundDetailsSchema,
  ErrorResponseSchema,
} from "@ai/contracts/chat";
import type { DeltaKind } from "@ai/contracts/hub";
import type postgres from "postgres";
import { type Level, setSink } from "../../../apps/hub-api/src/lib/logger";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  ownerSql,
  prepareDb,
  R,
  type Res,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import {
  AG,
  type HubExtra,
  type HubX,
  hubConfigChange,
  insertHubConfig,
  PROFILE,
} from "../H1/_hub";
import { type Job, ScriptRuntime } from "../H1/_runtime";
import { type H2aDeps, insertCatalog, insertH2aAgents, startHubH2a } from "../H2a/_h2a";
import { endSqlRun } from "../H2a/_h2a2";

// ---------- id cố định (dải `a2b0…`, test-plan §2.1) ----------
const b = (n: number) => `a2b00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const AG3 = { writer: b(1), llmbot: b(2), orchAcme: b(3), orchAlt: b(4) } as const;
export const ASSISTANT_NAME = { vi: "Trợ lý", en: "Assistant" } as const;
export const WRITER_DESC = "Soạn thảo thư và văn bản dài theo yêu cầu.";
export const ORCH_ACME_PROMPT = "Bạn là Orchestrator riêng của tenant acme (QW-A1).";
/** AU của `lan` sau `setupH2b` không catalog (test-plan §2.1). */
export const LAN_AU = ["assistant", "helper", "writer"] as const;

/**
 * Agent H2b (cần `insertHubConfig` trước): `writer` (agentic-cli, entitlement acme, grant `lan`), `llmbot` (runtime `llm`,
 * entitlement acme, grant `lan`), `orch-acme`, `orch-alt` (agentic-cli, không entitlement/grant); `assistant` đổi tên
 * vi/en. Tăng `hub_config_version`.
 */
export async function insertH2bAgents(sql: Sql): Promise<void> {
  const agent = (id: string, key: string, desc: string, runtime = "agentic-cli", prompt = "") => ({
    id,
    key,
    name: sql.json({ vi: key, en: key }),
    description: desc,
    runtime,
    profile_id: PROFILE.fake,
    system_prompt: prompt,
  });
  await sql`insert into hub.agents ${sql([
    agent(AG3.writer, "writer", WRITER_DESC),
    agent(AG3.llmbot, "llmbot", "Agent runtime llm chưa chạy được ở H2b.", "llm"),
    agent(
      AG3.orchAcme,
      "orch-acme",
      "Điều phối riêng cho tenant acme.",
      "agentic-cli",
      ORCH_ACME_PROMPT,
    ),
    agent(
      AG3.orchAlt,
      "orch-alt",
      "Điều phối thay thế cho tenant acme.",
      "agentic-cli",
      "Orch alt.",
    ),
  ])}`;
  await sql`update hub.agents set name = ${sql.json(ASSISTANT_NAME)} where id = ${AG.assistant}`;
  const ids = [AG3.writer, AG3.llmbot];
  await sql`insert into hub.agent_entitlements ${sql(ids.map((agent_id) => ({ agent_id, tenant_id: T.acme })))}`;
  await sql`insert into hub.agent_grants ${sql(
    ids.map((agent_id) => ({
      agent_id,
      tenant_id: T.acme,
      subject_type: "user",
      subject_id: USERS.lan.id,
    })),
  )}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

export type SetupOpts = { catalogBaseUrl?: string };
/**
 * DB sạch + fixture H1 + cấu hình Hub H1 [+ catalog/agent H2a] + agent H2b; kết thúc `runLive` của `lan` (SQL).
 * Catalog H2a cấp thêm `hoadon` (entitlement acme), `trello`, `dify-*` cho `lan` ⇒ AU khác `LAN_AU`.
 */
export async function setupH2b(o: SetupOpts = {}): Promise<Sql> {
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  if (o.catalogBaseUrl) {
    await insertCatalog(sql, { baseUrl: o.catalogBaseUrl });
    await insertH2aAgents(sql);
  }
  await insertH2bAgents(sql);
  await endSqlRun(sql, R.runLive);
  return sql;
}

// ---------- hub-api thật + `maxConcurrentRuns` (L1) ----------
export type H2bDeps = { maxConcurrentRuns?: number };
export type H2bExtra = Omit<HubExtra, "signal"> & Omit<H2aDeps, "publicInternalUrl"> & H2bDeps;

/** Như `startHubH2a` + `maxConcurrentRuns` (mặc định 2), `jobMaxWaitS` 30 (cases §2 "Chung"). */
export function startHubH2b(k: Keys, extra: H2bExtra = {}): Promise<HubX> {
  const deps: H2bExtra = {
    instanceId: "qc-hub-h2b",
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    ...extra,
  };
  return startHubH2a(k, deps);
}

// ---------- Orchestrator theo tenant (SQL owner như seed, P6) ----------
export type TenantOrchOpts = {
  maxSteps?: number;
  tokenBudget?: number;
  historyN?: number;
  onNoMatch?: "answer" | "ask";
};
/** Upsert bản Orchestrator riêng của `tenantId` + `hub_config_version + 1` + NOTIFY. */
export function tenantOrch(
  sql: Sql,
  tenantId: string,
  agentId: string,
  o: TenantOrchOpts = {},
): Promise<number> {
  return hubConfigChange(
    sql,
    (
      tx,
    ) => tx`insert into hub.orchestrator_settings (tenant_id, agent_id, max_steps, token_budget, history_n,
        on_no_match)
      values (${tenantId}, ${agentId}, ${o.maxSteps ?? 5}, ${o.tokenBudget ?? 200_000}, ${o.historyN ?? 10},
        ${o.onNoMatch ?? "answer"})
      on conflict (tenant_id) where tenant_id is not null do update set agent_id = excluded.agent_id,
        max_steps = excluded.max_steps, token_budget = excluded.token_budget, history_n = excluded.history_n,
        on_no_match = excluded.on_no_match, version = hub.orchestrator_settings.version + 1, updated_at = now()`,
  );
}
export const dropTenantOrch = (sql: Sql, tenantId: string): Promise<number> =>
  hubConfigChange(
    sql,
    (tx) => tx`delete from hub.orchestrator_settings where tenant_id = ${tenantId}`,
  );

// ---------- run đang chạy ----------
/** Số run `running` của `who` (owner, mọi `kind`). */
export async function runsRunning(sql: Sql, who: UserKey): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs
    where user_id = ${USERS[who].id} and status = 'running'`;
  return r?.n ?? 0;
}

const userKeyOf = (userId: string): UserKey | undefined =>
  (Object.keys(USERS) as UserKey[]).find((u) => USERS[u].id === userId);

/**
 * Huỷ (E15) mọi run `running` do `hub` làm chủ rồi chờ hết `running`; còn sót (instance khác/không huỷ được) → kết thúc
 * SQL. Gọi ở `afterEach`: ngưỡng 2 run/user không để ca trước làm 429 ca sau.
 */
export async function settleRuns(hub: HubX, sql: Sql, k: Keys): Promise<void> {
  const rows = await sql<{ id: string; user_id: string; owner: string | null }[]>`
    select id, user_id, owner from hub.runs where status = 'running'`;
  await Promise.all(
    rows
      .filter((r) => r.owner === hub.instanceId)
      .map(async (r) => {
        const who = userKeyOf(r.user_id);
        if (who)
          await call(hub, "POST", `/runs/${r.id}/cancel`, { token: await sign(k, USERS[who]) });
      }),
  );
  const ids = rows.map((r) => r.id);
  const left = await waitFor(
    () =>
      sql<{ id: string }[]>`select id from hub.runs
        where id = any(${sql.array(ids, 2950)}) and status = 'running'`,
    (rs) => rs.length === 0,
    5_000,
  );
  for (const r of left) await endSqlRun(sql, r.id);
}

// ---------- lỗi định tuyến (plan-errors §1) ----------
export type RoutingErr = { status: number; code: string | undefined; details: Json; body: Json };
export function routingError(res: Res): RoutingErr {
  const p = ErrorResponseSchema.safeParse(res.json);
  return {
    status: res.status,
    code: p.success ? p.data.error.code : undefined,
    details: res.json?.error?.details,
    body: res.json,
  };
}
/** 404 `AGENT_NOT_FOUND` đúng contract; trả `suggestions`. */
export function expectAgentNotFound(res: Res): string[] {
  const e = routingError(res);
  expect({ status: e.status, code: e.code }).toEqual({ status: 404, code: "AGENT_NOT_FOUND" });
  const d = AgentNotFoundDetailsSchema.safeParse(e.details);
  expect(d.success).toBe(true);
  return d.data?.suggestions ?? [];
}
/** 422 `CMD_MISSING_ARG` của tag rỗng (R04). */
export function expectMissingContent(res: Res): void {
  const e = routingError(res);
  expect({ status: e.status, code: e.code, details: e.details }).toEqual({
    status: 422,
    code: "CMD_MISSING_ARG",
    details: { missing: ["content"], invalid: [] },
  });
}

/** `GET /agents` → key (null nếu không 200 hoặc sai contract). */
export async function menuKeys(hub: HubX, token: string): Promise<string[] | null> {
  const res = await call(hub, "GET", "/agents", { token });
  if (res.status !== 200) return null;
  const p = AgentMenuResponseSchema.safeParse(res.json);
  return p.success ? p.data.items.map((i) => i.key) : null;
}

// ---------- payload job ----------
/** Khối `<message>` của prompt Orchestrator (chuỗi JSON → giải mã, như `echoAnswer`). */
export function messageOf(job: Job): string {
  const m = /<message>([\s\S]*?)<\/message>/.exec(job.payload.prompt);
  const raw = (m?.[1] ?? "").trim();
  try {
    const v = JSON.parse(raw);
    return typeof v === "string" ? v : raw;
  } catch {
    return raw;
  }
}
/** Mọi job của run: vai + key agent (sắp tạo). */
export async function jobsOf(sql: Sql, runId: string): Promise<{ role: string; key: string }[]> {
  const rows = await sql<Json[]>`select payload from hub.jobs where run_id = ${runId}
    order by created_at, id`;
  return rows.map((r) => ({ role: r.payload?.agent?.role, key: r.payload?.agent?.key }));
}

// ---------- log ----------
export type LogLine = { level: Level; rec: Json };
/** Bắt log hub-api (in-process) tới khi gọi `restore`. */
export function captureLogs(): { lines: LogLine[]; restore: () => void } {
  const lines: LogLine[] = [];
  const restore = setSink((level, line) => {
    try {
      lines.push({ level, rec: JSON.parse(line) });
    } catch {
      lines.push({ level, rec: { msg: line } });
    }
  });
  return { lines, restore };
}

// ---------- Runtime kịch bản H2b (QW-A2) ----------
/** `ScriptRuntime` + `job.delta` (C2), hở `seq` (P11), kết quả chữ thô (JSON hỏng, P12). */
export class ScriptRuntime3 extends ScriptRuntime {
  /** XADD `job.delta{kind, text}` (seq kế tiếp của job). */
  delta(job: Job, kind: DeltaKind, text: string): Promise<void> {
    return this.emit(job, { type: "job.delta", kind, text } as never);
  }
  /** Bỏ qua `n` số `seq` của job (sự kiện kế tiếp hở). */
  skipSeq(job: Job, n: number): void {
    const m = (this as unknown as { seq: Map<string, number> }).seq;
    m.set(job.id, (m.get(job.id) ?? 0) + n);
  }
  /** Orchestrator trả chữ bất kỳ (JSON hỏng). */
  rawDecide(job: Job, text: string): Promise<void> {
    return this.text(job, text);
  }
}

/** Đổi cấu hình Hub (re-export cho file ca). */
export const configChange = (sql: Sql, apply: (tx: postgres.TransactionSql) => Promise<unknown>) =>
  hubConfigChange(sql, apply);
