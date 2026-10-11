// HUB-FR-106 · HUB-FR-115 · D5 · CR-056 · ghi hàng `hub.attachments` (origin=output) + blob output stage vào kho cho `team-
// runner.writeOutput` (tách khỏi `team-runner.ts` cho giới hạn 400 dòng). Blob `.part` được `stage` trong tx quy trình, trả
// `Staged` ra ngoài để `stage-driver.apply` `commit()` SAU COMMIT (H2c-R05) — PHẢI trước khi báo output (thread/SSE).
import { createHash } from "node:crypto";
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { type Staged, storageKey } from "../../attachments/storage";
import type { Ctx, Deps } from "./team-runner";

/**
 * D5 · CR-056 · HUB-FR-115 · attachment `origin=output` (text/markdown, của người bắt đầu, `job_id` = job cuối) + ghi blob
 * vào kho (`.part`, commit SAU COMMIT tx) để stage kế tải được. Rỗng / không có job ⇒ không tạo hàng. Hàng attachment LUÔN
 * được tạo (giữ `attachment_id` cho test runtime giả không gắn kho); blob chỉ ghi khi có kho (`d.storage`). Lỗi `stage()` /
 * vắng kho ⇒ blob null (hàng còn, nội dung vẫn ở `process_outputs.content`; reconcile mở needs_decision, không chạy lại job).
 * Khoá luôn `tenant_id + '/' + attId` (cách ly tenant).
 */
export async function outputAttachment(
  d: Deps,
  tx: Tx,
  c: Ctx,
  text: string,
): Promise<{ id: string; staged: Staged | null } | null> {
  const size = Buffer.byteLength(text, "utf8");
  if (size === 0) return null;
  const jobId = c.x.jobId ?? (await lastJobOf(tx, c.x.runId));
  if (!jobId) return null;
  const id = crypto.randomUUID();
  const key = storageKey(c.head.tenant_id, id);
  const staged = await stageOutputBlob(d, c, key, text);
  const sha = staged?.sha256 ?? createHash("sha256").update(text, "utf8").digest("hex");
  const filename = c.def.output.filename || `${c.def.name || "output"}.md`;
  await tx.execute(sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename,
      safe_name, mime, size, sha256, storage_key)
    values (${id}, ${c.head.tenant_id}, ${c.head.started_by}, 'output', ${jobId}, ${filename},
      ${safeName(`s${c.idx}-v-${filename}`)}, 'text/markdown', ${staged?.size ?? size}, ${sha}, ${key})`);
  return { id, staged };
}

/** Ghi blob output vào kho (`.part`); vắng kho ⇒ null (test runtime giả). Lỗi kho ⇒ log `error` + null (hàng vẫn tạo). */
async function stageOutputBlob(d: Deps, c: Ctx, key: string, text: string): Promise<Staged | null> {
  if (!d.storage) return null;
  try {
    const body = new Blob([text], { type: "text/markdown" }).stream();
    return await d.storage.stage(key, body, { maxBytes: ATTACH_MAX_BYTES });
  } catch (e) {
    d.log.error("process-output-stage-failed", {
      run_id: c.x.runId,
      stage_idx: c.idx,
      ...safeErrorFields(e),
    });
    return null;
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
