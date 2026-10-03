# M4-ops · Quyết định (chuyển từ spec §9, Gate M4 §2)

### Trước Gate — đã chốt (người dùng 2026-10-03)
Nền: CR-001 (mặc định readiness M1–M4), CR-002 (2FA + Import/Export vào M4; canvas 6/8 màn); hiệu năng không chặn mốc; RD#10, 16, 31, 32, 33, 36, 37, 42, 48 đã vào §2. Người dùng chấp nhận mọi mặc định dưới đây và của [readiness lần 1](readiness.md); 3 câu trả lời riêng ghi "(ND)".
- Q0 Giữ một spec, task theo khối A–D; quá hạn thì cắt M4a = A+B, M4b = C+D.
- Q1 Run = số `run_id` khác nhau; USD = `billable_usd` (R03).
- Q2 AC-A12 kiểm phía Admin bằng `mock:quota`/stub; vế Hub ("2 run đều chạy") vào M5.
- Q2b Ngưỡng do `evaluateTenant` của Admin: sau commit PUT quotas (không await), NOTIFY `quota_threshold`, mở Tổng quan/banner; không job định kỳ.
- Q3 ADR-0005 **Accepted** 2026-10-03: `nodemailer`, `qrcode` (server), `yaml`; TOTP `node:crypto`; không `recharts`.
- Q5 Tổng quan platform chỉ dùng `usage_logs`; card cần `hub.runs` hiện "—"/"Chưa khả dụng".
- Q6 Audit qua `configWrite` + thao tác user/tenant (khoá, reset, tắt 2FA hộ); login/refresh không ghi; không backfill.
- Q7 (ND) Khôi phục chỉ command, workflow, feature, group, quota; chỉ `platform_admin`.
- Q8 `tenant_admin` không khôi phục (403).
- Q9 PUT quotas thay cả bộ trong một tx, gửi `version` tenant, lệch → 409.
- Q10 (ND) Bước đăng nhập 2FA theo missing §10.2; 2FA tuỳ chọn; admin tắt hộ trong phạm vi, ghi audit, **giữ phiên** của user (không thu hồi).
- Q11 Import tenant chỉ **sửa** (tên, slot, quota, entitlement chỉ thêm); tenant chưa có → lỗi dòng; grants tham chiếu theo key.
- Q12 Banner không đóng được, biến mất dưới 80%. Q13 Màn thiếu artboard theo missing-screens, vẽ sau.
- Q-D1 Tạo lại mã dự phòng đòi mã TOTP hiện tại. Q-C2 Grant cho user không export.
- plan-cd D1 bảng riêng `user_totp` thay cột `users.totp_secret` của BA §7 (docs-architect sửa BA ở task D1) · D2 AES-GCM AAD riêng · D3 mã dự phòng HMAC + pepper · D4 (ND) mật khẩu đúng chưa qua TOTP không reset bộ đếm · D5 `last_used_step` · D6 QR ở server · D7 `yaml` `maxAliasCount: 0` · D8 import 1 tx/1 audit/1 NOTIFY + `expectBase` · D9 SVG tự vẽ · D10 thiếu `SMTP_URL` = tắt mail.
- plan A+B: audit cùng tx trong `configWrite` + bất biến event⇔audit (§4.1); khôi phục = version mới, chỉ thay đổi mới nhất (§4.4); usage loại `cost_usd` ở server (§5.4); mail sau commit, claim `sending` (§5.2).
- Readiness lần 1: PUT quotas không đổi (so bộ sau `normalizeQuotaItems`) → 200 bộ hiện tại, không bump/`updated_by`/audit/NOTIFY/evaluate · `auditSnapshot` chỉ kiểm khoá cấm ở cấp 1 sau allowlist (bỏ qua `input_map`, `input_schema`, `args`, `output`) · audit `config` (import) allowlist `from_config_version, added, updated, secrets_created, truncated` · import `quotas` upsert theo (tenant, feature), dòng mọi giới hạn null → `SCHEMA` · KPI phụ/slot/subscription của Usage/Overview không thêm trường, FE bỏ hiển thị (TECH-DEBT #30).

### Trong lúc làm (agent tự quyết theo Luật 2)
- T0 · `audit_log.seq` Drizzle `bigint mode:"number"` (đủ 2^53; cursor mã hoá chuỗi ở `audit.rules`) · tên ràng buộc `quota_alerts_once_uq`, index `quota_alerts_queue_idx`, `audit_log_{tenant,entity,actor}_seq_idx` · trigger 2 cái (`audit_log_append_only` hàng, `audit_log_append_only_truncate` câu) cùng hàm `admin.audit_log_append_only()`.
- T0 · Enum CHECK của `audit_log`/`quota_alerts` khai ở `packages/db/src/schema/ops.ts` (`AUDIT_ACTION_VALUES`, `AUDIT_ENTITY_VALUES`, `QUOTA_ALERT_STATUSES`) — T0b giữ `AUDIT_ACTIONS`/`AUDIT_ENTITIES` của contracts khớp (đổi = migration mới).
- T0 · `Db.listen(channel, onPayload): Promise<() => Promise<void>>` (postgres.js `sql.listen`, payload chuỗi thô) · `insertAuditRows(tx, rows: AuditInput[], {actorId, v})`: INSERT…SELECT FROM VALUES, `actor_username` = subselect một lần; `AuditInput` export từ `@ai/db`.
- T0 · Test riêng của db (`migrate.int`, `catalog-rls.int`) cập nhật theo trạng thái sau 0007 (main 8; RLS 11 bảng); T0m/T9a nâng tiếp.
- T0b: `updated_by: null` tạm trong `toTenant`/`toUser` và 3 message lỗi ở `lib/errors.ts` để typecheck xanh; T1b điền giá trị thật. `UsageReport*.tenants` bắt buộc (mảng rỗng khi có `tenant_id`); `feature_id` báo cáo = uuid|"none"|null. `quotas.ts` chứa Money*/DateOnly/NOTIFY `quota_threshold`; `audit.ts` thêm NameTaken/RestoreRefMissing details.
- TM · `createTransport({url, timeouts 5/5/10 s})` (không pool); `MAIL_INVALID` kiểm cả `html` ≤ 100 KB và dùng chung cho memory mailer; log lỗi `{recipients, code}`. `SMTP_URL`/`MAIL_FROM` optional ở `EnvSchema`; `server.ts` chỉ cảnh báo `mailer-disabled`, chưa tạo mailer (T4 nối vào deps/`app.ts`). `MAIL_FROM` thêm vào `turbo.json` passthrough.
- T0m · `mock:quota` dùng `postgres` (thêm vào `tools/mocks/package.json`; hunk `bun.lock` đi cùng commit của TM do chung working tree) · tenant phải tồn tại, feature `--feature`/seed (`dich`,`tom-tat`,`viet-lai`) tự tạo nếu chưa có · migration dev `0002_usage_logs_at_idx` (index `usage_logs(at)`), dev=3, main vẫn 8.
- T1 · `ConfigCall.actor?: {userId}` tuỳ chọn tới T1b (tenants chưa truyền actor); `withConfigWrite` opts `actorId`: `undefined` + có `ch.audit` → ném "configWrite: ch.audit cần actorId" (không audit vô danh), `null` = hệ thống. Audit ghi sau bump kể cả khi không có event (`config_version` NULL) — bất biến event⇔audit bật ở T1c. `lib/audit/audit.write.ts`: `auditOf(action, entity, {entityId, entityName, tenantId, before, after, entityVersion?, summary?, snapshot?})` lọc DTO qua `auditSnapshot`; `recordAudit(tx, AuditEntry)`. `AUDIT_FIELDS.user` gồm `totp_enabled` (chỉ pick khi DTO có).
