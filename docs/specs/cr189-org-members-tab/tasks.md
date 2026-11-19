---
id: cr189-org-members-tab
lát: cr189-org-members-tab
cr: CR-189
làn: đầy đủ
migration: không
phụ thuộc: cr189-org-chart-cards, cr187-members-internal
---
## Plan (ngắn)
«Thành viên & phòng ban» có hai tab (Sơ đồ tổ chức đứng đầu, mở mặc định; Thành viên thứ hai). Tab Thành viên: cột tên = avatar + họ tên + chức vụ. Cấp quản lý chỉ chọn trưởng phòng (ô thả xuống avatar + tên, gợi ý trưởng phòng của phòng người đó, được để trống); máy chủ từ chối gán MỚI người không phải trưởng phòng; dữ liệu cũ giữ + cảnh báo vàng.

## Làm
- [x] `org.service.ts` `setManager`: gán mới ≠ quản lý hiện tại và không phải trưởng phòng ⇒ 400 `VALIDATION_ERROR` `details.reason = manager_not_head` (kiểm sau ràng buộc FK/ngoài/vòng; tx lùi).
- [x] `OrgTabs` + gắn vào `OrgChartPage` / `OrgPage`; `/contracts/settings` (và `/settings`) mở tab Sơ đồ; `/settings/members` cũ vẫn tới Thành viên.
- [x] `OrgPage`: ô tên avatar + chức vụ; ô cấp quản lý = `PersonPick` chỉ trưởng phòng + nút «Gợi ý» + cảnh báo vàng.
- [x] `lib/org.ts`: `headCandidates`, `suggestedHeadOf`, `managerNotHead`.
- [x] i18n vi/en; test int, unit, e2e.

## Không làm / Chạm
Không sửa cơ cấu (lát #4–5), không migration, không backfill/xoá cấp quản lý cũ.
Chạm: `apps/admin-api/src/modules/org/*`, `apps/workspace-web/src/features/org/*`, `features/org-chart/pages/OrgChartPage.tsx`, `routes/_authed/contracts/settings/index.tsx`, i18n `contracts/org.*.json`.

## Test tối thiểu
- int: `org.service.int.test.ts`, `external-deny.int.test.ts` (evotest, 27 pass).
- unit: `features/org/lib/org.test.ts`.
- e2e (chạy cuối đợt): `e2e/contracts-web/org-visibility.cw.ts`.

## Quyết định trong lúc làm
- Trưởng phòng = là `head_user_id` của MỘT phòng bất kỳ trong công ty (không bắt buộc là trưởng phòng của chính người được gán).
- Gán lại đúng người đang là quản lý (dù không phải trưởng phòng) = không đổi ⇒ cho qua; chỉ gán MỚI mới kiểm.
- Kiểm trưởng phòng đặt SAU insert (FK/đối tác/vòng giữ mã lỗi cũ trước); throw ⇒ cả tx lùi.
- Ứng viên + gợi ý lấy từ `/admin/org` (đã có, một lần) — không thêm API.
- Test cũ gán người không phải trưởng phòng đổi nghĩa theo spec: sửa `org.service.int.test.ts`, `external-deny.int.test.ts`, `org-visibility.cw.ts` (dựng trưởng phòng trước khi gán).
- `/contracts/settings` chuyển tới `/contracts/org` (tab Sơ đồ mặc định).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/sht/to-chuc-thanh-vien.md
#### Yêu cầu: Thành viên & phòng ban có hai tab, Sơ đồ tổ chức đứng đầu
«Thành viên & phòng ban» mở ở tab «Sơ đồ tổ chức»; tab «Thành viên» đứng thứ hai; link cũ tới Thành viên vẫn đúng.
- Kịch bản: khi mở /settings thì tới tab Sơ đồ tổ chức, tab thứ hai là Thành viên, link cũ /settings/members vẫn tới Thành viên [test: e2e/contracts-web/org-visibility.cw.ts » CR-189 · /settings mở tab Sơ đồ tổ chức đầu tiên, tab Thành viên thứ hai, link cũ vẫn tới Thành viên]

#### Yêu cầu: Cấp quản lý chỉ là trưởng phòng
Ô cấp quản lý chỉ liệt kê trưởng phòng (avatar + tên), gợi ý trưởng phòng của phòng người đó, được để trống; máy chủ từ chối gán MỚI người không phải trưởng phòng (400 `manager_not_head`).
- Kịch bản: khi người khác người tạo dữ liệu gán người không phải trưởng phòng thì 400 manager_not_head và không ghi [test: apps/admin-api/src/modules/org/org.service.int.test.ts » gán người không phải trưởng phòng ⇒ 400 manager_not_head, không ghi]
- Kịch bản: khi gán trưởng phòng hoặc để trống thì thành công [test: apps/admin-api/src/modules/org/org.service.int.test.ts » gán trưởng phòng hoặc để trống ⇒ ok]
- Kịch bản: khi người đang có quản lý không phải trưởng phòng thì giữ nguyên, gán lại ok, đổi sang người không phải trưởng phòng bị từ chối [test: apps/admin-api/src/modules/org/org.service.int.test.ts » dữ liệu cũ giữ: quản lý không phải trưởng phòng không bị xoá, gán lại ok, đổi sang người không phải trưởng phòng ⇒ 400 giữ bản cũ]
- Kịch bản: khi chọn quản lý thì chỉ thấy trưởng phòng và gợi ý đứng đầu [test: apps/workspace-web/src/features/org/lib/org.test.ts » ứng viên là trưởng phòng, trừ chính mình và cấp dưới, gợi ý đứng đầu]
- Kịch bản: khi quản lý cũ không phải trưởng phòng thì cảnh báo vàng [test: apps/workspace-web/src/features/org/lib/org.test.ts » cảnh báo vàng chỉ khi có cấp quản lý mà người đó không phải trưởng phòng]
- Kịch bản: khi chọn trưởng phòng ở tab Thành viên thì lưu, quản lý cũ không phải trưởng phòng giữ nguyên kèm cảnh báo, bấm gợi ý thì gán [test: e2e/contracts-web/org-visibility.cw.ts » CR-189 · quản lý cũ không phải trưởng phòng giữ nguyên + cảnh báo vàng, bấm gợi ý là gán]

## Việc còn lại
Chạy e2e `org-visibility.cw.ts` cuối đợt (chưa chạy). Soát Opus luật cấp quản lý ⇒ ai thấy HĐ. Seed demo `seed-demo-partner.org.io.ts` gán quản lý qua API: thứ tự `set_dept` trước `set_manager` chưa kiểm (ngoài phạm vi).
