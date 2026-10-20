---
id: M1e-fixes
title: UAT B2 — người tạo ghi việc cho đối tác của HĐ tự duyệt
cr: CR-095
lane: đầy đủ (RLS/quyền) — test tái hiện trước; review gộp cuối đợt
requirements: [M1D-FR-01, HD7-FR-05]
---

# M1e · UAT CR-095 B2 (`docs/uat/cr095/report.md`, gd0 c54a8195)

Lỗi: HĐ "Nhập tay" (Công ty Gamma), người tạo tự xác nhận cấp 1 ⇒ `POST /partner-events` 404. Câu ghi tay chỉ cho ghi khi đối tác có
đợt (`obligations`) hoặc sự kiện mình **thấy**; HĐ nhập tay không ngày chưa có đợt, và sau 0020 (HĐ tự duyệt không mở khoá bên) sự
kiện của người khác cho MST đó bị ẩn ⇒ không còn căn cứ nào.

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Test tái hiện `tests/acceptance/M1-b2/b2.int.test.ts` (đỏ trước sửa, xanh sau) + ca 404 cho MST không thuộc HĐ nào của mình | xong |
| 2 | `insertManual`: thêm căn cứ "đối tác là bên mua/bán của HĐ do mình tạo hoặc phụ trách" (cùng câu, không migration) | xong |

## Quyết định
- D-M1e-01: chỉ mở **ghi** cho đối tác của HĐ của chính mình; **đọc** giữ luật 0020: việc mình ghi thấy qua `by_user`, việc gắn HĐ mình
  thấy qua `contract_id`, việc/khách CKS của người khác cho cùng MST vẫn ẩn (ca N-1 `tests/acceptance/M1-sec` giữ xanh). Không cần
  migration. Chấm điểm tay (`PUT /partners/ratings`) đã cho ghi khi đối tác có HĐ mình thấy (HĐ của mình luôn thấy) — không đổi.

## Số đo (evotest)
- int: M1-b2 + M1-sec + M1c + M1b + M1D + HD7 + HD8 + HD9: **112 pass, 0 fail**; M1-b2 không có sửa: 1 fail (đúng lỗi B2).
