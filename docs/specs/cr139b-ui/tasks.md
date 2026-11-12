---
id: cr139b-ui
cr: CR-139 (Q1, Q13)
lane: Sonnet · làn nhanh (UI + một route đọc; không đổi quyền/máy trạng thái)
---
# CR-139b · giao diện «Trưởng phòng của người đề xuất» + «Sơ đồ tổ chức»

## Plan ngắn
| Phần | Làm |
|---|---|
| Editor bước Duyệt (admin-web) | Ô «Ai duyệt» thêm «Trưởng phòng của người đề xuất» (cả mẫu Thư viện) + dòng giải thích; ghi `after.approver_mode='starter_head'`, `group_id=null`, bỏ `approver_user_id` (`lib/approve-panel.ts` `STARTER_HEAD`, `draft-types` `review.approverMode`, `stage-convert`); hợp lệ không cần phòng (`def-form.ts`); thẻ/tóm tắt nói «trưởng phòng của người gửi». |
| Cảnh báo | Hub `flow-preview.rules` mã `no_dept_head` (không chặn): công ty chưa có phòng nào có trưởng ⇒ «…việc sẽ chuyển cho quản trị công ty». `World.anyDeptHead` đọc bằng MỘT câu `exists` trong `loadWorld`. |
| Thẻ duyệt (workspace-web) | `PackStepView.approver/approver_missing` (từ `rowsSql`: join một lần `h` = `approverSql` ∥ trưởng phòng, tên qua `admin.users`; không N+1) → `ApprovalCardStep.approver` → `FlowAssignee.group.person/person_missing` → «Các bước duyệt» hiện «· Tên» (người đích danh / trưởng phòng head_only / trưởng phòng của người gửi); thiếu ⇒ «Chưa có trưởng phòng — quản trị công ty duyệt thay; hãy đặt trưởng phòng ở Phòng ban.» |
| Sơ đồ tổ chức | `GET /pack/contracts/org` (`kit/adapters/org.route.ts`, quyền gói `read`, user ngoài 403, MỘT câu SQL theo tenant) + contract `ContractsOrgSchema`; trang `/contracts/org` (`features/org-chart`): cây (`buildOrgTree`), tìm không dấu (`filterOrg`), rỗng/lỗi/đang tải. Mục menu «Sơ đồ tổ chức» (`ORG_NAV`) cuối nhóm Sổ Hợp Tác (`mobile: more`). |
| Perf | `GET /org`: 1 câu SQL cố định (subquery theo PK/index `group_members`), ≤ 500 phòng. `rowsSql`: thêm 1 left join lateral + 1 join users theo PK — không thêm câu mới. Bundle: route mới tách chunk theo route. |

## Quyết định trong lúc làm
| # | Quyết định | Lý do |
|---|---|---|
| 1 | «Sơ đồ tổ chức» = mục menu riêng `/contracts/org` (không tab trong Cài đặt › Thành viên) | Cài đặt chỉ cho người ghi/quản trị; ai cũng phải xem được. Trang quản trị cũ giữ nguyên (sửa), trang mới chỉ xem — khác mục đích. Thêm `org` vào `CONTRACTS_PAGES` của `legacy-routes` (nếu không bị đổi thành `/contracts/c/org`). |
| 2 | Contract thẻ: `FlowAssignee.group` thêm `person`/`person_missing` thay vì đổi sang `kind:'user'` | Giữ nhãn phòng + cờ `head_only`; không phá nơi đọc `assignee.kind`. (Brief nói `name`; dùng `person` để khỏi lẫn `label` = tên phòng.) |
| 3 | `GET /org` trả danh sách phẳng (`parent_id`), cây dựng ở web | Một câu SQL đơn giản, kiểm vòng cha–con ở web (thuần, có test); tránh CTE đệ quy không cần. |
| 4 | Không làm `flow-form.ts` (khe duyệt của «luồng Thư viện» `FlowReviewStep`) | `FlowReviewStepSchema` không có `approver_mode`, compile qua `approval-flow.usecase` — cần đổi contract + hub ngoài phạm vi lát; mẫu Thư viện dạng stages (editor processes) đã chọn được. Đề xuất cho backend-lead nếu cần. |
| 5 | Cảnh báo dùng cơ chế `warnings` của preview (câu chữ tiếng Việt từ hub, như `no_head`), không thêm khoá i18n | `check:error-codes` OK; web hiện nguyên `message`. |
| 6 | Dòng tóm tắt thẻ Duyệt không lặp «trưởng phòng của người gửi» (đã là tiêu đề thẻ) | Ít chữ. |

## Test
unit: `approve-panel.test.ts` (mã hoá whoValue), `org-tree.test.ts` (dựng cây/tìm), `legacy-routes.test.ts`; int: `kit/adapters/org.route.int.test.ts` (đường chính + user ngoài 403 + chéo tenant) xanh trên evotest; e2e viết (không chạy): `e2e/journey-approval/cr139b-starter-head.spec.ts`.

## Việc còn lại
- Chạy e2e hành trình một lần cuối đợt (cần `DEMO_OWNER_PW`, công ty demo từ `bun run demo:org`; id HĐ mẫu trong spec là giả định `…0001` do cuong.le gửi — xác nhận khi chạy).
- Chụp editor ở chế độ sửa được (ảnh hiện là bản công ty do nền tảng soạn ⇒ chỉ xem).
- Nếu cần chọn «Trưởng phòng của người đề xuất» ở «luồng Thư viện» dạng `FlowReviewStep` ⇒ backend-lead mở contract (`approver_mode`) + `compileDef`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Editor bước Duyệt chọn được «Trưởng phòng của người đề xuất»
Ô «Ai duyệt» có lựa chọn «Trưởng phòng của người đề xuất» (kể cả mẫu Thư viện): lưu `approver_mode='starter_head'` không phòng, hợp lệ không cần chọn phòng; chọn lại phòng/người thì bỏ kiểu này; thẻ và tóm tắt bước nói «trưởng phòng của người gửi».
- Kịch bản: chọn kiểu mới ⇒ bỏ phòng và người, chọn lại ⇒ bỏ kiểu mới [test: apps/admin-web/src/features/processes/lib/approve-panel.test.ts » CR-139 · Trưởng phòng của người đề xuất]

### ADDED sht/so-do-to-chuc.md
#### Yêu cầu: Sơ đồ tổ chức chỉ xem cho nhân viên công ty
Mọi nhân viên có quyền đọc Sổ Hợp Tác xem được cây phòng ban (cha–con), trưởng phòng và thành viên đang dùng được của CHÍNH công ty mình, tìm theo tên phòng hoặc người (không phân biệt dấu); người dùng ngoài công ty (đối tác) bị từ chối; công ty trống ⇒ trang nói vì sao và ai tạo phòng ban.
- Kịch bản: `GET /pack/contracts/org` trả cây + trưởng phòng + thành viên đúng công ty [test: apps/hub-api/src/modules/packs/kit/adapters/org.route.int.test.ts » đường chính]
- Kịch bản: user ngoài ⇒ 403, công ty khác không lộ sang [test: apps/hub-api/src/modules/packs/kit/adapters/org.route.int.test.ts » user ngoài (đối tác) ⇒ 403]
- Kịch bản: dựng cây từ danh sách phẳng, chặn vòng, tìm không dấu [test: apps/workspace-web/src/features/org-chart/lib/org-tree.test.ts » filterOrg]
- Kịch bản: `/contracts/org` không bị đổi thành `/contracts/c/org` [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » /contracts/org]

### ADDED sht/duyet-ten-nguoi-duyet.md
#### Yêu cầu: «Các bước duyệt» hiện tên người duyệt đã được chọn
Bước có người duyệt đích danh, trưởng phòng (head_only) hoặc «trưởng phòng của người gửi» hiện «· Tên»; bước «trưởng phòng của người gửi» không tìm được ai ⇒ dòng nhắc quản trị công ty duyệt thay và hãy đặt trưởng phòng; preview cảnh báo (không chặn) khi công ty chưa có phòng nào có trưởng.
- Kịch bản: hành trình cuong.le gửi ⇒ thẻ hiện Trần Thị Bình, chỉ binh.tran duyệt được [test: e2e/journey-approval/cr139b-starter-head.spec.ts » starter_head · thẻ hiện tên trưởng phòng]
