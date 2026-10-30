---
id: ops-fix-core
lát: ops-fix-core
cr: CR-104
làn: đầy đủ (trạng thái/idempotency)
migration: hub 0066
phụ thuộc: ops-core, ops-checks
---
## Plan (ngắn)
Sửa 4 lỗi review phần lõi ops-watch (TB-1, Thấp 2–4) trong `apps/hub-api/src/modules/ops` (repo/round/rules) + migration hub 0066.

## Làm
- [x] TB-1: cột `ops_checks.last_known_status/last_known_at` (trạng thái khác `unknown` gần nhất); chuông warn/crit/hồi phục so với nó,
  dedup theo `last_known_at`. `X → unknown → X` không báo; `warn → unknown → ok` báo hồi phục; sang `unknown` có sự kiện, không chuông.
- [x] Thấp-2: upsert chỉ ghi khi `checked_at` đang lưu ≤ lượt này (lượt cũ ghi sau lượt mới ⇒ bỏ, không chuyển giả); `prev` của
  chuyển trạng thái đọc trong cùng câu dưới khoá advisory.
- [x] Thấp-3: `prev` cho check chỉ lấy kết quả có `checked_at` ≥ now − 2×`every_min`.
- [x] Thấp-4: tắt check ⇒ hàng về `unknown`/"Đã tắt trong cấu hình", `value` null, quên trạng thái đã biết, `checked_at` = lúc tắt.

## Không làm / Chạm
- Không sửa `adapters/checks/*`. Số câu SQL mỗi lượt không đổi (tắt check thêm 1 câu trong tx lưu cấu hình, chỉ khi có check bị tắt).

## Test tối thiểu
- `apps/hub-api/src/modules/ops/ops.fix.int.test.ts` (int), thêm ca vào `domain/ops.rules.test.ts` (unit).

## Quyết định trong lúc làm
- `unknown` kéo dài không gửi chuông "không kiểm được" (giữ đơn giản theo brief review).
- Migration 0066, journal `idx` 64 / `when` 1799100000000 (0065 giữ cho lát ops-checks).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi review CR-104)

## Việc còn lại
