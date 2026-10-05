// HUB-FR-75 · WRK-BR-06 · WRK-FR-18 · H2c-R17, R25 · P16, P21 · endpoint file nội bộ (plan H2c §5.4, §5.5): token job
// (Bearer, chỉ so hash) → job `running` có đúng `id` ∧ `type='agent.cli'` ∧ payload hợp `AgentCliJobSchema`.
// Tải (R17): ∧ `attId` ∈ `payload.attachments[].id` → hàng `attachments` cùng tenant của job (plan-db §2.5, scope `system`);
// `purged_at` / file mất trên kho → `not_found`. Output (R25): ∧ `payload.agent.role='agent'` → `AttachmentService.ingestOutput`
// (≤ 5/lần claim, luồng tải lên). Mọi sai xác thực → cùng `unauthorized` (không lộ tồn tại). Không log token/Authorization.
import type { Attachment } from "@ai/contracts/chat";
import { type AgentCliJob, AgentCliJobSchema } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { hashJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import {
  type AttachmentService,
  OutputClaimLost,
  type OutputJob,
  type UploadInput,
} from "../attachments/attachments.service";
import type { AttachmentStorage } from "../attachments/storage";
import * as repo from "./credential.repo";
import { bearerJobToken } from "./credential.service";

export type JobDownloadResult =
  | { kind: "ok"; blob: Blob; sha256: string }
  | { kind: "unauthorized" }
  | { kind: "not_found" };

export type JobOutputResult = { kind: "ok"; id: string } | { kind: "unauthorized" };

export type InternalAttachmentDeps = {
  db: Db;
  storage: AttachmentStorage;
  files: AttachmentService;
  log: Logger;
};

const UNAUTHORIZED = { kind: "unauthorized" } as const;
const NOT_FOUND = { kind: "not_found" } as const;
export const OCTET = "application/octet-stream";

type Found = { row: repo.JobAttachmentRow } | null;

type AgentJob = { job: repo.CredentialJob; payload: AgentCliJob };

/** Token → job `running` đúng `id`, `agent.cli`, payload hợp contract; null = mọi sai (401). */
async function agentJob(tx: Tx, token: string, jobId: string): Promise<AgentJob | null> {
  const job = await repo.jobByTokenHash(tx, hashJobToken(token));
  if (!job || job.id !== jobId || job.type !== "agent.cli") return null;
  const payload = AgentCliJobSchema.safeParse(job.payload);
  return payload.success ? { job, payload: payload.data } : null;
}

/** Token → job → payload → hàng file (một transaction `system`); null = mọi sai (401). */
async function findJobFile(tx: Tx, token: string, jobId: string, attId: string): Promise<Found> {
  const found = await agentJob(tx, token, jobId);
  if (!found) return null;
  // So nguyên văn (uuid chữ thường của payload) ⇒ id sai dạng / chữ hoa không tới DB (A89).
  if (!(found.payload.attachments ?? []).some((a) => a.id === attId)) return null;
  const row = await repo.jobAttachment(tx, attId, found.job.tenantId);
  return row ? { row } : null;
}

/** R25: job agent (role `agent`, không Orchestrator) → chủ + nơi của output; null = 401. */
async function outputJob(tx: Tx, token: string, jobId: string): Promise<OutputJob | null> {
  const found = await agentJob(tx, token, jobId);
  if (found?.payload.agent.role !== "agent") return null;
  return {
    jobId: found.job.id,
    tokenHash: hashJobToken(token),
    tenantId: found.job.tenantId,
    userId: found.job.userId,
    conversationId: found.payload.conversation_id,
    flowId: found.payload.flow_id,
  };
}

export class InternalAttachmentService {
  constructor(private readonly d: InternalAttachmentDeps) {}

  async download(
    authorization: string | undefined,
    jobId: string,
    attId: string,
  ): Promise<JobDownloadResult> {
    const token = bearerJobToken(authorization);
    if (!token) return UNAUTHORIZED;
    const found = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      findJobFile(tx, token, jobId, attId),
    );
    if (!found) return UNAUTHORIZED;
    const { row } = found;
    if (row.purged_at !== null) return NOT_FOUND;
    // `Blob` (đọc lười từ đĩa) thay vì stream: Bun giữ `Content-Length` (thân stream ⇒ chunked, mất độ dài).
    const file = await this.d.storage.blob(row.storage_key, OCTET);
    if (!file) {
      this.d.log.error("attachment-content-missing", { attachment_id: row.id });
      return NOT_FOUND;
    }
    this.d.log.info("attachment-served", { attachment_id: row.id, job_id: jobId });
    return { kind: "ok", blob: file, sha256: row.sha256 };
  }

  /**
   * `POST /internal/jobs/:job_id/outputs` (R25): xác thực như `download` (+ role `agent`) rồi `ingestOutput`. Lỗi tải lên
   * (400/409/413/415/500) ném `AppError` như `POST /attachments`. Claim mất trước khi chốt INSERT (requeue/kết thúc giữa
   * chừng — RV-1) ⇒ 401 như mọi sai xác thực (đã rollback + xoá `.part`).
   */
  async output(
    authorization: string | undefined,
    jobId: string,
    input: UploadInput,
  ): Promise<JobOutputResult> {
    const token = bearerJobToken(authorization);
    if (!token) return UNAUTHORIZED;
    const job = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      outputJob(tx, token, jobId),
    );
    if (!job) return UNAUTHORIZED;
    try {
      const out: Attachment = await this.d.files.ingestOutput(job, input, this.d.log);
      return { kind: "ok", id: out.id };
    } catch (e) {
      if (!(e instanceof OutputClaimLost)) throw e;
      // RV2-5 · 401 vì claim đổi giữa chừng (khác token sai) — vết vận hành; không log token.
      this.d.log.info("output-claim-lost", { job_id: jobId });
      return UNAUTHORIZED;
    }
  }
}
