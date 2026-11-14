# cr151-list-paging — CR-151 (mọi danh sách người dùng thấy phải tải dần hoặc phân trang, cả API lẫn UI)

## Plan
Bảng rà soát `audit.md`. Lát này làm mục Cao 2, 3, 5, 6. Mục 1 (Bảng tin) đã xong ở lát cr147c. Mục 4 chỉ đề xuất thiết kế.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 2 | `GET /admin/org/members?q&limit&offset` (limit ≤ 200, mặc định 50; MỘT câu SQL/trang gồm tổng + tên quản lý); màn Thành viên & phòng ban tìm + phân trang ở máy chủ, đổi quản lý bằng hộp tìm | contracts `org.ts`, `org.routes.ts`, `org.service.ts`, `OrgPage.tsx` | [x] |
| 3 | `GET /pack/contracts/members?q&limit&offset` (limit ≤ 50 ⇒ trang + `next_offset`; không `limit` ⇒ danh bạ đầy đủ như cũ, để tra tên); hộp chọn người dùng chung `PersonSearchSelect` (tìm máy chủ + «Xem thêm») cho Ủy quyền, Người phụ trách HĐ nhận, ô «Người» của phiếu yêu cầu | `appendix.ts`, `members.route.ts`, `PersonSearchSelect.tsx`, `DelegationPane.tsx`, `ReceiveSettings.tsx`, `RequestField.tsx` | [x] |
| 4 | Danh sách đối tác (điểm uy tín) | chỉ đề xuất, xem «Việc còn lại» | [ ] |
| 5 | `GET /business/products?limit&offset&group&q` (limit ≤ 100; `total`; đếm nhóm giữ nguyên); trang Sản phẩm dùng `Pager` + tìm máy chủ | `business.ts`, `business.types.ts`, `business.usecase.ts`, `ProductList.tsx`, `use-business.ts` | [x] |
| 6 | `GET /pack/community/partners?limit&offset&q` (limit ≤ 50); tab «Đối tác» hồ sơ tải dần («Xem thêm»); ô chọn công ty lọc bài tìm ở máy chủ; cột bên chỉ 50 công ty đầu | `profile.ts`, `org.routes.ts`, `sections.tsx`, `Feed.tsx`, `useFeed.ts` | [x] |

## Quyết định trong lúc làm
- Rebase: `ReceiveSettings` đã bị cr146b gỡ (Người phụ trách HĐ nhận nay ở panel flow admin-web) ⇒ không hồi sinh; bản sửa ReceiveSettings bỏ theo.
- Mục 5: chế độ trang lọc nhóm + cắt trang trong usecase (vẫn MỘT câu gom); Tổng quan (RecsBlock) vẫn gọi không `limit` ⇒ cả danh sách như cũ.
- Mục 6: trang = lát mảng sau khi ghép tên (đối tác chỉ thấy công ty mình); không `limit` giữ hành vi cũ; trang đầy ⇒ coi là còn.
- Mục 3: audit ghi nguồn `/admin/org` nhưng Ủy quyền và Người phụ trách dùng `/pack/contracts/members` (kit); chỉ thêm tham số vào route này, không đổi quyền. Ô «Người» của phiếu dùng `/admin/org/members` (như trước, `/admin/org` chỉ quản trị).
- Phân trang theo `offset` (khớp `ListQueryBase`); trang đầy + `next_offset` null = hết.
- Người đang chọn không nằm trong trang hiện tại: Ủy quyền giữ tên lúc chọn; Người phụ trách tra tên qua `/people?ids=`.
- `/admin/org` (cả cơ cấu) giữ nguyên cho sơ đồ tổ chức; không còn dùng cho danh sách chọn người.

- (fix-review-r3) `pack-community` dùng `nextOffset` (camelCase) vì các schema của gói đó viết camelCase toàn bộ (`flows.ts`); các gói khác dùng `next_offset` (snake_case theo quy ước API chung). Hai tên cùng nghĩa (null ⇒ hết); KHÔNG đổi tên API để khỏi vỡ client đã dùng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md

#### Yêu cầu: Danh sách thành viên theo cơ cấu phân trang ở máy chủ
- Kịch bản: khi xem trang 2 thì ra đúng người kế tiếp, tìm theo tên lọc ở máy chủ, không lộ người tenant khác [test: apps/admin-api/src/modules/org/org.service.int.test.ts » trang 2 đúng, tổng đúng, tìm theo tên, chéo tenant không lộ, kèm tên quản lý]
- Kịch bản: khi xin quá trần limit thì bị từ chối [test: apps/admin-api/src/modules/org/org.service.int.test.ts » limit quá trần bị chặn ở schema (200)]

#### Yêu cầu: Hộp chọn người tìm ở máy chủ và tải dần
- Kịch bản: khi lấy trang 1 rồi trang 2 thì không trùng nhau và hết trang thì next_offset rỗng [test: apps/hub-api/src/modules/packs/kit/adapters/external-deny.int.test.ts » trang 1 + trang 2 không trùng, next_offset đúng, hết trang thì null, không limit thì không có next_offset]
- Kịch bản: khi tìm theo tên thì chỉ ra người khớp, không có người tenant khác, limit trên 50 bị từ chối [test: apps/hub-api/src/modules/packs/kit/adapters/external-deny.int.test.ts » tìm theo tên + chéo tenant (user tenant beta không bao giờ có) + trần limit 50]

#### Yêu cầu: Danh sách Sản phẩm và Đối tác cộng đồng phân trang ở máy chủ
- Kịch bản: khi xem trang 2 sản phẩm thì không trùng trang 1, tổng theo nhóm đúng, quá trần 100 bị từ chối [test: tests/acceptance/V2-J1/business.int.test.ts » CR-151 · GET /business/products?limit= trả trang: trang 2 đúng, total theo nhóm, đếm nhóm giữ nguyên, quá trần 100 bị từ chối]
- Kịch bản: khi xem trang 2 đối tác cộng đồng thì không trùng trang 1, đối tác chỉ thấy công ty mình, quá trần 50 bị từ chối [test: apps/hub-api/src/modules/packs/community/adapters/community.routes.int.test.ts » CR-151 · GET /partners?limit= trả trang: trang 2 không trùng trang 1, tìm theo tên, trần 50, đối tác chỉ thấy công ty mình]

## Số câu SQL mỗi trang
- `GET /admin/org/members`: 1 câu (count(*) over() + join quản lý + chức vụ), cố định theo trang.
- `GET /pack/contracts/members?limit=`: 1 câu (limit+1 để biết còn trang).
- `GET /business/products?limit=`: số câu như cũ (cấu hình + ngày + 1 câu gom cả SP), cắt trang trong bộ nhớ ⇒ KHÔNG đổi, cố định theo tenant.
- `GET /pack/community/partners?limit=`: số câu như cũ (1 câu hàm cổng cho mọi công ty), cắt trang sau đó.

## Việc còn lại
- Mục 4 (Đối tác) — đề xuất thiết kế, KHÔNG làm lại engine:
  1. Thêm `GET /partners/page?role&band&flag&q&limit&offset` trả `{items,total}`; lọc/sắp (cờ đỏ trước, rồi tên) chạy trên kết quả engine đã tính ở máy chủ, rồi cắt trang.
  2. Ghép hai vai thành một dòng/đối tác ngay ở máy chủ (đang làm ở `partiesOf` phía máy khách) để `total` đúng.
  3. Số HĐ mỗi đối tác (`fetchContractCounts`) gộp vào cùng câu trả lời, bỏ lượt gọi riêng.
  4. `PartnersPage` dùng `useTable` chế độ `serverTotal` + `Pager`; tìm gõ trễ 250 ms; Tổng quan giữ endpoint cũ cho `partnersToReview`/`topPartners`.
  5. Về sau (CR riêng) cache điểm theo tenant để khỏi tính lại toàn bộ mỗi trang.
- Hộp chọn công ty ở Composer (`Composer.tsx`) và «Người phụ trách HĐ nhận» (panel flow admin-web, cr146b) chưa chuyển sang tìm máy chủ; Composer vẫn gọi `listPartners()` đầy đủ.
- e2e đã sửa theo giao diện mới, CHƯA chạy: `org-visibility.cw.ts`, `j03-uy-quyen.spec.ts`, `v2j1-products.cw.ts`; e2e cộng đồng dùng ô «Người đăng» cũ cần QC xem.
- Còn dùng danh bạ đầy đủ ≤ 1000 để tra tên (lọc HĐ, màn kiểm HĐ, hồ sơ tệp); `managerOptions` hết người dùng thật.
