# Admin · nhóm (groups) và đối tác

Cập nhật: 2026-11-03 · Nguồn: PDF Phần A + `ghi-chu.md`.

## Nhóm
Nhóm user trong một tenant; là đơn vị cấp feature và agent; không lồng nhóm.
Bảng `groups` (tenant_id, key, name jsonb vi/en, description, version; unique (tenant_id, key)), `group_members` (group_id, user_id, added_by, added_at).
- ADM-FR-62: CRUD group + thêm/bớt thành viên (dán danh sách username để thêm hàng loạt).
- ADM-FR-37: trang group hiện agent được cấp; tenant_admin cấp agent cho group (ghi `hub.agent_grants` qua API Hub bằng JWT tenant_admin; Hub chỉ cho cấp agent đã entitlement cho tenant đó).
- ADM-FR-55: `version` chống ghi đè (409). Nhóm `beta-testers` được bảo vệ; feature `beta` chỉ hiện cho nhóm này. User external bị chặn vào group (422 + trigger).
- `enablePack` tự tạo Group vai (xem `ung-dung-quyen.md`).
- Quyền: platform_admin và tenant_admin (trong tenant); có RLS.

## Đối tác (external orgs)
Công ty đối tác nằm trong tenant chủ quản, phục vụ gói Community (CR-102a). `admin.external_orgs` (tenant_id, name, active, created_by; không xoá cứng); `users.kind='external'` + `external_org_id` + `deactivated_at` (FK kép theo tenant).
- ADM-FR-74/75: nhận diện user ngoài và công ty đối tác; vai luôn `member`, không vào group, không làm quản lý (422).
- Vô hiệu công ty ⇒ vô hiệu mọi user của nó (audit từng user) + route "Mở lại"; `kind` / `external_org_id` bất biến (trigger).
- CR-102: xoá tài khoản đối tác = vô hiệu + huỷ kết bạn, giữ bài/bình luận ("đối tác đã rời").
- Cách ly: đối tác chỉ thấy gói `community` (`EXTERNAL_PACKS` = read/write tĩnh); Hub tra qua một cổng `ExternalOrgResolver`; JWT có claim `kind:external` + `xorg`. GĐ1 chỉ Admin chủ quản thêm/khoá; đối tác tự quản lý là GĐ2 (chưa rõ).
Chi tiết bổ sung: `ghi-chu.md`.
