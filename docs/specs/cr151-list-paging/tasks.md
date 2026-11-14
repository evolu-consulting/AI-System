# cr151-list-paging — CR-151 (mọi danh sách người dùng thấy phải tải dần hoặc phân trang, cả API lẫn UI)

## Plan
Bảng rà soát `audit.md`. Lát này làm mục Cao 2 và 3 (Thành viên & phòng ban; hộp chọn người). Mục 1 (Bảng tin) đã xong ở lát cr147c. Mục 4, 5, 6 CHƯA làm (xem «Việc còn lại»).

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 2 | `GET /admin/org/members?q&limit&offset` (limit ≤ 200, mặc định 50; MỘT câu SQL/trang gồm tổng + tên quản lý); màn Thành viên & phòng ban tìm + phân trang ở máy chủ, đổi quản lý bằng hộp tìm | contracts `org.ts`, `org.routes.ts`, `org.service.ts`, `OrgPage.tsx` | [x] |
| 3 | `GET /pack/contracts/members?q&limit&offset` (limit ≤ 50 ⇒ trang + `next_offset`; không `limit` ⇒ danh bạ đầy đủ như cũ, để tra tên); hộp chọn người dùng chung `PersonSearchSelect` (tìm máy chủ + «Xem thêm») cho Ủy quyền, Người phụ trách HĐ nhận, ô «Người» của phiếu yêu cầu | `appendix.ts`, `members.route.ts`, `PersonSearchSelect.tsx`, `DelegationPane.tsx`, `ReceiveSettings.tsx`, `RequestField.tsx` | [x] |
| 4 | Danh sách đối tác (điểm uy tín) | — | [ ] |
| 5 | Sản phẩm & giá | — | [ ] |
| 6 | Tab «Đối tác» hồ sơ + chọn công ty lọc bài | — | [ ] |

## Quyết định trong lúc làm
- Mục 3: audit ghi nguồn `/admin/org` nhưng Ủy quyền và Người phụ trách dùng `/pack/contracts/members` (kit); chỉ thêm tham số vào route này, không đổi quyền. Ô «Người» của phiếu dùng `/admin/org/members` (như trước, `/admin/org` chỉ quản trị).
- Phân trang theo `offset` (khớp `ListQueryBase`); trang đầy + `next_offset` null = hết.
- Người đang chọn không nằm trong trang hiện tại: Ủy quyền giữ tên lúc chọn; Người phụ trách tra tên qua `/people?ids=`.
- `/admin/org` (cả cơ cấu) giữ nguyên cho sơ đồ tổ chức; không còn dùng cho danh sách chọn người.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md

#### Yêu cầu: Danh sách thành viên theo cơ cấu phân trang ở máy chủ
- Kịch bản: khi xem trang 2 thì ra đúng người kế tiếp, tìm theo tên lọc ở máy chủ, không lộ người tenant khác [test: apps/admin-api/src/modules/org/org.service.int.test.ts » trang 2 đúng, tổng đúng, tìm theo tên, chéo tenant không lộ, kèm tên quản lý]
- Kịch bản: khi xin quá trần limit thì bị từ chối [test: apps/admin-api/src/modules/org/org.service.int.test.ts » limit quá trần bị chặn ở schema (200)]

#### Yêu cầu: Hộp chọn người tìm ở máy chủ và tải dần
- Kịch bản: khi lấy trang 1 rồi trang 2 thì không trùng nhau và hết trang thì next_offset rỗng [test: apps/hub-api/src/modules/packs/kit/adapters/external-deny.int.test.ts » trang 1 + trang 2 không trùng, next_offset đúng, hết trang thì null, không limit thì không có next_offset]
- Kịch bản: khi tìm theo tên thì chỉ ra người khớp, không có người tenant khác, limit trên 50 bị từ chối [test: apps/hub-api/src/modules/packs/kit/adapters/external-deny.int.test.ts » tìm theo tên + chéo tenant (user tenant beta không bao giờ có) + trần limit 50]

## Số câu SQL mỗi trang
- `GET /admin/org/members`: 1 câu (count(*) over() + join quản lý + chức vụ), cố định theo trang.
- `GET /pack/contracts/members?limit=`: 1 câu (limit+1 để biết còn trang).

## Việc còn lại
- Mục Cao 4 (Đối tác: điểm tính trong bộ nhớ từ toàn bộ HĐ, trang Đối tác ghép 2 vai + 2 engine ⇒ cần thiết kế riêng: chuyển lọc/tìm/trang lên máy chủ), 5 (Sản phẩm & giá), 6 (Đối tác cộng đồng).
- Int mới chưa chạy trên evotest nếu báo cáo ghi chưa; e2e `org-visibility.cw.ts`, `j03-uy-quyen.spec.ts` đã sửa theo hộp mới, CHƯA chạy.
- Các nơi còn dùng danh bạ đầy đủ ≤ 1000 để tra tên (lọc HĐ, màn kiểm HĐ, hồ sơ tệp) — lát sau.
- `managerOptions` (lib/org.ts) hết người dùng thật, chỉ còn test.
