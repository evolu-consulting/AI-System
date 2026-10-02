# features/access

Phân quyền [ADM-FR-35] [ADM-FR-32] [ADM-FR-36] (M3): `/access?tab=matrix|check&tenant=&user=` cho `tenant_admin` và `platform_admin` (chọn tenant; chưa chọn → không gọi API).

- Tab Ma trận: lưới feature × group có cửa sổ hoá hai chiều (`use-grid-window`, `lib/grid-window`; ≤ ~240 ô trong DOM dù 200 × 200), cột nhãn và hàng tiêu đề dính, ô `role=checkbox` (roving, mũi tên/Home/End), tick cả hàng/cột tri-state. Nháp là `Map` chênh lệch so với bản đã lưu (`lib/matrix`); lưu qua MỘT `PUT /admin/grants/batch` (> 200 thao tác → chặn Lưu). Hàng core "Mặc định" khoá, hàng đã thu hồi entitlement mờ (tick giữ nguyên), hàng "Chưa mở" ẩn sau công tắc. `fetchMatrix` gộp các trang group (server trả ≤ 200/trang).
- Tab Kiểm tra quyền: chọn người dùng (`SearchCombobox`), ô "Tìm command", `AccessExplainer` dùng chung (`components/shared/access`, cũng ở tab Quyền hiệu lực của drawer user, chỉ đọc), "Vì sao không?", `GrantToGroupDialog` (một batch `add`), "Thêm {user} vào beta-testers", link "Mở feature" (chỉ platform).
- `api.ts`: `useMatrix`/`fetchMatrix`, `useSaveMatrix`, `useEffectiveAccess` (`staleTime: 0`). NOT_ENTITLED giữa lúc lưu → `notifyInfo` (ma trận tự tải lại), không ghi một phần.
