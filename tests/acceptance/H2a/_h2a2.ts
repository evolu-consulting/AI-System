// HUB-FR-13, HUB-FR-50, HUB-FR-95, WRK-FR-13 · hạ tầng thêm cho QW-A2 (test-plan H2a §5 A30–A75, cases §6): lệnh thêm
// vào catalog, job `agent.cli` có token chèn vào **run do Hub tạo** (R2 của luồng xác nhận), claim job H1 kèm token, gọi
// JSON-RPC thô tới `/mcp`, đọc kết quả `tools/call`, kết thúc run SQL. Không chứa `it(...)`. `_h2a.ts` gần giới hạn dòng
// nên phần mới đặt ở đây.
import { expect } from "bun:test";
import { JobPayloadSchema } from "@ai/contracts/hub";
import { ToolConfirmationRequiredSchema } from "@ai/contracts/hub-internal";
import { type Hub, type Json, type Res, type Sql, USERS, type UserKey } from "../H1/_fixtures";
import type { ScriptRuntime } from "../H1/_runtime";
import { ARGS_DICH, FEAT, MAP_DICH, OUT, WF } from "./_h2a";
import { newJobToken, sqlJobPayload, tokenHash } from "./_runtime2";

/** Câu chữ nguyên văn `plan-errors` §4–5. */
export const MCP_ERR = {
  invalid: "Invalid arguments for this tool.",
  notConfigured: "This tool is not configured.",
  upstream: "The tool's service returned an error.",
  timeout: "The tool took too long to respond.",
} as const;
export const CONFIRM = {
  vi: {
    question: "Thao tác này sẽ thay đổi dữ liệu ở hệ thống bên ngoài. Bạn có muốn tiếp tục?",
    choices: ["Đồng ý", "Huỷ"],
    instruction:
      "CONFIRMATION_REQUIRED: Công cụ này cần người dùng xác nhận trước. Dừng lại và trả need_input với đúng question và choices trong structuredContent; không gọi lại công cụ trong lượt này.",
  },
  en: {
    question: "This action will change data in an external system. Do you want to continue?",
    choices: ["Agree", "Cancel"],
    instruction:
      "CONFIRMATION_REQUIRED: This tool needs user confirmation first. Stop and return need_input with exactly the question and choices in structuredContent; do not call the tool again this turn.",
  },
} as const;
export const MOCK_TEXT = "Xin chào, đây là mock.";

// ---------- catalog: lệnh thêm (trước khi dựng hub) ----------
export type ExtraCmd = {
  id: string;
  name: string;
  mode: "sync" | "async";
  timeoutS: number;
  wf?: string;
};
/** Lệnh `/dich` biến thể (cùng args/map) thuộc feature `translate` — vd async `timeout_s=3` (A34). */
export async function addCommand(sql: Sql, c: ExtraCmd): Promise<void> {
  await sql`insert into admin.commands (id, name, aliases, description, workflow_id, args, input_map, output,
      mode, timeout_s, enabled) values
    (${c.id}, ${c.name}, ${sql.array([])}, ${sql.json({ vi: `Lệnh /${c.name}`, en: null })},
     ${c.wf ?? WF.dich}, ${sql.json(ARGS_DICH as never)}, ${sql.json(MAP_DICH as never)}, ${sql.json(OUT)},
     ${c.mode}, ${c.timeoutS}, true)`;
  await sql`insert into admin.command_names (name, command_id) values (${c.name}, ${c.id})`;
  await sql`insert into admin.feature_commands (feature_id, command_id) values (${FEAT.translate}, ${c.id})`;
}

// ---------- job có token ----------
export type TokenJob = { jobId: string; token: string; stepId: string };

/**
 * Job `agent.cli` `running` có `token_hash` chèn vào run **đã có** (thường do Hub tạo qua E12): step `delegate` riêng
 * (`seq` ≥ 100, tránh đụng bộ đếm của Hub), payload hợp `JobPayloadSchema` (`mcp.tools` = `tools`). Q-T8.
 */
export async function jobInRun(
  sql: Sql,
  ids: () => string,
  runId: string,
  o: { agentId: string; agentKey: string; tools: string[]; mcpUrl: string },
): Promise<TokenJob> {
  const [r] = await sql<Json[]>`select tenant_id, user_id, conversation_id, flow_id from hub.runs
    where id = ${runId}`;
  expect(r).toBeDefined();
  const [stepId, jobId] = [ids(), ids()] as [string, string];
  const payload = sqlJobPayload(
    {
      type: "agent.cli",
      agentId: o.agentId,
      agentKey: o.agentKey,
      tools: o.tools,
      mcpUrl: o.mcpUrl,
    },
    {
      job_id: jobId,
      run_id: runId,
      step_id: stepId,
      tenant_id: r.tenant_id,
      user_id: r.user_id,
      conversation_id: r.conversation_id,
      flow_id: r.flow_id,
    },
    "",
  );
  expect(JobPayloadSchema.safeParse(payload).success).toBe(true);
  const [s] = await sql<{ n: number }[]>`select greatest(coalesce(max(seq), 0), 99) + 1 as n
    from hub.run_steps where run_id = ${runId}`;
  await sql`insert into hub.run_steps (id, tenant_id, user_id, run_id, seq, type, agent_id, provider_key, job_id,
      label_key, status) values
    (${stepId}, ${r.tenant_id}, ${r.user_id}, ${runId}, ${s?.n ?? 100}, 'delegate', ${o.agentId}, 'fake-cli',
     ${jobId}, 'step.delegate', 'running')`;
  const token = newJobToken();
  await sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, attempts, worker_id, heartbeat_at, started_at, token_hash)
    values (${jobId}, ${r.tenant_id}, ${r.user_id}, ${runId}, ${stepId}, ${r.conversation_id}, ${o.agentId},
      'agent.cli', 'fake-cli', ${sql.json(payload as never)}, 'running', 1, 'qc-rt-sql', now(), now(),
      ${tokenHash(token)})`;
  return { jobId, token, stepId };
}

/** Claim job kế của run bằng ScriptRuntime H1 rồi gắn `token_hash` như Runtime RT1 (job do Hub tạo). */
export async function claimWithToken(
  sql: Sql,
  rt: ScriptRuntime,
  runId: string,
): Promise<{ job: Awaited<ReturnType<ScriptRuntime["next"]>>; token: string }> {
  const job = await rt.next(runId);
  const token = newJobToken();
  await sql`update hub.jobs set token_hash = ${tokenHash(token)} where id = ${job.id}`;
  return { job, token };
}

/** Kết thúc run SQL (chủ instance khác) + job của nó: để E12 tiếp theo trong cùng flow không `FLOW_BUSY`. */
export async function endSqlRun(sql: Sql, runId: string): Promise<void> {
  await sql`update hub.jobs set status = 'succeeded', finished_at = now()
    where run_id = ${runId} and status in ('queued', 'running')`;
  await sql`update hub.run_steps set status = 'ok', finished_at = now()
    where run_id = ${runId} and status = 'running'`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where id = ${runId}`;
}

// ---------- JSON-RPC thô ----------
/** POST `/mcp` với body bất kỳ (chuỗi = gửi nguyên văn) và header tuỳ chọn; token null = không header. */
export async function rpcRaw(
  hub: Hub,
  token: string | null,
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
): Promise<Res> {
  const h = new Headers({ accept: "application/json, text/event-stream", ...headers });
  if (token !== null) h.set("authorization", `Bearer ${token}`);
  let payload: string | undefined;
  if (body !== undefined) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    h.set("content-type", "application/json");
  }
  const res = await fetch(`${hub.base}/mcp`, {
    method,
    headers: h,
    body: method === "GET" || method === "DELETE" ? undefined : payload,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: Json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** `tools/call` (id chuỗi) → `result` (đỏ ở `expect` nếu không 200/không có result). */
export async function toolCall(
  hub: Hub,
  token: string,
  name: string,
  args: unknown,
): Promise<{ res: Res; result: Json }> {
  const res = await rpcRaw(hub, token, {
    jsonrpc: "2.0",
    id: `call-${name}-${Math.random().toString(36).slice(2, 8)}`,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return { res, result: res.json?.result };
}

/** Kết quả `tools/call` là yêu cầu xác nhận đúng hình (plan §2.3) theo `locale`. */
export function expectConfirmation(result: Json, locale: "vi" | "en"): void {
  const c = CONFIRM[locale];
  expect(result?.isError).toBe(true);
  const first = ToolConfirmationRequiredSchema.safeParse(
    JSON.parse(result?.content?.[0]?.text ?? "null"),
  );
  expect(first.data).toEqual({
    code: "CONFIRMATION_REQUIRED",
    question: c.question,
    choices: [...c.choices] as [string, string],
  });
  expect(result?.content?.[1]?.text).toBe(c.instruction);
  expect(result?.structuredContent).toEqual(first.data as Json);
}

export const isConfirmation = (result: Json): boolean => {
  try {
    return (
      result?.isError === true &&
      ToolConfirmationRequiredSchema.safeParse(JSON.parse(result?.content?.[0]?.text ?? "null"))
        .success
    );
  } catch {
    return false;
  }
};

/** Trạng thái các xác nhận của flow (sắp `created_at`). */
export async function confirmations(sql: Sql, flowId: string): Promise<Json[]> {
  return [
    ...(await sql`select id, tenant_id, status, run_id, decided_run_id, agent_id, workflow_id
      from hub.tool_confirmations where flow_id = ${flowId} order by created_at, id`),
  ];
}

export const userOf = (who: UserKey) => USERS[who];
