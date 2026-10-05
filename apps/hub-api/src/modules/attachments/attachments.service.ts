// HUB-FR-44 · HUB-FR-75 · H2c-R01–R07, R13 · nghiệp vụ `POST /attachments` (plan §5.1) và `GET /attachments/:id(/content)`
// (plan §5.7, P22). Thứ tự kiểm plan §2.4: header (400) → đuôi (415) → `Content-Length` (413/400) → hạn mức sớm (409) →
// stream ra `.part` (413/415/400) → transaction khoá tenant (409 chốt) → INSERT → commit DB → rename (R05).
// Hạn mức là **theo tenant** ⇒ câu SUM/khoá/INSERT chạy scope `system` với `tenant_id`/`user_id` lấy từ JWT (RLS scope
// `user` chỉ thấy hàng của chính user — spec-decisions "BUILD — B2/B3" B2-1). Không log tên file, không byte thân.
import { randomUUID } from "node:crypto";
import {
  ATTACH_MAX_BYTES,
  type AttachMime,
  type Attachment,
  type AttachmentDetail,
} from "@ai/contracts/chat";
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
  deleteAttachment,
  findOwnedAttachment,
  insertAttachment,
  lockTenantQuota,
  type OwnedAttachment,
  quotaUsed,
} from "./attachments.repo";
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

export type AttachmentServiceDeps = { db: Db; storage: AttachmentStorage; tenantMaxBytes: number };

/**
 * Nội dung + header R13 của `/content` (plan §5.7). `Blob` (đọc lười từ đĩa) thay vì stream: Bun chỉ gửi `Content-Length`
 * khi thân có kích thước biết trước (stream ⇒ chunked) — spec-decisions "BUILD — B2/B3" B3-1.
 */
export type ContentResult = { body: Blob; headers: Record<string, string> };

const SYSTEM = { kind: "system" } as const;
const tooLarge = () => appError("ATTACHMENT_TOO_LARGE", { max_bytes: ATTACH_MAX_BYTES });
const badField = (field: "X-Filename" | "body") => appError("VALIDATION_ERROR", { field });

/** Thân request kèm bộ đếm byte (log `attachment-upload-aborted`) và cờ lỗi đọc (client đứt). */
type CountedBody = {
  stream: ReadableStream<Uint8Array>;
  st: { bytes: number; readError: boolean };
  /** Nhả khoá đọc thân gốc (không huỷ) — tầng HTTP còn đọc bỏ phần dư (spec-decisions B1-3, B1-4). */
  release: () => void;
};

function countedBody(src: ReadableStream<Uint8Array>): CountedBody {
  const reader = src.getReader();
  const st = { bytes: 0, readError: false };
  let released = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(ctl) {
        try {
          const { done, value } = await reader.read();
          if (done) return ctl.close();
          st.bytes += value.length;
          ctl.enqueue(value);
        } catch (e) {
          st.readError = true;
          ctl.error(e);
        }
      },
    },
    { highWaterMark: 0 },
  );
  const release = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // đã nhả / đang đọc dở: tầng HTTP tự bỏ thân
    }
  };
  return { stream, st, release };
}

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
  constructor(private readonly d: AttachmentServiceDeps) {}

  /** `POST /attachments` → `Attachment` (201). Lỗi 400/409/413/415 ⇒ log `attachment-rejected`. */
  async upload(u: AuthUser, i: UploadInput, log: Logger): Promise<Attachment> {
    try {
      return await this.#upload(u, i, log);
    } catch (e) {
      if (e instanceof AppError && e.status < 500)
        log.info("attachment-rejected", {
          tenant_id: u.tenantId,
          user_id: u.userId,
          code: e.status,
          origin: "upload",
        });
      throw e;
    }
  }

  async #upload(u: AuthUser, i: UploadInput, log: Logger): Promise<Attachment> {
    const { filename, ext, mime } = checkName(i.filenameRaw);
    if (i.contentLength !== null && i.contentLength > ATTACH_MAX_BYTES) throw tooLarge();
    if (i.contentLength === 0 || !i.body) throw badField("body");
    if (i.contentLength !== null) await this.#checkQuota(u.tenantId, i.contentLength);
    const id = randomUUID();
    const staged = await this.#stage(
      u,
      { id, ext, body: i.body, contentLength: i.contentLength },
      log,
    );
    const created = await this.#insert(u, { id, filename, mime, staged }).catch(async (e) => {
      await staged.discard().catch(() => {});
      throw e;
    });
    await this.#commit(u.tenantId, id, staged);
    log.info("attachment_uploaded", {
      attachment_id: id,
      tenant_id: u.tenantId,
      user_id: u.userId,
      size: staged.size,
      mime,
      origin: "upload",
    });
    return { id, filename, mime, size: staged.size, created_at: created.toISOString() };
  }

  /** Kiểm sớm theo `Content-Length` (không khoá, trước khi đọc thân — P6). */
  async #checkQuota(tenantId: string, add: number): Promise<void> {
    const used = await withHubScope(this.d.db, SYSTEM, (tx) => quotaUsed(tx, tenantId));
    if (overQuota(used, add, this.d.tenantMaxBytes)) throw appError("ATTACHMENT_QUOTA_EXCEEDED");
  }

  /** Stream thân ra `<tenant>/<id>.part` (đếm + sha256 + `FileInspector`); 0 byte / thiếu so với `Content-Length` ⇒ bỏ. */
  async #stage(
    u: AuthUser,
    o: {
      id: string;
      ext: AttachExt;
      body: ReadableStream<Uint8Array>;
      contentLength: number | null;
    },
    log: Logger,
  ): Promise<Staged> {
    const body = countedBody(o.body);
    const key = storageKey(u.tenantId, o.id);
    let staged: Staged;
    try {
      staged = await this.d.storage.stage(key, body.stream, {
        maxBytes: ATTACH_MAX_BYTES,
        inspect: new FileInspector(o.ext),
      });
    } catch (e) {
      throw this.#stageError(e, { u, id: o.id, bytes: body.st, log });
    } finally {
      body.release();
    }
    const short = o.contentLength !== null && staged.size !== o.contentLength;
    if (staged.size === 0 || short) {
      await staged.discard().catch(() => {});
      if (short) throw this.#aborted(u, body.st.bytes, log);
      throw badField("body");
    }
    return staged;
  }

  /** Lỗi `stage` → lỗi HTTP (413/415/500) + log (path-escape / client đứt). */
  #stageError(
    e: unknown,
    c: { u: AuthUser; id: string; bytes: { bytes: number; readError: boolean }; log: Logger },
  ): unknown {
    if (e instanceof StorageTooLarge) return tooLarge();
    if (e instanceof StorageRejected) return appError("ATTACHMENT_TYPE_NOT_ALLOWED");
    if (e instanceof StorageKeyError) {
      c.log.error("attachment-path-escape", { key: c.id });
      return appError("INTERNAL_ERROR");
    }
    if (c.bytes.readError) return this.#aborted(c.u, c.bytes.bytes, c.log);
    return e;
  }

  #aborted(u: AuthUser, bytes: number, log: Logger): AppError {
    log.warn("attachment-upload-aborted", { tenant_id: u.tenantId, user_id: u.userId, bytes });
    return appError("INTERNAL_ERROR");
  }

  /** Transaction: khoá tenant → hạn mức chốt (409) → INSERT (R05, R06). */
  async #insert(
    u: AuthUser,
    o: { id: string; filename: string; mime: AttachMime; staged: Staged },
  ): Promise<Date> {
    return withHubScope(this.d.db, SYSTEM, async (tx) => {
      await lockTenantQuota(tx, u.tenantId);
      if (overQuota(await quotaUsed(tx, u.tenantId), o.staged.size, this.d.tenantMaxBytes))
        throw appError("ATTACHMENT_QUOTA_EXCEEDED");
      return insertAttachment(tx, {
        id: o.id,
        tenantId: u.tenantId,
        userId: u.userId,
        origin: "upload",
        jobId: null,
        conversationId: null,
        flowId: null,
        filename: o.filename,
        safeName: safeName(o.filename),
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
