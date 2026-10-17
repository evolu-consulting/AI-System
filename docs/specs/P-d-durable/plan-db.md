# Plan phụ lục · DB P-d (migration viết tay, idempotent)

Phần của [`plan.md`](plan.md). Số thật (kiểm 2026-10-17): hub cao nhất `migrations-hub/0035_dlc_workflows.sql` ⇒ **`0036_pd1_durable.sql`**, **`0037_pd2_tool_branch.sql`**; admin cao nhất `migrations/0010_cr052_user_locale_en.sql` ⇒ **`0011_pd1_tenant_timezone.sql`**, **`0012_pd2_tenant_workflow_tools.sql`**. Không sửa migration đã commit. `_journal.json` (hub: `migrations-hub/meta`, admin: `migrations/meta`) thêm đúng một mục mỗi file. Mẫu: CHECK dựng lại theo 0024/0032 (`DO $$ … IF NOT EXISTS (… pg_get_constraintdef LIKE '%<giá trị mới>%')`), RLS theo 0019 dòng 661–683 (**ENABLE, không FORCE**).

## 1. `0036_pd1_durable.sql` (T6)
```sql
-- HUB-FR-143…145 · HUB-FR-115 · P-d1 (plan-db §1). Chỉ thêm cột/bảng/index, DROP NOT NULL, dựng lại CHECK nới enum.
-- (1) process_defs.ttl_days
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS ttl_days smallint DEFAULT 7;      -- NULL = không hết hạn
-- CHECK process_defs_ttl_ck CHECK (ttl_days IS NULL OR ttl_days BETWEEN 1 AND 365)
-- (2) process_runs.expires_at nullable + index hết hạn mới (predicate cũ không còn khớp tập "active" 5 trạng thái)
ALTER TABLE hub.process_runs ALTER COLUMN expires_at DROP NOT NULL;
CREATE INDEX IF NOT EXISTS process_runs_expiring_idx ON hub.process_runs (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('running','waiting_review','waiting_answer','needs_decision','waiting_timer');
DROP INDEX IF EXISTS hub.process_runs_expires_idx;
-- process_runs_active_idx (0019) GIỮ: predicate = PROCESS_RUN_CAP_COUNTED (đếm trần không tính waiting_timer).
-- (3) stage_runs: thử lại (giá trị chỉ hiệu lực khi retry_attempt/retry_round = attempt/round — plan §4.2)
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_count smallint NOT NULL DEFAULT 0;
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_attempt smallint;
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_round smallint;
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_since timestamptz;            -- PD-R05 cửa sổ "đã gửi side_effect"
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS last_error_code text;
-- CHECK stage_runs_retry_ck CHECK (retry_count BETWEEN 0 AND 3 AND (last_error_code IS NULL OR char_length(last_error_code) <= 64))
-- UNIQUE stage_runs_id_tenant_uq (id, tenant_id)    -- đích FK kép của process_timers (0019 chỉ có PK)
-- (4) review_tasks: nhắc lặp + chuyển cấp (chép từ snapshot lúc tạo task review — PD-R19)
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS remind_count smallint NOT NULL DEFAULT 0;
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS remind_every_h smallint;
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS escalate_at timestamptz;
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS escalate_group_id uuid;           -- admin.groups (không FK chéo schema, P3)
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
-- CHECK review_tasks_remind_ck CHECK (remind_count BETWEEN 0 AND 10 AND (remind_every_h IS NULL OR remind_every_h BETWEEN 4 AND 168)
--   AND ((escalate_at IS NULL) = (escalate_group_id IS NULL)) AND (kind = 'review' OR (remind_every_h IS NULL AND escalate_at IS NULL)))
CREATE INDEX IF NOT EXISTS review_tasks_remind_due_idx ON hub.review_tasks (remind_at)
  WHERE status = 'open' AND (reminded_at IS NULL OR (remind_every_h IS NOT NULL AND remind_count < 10));
CREATE INDEX IF NOT EXISTS review_tasks_escalate_idx ON hub.review_tasks (escalate_at)
  WHERE status = 'open' AND escalated_at IS NULL AND escalate_at IS NOT NULL;
-- (5) process_timers (mới)
CREATE TABLE IF NOT EXISTS hub.process_timers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  timezone text,                                   -- wait_until: IANA đọc lúc lưu (TZ-R04, hiển thị); retry: NULL
  fired_at timestamptz,
  cancelled_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_timers_pkey PRIMARY KEY (id),
  CONSTRAINT process_timers_key_uq UNIQUE (idempotency_key),
  CONSTRAINT process_timers_kind_ck CHECK (kind IN ('wait_until', 'retry')),
  CONSTRAINT process_timers_state_ck CHECK (NOT (fired_at IS NOT NULL AND cancelled_at IS NOT NULL)
    AND char_length(idempotency_key) BETWEEN 1 AND 200
    AND ((kind = 'wait_until') = (timezone IS NOT NULL)) AND (timezone IS NULL OR char_length(timezone) <= 64)),
  CONSTRAINT process_timers_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT process_timers_stage_fk FOREIGN KEY (stage_run_id, tenant_id)
    REFERENCES hub.stage_runs (id, tenant_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS process_timers_due_idx ON hub.process_timers (due_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS process_timers_run_idx ON hub.process_timers (process_run_id);
CREATE INDEX IF NOT EXISTS process_timers_stage_idx ON hub.process_timers (stage_run_id, kind);
ALTER TABLE hub.process_timers ENABLE ROW LEVEL SECURITY;                   -- KHÔNG FORCE (như 0019)
-- policy process_timers_hub_rw FOR ALL TO hub_rw USING v_t WITH CHECK v_t  (chép nguyên biểu thức v_t 0019 dòng 665–666)
GRANT SELECT, INSERT, UPDATE ON hub.process_timers TO hub_rw;               -- không DELETE; agent_runtime không quyền
-- (6) Dựng lại CHECK nới enum (giữ đủ giá trị cũ, thêm cuối)
-- process_runs_status_ck  : (…8 cũ…, 'waiting_timer')
-- stage_runs_status_ck    : (…9 cũ…, 'waiting_timer')
-- review_tasks_reason_ck  : (…20 giá trị của 0032…, 'retry_exhausted', 'timer_invalid')    LIKE '%timer_invalid%'
-- review_task_assignees_via_ck : ('initial', 'forward', 'escalated')
-- process_notices_kind_ck : (…6 cũ…, 'escalated')
-- hub_audit_log_action_check : (…21 giá trị của 0029…, 'escalate', 'escalate_skipped')     (entity giữ nguyên 0030)
```
Mọi `ADD CONSTRAINT`/`UNIQUE` bọc `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=… AND conrelid=…::regclass)`; policy bọc `pg_policies`. Hàng cũ: `ttl_days`=7 (DEFAULT), `retry_count`=0, `remind_count`=0 — thoả CHECK mới. `escalate_group_id` không FK sang `admin.groups` (0019 P3: không FK chéo schema) ⇒ kiểm cùng tenant ở luật lưu + lúc chuyển (S2).

**Drizzle** `schema/hub-processes.ts` (319 → ~360): cột mới (`ttlDays`, `expiresAt` bỏ `.notNull()`, `retryCount`, `retryAttempt`, `retryRound`, `retrySince`, `lastErrorCode`, `remindCount`, `remindEveryH`, `escalateAt`, `escalateGroupId`, `escalatedAt`), bảng `processTimers` (`kind` enum `TIMER_KINDS`), `ASSIGNEE_VIA_VALUES += "escalated"`, `PD_AUDIT_ACTIONS = ["escalate","escalate_skipped"]` trải vào `HUB_AUDIT_ACTION_VALUES` (`hub.ts`). Không seed.

## 2. `0011_pd1_tenant_timezone.sql` (admin, T6a)
Sinh bằng `drizzle-kit generate` từ `schema/admin.ts` (`tenants.timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh")` + `check("tenants_timezone_check", sql\`char_length(${t.timezone}) BETWEEN 1 AND 64\`)`), kết quả mong đợi:
```sql
ALTER TABLE "admin"."tenants" ADD COLUMN "timezone" text DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin"."tenants" ADD CONSTRAINT "tenants_timezone_check" CHECK (char_length("admin"."tenants"."timezone") BETWEEN 1 AND 64);
```
RLS/GRANT không đổi (`tenants_admin_rw`, `tenants_hub_ro` 0002 đủ: Hub đọc qua `hub_ro`). Hàng cũ = mặc định.

## 3. `0037_pd2_tool_branch.sql` (T17)
```sql
-- HUB-FR-146 · HUB-FR-147 · P-d2 (plan-db §3). Chỉ dựng lại CHECK nới enum — không bảng hub mới.
-- stage_runs_status_ck            : (…10 của 0036…, 'skipped')
-- review_tasks_reason_ck          : (…22 của 0036…, 'tool_failed')                LIKE '%tool_failed%'
-- hub_audit_log_action_check      : (…23 của 0036…, 'tool_call', 'branch')
-- process_thread_events_kind_ck   : ('block','output','ask','decision','task_result','forward','run_end','branch')
-- room_messages_process_kind_ck   : process_kind IN (…7 cũ…, 'branch')  (giữ vế sender_type='process' như 0019 dòng 467–469)
```
`process_thread_events_placement_ck` không đổi (`branch` ⇒ `flow`). Drizzle: enum tự theo contract (`ROOM_PROCESS_KINDS`, `STAGE_RUN_STATUSES`, `DECISION_REASONS`); `PD_AUDIT_ACTIONS += "tool_call","branch"`.

## 4. `0012_pd2_tenant_workflow_tools.sql` (admin, T18a)
Phần bảng sinh bằng `drizzle-kit generate` từ `schema/admin.ts` (mẫu `featureEntitlements`); phần RLS **viết tay nối cuối cùng file** (policy không khai trong Drizzle — tiền lệ 0004):
```sql
CREATE TABLE "admin"."tenant_workflow_tools" (
  "workflow_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "granted_by" uuid,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL, "revoked_at" timestamp with time zone,
  CONSTRAINT "tenant_workflow_tools_pkey" PRIMARY KEY("workflow_id","tenant_id"));--> statement-breakpoint
ALTER TABLE "admin"."tenant_workflow_tools" ADD CONSTRAINT "tenant_workflow_tools_workflow_id_workflows_id_fk"
  FOREIGN KEY ("workflow_id") REFERENCES "admin"."workflows"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "admin"."tenant_workflow_tools" ADD CONSTRAINT "tenant_workflow_tools_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "admin"."tenant_workflow_tools" ADD CONSTRAINT "tenant_workflow_tools_granted_by_users_id_fk"
  FOREIGN KEY ("granted_by") REFERENCES "admin"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "tenant_workflow_tools_tenant_active_idx" ON "admin"."tenant_workflow_tools" ("tenant_id","workflow_id")
  WHERE "admin"."tenant_workflow_tools"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE admin.tenant_workflow_tools ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_workflow_tools_admin_rw ON admin.tenant_workflow_tools FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY tenant_workflow_tools_hub_ro ON admin.tenant_workflow_tools FOR SELECT TO hub_ro USING (true);
```
GRANT: `ALTER DEFAULT PRIVILEGES` của 0000 (admin_rw SELECT/INSERT/UPDATE/DELETE, hub_ro SELECT) áp tự động. Hub **chỉ đọc** (B1/TT-R02). Hub lọc `tenant_id = run.tenant_id` tường minh (TT-R08) — policy `hub_ro USING(true)` giống `feature_entitlements_hub_ro`, nên cách ly ở Hub nằm ở truy vấn (security review T20 kiểm).

## 5. Hiệu năng / index (CONVENTIONS §6, không siết thêm)
| Truy vấn mới | Index | Ghi chú |
|---|---|---|
| Ứng viên hẹn giờ tới hạn | `process_timers_due_idx` | `ORDER BY due_at LIMIT 100`, không khoá |
| Đếm `n` khoá idempotency, hẹn chưa bắn của stage | `process_timers_stage_idx` | ≤ vài hàng/stage |
| Huỷ hẹn theo run | `process_timers_run_idx` | |
| Hết hạn run | `process_runs_expiring_idx` | thay `process_runs_expires_idx` |
| Đếm trần | `process_runs_active_idx` (0019) | predicate = `PROCESS_RUN_CAP_COUNTED` |
| Nhắc (cũ + lặp) | `review_tasks_remind_due_idx` | `LIMIT 100` |
| Chuyển cấp | `review_tasks_escalate_idx` | `LIMIT 100` |
| "Đã gửi side_effect" | `runs_process_run_idx` + `run_steps (run_id)` sẵn có | ≤ 4 run × vài bước |
| Công tắc tool (Hub) | PK `(workflow_id, tenant_id)` | đọc trực tiếp, không cache (B5) |

## 6. Test DB qc cần (gợi ý cho test-plan, không phải test)
`P-a/step0/migration.int.test.ts`, `rls.int.test.ts`: bảng/cột/policy mới; FK kép từ chối `stage_run_id` tenant khác (AC-H46); `hub_rw` scope user tenant B `SELECT process_timers` ⇒ 0 hàng của A; CHECK nới nhận giá trị mới, từ chối giá trị lạ; hàng cũ sau migrate (`ttl_days`=7, `timezone`=`Asia/Ho_Chi_Minh`). Admin: `admin_rw` scope tenant B không thấy hàng công tắc của A; `hub_ro` đọc được (AC-A15).
