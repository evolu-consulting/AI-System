// HUB-FR-128 · HUB-FR-130 · WRK-FR-29 · HUB-BR-14 · PC-R12 · PC-R14 · PC-R16 · P-c1 · `POST /internal/jobs/:job_id/autofix-
// result` (plan §3.3, §6.2). Thứ tự: token job (401 một thân) → job `running` + `payload.autofix` + run stage (409
// `AUTOFIX_NOT_EXPECTED`) → thân (400; diff > 2 MiB ⇒ 413) → nhánh khớp job (`reportMatchesJob`, 400) → stage blob diff/log
// NGOÀI tx → tx `system` (`tenant_id` của job): attachments output text/plain + `autofix_results` → commit blob sau COMMIT
// (R05). 23505 `autofix_results_job_uq` ⇒ 409 `AUTOFIX_RESULT_EXISTS` (blob `.part` bị discard). PC-R16: KHÔNG kiểm hạn mức
// file (ghi thẳng như output quy trình). Không log token/thân báo cáo.
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";
import { AgentCliJobSchema, type JobAutofix } from "@ai/contracts/hub";
import { AUTOFIX_DIFF_MAX_BYTES } from "@ai/contracts/hub-admin";
import { type AutofixReport, AutofixReportSchema } from "@ai/contracts/hub-internal";
import { withHubScope } from "@ai/db/hub-scope";
import type { NewAutofixResult } from "@ai/db/schema/hub-autofix";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import { hashJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import { type AttachmentStorage, type Staged, storageKey } from "../attachments/storage";
import { reportMatchesJob } from "../processes/runs/autofix.rules";
import * as repo from "./autofix.repo";
import { bearerJobToken } from "./credential.service";

export type AutofixReportResult =
  | { kind: "ok"; id: string }
  | { kind: "unauthorized" }
  | { kind: "not_expected" }
  | { kind: "exists" }
  | { kind: "invalid" }
  | { kind: "too_large" };

export type InternalAutofixDeps = { db: Db; storage: AttachmentStorage; log: Logger };

type Expected = {
  job: repo.AutofixJob & { processRunId: string; stageRunId: string };
  autofix: JobAutofix;
};
type Gate = { kind: "unauthorized" } | { kind: "not_expected" } | { kind: "go"; e: Expected };
type StagedFile = { row: repo.FileRow; staged: Staged };

const UNAUTHORIZED = { kind: "unauthorized" } as const;
const NOT_EXPECTED = { kind: "not_expected" } as const;
const INVALID = { kind: "invalid" } as const;

/** Token → job. Sai token / id / loại / payload ⇒ 401; đúng job nhưng không chờ báo cáo tự-sửa ⇒ 409. */
function gate(job: repo.AutofixJob | undefined, jobId: string): Gate {
  if (!job || job.id !== jobId || job.type !== "agent.cli") return UNAUTHORIZED;
  const p = AgentCliJobSchema.safeParse(job.payload);
  if (!p.success) return UNAUTHORIZED;
  const { processRunId, stageRunId } = job;
  if (job.status !== "running" || !p.data.autofix || !processRunId || !stageRunId)
    return NOT_EXPECTED;
  return { kind: "go", e: { job: { ...job, processRunId, stageRunId }, autofix: p.data.autofix } };
}

/** Thân thô → báo cáo. diff vượt trần (byte UTF-8) ⇒ 413 trước zod (zod chỉ cho 400). `ok` ⇒ diff khác rỗng. */
export function parseReport(raw: string): AutofixReport | { kind: "invalid" | "too_large" } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return INVALID;
  }
  const diff = (body as { diff?: unknown } | null)?.diff;
  if (typeof diff === "string" && Buffer.byteLength(diff, "utf8") > AUTOFIX_DIFF_MAX_BYTES)
    return { kind: "too_large" };
  const r = AutofixReportSchema.safeParse(body);
  if (!r.success || (r.data.status === "ok" && !r.data.diff)) return INVALID;
  return r.data;
}

/** `<stage_key>-r<round>.diff.txt` / `<stage_key>-r<round>-test.log.txt` (stage key lấy từ nhánh `ai/<run>/<stage>`). */
export function fileNames(branch: string, round: number): { diff: string; log: string } {
  const stage = branch.split("/")[2] ?? "stage";
  return { diff: `${stage}-r${round}.diff.txt`, log: `${stage}-r${round}-test.log.txt` };
}

function resultRow(e: Expected, r: AutofixReport, files: Record<"diff" | "log", string | null>) {
  return {
    tenantId: e.job.tenantId,
    processRunId: e.job.processRunId,
    stageRunId: e.job.stageRunId,
    jobId: e.job.id,
    round: e.autofix.round,
    sourceKey: e.autofix.source.key,
    pin: e.autofix.source.pin,
    branch: r.branch,
    baseSha: r.base_sha,
    headSha: r.head_sha,
    status: r.status,
    failures: r.failures,
    diffStats: r.diff_stats,
    diffAttachmentId: files.diff,
    testLogAttachmentId: files.log,
    testExitCode: r.test?.exit_code ?? null,
    testDurationMs: r.test?.duration_ms ?? null,
    commands: r.commands,
  } satisfies NewAutofixResult;
}

export class InternalAutofixService {
  constructor(private readonly d: InternalAutofixDeps) {}

  async report(
    authorization: string | undefined,
    jobId: string,
    raw: string,
  ): Promise<AutofixReportResult> {
    const token = bearerJobToken(authorization);
    if (!token) return UNAUTHORIZED;
    const hash = hashJobToken(token);
    const g = gate(
      await withHubScope(this.d.db, { kind: "system" }, (tx) => repo.jobByTokenAnyStatus(tx, hash)),
      jobId,
    );
    if (g.kind !== "go") return g;
    const report = parseReport(raw);
    if ("kind" in report) return report;
    if (!reportMatchesJob(report, g.e)) return INVALID;
    return this.persist(g.e, report, hash);
  }

  /** Stage blob (ngoài tx) → tx ghi hàng → commit blob; lỗi/409 ⇒ discard `.part`. */
  private async persist(e: Expected, r: AutofixReport, hash: Buffer): Promise<AutofixReportResult> {
    const names = fileNames(r.branch, e.autofix.round);
    const log = r.test && r.test.log_tail !== "" ? r.test.log_tail : null;
    const staged: StagedFile[] = [];
    try {
      const diffFile = r.diff ? await this.stage(e, names.diff, r.diff, staged) : null;
      const logFile = log !== null ? await this.stage(e, names.log, log, staged) : null;
      const row = resultRow(e, r, { diff: diffFile, log: logFile });
      const id = await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
        if (!(await repo.stillRunning(tx, e.job.id, hash))) return null;
        for (const f of staged) await repo.insertOutputFile(tx, f.row);
        return repo.insertResult(tx, row);
      });
      if (id === null) {
        await discardAll(staged);
        return NOT_EXPECTED;
      }
      await this.commitAll(staged);
      this.d.log.info("autofix-result-saved", { job_id: e.job.id, status: r.status });
      return { kind: "ok", id };
    } catch (err) {
      await discardAll(staged);
      if (repo.isResultExists(err)) return { kind: "exists" };
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
        this.d.log.error("autofix-blob-commit-failed", {
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
