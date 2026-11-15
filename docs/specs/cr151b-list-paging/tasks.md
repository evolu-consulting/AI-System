# cr151b-list-paging — CR-151 (mọi danh sách người dùng thấy phải tải dần hoặc phân trang, cả API lẫn UI) · lát b (mục Vừa)

## Plan
Bảng rà soát `docs/specs/cr151-list-paging/audit.md` (mục Vừa). Lát này làm 7, 8, 9, 10, 13, 14, 17. Mục 11, 12 chưa làm (xem «Việc còn lại»). Mục 15, 16, 18–29 ngoài phạm vi.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 7 | `GET /moderation/queue?limit&offset` (limit ≤ 100, mặc định 50; MỘT câu SQL/trang, kéo limit+1); màn Hàng đợi duyệt bài «Xem thêm» | `flows.ts` (contracts), `flows.repo/service/routes.ts`, `ReviewQueue.tsx`, `parts.tsx` | [x] |
| 8 | `GET /join-requests?limit&offset&pending` cùng khuôn; màn Yêu cầu tham gia «Xem thêm» | như trên + `JoinRequests.tsx` | [x] |
| 9 | `GET /reports?limit&offset&pending` cùng khuôn; màn Báo cáo vi phạm «Xem thêm» | như trên + `Reports.tsx` | [x] |
| 10 | `GET /moderation/mine?limit&offset` cùng khuôn; hồ sơ › Bài đăng gom mọi trang (`loadAllMine`) để đối chiếu trạng thái duyệt | `sections.tsx`, `domain/flows.ts` | [x] |
| 14 | `GET /processes/requests/mine?limit&offset` (limit ≤ 50) + `next_offset`; «Đã gửi của tôi» «Xem thêm» | `process-start.ts`, `my-requests.service.ts`, `manual-start.routes.ts`, `MyRequests.tsx` | [x] |
| 13 | chat-web «Chờ tôi kiểm» dùng `next_cursor` (useInfiniteQuery, `data` giữ dạng phẳng); nút «Xem thêm» khi còn trang | `inbox/api.ts`, `TodoGroup.tsx` | [x] (chưa có test) |
| 17 | Danh sách công ty (tenant): `Pagination` 50/trang, `limit/offset/total` có sẵn ở API; hộp chọn gán quy trình giữ `limit: 200` | `tenants/api.ts`, `TenantsPage.tsx`, `use-assignable-tenants.ts` | [x] |
| 11 | Sổ đối tác — nghĩa vụ mở | — | [ ] chưa làm |
| 12 | Tab «Hợp đồng» của đối tác | — | [ ] chưa làm |

## Quyết định trong lúc làm
- Phân trang theo `offset` (khớp lát trước và `ListQueryBase`); trang đầy + `nextOffset`/`next_offset` null = hết.
- Mục 10: bài của tôi chỉ dùng để dán nhãn trạng thái duyệt lên bài trong bảng tin ⇒ UI gom mọi trang (mỗi trang một lời gọi, trang ≤ 100) thay vì cắt 50 im lặng.
- Mục 13: không đổi API; `data` của `useReviewTasks` giữ dạng `{items, open_count}` nhờ `select` nên các nơi dùng cũ không đổi.
- Mục 17: API đã có `limit/offset/total`; chỉ thêm tham số `limit` vào hook để hộp chọn không bị đổi hành vi.
- Bộ lọc trạng thái của bảng Yêu cầu tham gia / Báo cáo chạy trên các dòng đã tải (như trước); «Xem thêm» nạp tiếp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hang-cho-duyet-bai.md

#### Yêu cầu: Hàng đợi duyệt bài, bài của tôi, yêu cầu tham gia và báo cáo vi phạm phân trang ở máy chủ
- Kịch bản: khi xem trang 2 hàng đợi duyệt và bài của tôi thì đúng thứ tự, không trùng, quá trần 100 bị từ chối [test: apps/hub-api/src/modules/packs/community/adapters/community.flows-paging.int.test.ts » hàng đợi duyệt + bài của tôi: trang 2 đúng thứ tự, không trùng, trần 100, người đăng ≠ người duyệt]
- Kịch bản: khi xem trang 2 yêu cầu tham gia thì đúng, đối tác chỉ thấy của công ty mình [test: apps/hub-api/src/modules/packs/community/adapters/community.flows-paging.int.test.ts » yêu cầu tham gia: trang 2 đúng, đối tác chỉ thấy của công ty mình, trần 100]
- Kịch bản: khi xem trang 2 báo cáo vi phạm thì đúng, đối tác chỉ thấy báo cáo của mình [test: apps/hub-api/src/modules/packs/community/adapters/community.flows-paging.int.test.ts » báo cáo vi phạm: trang 2 đúng, đối tác chỉ thấy báo cáo của mình, trần 100]
- Kịch bản: khi hồ sơ gom các trang bài của tôi thì đi hết theo nextOffset, mỗi trang một lời gọi [test: apps/workspace-web/src/modules/community/domain/flows.test.ts » gom mọi trang theo nextOffset, mỗi trang một lời gọi, dừng khi nextOffset rỗng]

### MODIFIED engine/manual-start-ui.md

#### Yêu cầu: Đã gửi của tôi tải dần
- Kịch bản: khi xem trang 2 thì không trùng trang 1, hết trang thì next_offset rỗng, quá trần 50 bị từ chối, người khác không thấy [test: apps/hub-api/src/modules/processes/triggers/my-requests.int.test.ts » CR-151 · phân trang limit/offset: trang 2 đúng, không trùng, hết trang ⇒ next_offset null, trần 50, người khác không thấy]

### MODIFIED admin/danh-sach.md

#### Yêu cầu: Danh sách công ty phân trang ở máy chủ
- Kịch bản: khi xem trang 2 thì không trùng trang 1, tổng và số đếm không đổi theo trang [test: apps/admin-api/src/modules/tenants/tenants.list-app.int.test.ts » trang 2 đúng, không trùng trang 1, total không đổi theo trang, counts.all đủ]

## Số câu SQL mỗi trang
- `GET /moderation/queue|mine`, `/join-requests`, `/reports`: 1 câu/trang (limit+1 để biết còn trang) + câu quyền của uow như cũ; cố định theo trang.
- `GET /processes/requests/mine`: 1 câu/trang (limit+1).
- `GET /admin/tenants`: số câu như cũ (1 câu danh sách có `count(*) over()` + 1 câu đếm theo trạng thái), cố định theo trang.
- chat-web `GET /me/review-tasks`: số câu như cũ, mỗi lần «Xem thêm» thêm một lời gọi cùng khuôn.

## Việc còn lại
- Mục 11 (Sổ đối tác — nghĩa vụ mở) và 12 (tab Hợp đồng của đối tác): chưa làm, hết ngân sách.
- Mục 13 chưa có test (unit/e2e) cho nút «Xem thêm» của «Chờ tôi kiểm».
- e2e chưa chạy/chưa sửa: các spec đang đếm hàng của 3 màn duyệt cộng đồng, «Đã gửi của tôi», bảng công ty (nay có phân trang); cần QC xem.
- Test chéo tenant chưa viết riêng cho 3 danh sách duyệt (RLS tenant đã phủ ở `community.cross-tenant.int.test.ts`).
- Hộp chọn tenant gán quy trình vẫn `limit: 200` (mục 18, ngoài phạm vi).
