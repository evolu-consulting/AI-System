# fix-e2e-r3 — e2e đỏ lượt toàn bộ 2026-11-15 (CR-172)

## Phân loại
- cr150 «B Trả lại/Từ chối» : lý do hiện ở 2 chỗ (băng đầu trang + dòng tóm tắt) ⇒ `getByText` strict-mode; sản phẩm đúng ⇒ `.first()`.
- cr127 j06 `fillDeal`: tra đối tác bất đồng bộ, đôi khi không ra gợi ý khi tải nặng ⇒ gõ lại ô trong `toPass`.
- FL3-1, chat CHAT-AC-03/06, N1 PK-FR-10, root-0 m2-flow, root-2 m4-audit: chập chờn khi tải nặng; chạy lại cùng ref xanh (2 lượt), không sửa.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa test e2e cho ổn định; sản phẩm giữ nguyên).
