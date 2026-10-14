// HUB-FR-129 · HUB-FR-130 · WRK-FR-29 · HUB-BR-14 · PC2-R13 · P-c2 · `POST /internal/jobs/:job_id/apply-result` (plan §3.5,
// §6.3). Thứ tự: token job (sai/thiếu/job khác ⇒ 401 MỘT thân) → job `source.apply` ∧ `running` (khác ⇒ 409
// APPLY_NOT_EXPECTED) → thân zod `ApplyReport` (400) → blob log test NGOÀI tx → tx `system` (`tenant_id` job): attachment
// output + INSERT `autofix_applies` (mode = `payload.apply_mode` lúc launch, C8; `error_code` bất biến C11) → commit blob.
// 23505 `autofix_applies_job_uq` ⇒ 409 APPLY_RESULT_EXISTS (blob `.part` bị discard). KHÔNG log giá trị khoá / thân.
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";
import { type SourceApplyJob, SourceApplyJobSchema } from "@ai/contracts/hub";
import type { ApplyErrorCode } from "@ai/contracts/hub-admin";
import { type ApplyReport, ApplyReportSchema } from "@ai/contracts/hub-internal";
import { withHubScope } from "@ai/db/hub-scope";
import type { NewAutofixApply } from "@ai/db/schema/hub-autofix";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import { hashJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import { type AttachmentStorage, type Staged, storageKey } from "../attachments/storage";
import * as repo from "./apply.repo";
import {
  type AutofixJob,
  type FileRow,
  insertOutputFile,
  jobByTokenAnyStatus,
  stillRunning,
} from "./autofix.repo";
import { bearerJobToken } from "./credential.service";

export type ApplyReportResult =
  | { kind: "ok"; id: string }
  | { kind: "unauthorized" }
  | { kind: "not_expected" }
  | { kind: "exists" }
  | { kind: "invalid" };

export type InternalApplyDeps = { db: Db; storage: AttachmentStorage; log: Logger };

type Expected = {
  job: AutofixJob;
  payload: SourceApplyJob;
  processRunId: string;
  stageRunId: string;
};
type StagedFile = { row: FileRow; staged: Staged };

const UNAUTHORIZED = { kind: "unauthorized" } as const;
const NOT_EXPECTED = { kind: "not_expected" } as const;
const INVALID = { kind: "invalid" } as const;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** `<stage_key>-apply-test.log.txt` (stage key lấy từ nhánh `ai/<run>/<stage>`). */
export function testLogName(branch: string): string {
  return `${branch.split("/")[2] ?? "apply"}-apply-test.log.txt`;
}

/** C11 · `failed` ⇒ mã Runtime; `check_failed` ⇒ `"check_failed"`; `pushed`/`conflict` ⇒ null (CHECK `err_req_ck`). */
export function applyErrorCode(r: ApplyReport): ApplyErrorCode | null {
  if (r.status === "failed") return r.code;
  if (r.status === "check_failed") return "check_failed";
  return null;
}

function applyRow(
  e: Expected,
  r: ApplyReport,
  logId: string | null,
  autofixResultId: string | null,
): NewAutofixApply {
  return {
    tenantId: e.job.tenantId,
    processRunId: e.processRunId,
    stageRunId: e.stageRunId,
    jobId: e.job.id,
    autofixResultId,
    sourceKey: e.payload.source.key,
    mode: e.payload.apply_mode,
    status: r.status,
    branch: e.payload.branch,
    pinSha: e.payload.pin_sha,
    targetSha: r.target_sha,
    headSha: r.head_sha,
    rebased: r.rebased,
    errorCode: applyErrorCode(r),
    detail: r.detail ?? null,
    conflictFiles: r.conflict_files,
    failures: r.failures,
    testExitCode: r.test?.exit_code ?? null,
    testDurationMs: r.test?.duration_ms ?? null,
    testLogAttachmentId: logId,
  };
}

export class InternalApplyService {
  constructor(private readonly d: InternalApplyDeps) {}

  async report(
    authorization: string | undefined,
    jobId: string,
    raw: string,
  ): Promise<ApplyReportResult> {
    const token = bearerJobToken(authorization);
    if (!token) return UNAUTHORIZED;
    const hash = hashJobToken(token);
    const job = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      jobByTokenAnyStatus(tx, hash),
    );
    if (!job || job.id !== jobId) return UNAUTHORIZED;
    if (job.type !== "source.apply" || job.status !== "running") return NOT_EXPECTED;
    const parsed = ApplyReportSchema.safeParse(parseJson(raw));
    if (!parsed.success) return INVALID;
    const p = SourceApplyJobSchema.safeParse(job.payload);
    if (!p.success || !job.processRunId || !job.stageRunId) {
      this.d.log.warn("apply-result-bad-payload", { job_id: jobId });
      return NOT_EXPECTED;
    }
    return this.persist(
      { job, payload: p.data, processRunId: job.processRunId, stageRunId: job.stageRunId },
      parsed.data,
      hash,
    );
  }

  /** Blob log test (ngoài tx) → tx ghi attachment + hàng → commit blob; lỗi/409 ⇒ discard `.part`. */
  private async persist(e: Expected, r: ApplyReport, hash: Buffer): Promise<ApplyReportResult> {
    const log = r.test && r.test.log_tail !== "" ? r.test.log_tail : null;
    const staged: StagedFile[] = [];
    try {
      const logFile =
        log !== null ? await this.stage(e, testLogName(e.payload.branch), log, staged) : null;
      const id = await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
        if (!(await stillRunning(tx, e.job.id, hash))) return null;
        const afId = await repo.autofixResultIdByDiff(tx, e.job.tenantId, e.payload.patch.id);
        for (const f of staged) await insertOutputFile(tx, f.row);
        return repo.insertApply(tx, applyRow(e, r, logFile, afId));
      });
      if (id === null) {
        await discardAll(staged);
        return NOT_EXPECTED;
      }
      await this.commitAll(staged);
      this.d.log.info("apply-result-saved", { job_id: e.job.id, status: r.status });
      return { kind: "ok", id };
    } catch (err) {
      await discardAll(staged);
      if (repo.isApplyExists(err)) return { kind: "exists" };
      throw err;
    }
  }

  private async stage(e: Expected, name: string, text: string, out: StagedFile[]): Promise<string> {
    const id = crypto.randomUUID();
    const key = storageKey(e.job.tenantId, id);
    const body = new Blob([text], { type: "text/plain" }).stream();
    const staged = await this.d.storage.stage(key, body, { maxBytes: ATTACH_MAX_BYTES });
    out.push({
      staged,
      row: {
        id,
        tenantId: e.job.tenantId,
        userId: e.job.userId,
        jobId: e.job.id,
        name,
        size: staged.size,
        sha256: staged.sha256,
        storageKey: key,
      },
    });
    return id;
  }

  /** Sau COMMIT: lỗi rename ⇒ log; sweeper `promote` hoàn tất `.part` (PL13). */
  private async commitAll(files: StagedFile[]): Promise<void> {
    for (const f of files) {
      try {
        await f.staged.commit();
      } catch (err) {
        this.d.log.error("apply-blob-commit-failed", {
          attachment_id: f.row.id,
          ...safeErrorFields(err),
        });
      }
    }
  }
}

async function discardAll(files: StagedFile[]): Promise<void> {
  for (const f of files) await f.staged.discard().catch(() => {});
}
