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

## Chẩn đoán (kết luận)
- KHÔNG phải hồi quy của cr125-request-steps. Spec e2e `cr125-form-step-card` dùng `PURCHASE_TEMPLATES[0]` (Phần 1); cr125-purchase-parent (b477ae3d9) đổi Phần 1 thành lượt con: `trigger = NEVER_TRIGGER` (`contract.submitted` + điều kiện `total_value < -1` không bao giờ đúng), đầu vào = phiếu, và dòng 3 thành MỘT bước «cùng duyệt» (11 bước thay vì 12). ⇒ HĐ gửi duyệt không khớp luật định tuyến ⇒ thẻ HĐ «chưa có quy trình duyệt» (FLOW_ROUTE_NONE) ⇒ `flow-step-1-…` không hiện.
- Sau khi gỡ điều kiện trên còn 2 lệch nữa của spec: (a) cr125-run-attachments ⇒ người xem lượt thấy TÊN tệp (không còn «Tệp đính kèm»); (b) chỉ số bước + bước cùng duyệt của mẫu mới.

## Làm
- Sửa spec e2e (sản phẩm đúng): ghi đè `trigger` = `contract.submitted` + đầu vào `contract_id` khi chạy Phần 1 như quy trình theo sự kiện HĐ; chỉ số bước theo mẫu 11 bước; `approvePart` cho dòng cùng duyệt (TBP rồi Tài chính); khẳng định tên tệp.
- evotest `journey-approval-journey-fsc`: 1 pass (71.8s).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ sửa spec e2e theo mẫu Phần 1 / tệp liên kết lượt đã gộp)

## Việc còn lại
- `cr125-purchase-full` (cha 3 Phần) đỏ do lỗi khác (cha đứng ở Phần 1/hẹn canh) — xem cr125-fix-parent-timer-2.

