---
id: cr120-community-flow-ui
lát: cr120-community-flow-ui
cr: CR-120
làn: nhanh
migration: không
phụ thuộc: cr120-community-flows, cr120-one-shell
---
## Plan (ngắn)
4 màn trong Community của workspace-web, dùng REST của `cr120-community-flows`: Hàng chờ duyệt bài, trạng thái duyệt trên "Bài đăng của tôi"
(trang hồ sơ hiện có), Yêu cầu tham gia (đối tác gửi / người duyệt duyệt), Báo cáo vi phạm (menu ⋯ → hộp thoại; người duyệt quyết). Menu theo
vai + khe do server tính (`GET /pack/community/flows/nav`), shell lọc mục có `cap` (mẫu manifest).

## Làm
- [x] contract `FlowNavSchema` + route `GET /pack/community/flows/nav` (reviewer + `moderationOn`, một câu).
- [x] module: route `review|join|reports` (tải lười, chunk riêng), `ui/flows/*`, `domain/flows.ts` (mapper thuần), `FlowsApi` (http + mock).
- [x] shell: `NavEntry.cap`, `buildShellNav(…, hasCap)`, `use-flow-caps` (một yêu cầu, fail-closed); Sidebar truyền `hasCap`.
- [x] "Bài đăng của tôi": ghi chú duyệt dưới thẻ bài (một lần gọi `moderation/mine` cho cả danh sách, không gọi theo bài).
- [x] i18n vi + en (`community.flows.*`, `contracts.nav.{review,join,reports}`); không có từ khe/slot/def/engine.
- [ ] e2e hành trình thật (D5) — CHƯA viết/chạy (hết giờ lát), xem "Việc còn lại".

## Không làm / Chạm
Không chạm backend nghiệp vụ (chỉ thêm route đọc `flows/nav`); không chạm DLC; không migration.

## Perf
Mỗi danh sách = 1 yêu cầu (limit 100 phía server), không yêu cầu theo hàng; `flows/nav` = 1 câu `exists` khi gói bật. Màn mới tải lười.

## Test tối thiểu
- unit: `modules/community/domain/flows.test.ts`, `shell/use-flow-caps.test.ts`, `manifest.test.ts`, `route.test.ts`.

## Quyết định trong lúc làm
- Báo cáo chỉ có `postId` (không tiêu đề) trong contract: danh sách hiện lý do + phân loại; thêm tiêu đề bài vào `ReportSchema` là việc backend sau.
- Người duyệt = `host_admin` (server tính `reviewer`); nav "Duyệt bài" cần thêm khe duyệt bài đã bật.

## Việc còn lại
- e2e hành trình thật: chủ quản bật duyệt bài qua đường admin thật (routing `community.post-moderation`) → đối tác đăng → "Chờ duyệt" → duyệt → hiện; đối tác báo cáo → chủ quản ẩn. Chạy `run-tests.ps1 -Step e2e -All -Filter community-web-stack`.
- `test:lock:write` sau khi có e2e; `check:bundle`; chụp UI soát Luật GỐC 3.
- Báo cáo nên kèm tiêu đề bài (contract).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Màn hình 3 luồng Community (nguồn: cr120-community-flow-ui)
Người duyệt có Hàng chờ duyệt bài (duyệt/từ chối kèm lý do, người khác đã xử lý ⇒ báo và làm mới); tác giả thấy trạng thái duyệt kèm lý do và gợi ý sửa ngay trên "Bài đăng của tôi"; đối tác gửi yêu cầu tham gia, người duyệt duyệt/từ chối; mọi người báo cáo bài từ menu ⋯, người duyệt ẩn/cảnh báo/bỏ qua. Mục menu chỉ hiện đúng vai và khi khe đã bật.
- Kịch bản: khi bài chờ duyệt thì tác giả thấy "Chờ duyệt" kèm lý do và gợi ý sửa; bị từ chối thì thấy lý do [test: apps/workspace-web/src/modules/community/domain/flows.test.ts » moderationNote]
- Kịch bản: khi đối tác chưa được cấp quyền duyệt hoặc khe tắt thì menu không có mục luồng [test: apps/workspace-web/src/shell/use-flow-caps.test.ts » capsOf + nav]
- Kịch bản: khi hai người cùng duyệt một bài thì người sau nhận 409 và được báo "đã có người xử lý" [test: apps/workspace-web/src/modules/community/domain/flows.test.ts » hàng chờ + lỗi]
- Kịch bản: khi người dùng mở route mới thì tải lười, route khớp manifest [test: apps/workspace-web/src/modules/community/manifest.test.ts » createCommunityRoutes]
