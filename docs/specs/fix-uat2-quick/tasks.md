---
id: fix-uat2-quick
lát: fix-uat2-quick (UAT 2026-11-12 — lỗi UI nhỏ)
cr: CR-133
làn: nhanh
migration: không
---
## Plan (ngắn)
| # | Sửa |
|---|---|
| 1 | `globals.css` (workspace-web + admin-web) lớp base: button/[role=button] `cursor: pointer`, disabled `not-allowed` |
| 2 | `DetailGrid`: «Sản phẩm (AI đọc)» ra khỏi cột trái, full chiều rộng hàng dưới lưới 2 cột |
| 3 | Bỏ câu `contracts.review.draftHint` (render + khoá vi/en). e2e khoá `e2e/contracts-web/cr120-intake-flow.cw.ts:25` còn kiểm `draft-hint` ⇒ qc cần cập nhật |
| 4 | `ImageViewer`: khung cố định (hộp 1100px, stage cao `min(70vh,640px)`, ảnh `object-contain`) ⇒ hết chớp |
| 5 | `.stickytop`: khe dưới là `padding-bottom` có nền (không `margin-bottom` trong suốt) ⇒ bài cuộn không lộ ở khe |
| 6 | `MessageFiles.openFile`: tệp không phải ảnh tải bằng thẻ `a[download]` từ URL `/link` (không điều hướng trang) |

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: sửa giao diện — con trỏ, bố cục, khung hộp ảnh, nền thanh dính, cách kích hoạt tải tệp; bỏ một câu gợi ý).

Trạng thái gộp: chưa gộp
