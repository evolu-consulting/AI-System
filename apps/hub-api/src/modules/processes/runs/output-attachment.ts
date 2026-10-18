// HUB-FR-106 · HUB-FR-115 · D5 · CR-056 · ghi hàng `hub.attachments` (origin=output) + blob output stage vào kho cho `team-
// runner.writeOutput` (tách khỏi `team-runner.ts` cho giới hạn 400 dòng). `outputAttachment` chỉ INSERT trong tx quy trình
// (callback `withHubScope` có thể CHẠY LẠI khi 40001/40P01 ⇒ KHÔNG chạm kho ở đây). Blob ghi SAU COMMIT bằng
// `commitOutputBlob` (RV2 #1): một lần duy nhất, không `.part` mồ côi do retry; vẫn TRƯỚC thread/SSE (H2c-R05).
import { createHash } from "node:crypto";
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import type { RunFile } from "../../attachments/run-files.rules";
import { type Staged, storageKey } from "../../attachments/storage";
import type { ProcessDeps } from "../core/ports";

// Cục bộ (không import team-runner ⇒ tránh vòng no-circular): cùng dạng `Deps` của team-runner.
type Deps = Omit<ProcessDeps, "launcher" | "start">;
type Ctx = {
  x: { jobId?: string | null; runId: string };
  head: { tenant_id: string; started_by: string };
  def: { name?: string; output: { filename: string }; executor?: { kind: string } };
  idx: number;
};

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
  // P-d2 T18-2 · stage `tool` không có job (job cuối của run = job stage KHÁC) và không ghi blob ⇒ không hàng attachment
  // (tránh hàng trỏ blob không tồn tại); .md nằm ở `process_outputs.content` (T18-1 "inline như stage Áp").
  if (size === 0 || c.def.executor?.kind === "tool") return null;
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
    return;
  }
  // FB1 (HUB-FR-138): INSERT (outputAttachment) chạy TRƯỚC stage ⇒ ghi tham chiếu FileBox sau khi có `file_id` (bất biến hàng⟺file §4.2).
  if (staged.fileId) await setFileboxRef(d, p.key, staged.fileId, staged.versionId ?? null);
}

/** UPDATE 2 cột FileBox lên hàng đã INSERT (khoá = `tenant/id`); lỗi ⇒ log (hàng còn, blob ở `process_outputs.content`). */
async function setFileboxRef(
  d: Deps,
  key: string,
  fileId: string,
  versionId: string | null,
): Promise<void> {
  const id = key.slice(key.indexOf("/") + 1);
  try {
    await withHubScope(d.db, { kind: "system" }, (tx) =>
      tx.execute(sql`update hub.attachments
        set filebox_file_id = ${fileId}, filebox_version_id = ${versionId} where id = ${id}`),
    );
  } catch (e) {
    d.log.error("process-output-filebox-ref-failed", { attachment_id: id, ...safeErrorFields(e) });
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

export type DraftInput = {
  tenantId: string;
  startedBy: string;
  runId: string;
  name: string;
  text: string;
};

/**
 * #133 · #135 · PB-R18 · ghi bản nháp ghép của nhóm thành `hub.attachments` THẬT (origin=output ⇒ `job_id` BẮT BUỘC —
 * `attachments_output_job_ck`; gắn job gần nhất của chính run ⇒ join `job_id→runs.process_run_id` khớp run này) + blob
 * trên kho, rồi trả `RunFile` id thật để thành viên kế tải được (200, sha khớp). Scope system (RLS T). `sha256`/`size` tính
 * thẳng từ `text` nên hàng khớp blob. Chưa có job (stage nhóm ở stage 0): trả `null` ⇒ KHÔNG có file nháp (tránh id nháp
 * mồ côi ⇒ runtime thật tải 401/404 — #135); nháp v1 là template rỗng nên member đầu không cần đọc.
 */
export async function persistDraft(d: Deps, p: DraftInput): Promise<RunFile | null> {
  const size = Math.max(1, Buffer.byteLength(p.text, "utf8"));
  const id = crypto.randomUUID();
  const key = storageKey(p.tenantId, id);
  const sha = createHash("sha256").update(p.text, "utf8").digest("hex");
  const saved = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const jobId = await lastJobOf(tx, p.runId);
    // Chưa có job nào của run (nháp v1 của stage nhóm đầu tiên): `origin=output` cần `job_id` ⇒ không ghi hàng/blob.
    if (!jobId) return false;
    await tx.execute(sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename,
        safe_name, mime, size, sha256, storage_key)
      values (${id}, ${p.tenantId}, ${p.startedBy}, 'output', ${jobId}, ${p.name},
        ${safeName(p.name)}, 'text/markdown', ${size}, ${sha}, ${key})`);
    return true;
  });
  if (!saved) return null; // #135 · không có job ⇒ không có file (tránh id mồ côi)
  await commitOutputBlob(d, { key, text: p.text });
  return { id, name: p.name, mime: "text/markdown", size, sha256: sha };
}

/**
 * #133 · #135 · persist nháp ghép rồi nối vào `priorFiles` (đã lọc run/tenant ở launcher) — dùng bởi `team-exec.draftFiles`.
 * `persistDraft` trả `null` (chưa có job ⇒ id nháp sẽ mồ côi) ⇒ BỎ hẳn draft, chỉ trả `priorFiles` (không file nào gắn id
 * dangling cho member đầu ⇒ runtime thật không gặp 401 — #135).
 */
export async function teamDraftFiles(
  d: Deps,
  p: DraftInput & { priorFiles: readonly RunFile[] },
): Promise<RunFile[]> {
  const draft = await persistDraft(d, p);
  return draft ? [...p.priorFiles, draft] : [...p.priorFiles];
}

/**
 * PB-R18 · lọc tập `ids` chỉ giữ attachment thuộc CHÍNH run + tenant: `attachments.job_id → jobs.run_id →
 * runs.process_run_id = runId`. Id của run/tenant khác (dù nằm trong `process_outputs`) bị loại (#133/ID-05).
 */
export async function runScopedFileIds(
  tx: Tx,
  runId: string,
  tenantId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.execute<{ id: string }>(sql`select a.id from hub.attachments a
    join hub.jobs j on j.id = a.job_id
    join hub.runs r on r.id = j.run_id
    where a.tenant_id = ${tenantId} and r.process_run_id = ${runId}
      and a.id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`);
  return new Set([...rows].map((r) => r.id));
}
