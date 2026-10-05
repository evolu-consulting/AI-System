// HUB-FR-75 · WRK-FR-11 · WRK-FR-18 · HUB-FR-12 · HUB-FR-50 · hạ tầng thêm cho QW-A2 (test-plan H2c §2 "Runtime kịch bản",
// test-plan-int §2.8–§2.12): file "đã tải lên" (hàng SQL + nội dung ghi thẳng `<HUB_ATTACH_DIR>/<tenant>/<id>`, không qua
// `POST /attachments`), job `agent.cli` dựng SQL có `payload.attachments` + token (`insertSqlJob` H2a), gọi
// `GET /internal/jobs/:job/attachments/:att` và `POST /internal/jobs/:job/outputs` bằng token như Runtime, kết thúc job kèm
// `outputs` (XADD tay), đổi key workflow H2c, câu chữ nguyên văn `plan-rules` §3 / `plan-errors` §2–3. `_h2c.ts` gần trần
// dòng (600) nên phần mới đặt ở đây. Không chứa `it(...)`.
import { expect } from "bun:test";
import { FILENAME_HEADER } from "@ai/contracts/chat";
import {
  type AgentResult,
  type JobAttachment,
  JobAttachmentSchema,
  JobPayloadSchema,
} from "@ai/contracts/hub";
import { encryptSecret, parseMasterKey } from "../../../apps/admin-api/src/lib/secret-crypto";
import { type Hub, type Json, type Res, type Sql, USERS, type UserKey } from "../H1/_fixtures";
import { AG } from "../H1/_hub";
import type { Job, ScriptRuntime } from "../H1/_runtime";
import { type Dify, TEST_MASTER_KEY_B64 } from "../H2a/_h2a";
import { endSqlRun } from "../H2a/_h2a2";
import {
  insertSqlJob,
  newJobToken,
  type SqlJob,
  type SqlJobOpts,
  tokenHash,
} from "../H2a/_runtime2";
import { type HubC, insertAttachmentRow, pct, sha256 } from "./_h2c";

// ---------- câu chữ nguyên văn ----------
/** `plan-rules` §3. */
export const OUT_HINT =
  "To return files to the user, write them directly in the out/ directory (at most 5 files, 20 MiB each).";
export const AGENT_FILES_INTRO =
  "The user attached these files. They are in your working directory; read them by relative path:";
/** `SYSTEM_PROMPT_MAX` contract hub (readiness: 20 000). */
export const SYSTEM_PROMPT_MAX = 20_000;
/** `plan-errors` §2 (hint `UPSTREAM_ERROR` + reason `file_rejected`). */
export const FILE_REJECTED_HINT = {
  vi: "Dify không nhận file này (loại hoặc kích thước).",
  en: "Dify rejected this file (type or size).",
} as const;
/** `plan-errors` §3 (`TOOL_FILE_TEXT`). */
export const TOOL_FILE = {
  notAttached: "This file is not attached to this message.",
  rejected: "Dify rejected this file (type or size).",
} as const;
/** Thân 401 nội bộ (một thân cho mọi sai — `plan-errors` §1 "Nội bộ"). */
export const UNAUTHORIZED = { error: { code: "UNAUTHORIZED", message: "Unauthorized" } } as const;
export const PDF = "application/pdf";

export type Brief = { name: string; mime: string; size: number };
export const kb = (size: number): number => Math.max(1, Math.ceil(size / 1024));
/** `orchestratorFilesBlock` (R15) dựng lại từ câu chữ plan. */
export const orchBlock = (items: readonly Brief[]): string =>
  `<attachments>\n${items.map((i) => `- ${i.name} (${i.mime}, ${kb(i.size)} KB)`).join("\n")}\n</attachments>`;
/** `agentFilesBlock` (R15/R24) dựng lại từ câu chữ plan. */
export const agentBlock = (items: readonly Brief[]): string =>
  `<attachments>\n${AGENT_FILES_INTRO}\n${items
    .map((i) => `- attachments/${i.name} (${i.mime}, ${kb(i.size)} KB)`)
    .join("\n")}\n</attachments>`;

// ---------- file "đã tải lên" ----------
export type StoredFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  content: Uint8Array;
};
/** Hàng `origin='upload'` chưa gắn của `who` + nội dung trên đĩa của `hub` (như sau `POST /attachments` 201). */
export async function storedFile(
  sql: Sql,
  hub: HubC,
  name: string,
  content: Uint8Array,
  o: { who?: UserKey; mime?: string } = {},
): Promise<StoredFile> {
  const mime = o.mime ?? PDF;
  const r = await insertAttachmentRow(sql, {
    who: o.who ?? "lan",
    filename: name,
    mime,
    content,
    dir: hub.dir,
  });
  return { id: r.id, name, mime, size: content.length, sha256: sha256(content), content };
}
export const jobAttachmentOf = (f: StoredFile): JobAttachment => ({
  id: f.id,
  name: f.name,
  mime: f.mime as JobAttachment["mime"],
  size: f.size,
  sha256: f.sha256,
});
export const briefOf = (f: StoredFile): Brief => ({ name: f.name, mime: f.mime, size: f.size });

// ---------- job agent dựng SQL có file ----------
export type FileJob = SqlJob & { userMessageId: string; files: StoredFile[] };
export type FileJobOpts = Partial<SqlJobOpts> & {
  files?: { name: string; content: Uint8Array; mime?: string }[];
};
/**
 * `insertSqlJob` (agent `hoadon`, MCP `${hub}/mcp`, `running`, token) + file gắn vào tin user của run (position theo thứ
 * tự) + `payload.attachments` (khi job `agent.cli` và có file) + `runs.attachment_ids`. Payload hợp `JobPayloadSchema`.
 */
export async function fileJob(sql: Sql, hub: HubC, o: FileJobOpts = {}): Promise<FileJob> {
  const who = o.who ?? "lan";
  const j = await insertSqlJob(sql, () => crypto.randomUUID(), {
    type: "agent.cli",
    agentId: AG.hoadon,
    agentKey: "hoadon",
    mcpUrl: `${hub.base}/mcp`,
    ...o,
    who,
  });
  const [run] = await sql<{ m: string }[]>`select user_message_id as m from hub.runs
    where id = ${j.runId}`;
  const userMessageId = run?.m ?? "";
  const files: StoredFile[] = [];
  for (const [i, f] of (o.files ?? []).entries()) {
    const s = await storedFile(sql, hub, f.name, f.content, { who, mime: f.mime });
    await sql`update hub.attachments set message_id = ${userMessageId}, conversation_id = ${j.convId},
      flow_id = ${j.flowId}, position = ${i}, bound_at = now() where id = ${s.id}`;
    files.push(s);
  }
  if (files.length > 0) await attachToJob(sql, j.jobId, files.map(jobAttachmentOf));
  if (files.length > 0)
    await sql`update hub.runs set attachment_ids = ${sql.array(
      files.map((f) => f.id),
      2950,
    )} where id = ${j.runId}`;
  return { ...j, userMessageId, files };
}
/** Ghi `payload.attachments` (job `agent.cli`); payload sau đó phải hợp contract C2. */
export async function attachToJob(
  sql: Sql,
  jobId: string,
  atts: readonly JobAttachment[],
): Promise<void> {
  for (const a of atts) expect(JobAttachmentSchema.safeParse(a).success).toBe(true);
  const [row] = await sql<{ payload: Json }[]>`update hub.jobs
    set payload = payload || ${sql.json({ attachments: atts } as never)}
    where id = ${jobId} returning payload`;
  expect(JobPayloadSchema.safeParse(row?.payload).success).toBe(true);
}

// ---------- endpoint nội bộ (token job) ----------
export type BinRes = Res & { bytes: Uint8Array };
const authHeader = (token: string | null): Record<string, string> =>
  token === null ? {} : { authorization: `Bearer ${token}` };
async function asRes(res: Response): Promise<BinRes> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json: Json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json, bytes };
}
/** `GET /internal/jobs/:job/attachments/:att` (token null = không header). */
export async function internalGet(
  hub: Hub,
  jobId: string,
  attId: string,
  token: string | null,
  headers: Record<string, string> = {},
): Promise<BinRes> {
  const res = await fetch(`${hub.base}/internal/jobs/${jobId}/attachments/${attId}`, {
    headers: { ...authHeader(token), ...headers },
    keepalive: false,
    signal: AbortSignal.timeout(20_000),
  });
  return asRes(res);
}
/** `POST /internal/jobs/:job/outputs` thân thô + `X-Filename` (name null = không header). Kết nối riêng (QW-A1 #2). */
export async function postOutput(
  hub: Hub,
  jobId: string,
  token: string | null,
  name: string | null,
  body: Uint8Array,
): Promise<BinRes> {
  const h: Record<string, string> = {
    ...authHeader(token),
    "content-type": "application/octet-stream",
  };
  if (name !== null) h[FILENAME_HEADER] = pct(name);
  const res = await fetch(`${hub.base}/internal/jobs/${jobId}/outputs`, {
    method: "POST",
    headers: h,
    body: body as BodyInit,
    keepalive: false,
    signal: AbortSignal.timeout(20_000),
  });
  return asRes(res);
}
/** Claim lại job (PL10, H2b requeue): `started_at` mới + token mới. Trả token mới. */
export async function reclaim(sql: Sql, jobId: string): Promise<string> {
  const t = newJobToken();
  await sql`update hub.jobs set started_at = clock_timestamp(), attempts = attempts + 1,
    token_hash = ${tokenHash(t)} where id = ${jobId}`;
  return t;
}

// ---------- Runtime kịch bản: kết quả kèm outputs, requeue ----------
/** Như `ScriptRuntime.agent` + `outputs` trong `job.result` (contract C2). */
export async function agentWithOutputs(
  rt: ScriptRuntime,
  sql: Sql,
  job: Job,
  r: AgentResult,
  outputs?: string[],
): Promise<void> {
  const output = { kind: "agent_result", result: r };
  await sql`update hub.jobs set status = 'succeeded', result = ${sql.json(output as never)},
      finished_at = now(), pgid = null
    where id = ${job.id} and status = 'running'`;
  await rt.emit(job, {
    type: "job.result",
    output,
    usage: { input_tokens: 100, output_tokens: 20 },
    session_resumed: false,
    ...(outputs ? { outputs } : {}),
  } as never);
}
/** Requeue (H2b): job về `queued`; cùng `rt` claim lại được (`seq` tiếp tục). */
export async function requeue(sql: Sql, rt: ScriptRuntime, jobId: string): Promise<void> {
  await sql`update hub.jobs set status = 'queued', worker_id = null where id = ${jobId}`;
  (rt as unknown as { seen: Set<string> }).seen.delete(jobId);
}
/** Kết thúc (SQL) mọi run `running` dựng bằng `insertSqlJob` (chủ `qc-other-instance`) — trước `settleRuns`. */
export async function endSqlRuns(sql: Sql): Promise<void> {
  const rows = await sql<{ id: string }[]>`select id from hub.runs
    where status = 'running' and owner = 'qc-other-instance'`;
  for (const r of rows) await endSqlRun(sql, r.id);
}
/** Hàng output (SQL, như sau `/outputs` 201) của job `jobId` (hội thoại/flow của run); có `content` + `dir` ⇒ ghi file. */
export async function outputRow(
  sql: Sql,
  o: {
    who?: UserKey;
    jobId: string;
    conv: string;
    flow: string;
    name: string;
    content?: Uint8Array;
    dir?: string;
  },
): Promise<string> {
  const r = await insertAttachmentRow(sql, {
    who: o.who ?? "lan",
    origin: "output",
    jobId: o.jobId,
    filename: o.name,
    mime: "text/markdown",
    conversationId: o.conv,
    flowId: o.flow,
    content: o.content,
    dir: o.dir,
  });
  // lần claim hiện hành (PL10): `created_at` = `jobs.started_at` + 1 s (không phụ thuộc lệch đồng hồ host/DB)
  await sql`update hub.attachments set created_at = coalesce(
      (select started_at from hub.jobs where id = ${o.jobId}) + interval '1 second', created_at)
    where id = ${r.id}`;
  return r.id;
}

// ---------- Dify (MK) ----------
export const uploadsOf = (dify: Dify, name?: string) =>
  dify.mock
    .calls()
    .filter(
      (c) =>
        c.path === "/v1/files/upload" &&
        (name === undefined || (c.body as Json)?.file?.name === name),
    );
export const difyUser = (who: UserKey): string => `acme:${USERS[who].id}`;
/** Đổi key (kịch bản MK) của workflow H2c (`admin.secrets` theo `workflows.secret_id`; proxy bỏ `~pad`). */
export async function setWorkflowKey(
  sql: Sql,
  workflowId: string,
  scenario: string,
): Promise<void> {
  const [w] = await sql<{ s: string }[]>`select secret_id as s from admin.workflows
    where id = ${workflowId}`;
  const value = `${scenario}~pad`;
  const s = encryptSecret(parseMasterKey(TEST_MASTER_KEY_B64), w?.s ?? "", value);
  await sql`update admin.secrets set ciphertext = ${Buffer.from(s.ciphertext)}, iv = ${Buffer.from(s.iv)},
    key_version = 1, last4 = ${value.slice(-4)}, updated_at = now() where id = ${w?.s ?? ""}`;
}
