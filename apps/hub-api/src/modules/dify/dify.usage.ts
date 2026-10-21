// HUB-FR-80 · H2a-R15 · P2 · ghi một dòng `usage_logs` billing `dify` cho mỗi lời gọi Dify của Hub qua hàm
// `hub.log_dify_usage` (SECURITY DEFINER, EXECUTE `hub_rw` — `hub_api` không INSERT `usage_logs`, khoá H1 A51).
// Hàm cố định `billing='dify'`, `provider_key='dify'`, `model=NULL`. Gọi trong transaction của người gọi hoặc thẳng `db`.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { DifyRunOutcome } from "./dify.client";
import type { DifyUsage } from "./dify.rules";

/** dify-workflows · phần ghi `hub.dify_runs` đi kèm usage (lịch sử chạy trong Admin → Workflows). */
export type DifyRunMeta = {
  workflowId: string;
  trigger: "command" | "agent" | "schedule";
  status: "ok" | "failed" | "aborted";
  /** Đã che secret (client Dify che app-key), cắt ≤ 500 ở hàm DB. */
  error: string | null;
  difyWorkflowRunId: string | null;
  difyConversationId: string | null;
  difyTaskId: string | null;
};

/** Kết cục client Dify → dòng lịch sử. Lỗi: thân lỗi upstream (đã che) → `HTTP <status>` → `<code>: <reason>`. */
export function difyRunMeta(
  out: DifyRunOutcome,
  workflowId: string,
  trigger: DifyRunMeta["trigger"],
): DifyRunMeta {
  const ids = {
    difyWorkflowRunId: out.workflowRunId ?? null,
    difyConversationId: out.conversationId,
    difyTaskId: out.taskId,
  };
  if (out.kind === "finished") return { workflowId, trigger, status: "ok", error: null, ...ids };
  if (out.kind === "aborted")
    return { workflowId, trigger, status: "aborted", error: null, ...ids };
  const http = out.httpStatus === null ? "" : `HTTP ${out.httpStatus}`;
  const error = out.detail ?? (http || `${out.code}: ${out.reason}`);
  return {
    workflowId,
    trigger,
    status: "failed",
    error: out.detail && http ? `${http} ${error}` : error,
    ...ids,
  };
}

export type DifyUsageRow = {
  tenantId: string;
  runId: string;
  stepId: string;
  userId: string;
  /** Run command → feature của lệnh; tool/agent `dify-*` → null (R15). */
  featureId: string | null;
  /** Agent `dify-*`/agent gọi tool MCP; command → null. */
  agentId: string | null;
  usage: DifyUsage;
  latencyMs: number;
  /** Có ⇒ cùng câu SQL ghi thêm `hub.dify_runs` (`hub.log_dify_run`). */
  run?: DifyRunMeta;
};

const INT_MAX = 2_147_483_647;
const int = (n: number): number => Math.min(INT_MAX, Math.max(0, Math.floor(Number(n) || 0)));
/** `numeric` dạng chuỗi (không qua float của driver); âm/NaN → 0. */
const money = (n: number): string => (Number.isFinite(n) && n > 0 ? String(n) : "0");

/** `select hub.log_dify_usage(...)` — `exec` là transaction đang mở (`Tx`) hoặc `db.db`. */
export async function logDifyUsage(exec: Pick<Tx, "execute">, r: DifyUsageRow): Promise<void> {
  await exec.execute(difyUsageSelect(r));
}

/** Câu `select hub.log_dify_usage(...)` (văn bản cố định) — ghép sau một CTE ghi được (T18-perf: đóng bước + usage). */
export function difyUsageSelect(r: DifyUsageRow): SQL {
  const usage = sql`select hub.log_dify_usage(${r.tenantId}::uuid, ${r.runId}::uuid,
    ${r.stepId}::uuid, ${r.userId}::uuid, ${r.featureId}::uuid, ${r.agentId}::uuid,
    ${int(r.usage.input_tokens)}::int, ${int(r.usage.output_tokens)}::int,
    ${money(r.usage.cost_usd)}::numeric, ${int(r.latencyMs)}::int)`;
  return r.run ? sql`${usage}, ${difyRunCall(r, r.run)}` : usage;
}

function difyRunCall(r: DifyUsageRow, m: DifyRunMeta): SQL {
  return sql`hub.log_dify_run(${r.tenantId}::uuid, ${r.userId}::uuid, ${m.workflowId}::uuid,
    ${r.runId}::uuid, ${r.stepId}::uuid, ${m.trigger}::text, ${m.status}::text, ${int(r.latencyMs)}::int,
    ${int(r.usage.input_tokens)}::int, ${int(r.usage.output_tokens)}::int, ${m.error}::text,
    ${m.difyWorkflowRunId}::text, ${m.difyConversationId}::text, ${m.difyTaskId}::text)`;
}

/** Lời gọi Dify lỗi TRƯỚC khi Dify cấp `task_id` (vd 400 "Workflow not published"): không có usage, chỉ ghi lịch sử chạy để Admin thấy lỗi. */
export async function recordDifyRunOnly(db: Db, r: DifyUsageRow): Promise<void> {
  if (r.run) await db.db.execute(sql`select ${difyRunCall(r, r.run)}`);
}

/** Ghi ngoài transaction (vd sau khi stream Dify kết thúc). */
export function recordDifyUsage(db: Db, r: DifyUsageRow): Promise<void> {
  return logDifyUsage(db.db, r);
}
