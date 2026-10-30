---
id: ops-checks
lát: ops-checks
cr: CR-104
làn: nhanh
migration: không
phụ thuộc: ops-watch (O1 ops-core)
---
## Plan (ngắn)
7 check còn lại của ops-watch, mỗi check một file ở `apps/hub-api/src/modules/ops/adapters/checks/`, đăng ký ở `registry.ts`. Mỗi file tách hàm `evaluate*` thuần (unit) khỏi IO (SQL một câu / đọc file / fetch / tls). Ngưỡng lấy từ `cfg` (cấu hình UI), thiếu ⇒ mặc định `OPS_CHECK_META`.

## Làm
- provider, runs_failed, stuck (SQL tập hợp, scope system), public_hosts (fetch tiêm được, 10 s/host), tls (node:tls, hàm lấy hạn tiêm được), backup, disk (file `backup.json`/`host.json`, zod ở `packages/contracts/src/hub-admin/ops-status.ts`).
- `check-kit.ts`: ngưỡng, đọc file trạng thái, danh sách host (`OPS_PUBLIC_URLS`, dự phòng `S2_PUBLIC_*_URL`), `scrub` cho `last_error`.
- Lượt kiểm truyền `prev` (kết quả lượt trước) vào check: `ops.repo.previous()` (một câu) → `ops.round.ts` → `OpsCheckDeps.prev`.

## Không làm / Chạm
Không chạm admin-web (O3) và deploy/ (O4). Chạm O1: `ops.check.ts` (+`prev`), `ops.round.ts`, `ops.repo.ts` (+`previous`).

## Test tối thiểu
- unit `adapters/checks/ops.checks.test.ts`; int `ops.checks.int.test.ts` (provider logged_out ⇒ crit qua lượt thật; runs_failed; stuck dưới RLS).

## Quyết định trong lúc làm
- `statusDir`: `deps.statusDir` ∥ env `HUB_OPS_STATUS_DIR` ∥ `/run/s2/ops`.
- "2 lượt liền lỗi" của host công khai đếm theo `value.consecutive` của lượt trước; "Kiểm tra ngay" cũng là một lượt.
- Provider: thời gian cooldown/busy tính từ `provider_state.updated_at`; chỉ xét provider `enabled` và không `dev_only`.
- stuck: run quy trình "quá timeout" = `status='running'` và `expires_at < now`.
- tls: không xác thực chuỗi (chỉ đọc hạn); host http bị bỏ; host không đọc được không làm crit (đã có check Host công khai).

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: các check của CR-104, yêu cầu ở ops-watch)
Trạng thái gộp: chưa gộp
