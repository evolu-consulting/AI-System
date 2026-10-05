// HUB-FR-44 · HUB-FR-75 · H2c-R09–R11, R14 · E12: kiểm file gửi được (ngoài transaction, trước router — R10), gắn vào
// tin user + chốt tập file của run (trong `createRunTx`, sau INSERT messages — P7, P8). Chỉ cần DB (PL14): chạy cả khi
// app không có `AppDeps.attachments`. Mọi sai (khác tenant/user, không có, đã gắn, hết hạn, đã xoá) → cùng 404
// `ATTACHMENT_NOT_FOUND{ids}` theo thứ tự gửi (không lộ tồn tại).
import type { AttachMime } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import { bindAttachments, runFileRows, sendableFiles } from "./attachments.repo";
import { type FileRow, pickRunFiles, type RunFile, toRunFile } from "./run-files.rules";

type Owner = { tenantId: string; userId: string };
export type RunKind = "orchestrated" | "direct" | "command";

const notFound = (ids: readonly string[]) => appError("ATTACHMENT_NOT_FOUND", { ids: [...ids] });

/** R09 (plan-db §2.1) · scope `user`; thiếu id nào ⇒ 404 `ATTACHMENT_NOT_FOUND{ids}`; đủ ⇒ file theo thứ tự `ids`. */
export async function checkSendable(
  db: Db,
  u: AuthUser,
  ids: readonly string[],
): Promise<RunFile[]> {
  const o = { tenantId: u.tenantId, userId: u.userId };
  const rows = await withHubScope(db, { kind: "user", ...o }, (tx) => sendableFiles(tx, o, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw notFound(missing);
  return ids.map((id) => {
    const r = byId.get(id) as (typeof rows)[number];
    const mime = r.mime as AttachMime;
    return toRunFile({ id, safeName: r.safe_name, mime, size: Number(r.size), sha256: r.sha256 });
  });
}

export type RunFilesInput = {
  /** `attachment_ids` của tin (vắng = không file). */
  ids?: readonly string[];
  /** Flow mới (không tin cũ) ⇒ không cần đọc tập file khi không `ids` (plan §5.2 bước 4). */
  newFlow: boolean;
  kind: RunKind;
  messageId: string;
  conversationId: string;
  flowId: string;
};

/** R11 (plan-db §2.2) · số hàng gắn ≠ số id (gửi song song cùng file, sweeper vừa claim) ⇒ ném 404 (rollback run). */
async function bind(tx: Tx, o: Owner, p: RunFilesInput, ids: readonly string[]): Promise<void> {
  const got = new Set(await bindAttachments(tx, o, { ...p, ids }));
  const missing = ids.filter((id) => !got.has(id));
  if (missing.length > 0) throw notFound(missing);
}

/** R14 (plan-db §2.3) · hàng DB → `FileRow` (`pickRunFiles`). */
async function candidates(tx: Tx, p: RunFilesInput): Promise<FileRow[]> {
  const rows = await runFileRows(tx, {
    flowId: p.flowId,
    currentMessageId: p.messageId,
    command: p.kind === "command",
  });
  return rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    messageCreatedAt: new Date(r.message_created_at),
    position: Number(r.position),
    safeName: r.safe_name,
    mime: r.mime as AttachMime,
    size: Number(r.size),
    sha256: r.sha256,
  }));
}

/**
 * Trong `createRunTx` (scope `user`), ngay sau INSERT tin user: gắn `ids` (R11) → tập file của run `A` (R14). Người gọi
 * ghi `runs.attachment_ids` (khi ≠ ∅); `A` = `RunContext.files`, bất biến theo run (P9).
 */
export async function bindRunFiles(tx: Tx, o: Owner, p: RunFilesInput): Promise<RunFile[]> {
  const ids = p.ids ?? [];
  if (ids.length > 0) await bind(tx, o, p, ids);
  if (p.newFlow && ids.length === 0) return [];
  const picked = pickRunFiles(await candidates(tx, p), {
    currentMessageId: p.messageId,
    kind: p.kind,
  });
  return picked.map(toRunFile);
}
