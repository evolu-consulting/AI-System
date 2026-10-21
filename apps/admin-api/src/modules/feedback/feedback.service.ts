// feedback · "Góp ý về app": user gửi/xem của mình (`/auth/feedback`), admin lọc/đổi trạng thái/trả lời (`/admin/feedback`).
// RLS ở DB (migration 0017); service đặt `app.user_id` + `app.fb_all` trong cùng tx rồi lọc tường minh thêm một lớp. Không email.
import type {
  FeedbackCreateParsed,
  FeedbackItem,
  FeedbackListQuery,
  FeedbackListResponse,
  FeedbackUpdateRequest,
} from "@ai/contracts";
import { type Db, type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { type Actor, scopeOf } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import * as repo from "./feedback.repo";
import { decodeFiles, seesAll } from "./feedback.rules";

export type FeedbackCtx = { db: Db };

const MINE_LIMIT = 50;

/** withScope + ngữ cảnh người dùng cho chính sách `feedback_admin_rw`. */
function scoped<T>(ctx: FeedbackCtx, actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${actor.userId}, true),
        set_config('app.fb_all', ${seesAll(actor.role) ? "1" : "0"}, true)`,
    );
    return fn(tx);
  });
}

export async function createFeedback(
  ctx: FeedbackCtx,
  actor: Actor,
  b: FeedbackCreateParsed,
): Promise<FeedbackItem> {
  const dec = decodeFiles(b.files);
  if (!dec.ok)
    throw validationError([
      { path: ["files", dec.index], code: "invalid_file", message: "Invalid attachment" },
    ]);
  return scoped(ctx, actor, async (tx) => {
    const id = await repo.insertFeedback(
      tx,
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        app: b.app,
        kind: b.kind,
        message: b.message,
        pageUrl: b.page_url,
        appVersion: b.app_version,
      },
      dec.files,
    );
    const row = await repo.findOne(tx, id);
    if (!row) throw appError("NOT_FOUND");
    return row;
  });
}

export function listMine(ctx: FeedbackCtx, actor: Actor): Promise<{ items: FeedbackItem[] }> {
  return scoped(ctx, actor, async (tx) => ({
    items: await repo.listMine(tx, actor.userId, MINE_LIMIT),
  }));
}

export function listAdmin(
  ctx: FeedbackCtx,
  actor: Actor,
  q: FeedbackListQuery & { limit: number; offset: number },
): Promise<FeedbackListResponse> {
  // tenant_admin: ép tenant của mình (RLS đã chặn; lọc tường minh để `total` cũng đúng khi truyền tenant_id lạ).
  const tenant_id = actor.role === "platform_admin" ? q.tenant_id : actor.tenantId;
  return scoped(ctx, actor, (tx) => repo.listAdmin(tx, { ...q, tenant_id }));
}

export function updateFeedback(
  ctx: FeedbackCtx,
  actor: Actor,
  id: string,
  b: FeedbackUpdateRequest,
): Promise<FeedbackItem> {
  return scoped(ctx, actor, async (tx) => {
    if (!(await repo.updateFeedback(tx, id, b, actor.userId))) throw appError("NOT_FOUND");
    const row = await repo.findOne(tx, id);
    if (!row) throw appError("NOT_FOUND");
    return row;
  });
}

/** Tệp đính kèm — chỉ khi RLS cho thấy góp ý cha (chủ góp ý / admin trong phạm vi). */
export async function getFile(ctx: FeedbackCtx, actor: Actor, id: string, fileId: string) {
  const f = await scoped(ctx, actor, (tx) => repo.fileOf(tx, id, fileId));
  if (!f) throw appError("NOT_FOUND");
  return f;
}
