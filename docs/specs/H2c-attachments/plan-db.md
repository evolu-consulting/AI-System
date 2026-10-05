# Plan · H2c · DB + SQL (phụ lục `plan.md` §3)

Postgres, schema `hub`, migration viết tay idempotent như 0006 (`IF NOT EXISTS`, đổi CHECK qua `DO $$ … pg_constraint`). **Không sửa migration đã commit** (0000–0006). Scope: `withHubScope(db, {kind:"user", tenantId, userId} | {kind:"system"}, fn)` (H1 §3.4).

## 1. `packages/db/migrations-hub/0007_h2c_attachments.sql` (D1) · `meta/_journal.json` idx 7 · `schema/hub.ts`
```sql
-- HUB-FR-44 · HUB-FR-75 · WRK-FR-11 · WRK-FR-18 · plan H2c §3: file đính kèm (Storage local theo tenant), tập file của run,
-- lý do job `attachment`. Chỉ thêm bảng/cột/index, nới CHECK — không mất dữ liệu.
CREATE TABLE IF NOT EXISTS hub.attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  origin text NOT NULL,
  job_id uuid,
  conversation_id uuid,
  flow_id uuid,
  message_id uuid,
  position smallint,
  filename text NOT NULL,
  safe_name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  bound_at timestamptz,
  purged_at timestamptz,
  CONSTRAINT attachments_pkey PRIMARY KEY (id),
  CONSTRAINT attachments_origin_check CHECK (origin IN ('upload', 'output')),
  CONSTRAINT attachments_output_job_ck CHECK ((origin = 'output') = (job_id IS NOT NULL)),
  CONSTRAINT attachments_size_check CHECK (size BETWEEN 1 AND 20971520),
  CONSTRAINT attachments_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT attachments_filename_check CHECK (char_length(filename) BETWEEN 1 AND 200),
  CONSTRAINT attachments_safe_name_check CHECK (octet_length(safe_name) BETWEEN 1 AND 120),
  CONSTRAINT attachments_mime_check CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg', 'image/gif',
    'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/markdown', 'text/csv', 'application/xml', 'application/json')),
  CONSTRAINT attachments_key_ck CHECK (storage_key = tenant_id::text || '/' || id::text),
  -- FK SET NULL chỉ xoá `message_id` ⇒ không ràng buộc ngược `bound_at`/`position` khi message_id NULL.
  CONSTRAINT attachments_bound_ck CHECK (message_id IS NULL
    OR (bound_at IS NOT NULL AND position BETWEEN 0 AND 9 AND conversation_id IS NOT NULL AND flow_id IS NOT NULL)),
  CONSTRAINT attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES hub.messages (id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_message_idx ON hub.attachments (message_id, position) WHERE message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_tenant_live_idx ON hub.attachments (tenant_id) INCLUDE (size) WHERE purged_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_unbound_idx ON hub.attachments (created_at) WHERE message_id IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_job_idx ON hub.attachments (job_id, safe_name, created_at) WHERE job_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_conv_live_idx ON hub.attachments (conversation_id)
  WHERE purged_at IS NULL AND conversation_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conversations_deleted_idx ON hub.conversations (id) WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'attachments'
                 AND policyname = 'attachments_hub_rw') THEN
    CREATE POLICY attachments_hub_rw ON hub.attachments FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                 AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
      WITH CHECK (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                 AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.attachments TO hub_rw;
--> statement-breakpoint
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS attachment_ids uuid[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_attachment_ids_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_attachment_ids_ck CHECK (cardinality(attachment_ids) <= 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_error_reason_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''attachment''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_error_reason_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_error_reason_check CHECK (
      error_reason IS NULL
      OR error_reason IN ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash',
                          'cancelled', 'timeout', 'invalid_payload', 'invalid_output', 'sandbox', 'credential',
                          'upstream', 'refused', 'attachment'));
  END IF;
END
$$;
```
- Không FK `conversation_id`/`flow_id`/`job_id` (H1 P3: hội thoại xoá mềm; job theo vòng đời Runtime). `agent_runtime` **không** GRANT (Runtime chỉ qua HTTP Hub). Bảng mới, cột mới có `DEFAULT` hằng ⇒ `ALTER` không ghi lại bảng `runs`.
- `schema/hub.ts`: `ATTACHMENT_ORIGIN_VALUES = ["upload","output"] as const`, `attachments = hub.table("attachments", …)` (bigint mode `number`), `runs.attachmentIds: uuid("attachment_ids").array().notNull().default(sql\`'{}'\`)`; `JOB_FAIL_REASON` (nếu có hằng ở schema) + `attachment`.

## 2. SQL theo luồng (`attachments.repo.ts`, `runs/runs.repo.ts`; `sql` drizzle, tham số hoá)
### 2.1 Kiểm gửi (R09, PL7) — scope `user`, ngoài transaction E12
```sql
SELECT id, safe_name, mime, size, sha256 FROM hub.attachments
WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${t} AND user_id = ${u}
  AND message_id IS NULL AND purged_at IS NULL AND created_at > now() - interval '24 hours'
```
Service: `ids` thiếu trong kết quả (theo thứ tự gửi) ≠ ∅ ⇒ 404 `ATTACHMENT_NOT_FOUND{ids}`; đủ ⇒ `CurrentFile[]` theo thứ tự `ids`.

### 2.2 Gắn (R11) — trong `createRunTx` (scope `user`), sau `insertMessage(user)`
```sql
UPDATE hub.attachments a
SET message_id = ${messageId}, conversation_id = ${conversationId}, flow_id = ${flowId}, bound_at = now(),
    position = array_position(${ids}::uuid[], a.id) - 1
WHERE a.id = ANY(${ids}::uuid[]) AND a.tenant_id = ${t} AND a.user_id = ${u}
  AND a.message_id IS NULL AND a.purged_at IS NULL AND a.created_at > now() - interval '24 hours'
RETURNING a.id
```
Số hàng ≠ `ids.length` ⇒ ném `ATTACHMENT_NOT_FOUND{ids: ids − trả về}` (rollback cả run/message). Hai E12 cùng user nối tiếp nhau nhờ khoá advisory user (H2b P8) ⇒ không deadlock hàng; sweeper claim dùng `SKIP LOCKED` (không chờ).

### 2.3 Tập file của run (R14) — cùng transaction, sau 2.2 (bỏ qua khi flow mới ∧ không `ids`)
```sql
SELECT a.id, a.message_id, m.created_at AS message_created_at, a.position, a.safe_name, a.mime, a.size, a.sha256
FROM hub.messages m JOIN hub.attachments a ON a.message_id = m.id
WHERE m.flow_id = ${flowId} AND a.purged_at IS NULL
  AND (${kind} <> 'command' OR m.id = ${currentMessageId})
ORDER BY (m.id = ${currentMessageId}) DESC, m.created_at DESC, m.id DESC, a.position
LIMIT 11
```
→ `pickRunFiles` (`plan-rules` §3) → `UPDATE hub.runs SET attachment_ids = ${pickedIds}::uuid[] WHERE id = ${runId}` (chỉ khi ≠ ∅).

### 2.4 Gắn output vào tin assistant (R26, PL6) — `SseWriter.finish` (scope `system`), `status='finished'`, sau `insertMessage(assistant)`
```sql
WITH latest AS (
  SELECT DISTINCT ON (a.job_id, a.safe_name) a.id, a.job_id, a.safe_name, j.created_at AS job_created_at
  FROM hub.jobs j JOIN hub.attachments a ON a.job_id = j.id
  WHERE j.run_id = ${runId} AND a.origin = 'output' AND a.message_id IS NULL AND a.purged_at IS NULL
  ORDER BY a.job_id, a.safe_name, a.created_at DESC
), picked AS (
  SELECT id, (row_number() OVER (ORDER BY job_created_at, job_id, safe_name) - 1)::smallint AS pos
  FROM latest ORDER BY job_created_at, job_id, safe_name LIMIT 10
)
UPDATE hub.attachments a
SET message_id = ${answerMessageId}, conversation_id = ${conversationId}, flow_id = ${flowId}, bound_at = now(), position = p.pos
FROM picked p WHERE a.id = p.id
```
Thứ tự khoá trong `finish`: `flows → runs → messages → attachments → flows (cập nhật) → jobs` (P8).

### 2.5 Endpoint nội bộ (R17, R25) — scope `system`
- Token → job: `credential.repo.jobByTokenHash` (H2a, đã có `tenant_id`, `user_id` trong SELECT) — mở rộng kiểu trả về `CredentialJob` + `tenantId`, `userId`, `runId`.
- File của job: `SELECT id, storage_key, size, sha256, purged_at FROM hub.attachments WHERE id = ${attId} AND tenant_id = ${jobTenantId}` (không hàng ⇒ 401).
- Đếm output: `SELECT count(*)::int FROM hub.attachments WHERE job_id = ${jobId} AND origin = 'output'`.

### 2.6 Xem lại (R13, P22) — scope `user`
```sql
SELECT a.id, a.filename, a.mime, a.size, a.created_at, a.purged_at, a.storage_key
FROM hub.attachments a LEFT JOIN hub.conversations c ON c.id = a.conversation_id
WHERE a.id = ${id} AND a.tenant_id = ${t} AND a.user_id = ${u} AND c.deleted_at IS NULL
```
(`conversation_id` NULL ⇒ `c` NULL ⇒ `c.deleted_at IS NULL` đúng). Tin E10/E11/preview: `SELECT message_id, id, filename, mime, size, purged_at FROM hub.attachments WHERE message_id = ANY(${messageIds}::uuid[]) ORDER BY message_id, position`.

## 3. Upload / output — transaction chốt hạn mức (R05, R06, P6)
Kiểm sớm (không khoá, scope `user` hoặc `system`): `SELECT coalesce(sum(size), 0)::bigint AS used FROM hub.attachments WHERE tenant_id = ${t} AND purged_at IS NULL`.
Transaction (upload: scope `user`; output: `system`):
```sql
SELECT pg_advisory_xact_lock(hashtext('hub.attach.tenant'), hashtext(${t}::text));
SELECT coalesce(sum(size), 0)::bigint AS used FROM hub.attachments WHERE tenant_id = ${t} AND purged_at IS NULL;
-- overQuota(used, size, max) ⇒ ném 409 (rollback)
INSERT INTO hub.attachments (id, tenant_id, user_id, origin, job_id, conversation_id, flow_id, filename, safe_name, mime,
  size, sha256, storage_key)
VALUES (${id}, ${t}, ${u}, ${origin}, ${jobId}, ${conversationId}, ${flowId}, ${filename}, ${safeName}, ${mime},
  ${size}, ${sha256}, ${t}::text || '/' || ${id}::text);
```
Khoá advisory 2 khoá không gian riêng (`hub.attach.tenant`) ≠ `hub.runs.user` (H2b) ≠ `K_CLAIM` (1 khoá) ⇒ không chu trình.

## 4. Sweeper (R27–R29, PL2) — scope `system`, mỗi lượt một transaction ngắn cho mỗi bước claim
```sql
-- lượt: SELECT pg_try_advisory_xact_lock(hashtext('hub.attach.sweep')) → false ⇒ bỏ lượt (Hub khác đang quét)
-- 4.1 R27 · chưa gắn quá 24 h (kể cả hàng đã claim lượt trước mà xoá dở)
WITH c AS (
  SELECT id FROM hub.attachments
  WHERE message_id IS NULL AND (purged_at IS NOT NULL OR created_at < ${now}::timestamptz - interval '24 hours')
  ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
UPDATE hub.attachments a SET purged_at = coalesce(a.purged_at, ${now}) FROM c WHERE a.id = c.id
RETURNING a.id, a.storage_key;
--   → storage.remove(key) từng file → DELETE FROM hub.attachments WHERE id = ANY(${removedIds}) AND message_id IS NULL;
-- 4.2 R28 · hội thoại đã xoá
WITH c AS (
  SELECT a.id FROM hub.conversations cv JOIN hub.attachments a ON a.conversation_id = cv.id
  WHERE cv.deleted_at IS NOT NULL AND a.purged_at IS NULL
  LIMIT 500 FOR UPDATE OF a SKIP LOCKED
)
UPDATE hub.attachments a SET purged_at = ${now} FROM c WHERE a.id = c.id RETURNING a.id, a.storage_key;
--   → storage.remove(key) (lỗi ⇒ log; nội dung còn sót do 4.3 dọn — hàng đã purged ⇒ không còn "live")
-- 4.3 Mồ côi: id (phần sau `/` của key) trong lô `storage.list` còn sống? (PK, không cần index `storage_key`)
SELECT storage_key FROM hub.attachments WHERE id = ANY(${ids}::uuid[]) AND purged_at IS NULL;
```
`${now}` = đồng hồ tiêm (`Date`), không dùng `now()` trong câu sweeper (AC-13). Câu 4.1 dùng `attachments_unbound_idx`; 4.2 dùng `conversations_deleted_idx` + `attachments_conv_live_idx`; 4.3 dùng PK.

## 5. DB test (D1, `packages/db/src/hub-h2c.int.test.ts`)
| # | Kiểm |
|---|---|
| 1 | Migration chạy 2 lần (idempotent) trên DB sạch và DB đã có 0006 |
| 2 | CHECK: `size` 0 / 20 971 521 · `sha256` hoa · `origin='output'` không `job_id` · `storage_key` lệch `tenant/id` · `message_id` có mà `bound_at` NULL · `position` 10 · mime lạ → 23514; `runs.attachment_ids` 11 phần tử → 23514; `jobs.error_reason='attachment'` nhận |
| 3 | Xoá message ⇒ `attachments.message_id` NULL, hàng còn |
| 4 | RLS: scope `user` khác user/tenant → 0 hàng (SELECT/UPDATE); scope lạ → 0; `system` thấy hết; `agent_runtime` SELECT → 42501 |
| 5 | Index tồn tại (`pg_indexes`) và `EXPLAIN` §2.1/§3 dùng index (không `Seq Scan` trên 10 000 hàng mẫu) |
| 6 | Test khoá H1 A48–A51, H2a `db.int`, H2b `db.int` xanh nguyên văn |
