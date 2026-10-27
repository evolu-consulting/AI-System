# tenant-quotas — hạn mức ngày theo công ty (Luật 0b, làn đầy đủ phần RLS/quyền, một agent)

Mục tiêu: platform_admin chỉnh 3 hạn mức NGÀY cho từng công ty ở Admin › Công ty › tab Quota thay vì chỉ env chung.

| Loại | Env hub-api (mặc định) | Đếm ở | Ngày |
|---|---|---|---|
| `uploads` lượt tải HĐ/ngày | `CONTRACTS_UPLOADS_TENANT_DAY` (30) | Redis `q:contracts:t:<tenant>:<ngày>` | múi tenant |
| `actions` lượt thao tác AI/ngày | `CONTRACTS_ACTIONS_TENANT_DAY` (100) | Redis `q:contracts:a:<tenant>:<ngày>` | múi tenant |
| `ai_tokens` token AI/ngày | `AI_TENANT_DAILY_TOKENS` (5.000.000, 0 = không trần) | `hub.usage_logs` (+ giữ chỗ) | UTC |

## Plan (đã làm)
- [x] Migration `0025_tenant_quotas` (journal idx 25, when 1798300000000): bảng `admin.tenant_daily_limits` (PK tenant, 3 cột null = env, `ai_tokens_reset_at`, CHECK 1..max); RLS như `tenant_workflow_tools` (admin_rw theo scope/tenant, hub_ro SELECT). Schema Drizzle `packages/db/src/schema/daily-limits.ts`.
- [x] `@ai/contracts` `daily-limits.ts`: luật thuần (`envDailyLimit`, `effectiveDailyLimit`, `tenantLocalDay`, `dailyCounterKey`, `aiTokensSince`) + schema API.
- [x] hub-api: `loadTenants` LEFT JOIN bảng mới (cùng một câu) ⇒ `TenantState.dailyLimits` trong `ConfigCache` (nạp lại theo NOTIFY/poll `config_version`, 0 SQL mỗi request). Upload use case `tenantLimitOf`, `actionQuota.limitOf`, `createHubAiClient({limitsOf})` (`hubAiCaps`: trần riêng + mốc đếm). Không đổi cách đếm/khoá/mặc định.
- [x] admin-api module `daily-limits` (chỉ platform_admin):
  - `GET /admin/tenants/:id/daily-limits` → `{tenant_id, timezone, items[{kind, override, env_default, effective, used, day}]}`
  - `PUT /admin/tenants/:id/daily-limits` body `{uploads, actions, ai_tokens}` (số nguyên ≥ 1 hoặc null) — `configWrite` + audit `quota/update` (`daily_limits`) + NOTIFY `config_changed {entity: quota}`.
  - `POST /admin/tenants/:id/daily-limits/:kind/reset` — uploads/actions: DEL khoá Redis ngày hiện tại (múi tenant) + audit (không bump); ai_tokens: đặt `ai_tokens_reset_at = now` (configWrite + audit).
- [x] admin-web: thẻ "Hạn mức theo ngày" đầu tab Quota (3 ô, trống = mặc định, "Hôm nay đã dùng X / Y", "Đặt lại hôm nay" có xác nhận).
- [x] Test: unit (contracts, hubAiCaps, nháp admin-web), int `daily-limits.int.test.ts` (đường chính GET/PUT/reset, 403 tenant_admin, RLS chặn đọc/ghi chéo tenant); e2e `e2e/tenant-daily-limits.spec.ts` (mock, chưa chạy). Cập nhật danh sách bảng ở 5 test schema/RLS.

## Quyết định trong lúc làm
- Tên bảng `tenant_daily_limits` (không `tenant_quotas` — đã có bảng quota tháng 0007). File migration theo số giao `0025_tenant_quotas`.
- Hub đọc override qua `ConfigCache.tenant()` sẵn có (cache theo `config_version`), không truy vấn mỗi request.
- Token AI không có khoá Redis ⇒ "Đặt lại hôm nay" = mốc `ai_tokens_reset_at`; hub đếm từ `max(00:00 UTC, mốc)` (mốc của ngày trước tự hết tác dụng). Không xoá `usage_logs` (dữ liệu chi phí).
- admin-api đọc/xoá khoá Redis của hub qua cùng `REDIS_URL` (client của giới hạn đăng nhập); Redis vắng ⇒ "đã dùng" = null ("—"), reset uploads/actions 503 `QUOTA_COUNTER_UNAVAILABLE`.
- `env_default` admin-api đọc cùng tên biến env với hub-api (giả định hai dịch vụ dùng chung `.env`, như compose hiện tại). Lệch env giữa hai container chỉ làm sai số "mặc định" hiển thị, không đổi hành vi hub.
- Token đã dùng đọc `hub.usage_logs` ngoài transaction scope (bảng Hub không RLS, như `usage.repo`); DB chỉ có migration Admin (test) ⇒ null thay vì 500.
- Reset uploads/actions: audit ghi trước, DEL là bước cuối trong cùng transaction ⇒ DEL lỗi thì rollback audit.
- Audit allowlist `quota` thêm khoá `daily_limits`.
- Ghi tuần tự: khoá hàng `admin.tenants` (FOR UPDATE) trước khi upsert.

## Việc còn lại
- Chạy e2e `e2e/tenant-daily-limits.spec.ts` ở lượt e2e cuối đợt.
- Review + security cuối đợt (RLS bảng mới, quyền platform_admin, DEL Redis từ admin-api).
- Typecheck admin-web có lỗi sẵn ở `src/features/agents/lib/agents.test.ts` (không thuộc lát này).

## tenant-quotas-fix (sau review)
- Đặt lại lượt tải/thao tác: `SET key 0 KEEPTTL` (không DEL), chạy SAU khi commit audit; Redis lỗi sau commit ⇒ 503, bấm lại vô hại.
- hub `upload-counter.redis` hoàn lượt bằng một EVAL kẹp ≥ 0 (giữ TTL) — lượt giữ trước "Đặt lại" rồi hoàn không làm bộ đếm âm. Int Redis thật `upload-counter.redis.int.test.ts`.
- e2e: ô nhập lấy theo `getByRole("textbox")` (nhãn nút "Đặt lại hôm nay: <loại>" cũng chứa tên loại ⇒ `getByLabel` khớp 2). Đã chạy xanh.
