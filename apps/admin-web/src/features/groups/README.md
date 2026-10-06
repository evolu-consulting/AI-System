# features/groups

Groups [ADM-FR-62] [ADM-FR-32] [ADM-FR-55] (M3): nhóm người dùng trong tenant để cấp feature cho cả nhóm. `tenant_admin` (tenant mình) và `platform_admin` (chọn `?tenant=<mã>`; chưa chọn → không gọi API, D9); `member` không vào được.

- Routes: `/groups` (danh sách, xoá gõ key; `beta-testers` "Có sẵn", không xoá được), `/groups/new`, `/groups/$groupId?tab=members|features|agents` (+ `?tenant=`).
- `components/{list,editor,members,grants}`: list (GroupTable + `group-columns`), editor (GroupFields dùng chung cho tạo và "Đổi tên", GroupHeader, GroupTabs, AgentTab — X1 gọi Hub qua `features/hub`), members (MemberTable, PasteMembers, dùng `SearchCombobox` dùng chung), grants (chế độ xem ↔ Sửa, lưu MỘT `PUT /admin/grants/batch`).
- `api.ts`: `/admin/groups*`, members (thêm có `dry_run`, bớt), `grants/matrix?group_id` (một cột), `grants/batch`, `useGroupOptions` (≤ 200, dùng ở Users và Phân quyền).
- Đổi tên: `use-group-conflict` (`useConflictSave`, `ConflictDialog` entity "group"). Dán danh sách: `parseUsernameList` của contract, tối đa 500, thêm một phần; xem trước bằng `dry_run` (`use-paste-preview`).
- `lib/`: `schemas` (form, `typeGroupKey`), `grants` (hàng/kế hoạch batch), `paging`.
