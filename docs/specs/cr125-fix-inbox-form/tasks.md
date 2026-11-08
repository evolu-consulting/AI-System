---
id: cr125-fix-inbox-form
lát: cr125-fix-inbox-form
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Tìm hồi quy: bước điền (form) ở waiting_review không vào «Chờ tôi duyệt» / thẻ bước 1 không hiện (e2e cr125-form-step-card + cr125-purchase-full đỏ trên 84e58d6b0).

## Chẩn đoán (tạm dừng theo điều phối, chưa sửa)
- int hub `flow-form-step-card.int.test.ts` XANH trên 84e58d6b0 (4 pass): chiếu thẻ HĐ (kind form + task Gửi) và Gửi ở hub đúng ⇒ lỗi không ở hub-api contracts/flowViewOfCard.
- Còn nghi (chưa kiểm): (1) web `RequestPage`/`RequestsPage` sau cr125-request-steps + cr125-run-attachments (trang yêu cầu giờ chuyển sang lượt gốc theo `root_run_id`; hộp «Chờ tôi duyệt» đọc `/me/review-tasks` lọc `status=open && can_act`); (2) e2e harness cr125-fix-ms-harness (bf657942e: journey -fsc DB/Redis/cổng riêng) — đổi môi trường e2e, không đổi sản phẩm; (3) cr125-contract-from-step (13a71e65c) chỉnh khoá/node Phần 2.
- Bước kế: chạy int `manual-start`/`request-steps` + dò `/me/review-tasks` cho task form của nhóm được giao; chạy job fsc MỘT lần trên evotest rồi đọc dump.

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Xoá khối mẫu dưới đây rồi điền thật (kiểm bằng `bun run openspec:check`). Lát không đổi hành vi: thay bằng
một dòng `Không thay đổi hành vi (lý do: …)`.
```
### MODIFIED sht/chung-tu.md
#### Yêu cầu: <tên>
<mô tả hành vi mới>
- Kịch bản: khi … thì … [test: <path test> » <tiêu đề test>]  (hoặc [test: thủ công — <lý do>])
(### ADDED <file mới>; ### REMOVED <file> + dòng "Lý do: …")
```

## Việc còn lại

