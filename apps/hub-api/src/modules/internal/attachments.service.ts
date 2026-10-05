// HUB-FR-75 · WRK-BR-06 · H2c-R17 · P16 · `GET /internal/jobs/:job_id/attachments/:attachment_id` (plan H2c §5.4): token job
// (Bearer, chỉ so hash) → job `running` có đúng `id` ∧ `type='agent.cli'` ∧ payload hợp `AgentCliJobSchema` ∧ `attId` ∈
// `payload.attachments[].id` → hàng `attachments` cùng tenant của job (plan-db §2.5, scope `system`). Mọi sai → cùng
// `unauthorized` (không lộ tồn tại); `purged_at` / file mất trên kho → `not_found`. Không log token/Authorization.
import { AgentCliJobSchema } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { hashJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import type { AttachmentStorage } from "../attachments/storage";
import * as repo from "./credential.repo";
import { bearerJobToken } from "./credential.service";

export type JobDownloadResult =
  | { kind: "ok"; blob: Blob; sha256: string }
  | { kind: "unauthorized" }
  | { kind: "not_found" };

export type InternalAttachmentDeps = { db: Db; storage: AttachmentStorage; log: Logger };

const UNAUTHORIZED = { kind: "unauthorized" } as const;
const NOT_FOUND = { kind: "not_found" } as const;
export const OCTET = "application/octet-stream";

type Found = { row: repo.JobAttachmentRow } | null;

/** Token → job → payload → hàng file (một transaction `system`); null = mọi sai (401). */
async function findJobFile(tx: Tx, token: string, jobId: string, attId: string): Promise<Found> {
  const job = await repo.jobByTokenHash(tx, hashJobToken(token));
  if (!job || job.id !== jobId || job.type !== "agent.cli") return null;
  const payload = AgentCliJobSchema.safeParse(job.payload);
  if (!payload.success) return null;
  // So nguyên văn (uuid chữ thường của payload) ⇒ id sai dạng / chữ hoa không tới DB (A89).
  if (!(payload.data.attachments ?? []).some((a) => a.id === attId)) return null;
  const row = await repo.jobAttachment(tx, attId, job.tenantId);
  return row ? { row } : null;
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
}
