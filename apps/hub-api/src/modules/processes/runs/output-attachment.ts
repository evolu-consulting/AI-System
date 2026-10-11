// HUB-FR-106 · HUB-FR-115 · D5 · CR-056 · ghi hàng `hub.attachments` (origin=output) + blob output stage vào kho cho `team-
// runner.writeOutput` (tách khỏi `team-runner.ts` cho giới hạn 400 dòng). `outputAttachment` chỉ INSERT trong tx quy trình
// (callback `withHubScope` có thể CHẠY LẠI khi 40001/40P01 ⇒ KHÔNG chạm kho ở đây). Blob ghi SAU COMMIT bằng
// `commitOutputBlob` (RV2 #1): một lần duy nhất, không `.part` mồ côi do retry; vẫn TRƯỚC thread/SSE (H2c-R05).
import { createHash } from "node:crypto";
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { type Staged, storageKey } from "../../attachments/storage";
import type { Ctx, Deps } from "./team-runner";

/** Blob output chờ ghi SAU COMMIT tx (store chỉ chạm một lần, ngoài vùng retry). */
export type PendingBlob = { key: string; text: string };

/**
 * D5 · CR-056 · HUB-FR-115 · attachment `origin=output` (text/markdown, của người bắt đầu, `job_id` = job cuối). Rỗng /
 * không có job ⇒ không tạo hàng. Hàng attachment LUÔN được tạo (giữ `attachment_id` cho test runtime giả không gắn kho);
 * `pending` (ghi blob sau COMMIT) chỉ trả khi có kho (`d.storage`). `sha256`/`size` tính thẳng từ `content` nên hàng khớp
 * blob ghi sau. Khoá luôn `tenant_id + '/' + attId` (cách ly tenant). CHỈ làm việc DB (callback tx có thể chạy lại).
 */
export async function outputAttachment(
  d: Deps,
  tx: Tx,
  c: Ctx,
  text: string,
): Promise<{ id: string; pending: PendingBlob | null } | null> {
  const size = Buffer.byteLength(text, "utf8");
  if (size === 0) return null;
  const jobId = c.x.jobId ?? (await lastJobOf(tx, c.x.runId));
  if (!jobId) return null;
  const id = crypto.randomUUID();
  const key = storageKey(c.head.tenant_id, id);
  const sha = createHash("sha256").update(text, "utf8").digest("hex");
  const filename = c.def.output.filename || `${c.def.name || "output"}.md`;
  await tx.execute(sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename,
      safe_name, mime, size, sha256, storage_key)
    values (${id}, ${c.head.tenant_id}, ${c.head.started_by}, 'output', ${jobId}, ${filename},
      ${safeName(`s${c.idx}-v-${filename}`)}, 'text/markdown', ${size}, ${sha}, ${key})`);
  return { id, pending: d.storage ? { key, text } : null };
}

/**
 * CR-056 · ghi blob output vào kho SAU COMMIT tx (RV2 #1 — store chỉ chạm một lần, ngoài vùng retry của `withHubScope`),
 * TRƯỚC thread/SSE. Lỗi `stage`/`commit` ⇒ log `error` + `discard` (hàng còn, nội dung vẫn ở `process_outputs.content`;
 * reconcile mở needs_decision, không chạy lại job — D-OUTBLOB-A/B). Vắng kho ⇒ no-op.
 */
export async function commitOutputBlob(d: Deps, p: PendingBlob): Promise<void> {
  if (!d.storage) return;
  let staged: Staged;
  try {
    const body = new Blob([p.text], { type: "text/markdown" }).stream();
    staged = await d.storage.stage(p.key, body, { maxBytes: ATTACH_MAX_BYTES });
  } catch (e) {
    d.log.error("process-output-stage-failed", safeErrorFields(e));
    return;
  }
  try {
    await staged.commit();
  } catch (e) {
    d.log.error("process-output-commit-failed", safeErrorFields(e));
    await staged.discard().catch(() => {});
  }
}

/** ≤ 120 byte UTF-8, ký tự an toàn (khớp CHECK `attachments_safe_name_check`). */
const safeName = (s: string): string =>
  Buffer.from(s.replace(/[^\w.-]+/g, "-"), "utf8")
    .subarray(0, 120)
    .toString("utf8");

async function lastJobOf(tx: Tx, runId: string): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select j.id from hub.jobs j
    join hub.runs rr on rr.id = j.run_id where rr.process_run_id = ${runId}
    order by j.created_at desc limit 1`);
  return r?.id ?? null;
}
