// HUB-FR-50 · H2c-R21–R23 · P12, P14 · plan §5.6 · tham số `file` của `tools/call`: chuỗi (đã qua `validateToolArgs`) →
// file của job (`fileArg`, `payload.attachments`) → Dify `/files/upload` (`attachments/attachment-dify.ts`) → `inputs[input]`
// = `{type, transfer_method:"local_file", upload_file_id}`. Không thuộc job ⇒ `TOOL_FILE_TEXT.NOT_ATTACHED` (0 lời gọi Dify);
// upload lỗi ⇒ `REJECTED` (`file_rejected`) / `TOOL_ERROR_TEXT` (plan-errors §3). Log `dify-upload` không tên file, không key.
import type { JobAttachment } from "@ai/contracts/hub";
import type { Logger } from "../../lib/logger";
import {
  type AttachmentDifyDeps,
  type DifyUploadTarget,
  difyFileInput,
  type UploadTrace,
  uploadToDify,
} from "../attachments/attachment-dify";
import type { CatalogWorkflow, WorkflowInputValue } from "../commands/catalog.types";
import {
  fileArg,
  TOOL_FILE_TEXT,
  type ToolErrorCode,
  type ToolResult,
  toolError,
} from "./mcp.rules";

/** Một input `file` đã đối chiếu với file của job. */
export type ToolFile = { input: string; file: JobAttachment };

export type ToolFilesResolution = { ok: true; files: ToolFile[] } | { ok: false };

/** Mỗi input `type=file` có giá trị → `fileArg`; một giá trị không thuộc job ⇒ `{ok:false}` (NOT_ATTACHED). */
export function resolveToolFiles(
  wf: Pick<CatalogWorkflow, "inputSchema">,
  inputs: Readonly<Record<string, WorkflowInputValue>>,
  attachments: readonly JobAttachment[],
): ToolFilesResolution {
  const files: ToolFile[] = [];
  for (const i of wf.inputSchema) {
    if (i.type !== "file" || inputs[i.name] === undefined) continue;
    const file = fileArg(inputs[i.name], attachments);
    if (!file) return { ok: false };
    files.push({ input: i.name, file });
  }
  return { ok: true, files };
}

export const notAttached = (): ToolResult => ({
  content: [{ type: "text", text: TOOL_FILE_TEXT.NOT_ATTACHED }],
  isError: true,
});

const rejected = (): ToolResult => ({
  content: [{ type: "text", text: TOOL_FILE_TEXT.REJECTED }],
  isError: true,
});

export type ToolFilesDeps = AttachmentDifyDeps & { log: Logger };

export type ToolUploadResult =
  | { kind: "ok"; inputs: Record<string, WorkflowInputValue>; upload: UploadTrace | null }
  | {
      kind: "failed";
      code: ToolErrorCode;
      result: ToolResult;
      trace: Record<string, unknown>;
    }
  /** `signal` đã abort (hạn tool / kết nối `/mcp` đóng) — người gọi quyết `TIMEOUT`/`CANCELLED`. */
  | { kind: "aborted"; upload: UploadTrace };

/** Upload tuần tự mọi `files` (vắng ⇒ `inputs` giữ nguyên). Ném `AttachmentContentMissing` khi kho không có nội dung. */
export async function uploadToolFiles(
  d: ToolFilesDeps,
  x: { tenantId: string; workflowId: string; target: DifyUploadTarget },
  args: { inputs: Record<string, WorkflowInputValue>; files: readonly ToolFile[] },
  signal: AbortSignal,
): Promise<ToolUploadResult> {
  const inputs = { ...args.inputs };
  let upload: UploadTrace | null = null;
  for (const f of args.files) {
    const { result: r, trace } = await uploadToDify(
      d,
      { tenantId: x.tenantId, file: f.file },
      x.target,
      signal,
    );
    upload = trace;
    d.log.info("dify-upload", {
      workflow_id: x.workflowId,
      mime: trace.mime,
      size: trace.size,
      ms: trace.ms,
      status: r.ok ? r.status : r.code === "ABORTED" ? null : r.status,
    });
    if (r.ok) {
      inputs[f.input] = difyFileInput(f.file, r.id);
      continue;
    }
    if (r.code === "ABORTED") return { kind: "aborted", upload: trace };
    const result = r.reason === "file_rejected" ? rejected() : toolError(r.code);
    const http = { reason: r.reason, http_status: r.status, upstream: r.detail };
    return { kind: "failed", code: r.code, result, trace: { ...http, upload: trace } };
  }
  return { kind: "ok", inputs, upload };
}
