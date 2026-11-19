---
id: cr189-org-chart-cards
lát: cr189-org-chart-cards
cr: CR-189
làn: nhanh
migration: không
phụ thuộc: cr189-avatar-list
---
## Plan (ngắn)
Thẻ phòng trên sơ đồ tổ chức (BR-189-2): tên · avatar + họ tên trưởng phòng · «N người» trực tiếp (gồm trưởng phòng) + «· tổng M» khi có phòng con · hàng `PersonAvatarGroup` nhân viên (không gồm trưởng phòng). Dùng chung cho Sổ Hợp Tác (xem) và admin (xem trước).

## Làm
- [x] `org-graph.ts`: `count` = trực tiếp, `total`, `hasChildren`, `staff` (`staffOf`), `jobTitle` ở người; thẻ cao 136.
- [x] `OrgChart.tsx`: thẻ mới (nút mở phòng + hàng avatar tách riêng, không lồng nút trong nút); nhãn `peopleTotal`.
- [x] `org.route.ts`: thêm `job_title` (hồ sơ người) cho trưởng phòng và thành viên TRONG cùng câu SQL; `appendix.ts` `job_title` nullish.
- [x] `org-tree.ts` `directCount`; `DeptMembersDialog` hiện trực tiếp + tổng; mapper hai app; i18n `peopleTotal`.
- [x] `flow-canvas` thêm phụ thuộc workspace `@ai/web-kit`; e2e `cr189-avatar-list.cw.ts` bỏ `fixme`.

## Không làm / Chạm
Không đổi tab/route Thành viên, không sửa cơ cấu. Chạm: `packages/flow-canvas/src/org-chart/*`, `org.route.ts`, `appendix.ts`, `OrgChartBody.tsx`, `DeptMembersDialog.tsx`, `org-chart-data.ts` (2 app), `OrgPreview.tsx`, i18n.

## Test tối thiểu
`bun test packages/flow-canvas/src/org-chart apps/workspace-web/src/features/org-chart/lib` · int `org.route.int.test.ts` (evotest -Dirty) · tsc flow-canvas, workspace-web, admin-web, contracts, hub-api.

## Quyết định trong lúc làm
- Avatar trưởng phòng/nhân viên: màu theo `id` (PersonAvatar), CHƯA ảnh thật — API chưa trả `avatar` (data URL nặng cho cả sơ đồ); ảnh thật để lát/CR sau (kế hoạch Q1).
- Thẻ là `div` có 2 vùng: nút mở phòng (tên, trưởng phòng, đếm) và hàng avatar (Popover) — tránh nút lồng nút; `data-testid=org-node-<id>` chuyển lên `div`, nút là `org-open-<id>`.
- `count` đổi nghĩa từ «cả nhánh» sang «trực tiếp» (theo BR); tổng nằm ở `total`.
- Trưởng phòng không lọc kind trong SQL (trigger 0029 chặn đối tác làm trưởng phòng); thành viên vẫn lọc `internal` ⇒ người ngoài không lộ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/so-do-to-chuc.md
#### Yêu cầu: Thẻ phòng trên Sơ đồ tổ chức (nguồn: cr189-org-chart-cards)
Mỗi phòng là một thẻ: tên phòng, avatar và họ tên trưởng phòng, «N người» (trực tiếp, gồm trưởng phòng), thêm «· tổng M» khi có phòng con, và hàng avatar nhân viên (không gồm trưởng phòng; tối đa 5 và «+n», bấm mở danh sách họ tên, chức vụ). Người ngoài công ty không hiện.
- Kịch bản: khi phòng có phòng con thì thẻ hiện «N người · tổng M», phòng lá chỉ hiện «N người» [test: packages/flow-canvas/src/org-chart/org-graph.test.ts » số người trực tiếp (gồm trưởng phòng) + tổng cả nhánh, công ty có tên truyền vào]
- Kịch bản: khi trưởng phòng không nằm trong danh sách thành viên thì vẫn được đếm, và không có trong hàng avatar nhân viên [test: packages/flow-canvas/src/org-chart/org-graph.test.ts » hàng avatar nhân viên không gồm trưởng phòng, trưởng phòng ngoài members vẫn được đếm]
- Kịch bản: khi đếm trực tiếp thì không tính phòng con [test: apps/workspace-web/src/features/org-chart/lib/org-tree.test.ts » directCount = trực tiếp gồm trưởng phòng, không đếm phòng con, tổng ≥ trực tiếp]
- Kịch bản: khi xem sơ đồ thì có chức vụ và không lộ người ngoài [test: apps/hub-api/src/modules/packs/kit/adapters/org.route.int.test.ts » CR-189 · thẻ phòng: đủ dữ liệu đếm (trưởng phòng ∪ thành viên), chức vụ, người ngoài không lộ]
- Kịch bản: khi bấm nhóm avatar thì mở danh sách họ tên + chức vụ, Esc đóng [test: e2e/contracts-web/cr189-avatar-list.cw.ts » thẻ phòng hiện trưởng phòng và số người, bấm nhóm avatar mở danh sách họ tên chức vụ]

## Việc còn lại
- Ảnh thật cho avatar trên thẻ (cần API trả `src` nhẹ).
