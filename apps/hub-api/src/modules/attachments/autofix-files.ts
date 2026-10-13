// HUB-FR-128 · HUB-BR-14 · HUB-BR-25 · PC-R14 · P-c1 B5b (plan §6.6) · nhánh đọc `GET /attachments/:id(/content)` cho file
// diff/log của `hub.autofix_results` khi luật cũ X2b2-R05/R06 không cho: (1) scope `system`, tenant tường minh — tra kết quả
// tự sửa + hàng file + run; (2) scope `user` của người xem trong tenant đó — definer `hub.process_run_viewer` (cùng nguồn với
// view run, gồm `task`); null ⇒ null (service trả 404 cùng thân). File không thuộc `autofix_results` ⇒ null (luật cũ giữ).
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import {
  findAutofixAttachment,
  processRunViewer,
  type ReadableAttachment,
} from "./attachments.repo";
import { autofixReadTenant, canReadAutofixFile } from "./autofix-files.rules";

export async function readableAutofixFile(
  db: Db,
  u: AuthUser,
  id: string,
  tenantIdQ: string | undefined,
): Promise<ReadableAttachment | null> {
  const tenantId = autofixReadTenant(u, tenantIdQ);
  const hit = await withHubScope(db, { kind: "system" }, (tx) =>
    findAutofixAttachment(tx, { tenantId, id }),
  );
  if (!hit) return null;
  const access = await withHubScope(db, { kind: "user", tenantId, userId: u.userId }, (tx) =>
    processRunViewer(tx, hit.runId),
  );
  return canReadAutofixFile(access) ? hit.file : null;
}
