// HUB-FR-44 · HUB-FR-75 · WRK-FR-18 · H2c-R01–R07, R13, R25 · nghiệp vụ `POST /attachments` (plan §5.1), output job
// (`ingest` origin `output`, plan §5.5 — gọi từ `internal/attachments.service`) và `GET /attachments/:id(/content)` (plan
// §5.7, P22). Thứ tự kiểm plan §2.4: header (400) → đuôi (415) → `Content-Length` (413/400) → hạn mức sớm (409) → stream ra
// `.part` (413/415/400) → transaction khoá tenant (409 chốt; output: ≤ 5/lần claim chốt — P21) → INSERT → commit DB → rename
// (R05). Hạn mức là **theo tenant** ⇒ câu SUM/khoá/INSERT chạy scope `system` với `tenant_id`/`user_id` của chủ (JWT hoặc
// job) (spec-decisions "BUILD — B2/B3" B2-1). Không log tên file, không byte thân. REVIEW 1 — Hub: ≤ 3 upload đồng thời
// mỗi user (RV-5, 429 `TOO_MANY_RUNS`); output: cùng tên trong lần claim = thay (RV-2), claim còn giữ dưới khoá (RV-1).
import { randomUUID } from "node:crypto";
import {
  ATTACH_MAX_BYTES,
  type AttachMime,
  type Attachment,
  type AttachmentDetail,
  RETRY_AFTER_HEADER,
  TOO_MANY_RUNS_RETRY_AFTER_S,
} from "@ai/contracts/chat";
import { JOB_OUTPUTS_MAX } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { AppError, appError, safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import {
  type AttachExt,
  contentDisposition,
  displayName,
  extOf,
  mimeOf,
  overQuota,
  parseFilenameHeader,
  safeName,
} from "./attachment.rules";
import {
  claimHeld,
  countJobOutputs,
  deleteAttachment,
  findOwnedAttachment,
  insertAttachment,
  lockTenantQuota,
  type OwnedAttachment,
  quotaUsed,
  supersedeJobOutput,
} from "./attachments.repo";
import { countedBody } from "./counted-body";
import { FileInspector } from "./sniff.rules";
import {
  type AttachmentStorage,
  type Staged,
  StorageKeyError,
  StorageRejected,
  StorageTooLarge,
  storageKey,
} from "./storage";

export type UploadInput = {
  /** Giá trị thô `X-Filename`. */
  filenameRaw: string | undefined;
  /** `Content-Length` (null = vắng/chunked). */
  contentLength: number | null;
  body: ReadableStream<Uint8Array> | null;
};

/** Chủ + nguồn của hàng mới. `output`: `jobId` + hội thoại/flow của payload job, chưa `message_id` (plan §5.5). */
export type IngestTarget = {
  tenantId: string;
  userId: string;
  origin: "upload" | "output";
  jobId: string | null;
  conversationId: string | null;
  flowId: string | null;
  /**
   * Kiểm thêm trong transaction INSERT, ngay sau khoá tenant, trước hạn mức chốt (output: thay cùng tên RV-2, claim còn giữ
   * RV-1, P21 ≤ 5 tên/lần claim) — ném ⇒ rollback + xoá `.part`.
   */
  guard?: (tx: Tx, row: { safeName: string }) => Promise<void>;
};

/** Job agent đã xác thực (token → job `running`, role `agent`) — chủ + nơi của output (plan §5.5). */
export type OutputJob = {
  jobId: string;
  /** Hash token của lần claim đã xác thực — kiểm lại dưới khoá (RV-1). */
  tokenHash: Buffer;
  tenantId: string;
  userId: string;
  conversationId: string;
  flowId: string;
};

export type AttachmentServiceDeps = { db: Db; storage: AttachmentStorage; tenantMaxBytes: number };

/** RV-5 · upload `POST /attachments` đồng thời tối đa mỗi user (trong tiến trình — v1 một Hub). */
export const UPLOADS_PER_USER_MAX = 3;

/** RV-1 · lần claim đã xác thực không còn giữ khi chốt (requeue/kết thúc giữa chừng) ⇒ người gọi trả 401. */
export class OutputClaimLost extends Error {
  constructor() {
    super("output claim lost");
  }
}

/**
 * Nội dung + header R13 của `/content` (plan §5.7). `Blob` (đọc lười từ đĩa) thay vì stream: Bun chỉ gửi `Content-Length`
 * khi thân có kích thước biết trước (stream ⇒ chunked) — spec-decisions "BUILD — B2/B3" B3-1.
 */
export type ContentResult = { body: Blob; headers: Record<string, string> };

const SYSTEM = { kind: "system" } as const;
const tooLarge = () => appError("ATTACHMENT_TOO_LARGE", { max_bytes: ATTACH_MAX_BYTES });
const badField = (field: "X-Filename" | "body") => appError("VALIDATION_ERROR", { field });
const tooManyUploads = () =>
  appError("TOO_MANY_RUNS", undefined, {
    [RETRY_AFTER_HEADER]: String(TOO_MANY_RUNS_RETRY_AFTER_S),
  });

/** P21 chốt: ≥ `JOB_OUTPUTS_MAX` tên output khác `name` trong lần claim ⇒ 409. */
async function outputsFull(tx: Tx, jobId: string, name: string): Promise<void> {
  if ((await countJobOutputs(tx, jobId, name)) >= JOB_OUTPUTS_MAX)
    throw appError("ATTACHMENT_QUOTA_EXCEEDED");
}

/** Guard output dưới khoá tenant — thứ tự khoá P8: attachments (thay cùng tên) → jobs (`FOR SHARE`). */
async function outputGuard(tx: Tx, j: OutputJob, name: string): Promise<void> {
  await supersedeJobOutput(tx, j.jobId, name);
  if (!(await claimHeld(tx, j.jobId, j.tokenHash))) throw new OutputClaimLost();
  await outputsFull(tx, j.jobId, name);
}
/** Trường log chung (không tên file); `output` thêm `job_id` (plan-errors §5). */
const logBase = (t: IngestTarget) => ({
  tenant_id: t.tenantId,
  user_id: t.userId,
  origin: t.origin,
  ...(t.jobId ? { job_id: t.jobId } : {}),
});

/** Tên + loại đã kiểm từ `X-Filename` (400 → 415). */
function checkName(raw: string | undefined): {
  filename: string;
  ext: AttachExt;
  mime: AttachMime;
} {
  const decoded = parseFilenameHeader(raw);
  if (decoded === null) throw badField("X-Filename");
  const filename = displayName(decoded);
  const ext = extOf(filename);
  if (ext === null) throw appError("ATTACHMENT_TYPE_NOT_ALLOWED");
  return { filename, ext, mime: mimeOf(ext) };
}

export class AttachmentService {
  /** Số upload đang chạy theo user (RV-5). */
  readonly #active = new Map<string, number>();

  constructor(private readonly d: AttachmentServiceDeps) {}

  /** `POST /attachments` → `Attachment` (201). Lỗi 400/409/413/415/429 ⇒ log `attachment-rejected`. */
  async upload(u: AuthUser, i: UploadInput, log: Logger): Promise<Attachment> {
    const t: IngestTarget = {
      tenantId: u.tenantId,
      userId: u.userId,
      origin: "upload",
      jobId: null,
      conversationId: null,
      flowId: null,
    };
    const n = this.#active.get(u.userId) ?? 0;
    if (n >= UPLOADS_PER_USER_MAX) {
      log.info("attachment-rejected", { ...logBase(t), code: 429 });
      throw tooManyUploads();
    }
    this.#active.set(u.userId, n + 1);
    try {
      return await this.ingest(t, i, log);
    } finally {
      const left = (this.#active.get(u.userId) ?? 1) - 1;
      if (left > 0) this.#active.set(u.userId, left);
      else this.#active.delete(u.userId);
    }
  }

  /**
   * `POST /internal/jobs/:job_id/outputs` (R25, plan §5.5) sau khi đã xác thực job: ≥ `JOB_OUTPUTS_MAX` tên output (khác
   * tên này) của lần claim hiện hành ⇒ 409 (P21, PL10) — kiểm sớm (trước khi đọc thân) và chốt dưới khoá tenant (claim
   * còn giữ — RV-1; cùng tên ⇒ thay bản cũ — RV-2) — rồi luồng §5.1 với `origin='output'`, chủ = `jobs.user_id`, hội
   * thoại/flow của payload (chưa `message_id`). Claim mất khi chốt ⇒ ném `OutputClaimLost`.
   */
  async ingestOutput(j: OutputJob, i: UploadInput, log: Logger): Promise<Attachment> {
    const { tokenHash: _h, ...owner } = j;
    const t: IngestTarget = {
      ...owner,
      origin: "output",
      guard: (tx, row) => outputGuard(tx, j, row.safeName),
    };
    try {
      const name = safeName(checkName(i.filenameRaw).filename);
      await withHubScope(this.d.db, SYSTEM, (tx) => outputsFull(tx, j.jobId, name));
    } catch (e) {
      if (e instanceof AppError) log.info("attachment-rejected", { ...logBase(t), code: e.status });
      throw e;
    }
    return this.ingest(t, i, log);
  }

  /** Luồng tải lên chung (plan §5.1) cho `t`; lỗi 4xx ⇒ log `attachment-rejected` rồi ném lại. */
  async ingest(t: IngestTarget, i: UploadInput, log: Logger): Promise<Attachment> {
    try {
      return await this.#ingest(t, i, log);
    } catch (e) {
      if (e instanceof AppError && e.status < 500)
        log.info("attachment-rejected", { ...logBase(t), code: e.status });
      throw e;
    }
  }

  async #ingest(t: IngestTarget, i: UploadInput, log: Logger): Promise<Attachment> {
    const { filename, ext, mime } = checkName(i.filenameRaw);
    if (i.contentLength !== null && i.contentLength > ATTACH_MAX_BYTES) throw tooLarge();
    if (i.contentLength === 0 || !i.body) throw badField("body");
    if (i.contentLength !== null) await this.#checkQuota(t.tenantId, i.contentLength);
    const id = randomUUID();
    const staged = await this.#stage(
      t,
      { id, ext, body: i.body, contentLength: i.contentLength },
      log,
    );
    const created = await this.#insert(t, { id, filename, mime, staged }).catch(async (e) => {
      await staged.discard().catch(() => {});
      throw e;
    });
    await this.#commit(t.tenantId, id, staged);
    log.info("attachment_uploaded", { attachment_id: id, ...logBase(t), size: staged.size, mime });
    return { id, filename, mime, size: staged.size, created_at: created.toISOString() };
  }

  /** Kiểm sớm theo `Content-Length` (không khoá, trước khi đọc thân — P6). */
  async #checkQuota(tenantId: string, add: number): Promise<void> {
    const used = await withHubScope(this.d.db, SYSTEM, (tx) => quotaUsed(tx, tenantId));
    if (overQuota(used, add, this.d.tenantMaxBytes)) throw appError("ATTACHMENT_QUOTA_EXCEEDED");
  }

  /** Stream thân ra `<tenant>/<id>.part` (đếm + sha256 + `FileInspector`); 0 byte / thiếu so với `Content-Length` ⇒ bỏ. */
  async #stage(
    t: IngestTarget,
    o: {
      id: string;
      ext: AttachExt;
      body: ReadableStream<Uint8Array>;
      contentLength: number | null;
    },
    log: Logger,
  ): Promise<Staged> {
    const body = countedBody(o.body);
    const key = storageKey(t.tenantId, o.id);
    let staged: Staged;
    try {
      staged = await this.d.storage.stage(key, body.stream, {
        maxBytes: ATTACH_MAX_BYTES,
        inspect: new FileInspector(o.ext),
      });
    } catch (e) {
      throw this.#stageError(e, { t, id: o.id, bytes: body.st, log });
    } finally {
      body.release();
    }
    const short = o.contentLength !== null && staged.size !== o.contentLength;
    if (staged.size === 0 || short) {
      await staged.discard().catch(() => {});
      if (short) throw this.#aborted(t, body.st.bytes, log);
      throw badField("body");
    }
    return staged;
  }

  /** Lỗi `stage` → lỗi HTTP (413/415/500) + log (path-escape / client đứt). */
  #stageError(
    e: unknown,
    c: { t: IngestTarget; id: string; bytes: { bytes: number; readError: boolean }; log: Logger },
  ): unknown {
    if (e instanceof StorageTooLarge) return tooLarge();
    if (e instanceof StorageRejected) return appError("ATTACHMENT_TYPE_NOT_ALLOWED");
    if (e instanceof StorageKeyError) {
      c.log.error("attachment-path-escape", { key: c.id });
      return appError("INTERNAL_ERROR");
    }
    if (c.bytes.readError) return this.#aborted(c.t, c.bytes.bytes, c.log);
    return e;
  }

  #aborted(t: IngestTarget, bytes: number, log: Logger): AppError {
    log.warn("attachment-upload-aborted", { tenant_id: t.tenantId, user_id: t.userId, bytes });
    return appError("INTERNAL_ERROR");
  }

  /** Transaction: khoá tenant → `guard` → hạn mức chốt (409) → INSERT (R05, R06, P21, RV-1, RV-2). */
  async #insert(
    t: IngestTarget,
    o: { id: string; filename: string; mime: AttachMime; staged: Staged },
  ): Promise<Date> {
    const name = safeName(o.filename);
    return withHubScope(this.d.db, SYSTEM, async (tx) => {
      await lockTenantQuota(tx, t.tenantId);
      await t.guard?.(tx, { safeName: name });
      if (overQuota(await quotaUsed(tx, t.tenantId), o.staged.size, this.d.tenantMaxBytes))
        throw appError("ATTACHMENT_QUOTA_EXCEEDED");
      return insertAttachment(tx, {
        id: o.id,
        tenantId: t.tenantId,
        userId: t.userId,
        origin: t.origin,
        jobId: t.jobId,
        conversationId: t.conversationId,
        flowId: t.flowId,
        filename: o.filename,
        safeName: name,
        mime: o.mime,
        size: o.staged.size,
        sha256: o.staged.sha256,
      });
    });
  }

  /** Rename `.part` → file cuối sau DB commit; lỗi ⇒ xoá hàng + `.part`, 500 (R05). */
  async #commit(tenantId: string, id: string, staged: Staged): Promise<void> {
    try {
      await staged.commit();
    } catch (e) {
      await withHubScope(this.d.db, SYSTEM, (tx) => deleteAttachment(tx, id, tenantId)).catch(
        () => {},
      );
      await staged.discard().catch(() => {});
      throw e;
    }
  }

  async #owned(u: AuthUser, id: string): Promise<OwnedAttachment> {
    const row = await withHubScope(
      this.d.db,
      { kind: "user", tenantId: u.tenantId, userId: u.userId },
      (tx) => findOwnedAttachment(tx, { tenantId: u.tenantId, userId: u.userId, id }),
    );
    if (!row) throw appError("NOT_FOUND");
    return row;
  }

  /** `GET /attachments/:id` (R13): khác chủ / hội thoại đã xoá / không có ⇒ 404. */
  async get(u: AuthUser, id: string): Promise<AttachmentDetail> {
    const r = await this.#owned(u, id);
    return {
      id: r.id,
      filename: r.filename,
      mime: r.mime as AttachMime,
      size: r.size,
      created_at: r.createdAt.toISOString(),
      available: r.purgedAt === null,
    };
  }

  /** `GET /attachments/:id/content` (R13): `available=false` / file mất ⇒ 404 (+ log `attachment-content-missing`). */
  async content(u: AuthUser, id: string, log: Logger): Promise<ContentResult> {
    const r = await this.#owned(u, id);
    if (r.purgedAt !== null) throw appError("NOT_FOUND");
    let file: Blob | null;
    try {
      file = await this.d.storage.blob(r.storageKey, r.mime);
    } catch (e) {
      if (e instanceof StorageKeyError) log.error("attachment-path-escape", { key: r.id });
      else log.error("attachment-open-failed", { attachment_id: r.id, ...safeErrorFields(e) });
      throw appError("INTERNAL_ERROR");
    }
    if (!file) {
      log.error("attachment-content-missing", { attachment_id: r.id });
      throw appError("NOT_FOUND");
    }
    return { body: file, headers: contentHeaders(r, file.size) };
  }
}

/** Header tải về (R13, plan §5.7): không đoán kiểu, sandbox, luôn `attachment`, không cache dùng chung. */
export function contentHeaders(r: { filename: string; mime: string }, size: number) {
  return {
    "Content-Type": r.mime,
    "Content-Length": String(size),
    "Content-Disposition": contentDisposition(r.filename),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
  };
}
