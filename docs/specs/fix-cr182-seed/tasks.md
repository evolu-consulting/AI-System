---
id: fix-cr182-seed
lát: fix-cr182-seed
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-seed
---
# fix-cr182-seed — `--sign-new`, quy trình phụ hiện ra, lệnh lấy link

## Plan (ngắn)
Soát UI kẹt vì: không còn HĐ Nháp (HĐ mẫu theo ngày đã đi hết), sale tự tải HĐ không gắn được đối tác Evolu, quy trình phụ không hiện ở Cài đặt.

## Chứng cứ (quy trình phụ không hiện)
`apps/hub-api/src/modules/processes/library/event-flow.repo.ts` (`EVENT_FLOW_SQL`, nguồn của `readCurrentFlows` ở `approval-flow.usecase.ts:194`) loại `d.trigger = NEVER_TRIGGER` (`total_value < -1`, `purchase-templates.ts:38`). Seed phụ dùng đúng điều kiện đó ⇒ bị loại dù đã Bật. Sửa: `total_value < -2` (vẫn không bao giờ đúng, khác NEVER_TRIGGER).

## Làm
- [x] `pickSampleTarget(existing, now, forceNew)`: id/tiêu đề theo GIỜ («· 18/11 15:30 · bản 2»); `--sign-new` luôn tạo mới; `--sign-only` dùng HĐ Nháp đang có, không còn Nháp nào thì tạo mới.
- [x] `seed-demo.sh --sign-new` (chuyển cờ cho script).
- [x] Quy trình phụ: trigger `< -2`; test khoá không được bằng `NEVER_TRIGGER`.
- [x] UAT: dùng `--sign-new` mỗi lượt; không tự tải HĐ; lệnh lấy link = `grep partner-sign-mail-off` (bản test `APP_ENV=development` ⇒ log có `link`), thêm cách «Sao chép link».
- [x] Unit test (20 ca).

## Không làm / Chạm
Không chạy trên máy chủ. HĐ đời 17 cũ giữ nguyên.

## Quyết định trong lúc làm
- Bỏ id theo ngày (đã chặn lượt thứ hai trong ngày); id theo phút, cùng phút chạy lại ⇒ cùng HĐ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: seed + tài liệu UAT)
