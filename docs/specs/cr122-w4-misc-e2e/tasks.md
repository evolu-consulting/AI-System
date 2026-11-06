---
id: cr122-w4-misc-e2e
lát: cr122-w4-misc-e2e
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: C, p14, W1, W2
---
## Plan (ngắn)
Sửa các ca đỏ còn lại ở wave cuối CR-122 (chỉ test): fnr editor/form-editor theo chữ mới (C: "Chuẩn bị dữ liệu", "Tên bước"); N3 isolation cho phép USAGE hub + EXECUTE hub.emit_flow_event, không quyền bảng hub; HD1 hops 3→4 câu SQL (emit contract.uploaded cùng tx); CF/approval-engine so flow_version với published_version hiện hành (M1 tạo release v+1); journey chờ approval-step-0 mở rồi mới Xác nhận và lưu. Chập chờn: X1-AC08, CHAT-AC-03 (chạy lại xanh), M2-AC09 vào known-red tới 2026-11-14.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa test e2e/acceptance theo hành vi CR-122 đã chốt và đánh dấu ca chập chờn).
