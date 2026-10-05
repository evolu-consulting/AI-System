// HUB-FR-12 · H2c-R21, R22 · P13, P14 · T7–T9 · file của lệnh (`PreparedCommand.files`, ≤ 1 — T9) → Dify `/files/upload` trước
// lời gọi workflow (sync) / trước INSERT job (async) → `inputs[input] = {type, transfer_method, upload_file_id}`. Lỗi upload →
// kết cục run theo plan-errors §4 (`file_rejected` ⇒ `reason` cho hint). Log `dify-upload` (không tên file, không key).
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { Logger } from "../../../lib/logger";
import {
  AttachmentContentMissing,
  type AttachmentDifyDeps,
  difyFileInput,
  type UploadTrace,
  uploadToDify,
} from "../../attachments/attachment-dify";
import type { RunFile } from "../../attachments/run-files.rules";
import type { WorkflowInputValue } from "../catalog.types";
import type { PreparedCommand } from "../commands.service";

export type CommandFilesDeps = AttachmentDifyDeps & { log: Logger };

export type CommandFilesInput = {
  p: Pick<PreparedCommand, "files" | "inputs" | "workflow">;
  /** `RunContext.files` (kind `command` ⇒ chỉ file của tin hiện tại). */
  files: readonly RunFile[];
  tenantId: string;
  apiKey: string;
  user: string;
};

export type CommandFilesResult =
  | { kind: "ok"; inputs: Record<string, WorkflowInputValue>; upload: UploadTrace | null }
  | {
      kind: "failed";
      code: ChatRunErrorCode;
      reason: string;
      trace: Record<string, unknown>;
    }
  /** `signal` đã abort (hạn lệnh / huỷ) — người gọi quyết `TIMEOUT`/`stopped`. */
  | { kind: "aborted"; upload: UploadTrace };

/** File trong `PreparedCommand.files` không có trong tập file run (không xảy ra khi R14 đúng) — như mất nội dung. */
function runFileOf(files: readonly RunFile[], id: string): RunFile {
  const f = files.find((x) => x.id === id);
  if (!f) throw new AttachmentContentMissing(id);
  return f;
}

/** Upload mọi `files[k]` (tuần tự); vắng ⇒ `inputs` giữ nguyên, `upload = null`. */
export async function uploadCommandFiles(
  d: CommandFilesDeps,
  i: CommandFilesInput,
  signal: AbortSignal,
): Promise<CommandFilesResult> {
  const inputs: Record<string, WorkflowInputValue> = { ...i.p.inputs };
  let upload: UploadTrace | null = null;
  const target = { baseUrl: i.p.workflow.baseUrl, apiKey: i.apiKey, user: i.user };
  for (const f of i.p.files ?? []) {
    const file = runFileOf(i.files, f.attachmentId);
    const { result: r, trace } = await uploadToDify(
      d,
      { tenantId: i.tenantId, file },
      target,
      signal,
    );
    upload = trace;
    d.log.info("dify-upload", {
      workflow_id: i.p.workflow.id,
      mime: trace.mime,
      size: trace.size,
      ms: trace.ms,
      status: r.ok ? r.status : r.code === "ABORTED" ? null : r.status,
    });
    if (r.ok) {
      inputs[f.input] = difyFileInput(file, r.id);
      continue;
    }
    if (r.code === "ABORTED") return { kind: "aborted", upload: trace };
    const http = { code: r.code, reason: r.reason, http_status: r.status, upstream: r.detail };
    return { kind: "failed", code: r.code, reason: r.reason, trace: { ...http, upload: trace } };
  }
  return { kind: "ok", inputs, upload };
}
