// HUB-FR-72 · HUB-FR-60 · HUB-FR-61 · HUB-FR-62 · HUB-FR-64 · HUB-FR-69 · hạ tầng int H4a (test-plan H4a §2): DB sạch +
// fixture H1 (tenant/user) + cấu hình Hub H1 + catalog H2a (workflow bật/tắt, app chat/agent) + agent H2a/H2b, rồi thêm
// bộ H4a (agent_types, agent có lịch sử ở tenant acme, agent còn entitlement, Orchestrator tenant `beta`). Hub thật
// (`startHubH2b`) + `hubAudit` tiêm lỗi (P7) + `studioDist` (AC-11). Không chứa `it(...)`.
// Audit append-only ⇒ không dọn: đếm theo `seq > mốc`. NOTIFY: dùng lại `listenHub` H3b (sentinel).
import { resolve } from "node:path";
import {
  call,
  type Json,
  type Keys,
  makeKeys,
  R,
  type Res,
  type Sql,
  sign,
  T,
  USERS,
} from "../H1/_fixtures";
import { AG, type HubX, hubConfigChange, PROFILE } from "../H1/_hub";
import { AG2, WF } from "../H2a/_h2a";
import { AG3, setupH2b, startHubH2b } from "../H2b/_h2b";
import { auditMax, auditSince, errOf, type HubAuditLike, versionOf } from "../H3b/_h3b";

export { AG, AG2, AG3, auditMax, auditSince, errOf, PROFILE, R, T, USERS, versionOf, WF };

// ---------- id cố định (dải `a4a0…`) ----------
const h = (n: number) => `a4a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bộ sinh uuid tất định cho dữ liệu tạo trong ca (mỗi file một dải `base` ≥ 1000). */
export function idGen4(base: number): () => string {
  let n = base;
  return () => h(n++);
}
/** Agent thêm của H4a (đều `agentic-cli`, profile `fake-1`, trừ `llmBot`). */
export const AG4 = {
  /** có `run_steps.agent_id` trong run `R.runDone` của tenant acme (R-K2: actor là platform, lịch sử ở acme). */
  hist: h(1),
  /** entitlement acme còn hiệu lực, 0 grant ⇒ `AGENT_HAS_ACCESS {entitlements: 1, grants: 0}`. */
  access: h(2),
  /** runtime `llm`, bật ⇒ QB1: không làm được Orchestrator. */
  llmBot: h(3),
  /** agentic-cli tắt ⇒ `AGENT_NOT_ORCHESTRATABLE{disabled}`. */
  off: h(4),
  /** Orchestrator riêng của tenant `beta` (fixture). */
  orchBeta: h(5),
  /** agentic-cli bật, không entitlement/grant/lịch sử — xoá được; dùng làm Orchestrator tenant qua API. */
  free: h(6),
  /** agentic-cli có `Bash` sẵn trong `allowed_tools` (R05: sửa giữ Bash không cần ack lại). */
  bash: h(7),
} as const;
export const NONE = h(999);
export const AGENT_TYPE = { py: "py-report", pyOff: "py-old", cli: "cli-tool" } as const;

/** Mô tả hợp DB (20–400). */
export const desc = (key: string) => `Agent ${key} dùng cho kiểm thử Studio H4a, đủ dài.`;

async function insertH4aAgents(sql: Sql): Promise<void> {
  const agent = (
    id: string,
    key: string,
    o: { runtime?: string; enabled?: boolean; opts?: Json } = {},
  ) => ({
    id,
    key,
    name: sql.json({ vi: `Tên ${key}`, en: `Name ${key}` }),
    description: desc(key),
    runtime: o.runtime ?? "agentic-cli",
    profile_id: PROFILE.fake,
    runtime_options: sql.json(o.opts ?? {}),
    enabled: o.enabled ?? true,
  });
  await sql`insert into hub.agents ${sql([
    agent(AG4.hist, "co-lich-su"),
    agent(AG4.access, "co-quyen"),
    agent(AG4.llmBot, "llm-bot", { runtime: "llm" }),
    agent(AG4.off, "dang-tat", { enabled: false }),
    agent(AG4.orchBeta, "orch-beta4"),
    agent(AG4.free, "tu-do"),
    agent(AG4.bash, "co-bash", {
      opts: { cli: "claude", allowed_tools: ["Read", "Bash"], mcp: false, cwd_mode: "job" },
    }),
  ])}`;
  await sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${AG4.access}, ${T.acme})`;
  await sql`insert into hub.run_steps (tenant_id, user_id, run_id, seq, type, agent_id, label_key, status)
    values (${T.acme}, ${USERS.lan.id}, ${R.runDone}, 1, 'delegate', ${AG4.hist}, 'step.delegate', 'ok')`;
  await sql`insert into hub.orchestrator_settings (tenant_id, agent_id, max_steps, token_budget, history_n)
    values (${T.beta}, ${AG4.orchBeta}, 4, 150000, 8)`;
  const schema = { type: "object", properties: { sheet: { type: "string" } } };
  const at = (key: string, runtime: string, available = true) => ({
    key,
    runtime,
    description: sql.json({ vi: `Loại ${key}`, en: `Type ${key}` }),
    config_schema: sql.json(schema),
    version: 1,
    worker_id: "qc-worker-h4a",
    available,
  });
  await sql`insert into hub.agent_types ${sql([
    at(AGENT_TYPE.py, "python"),
    at(AGENT_TYPE.pyOff, "python", false),
    at(AGENT_TYPE.cli, "agentic-cli"),
  ])}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

/** DB sạch + fixture H1/H2a (catalog, base URL Dify không gọi tới)/H2b + bộ H4a. */
export async function setupH4a(): Promise<Sql> {
  const sql = await setupH2b({ catalogBaseUrl: "http://127.0.0.1:9/v1" });
  await insertH4aAgents(sql);
  return sql;
}

// ---------- hub-api thật ----------
/** Seam: `AppDeps.hubAudit?` (H3b P12, H4a P7) + `AppDeps.studioDist?` (plan §9). */
export type H4aExtra = { instanceId?: string; hubAudit?: HubAuditLike; studioDist?: string };
export const STUDIO_DIST = resolve(import.meta.dir, "__fixtures__/studio-dist");

export type Ctx = { sql: Sql; k: Keys; hub: HubX; stop: () => Promise<void> };
export async function startH4a(extra: H4aExtra = {}): Promise<Ctx> {
  const sql = await setupH4a();
  const k = await makeKeys();
  const hub = await startHubH2b(k, { instanceId: "qc-hub-h4a", ...extra } as never);
  return {
    sql,
    k,
    hub,
    stop: async () => {
      await hub.stop();
      await sql.end();
    },
  };
}

// ---------- gọi API ----------
export type Who = "padmin" | "tadmin" | "lan" | "an";
export const tok = (k: Keys, w: Who): Promise<string> => sign(k, USERS[w]);
/** `method path` dưới `/studio/api` với token của `w` (null = không token). */
export async function api(
  x: Ctx,
  w: Who | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res> {
  const token = w ? await tok(x.k, w) : undefined;
  return call(x.hub, method, `/studio/api${path}`, { token, body });
}
export const pa = (x: Ctx, method: string, path: string, body?: unknown) =>
  api(x, "padmin", method, path, body);

// ---------- body hợp contract (plan §2.3, §2.4) ----------
const common = (key: string) => ({
  key,
  name: { vi: `Tên ${key}`, en: `Name ${key}` },
  description: desc(key),
  system_prompt: `Bạn là agent ${key}.`,
  timeout_s: 600,
  token_budget: null,
  enabled: true,
});
export const llmBody = (key: string, o: Json = {}) => ({
  ...common(key),
  runtime: "llm",
  profile_id: PROFILE.fake,
  runtime_options: {},
  workflow_ids: [],
  ...o,
});
export const CLI_OPTS = {
  cli: "claude",
  allowed_tools: ["Read", "Grep"],
  mcp: false,
  cwd_mode: "job",
};
export const cliBody = (key: string, o: Json = {}) => ({
  ...common(key),
  runtime: "agentic-cli",
  profile_id: PROFILE.fake,
  runtime_options: CLI_OPTS,
  workflow_ids: [],
  ...o,
});
export const difyBody = (
  key: string,
  runtime: "dify-workflow" | "dify-agent",
  wf: string[],
  o: Json = {},
) => ({
  ...common(key),
  runtime,
  workflow_ids: wf,
  ...o,
});
/** Bỏ `key`, `runtime` (P10) + thêm `version` — thân PUT từ body tạo. */
export function putOf(b: Json, version: number, o: Json = {}): Json {
  const { key: _k, runtime: _r, ...rest } = b;
  return { ...rest, version, ...o };
}
export const orchBody = (agent_id: string, o: Json = {}) => ({
  agent_id,
  max_steps: 5,
  token_budget: 200_000,
  history_n: 10,
  on_no_match: "answer",
  ...o,
});

// ---------- đọc DB (owner) ----------
export async function agentRow(sql: Sql, id: string): Promise<Json | undefined> {
  const [r] = await sql`select * from hub.agents where id = ${id}`;
  return r ? { ...r } : undefined;
}
export async function agentByKey(sql: Sql, key: string): Promise<Json | undefined> {
  const [r] = await sql`select * from hub.agents where key = ${key}`;
  return r ? { ...r } : undefined;
}
export async function agentWfIds(sql: Sql, id: string): Promise<string[]> {
  const rows = await sql<{ w: string }[]>`select workflow_id as w from hub.agent_workflows
    where agent_id = ${id} order by workflow_id`;
  return rows.map((r) => r.w);
}
export async function orchRow(sql: Sql, tenant: string | null): Promise<Json | undefined> {
  const [r] = tenant
    ? await sql`select * from hub.orchestrator_settings where tenant_id = ${tenant}`
    : await sql`select * from hub.orchestrator_settings where tenant_id is null`;
  return r ? { ...r } : undefined;
}
/** Ảnh "0 ghi": agents + agent_workflows + orchestrator_settings + version + audit. */
export async function configState(sql: Sql): Promise<Json> {
  const agents =
    await sql`select id, key, enabled, version, system_prompt, runtime_options, profile_id
    from hub.agents order by key`;
  const wfs =
    await sql`select agent_id, workflow_id from hub.agent_workflows order by agent_id, workflow_id`;
  const orch =
    await sql`select id, tenant_id, agent_id, max_steps, version from hub.orchestrator_settings
    order by id`;
  return {
    agents: agents.map((r) => ({ ...r })),
    wfs: wfs.map((r) => ({ ...r })),
    orch: orch.map((r) => ({ ...r })),
    version: await versionOf(sql),
    audit: await auditMax(sql),
  };
}
/** Đổi cấu hình bằng owner (như seed) — dựng trạng thái giữa ca. */
export { hubConfigChange };
