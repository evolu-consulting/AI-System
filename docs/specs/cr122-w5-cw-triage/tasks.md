---
id: cr122-w5-cw-triage
lát: cr122-w5-cw-triage
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: W1, W3, W4
---
## Plan (ngắn)
Phân loại 27 ca e2e đỏ MỚI ở wave CR-122 lượt 2 (contracts-web ×25, journey-approval ×2) rồi sửa; chạy lại đúng 2 job đỏ một lệnh.

## Làm
- Đối chiếu `git log 0380c80a7..HEAD`: không commit nào chạm `apps/workspace-web` (contracts-web); thay đổi sản phẩm duy nhất là W1
  `approval-engine-card.usecase.ts` (hub-api, chỉ thứ tự ghi audit duyệt thay) — e2e contracts-web dùng backend giả `page.route` nên
  không bị ảnh hưởng.
- contracts-web ×25: mọi ca dừng ở "element(s) not found" 5 s, trang còn "Đang tải…" (v2g-review), `page.goto` quá 30 s (legacy-routes);
  máy chủ lúc đó load 39/12 lõi, 8 slot cùng chạy ⇒ chập chờn do tải. Chạy lại riêng khi máy rảnh để chứng minh.
- journey ×2 (approval.ja ›3, cr121-d ›4): đỏ do W4 `confirmAndSave` chờ `approval-step-0` `data-status=open` — trước khi xác nhận, thẻ
  có thể chưa có bước 0 (ca 3) hoặc bước 0 còn `pending` (ca 4) ⇒ treo 60 s. Sửa test: bấm "Xác nhận và lưu" tới khi nút biến mất
  (thẻ cũ ⇒ APPROVAL_NOT_OPEN ⇒ thẻ tự tải lại ⇒ bấm lại) — đúng gợi ý thứ hai của W1. Trước vòng bấm phải chờ nút HIỆN (ca 5 reload:
  chưa có nút bị hiểu nhầm là đã xác nhận ⇒ ca 5/7 đỏ ở lượt chạy lại 1).
- Kết quả: lượt 1 `-Filter "contracts-web,journey-approval-journey"` (load 1.18/12): contracts-web xanh trọn, journey đỏ ca 5/7 (lỗi
  helper ở trên); lượt 2 journey 26/26 xanh.

## Không làm / Chạm
- Chỉ `e2e/journey-approval/_journey.ts`. Không sửa code sản phẩm.

## Test tối thiểu
- `run-tests.ps1 -Step e2e -Dirty -Filter "contracts-web,journey-approval-journey"`.

## Quyết định trong lúc làm
- Không thêm known-red cho contracts-web: chạy lại khi máy rảnh là đủ chứng minh tải (T2).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

Không thay đổi hành vi (lý do: chỉ sửa helper e2e journey theo hành vi CR-122 đã chốt; ca contracts-web đỏ do tải máy chủ, không đổi code).

## Việc còn lại
- Theo dõi UX (từ W1): nút xác nhận hiện trên thẻ sắp đổi ⇒ hàng chờ sau deploy.
