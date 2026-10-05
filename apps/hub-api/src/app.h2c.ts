// HUB-FR-44 · HUB-FR-75 · H2c plan §4 · nối phần file H2c vào app (`app.ts` chỉ gọi). Vắng `AppDeps.attachments` ⇒ không
// mount gì ở đây (PL14). B5: `GET /internal/jobs/:job_id/attachments/:attachment_id`; B9: `POST /internal/jobs/:job_id/outputs`
// (token job, không JWT/CORS riêng).
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import { attachmentRoutes } from "./modules/attachments/attachments.routes";
import { AttachmentService } from "./modules/attachments/attachments.service";
import type { AttachmentDeps } from "./modules/attachments/storage";
import { startAttachmentSweeper } from "./modules/attachments/sweeper";
import { internalAttachmentRoutes } from "./modules/internal/attachments.routes";
import { InternalAttachmentService } from "./modules/internal/attachments.service";

export type H2cMountDeps = {
  db: Db;
  attachments: AttachmentDeps;
  log: Logger;
  signal?: AbortSignal;
};

/** Route file H2c (gọi trước `notFound`). */
export function mountH2c<E extends Env>(app: Hono<E>, d: H2cMountDeps): void {
  // B2/B3: `/attachments*` — JWT đã gắn ở gốc (`PROTECTED_PREFIXES` của `app.ts`).
  const files = new AttachmentService({
    db: d.db,
    storage: d.attachments.storage,
    tenantMaxBytes: d.attachments.tenantMaxBytes,
  });
  app.route("/attachments", attachmentRoutes(files));
  const internal = new InternalAttachmentService({
    db: d.db,
    storage: d.attachments.storage,
    files,
    log: d.log,
  });
  app.route("/internal", internalAttachmentRoutes(internal, d.log));
  // B10: vòng sweeper nền (R27–R29); `sweep: false` ⇒ tắt (test gọi thẳng `sweepOnce`, L1).
  if (d.attachments.sweep !== false)
    startAttachmentSweeper({
      db: d.db,
      storage: d.attachments.storage,
      log: d.log,
      everyMs: d.attachments.sweepS * 1000,
      signal: d.signal,
    });
}
