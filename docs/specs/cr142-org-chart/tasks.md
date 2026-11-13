---
id: cr142-org-chart
lát: cr142-org-chart
cr: CR-142
làn: nhanh
migration: không
phụ thuộc: org-tree
---
## Plan (ngắn)
«Sơ đồ tổ chức tôi chưa thấy dạng tree, nên dùng organization chart, dùng React Flow đang có để config ở admin và view ở Sổ Hợp Tác.»
Một component sơ đồ cây dùng chung `@ai/flow-canvas/org-chart` (xyflow, nạp lười) + hàm thuần `buildOrgGraph`/`searchDepts` (`@ai/flow-canvas/pure`).
Sổ Hợp Tác `/contracts/org`: cây Công ty → phòng → phòng con, thẻ phòng (tên, trưởng phòng, số người), bấm thẻ ⇒ hộp thành viên, tìm ⇒ nhảy tới phòng + làm nổi thẻ.
Admin «Cơ cấu»: xem trước cùng sơ đồ phía trên form; bấm thẻ ⇒ chọn + cuộn tới phòng đó ở form.

## Làm
- [x] `packages/flow-canvas/src/org-chart/org-graph.ts` (+test): phòng phẳng ⇒ nodes/edges có toạ độ; mồ côi/vòng ⇒ dưới gốc; tìm không dấu.
- [x] `OrgChart.tsx`: thẻ tuỳ biến, chỉ xem (không kéo/nối), Controls, `setCenter` khi tìm.
- [x] workspace-web `features/org-chart`: `OrgChartLazy`, `OrgChartBody`, `DeptMembersDialog`, `org-chart-data.ts`; bỏ danh sách thụt lề.
- [x] admin-web `features/org`: `OrgPreview`, `org-chart-data.ts`, `DeptCard` có `selected`.
- [x] e2e `cr139d-org-tree.spec.ts` sửa theo testid mới (viết, chưa chạy).

## Không làm / Chạm
Không kéo thả đổi phòng cha (để sau), không đổi API/contract, không chạm ApprovalRecord/community.

## Test tối thiểu
unit `org-graph.test.ts`, `org-chart-data.test.ts` (workspace-web, admin-web); e2e `cr139d-org-tree.spec.ts`.

## Quyết định trong lúc làm
- Bố cục tự viết (cha ở giữa con, O(n), đồng bộ) thay vì ELK: ELK cần worker ~1,5 MB phát như tệp tĩnh (chỉ admin-web có) và bất đồng bộ; cây không cần định tuyến cạnh. `memo` theo dữ liệu ⇒ tính một lần mỗi lần dữ liệu đổi.
- Mobile: vẫn dùng sơ đồ (kéo/chụm), không có bản danh sách riêng — một khuôn cho mọi màn (G2).
- Số người thẻ phòng = số người khác nhau cả nhánh (như `headcount` cũ); tính phía client, không đổi API.
- Delta dùng ADDED vì `sht/so-do-to-chuc.md` chưa có ở docs/current (do Delta `org-tree` chưa gộp): khi đóng, gộp hai Delta thành một.
- Nhãn trưởng phòng trống: «Chưa có trưởng phòng». Bỏ `showMembers/hideMembers`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/so-do-to-chuc.md
#### Yêu cầu: Sơ đồ tổ chức dạng cây
Sổ Hợp Tác vẽ sơ đồ cây (organization chart) Công ty → phòng → phòng con nối bằng cạnh; thẻ phòng có tên, trưởng phòng («Chưa có trưởng phòng» nếu trống), số người; chỉ xem, có zoom/kéo khung nhìn.
- Kịch bản: khi nhân viên mở Sơ đồ tổ chức thì thấy cây phòng ban, bấm thẻ phòng mở được danh sách thành viên và không có nút «Chỉnh sơ đồ» [test: e2e/journey-approval/cr139d-org-tree.spec.ts » nhân viên xem cây]
- Kịch bản: khi phòng có phòng cha không tồn tại hoặc nằm trong vòng cha–con thì thẻ phòng treo dưới Công ty và vẫn hiện đúng một lần [test: packages/flow-canvas/src/org-chart/org-graph.test.ts » phòng mồ côi]
- Kịch bản: khi gõ tên phòng, trưởng phòng hoặc thành viên (không dấu) thì khung nhìn nhảy tới phòng khớp và thẻ được làm nổi [test: packages/flow-canvas/src/org-chart/org-graph.test.ts » searchDepts]

#### Yêu cầu: Xem trước sơ đồ ở admin
Màn «Cơ cấu» ở admin hiện cùng sơ đồ phía trên form; bấm thẻ phòng thì chọn phòng đó ở form (đổi phòng cha, trưởng phòng, thành viên vẫn bằng form).
- Kịch bản: khi quản trị bấm thẻ phòng trên sơ đồ xem trước thì phòng đó được chọn ở form [test: e2e/journey-approval/cr139d-org-tree.spec.ts » quản trị chỉnh sơ đồ]
- Kịch bản: khi dữ liệu admin có người không nằm trong danh sách thành viên thì sơ đồ bỏ qua người đó [test: apps/admin-web/src/features/org/lib/org-chart-data.test.ts » trưởng phòng]
