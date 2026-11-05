---
id: cr121-c7-approval-inbox-nav
lát: cr121-c7-approval-inbox-nav
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c6
---
## Plan (ngắn)
Menu trái hiện mục "Chờ tôi duyệt" cho Sổ Hợp Tác (cap `contracts.review`) + số đếm (badge) cho mọi mục hàng việc ở cả hai app.
Server trả TẤT CẢ trong MỘT lần gọi: mở rộng `GET /pack/community/flows/nav` (`counts` + `contracts`). Web tải lại khi quay lại tab /
sau một thao tác duyệt (`notifyFlowNavChanged`), không poll.

## Làm
- hub: `flows/nav` + `counts{review,join,reports}` (1 câu SQL `pendingCounts`, 3 subquery đếm theo index một phần/`(tenant_id,status)`) +
  `contracts{review,count}` (cổng `contractsInbox` → `PackRunsPort.inboxOf`, 1 câu SQL: đếm task duyệt mở cùng mệnh đề với `openTasksOf` +
  `approver` = có vai duyệt trong quy trình ĐANG GÁN của khe `contracts.approval`, Group theo mã). Chỉ đếm cho người duyệt.
- web: manifest Sổ Hợp Tác thêm mục (icon ClipboardCheck, 20 px do `NavIcon`), `NavBadge` 16 px kiểu chuông Header (0 ẩn, >99 "99+"),
  trang `/contracts/approvals` (dữ liệu sẵn `GET /my-work` → approvals[]; rỗng = giải thích + "Xem tất cả hợp đồng").

## Không làm / Chạm
Không đổi quyền duyệt, engine, migration, admin-web. Chạm: `pack-runs-view.ts` (tách mệnh đề FROM/WHERE dùng chung với `openTasksOf`).

## Test tối thiểu
unit `shell/use-flow-caps.test.ts` (map cap→badge, nav theo cap); int `tests/acceptance/CF/approval-inbox-count.int.test.ts` (người duyệt/người khác/tenant khác,
vai duyệt) + `community.flows.int.test.ts` (số đếm theo tenant, người khác 0); e2e viết `e2e/community-web/sidebar-one.cm.ts` (không chạy trong lát).

## Quyết định trong lúc làm
- Một endpoint cho cả hai app: giữ đường `/pack/community/flows/nav` (đã là nguồn cap); mục Sổ Hợp Tác chỉ hiện khi app Community bật (nav tải cùng gói).
- Hiển thị mục khi có việc HOẶC là người duyệt của quy trình đang gán; khe chưa gán quy trình ⇒ ẩn (trừ khi còn việc mở).
- PERF: endpoint tăng +2 câu SQL cố định (1 đếm community, 1 hub HĐ) chạy song song; ngoài người duyệt/không có gói contracts thì 0 câu thêm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Số chờ xử lý trên mục menu hàng việc (nguồn: cr121-c7-approval-inbox-nav)
Mục Duyệt bài, Yêu cầu tham gia, Báo cáo vi phạm hiện số hàng đang chờ (badge); 0 thì không hiện, trên 99 hiện "99+". Số do server tính trong cùng lần gọi quyền menu, chỉ cho người duyệt, chỉ trong công ty của họ; tải lại khi quay lại tab và sau mỗi thao tác duyệt.
- Kịch bản: khi người duyệt có bài chờ thì thấy đúng số của công ty mình, người khác thấy 0, công ty khác không lẫn [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » GET /flows/nav [CR-120] C-7]
- Kịch bản: khi số là 0 thì không có badge, trên 99 hiện 99+ [test: apps/workspace-web/src/shell/use-flow-caps.test.ts » chữ badge]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Mục "Chờ tôi duyệt" trên menu Sổ Hợp Tác (nguồn: cr121-c7-approval-inbox-nav)
Người có vai duyệt trong quy trình duyệt hợp đồng đang gán (hoặc đang có việc chờ) thấy mục "Chờ tôi duyệt" kèm số hợp đồng chờ; mở ra danh sách hợp đồng chờ quyết. Danh sách rỗng ⇒ nói rõ vì sao và bước tiếp theo. Người khác không thấy mục.
- Kịch bản: khi người dùng có vai duyệt thì mục xuất hiện sau "Hợp đồng", người không có vai thì không [test: apps/workspace-web/src/shell/use-flow-caps.test.ts » cap Sổ Hợp Tác]
- Kịch bản: khi hợp đồng chờ người duyệt đúng thì chỉ người đó thấy số, người khác và công ty khác thấy 0 [test: tests/acceptance/CF/approval-inbox-count.int.test.ts » inboxOf]
- Kịch bản: khi mở trang không có hợp đồng chờ thì thấy giải thích và liên kết xem tất cả hợp đồng [test: e2e/community-web/sidebar-one.cm.ts » Menu: badge số]

## Việc còn lại
- Chạy e2e `sidebar-one.cm.ts` ở cuối đợt (đã viết, chưa chạy). Hộp rỗng/`approver` chưa kiểm với dữ liệu seed thật của khách.
