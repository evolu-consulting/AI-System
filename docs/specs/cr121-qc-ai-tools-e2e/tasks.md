---
id: cr121-qc-ai-tools-e2e
lát: cr121-qc-ai-tools-e2e
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-f4-ai-tools-workflows, cr121-f4b-commands-toggle, cr121-f5-features-entry
---
## Plan (ngắn)
qc sửa e2e theo danh sách /workflows và /commands đã gộp vào /ai-tools (F4/F4b/F5). Không sửa code sản phẩm.

## Làm
workflows.spec, workflows-dify.spec, conflict-workflows.spec, conflict-commands.spec, commands.spec, cr121-list.spec, m2-flow.spec, secrets.spec, cr121-c22-system.spec (thẻ "Danh mục tính năng" + breadcrumb). x1/studio/combine/deployed: không có chỗ trỏ danh sách cũ, giữ nguyên.

## Không làm / Chạm
Không đụng code sản phẩm.

## Test tối thiểu
evotest e2e root@0 (9 spec): 43 xanh + workflows.spec xanh sau sửa lần cuối.

## Quyết định trong lúc làm
Xung đột phiên bản ở menu hàng: menu đọc bản mới trước PATCH nên test chen bản của người kia qua page.route ngay trước PATCH.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: sửa e2e theo CR-121 F4/F4b/F5)

## Việc còn lại
Không.