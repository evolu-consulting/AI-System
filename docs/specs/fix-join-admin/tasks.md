# fix-join-admin — duyệt đơn tham gia Bảng tin cần quyền quản trị Sổ Hợp Tác (CR-130, người dùng chốt B 2026-11-12)

## Kế hoạch (đã làm)
| Việc | File |
|---|---|
| `Access.joinAdmin` = quyền `admin` của gói `contracts` (cache cấu hình, 0 SQL; đối tác luôn false) | `community/adapters/community-access.ts`, `flow-slots.ts` (`accessOfWho`) |
| `joinReviewer(a)` = nội bộ ∧ joinAdmin: `GET /join-requests` 403, `POST /join-requests/:id/decide` 403 (rule `NOT_REVIEWER`), `/flows/nav.joinReview`, mục menu `community.join` chỉ cho quản trị; khe `partner-join` của flow adapter dùng `joinReviewer` (không có nút quyết) | `flows.service.ts`, `flows.routes.ts`, `nav.source.ts`, `flow-slots.ts` |
| Giữ mọi nội bộ: ẩn bài/báo cáo đối tác, đăng bài, bình luận, duyệt bài | — |
| ADR-0044 mục quyền 1 dòng | `docs/adr/0044-community-into-contracts-pack.md` |

## Quyết định trong lúc làm
- Người không đủ quyền: **ẩn** (không liệt kê hàng, không mục menu), không hiện kèm lý do — đơn giản nhất.
- Web `modules/community`: KHÔNG có nút/danh sách duyệt đơn riêng (chỉ mock `mock-flows.ts`); duyệt đi qua thẻ việc/flow `view`+`act` đọc `reviewer` từ API ⇒ không có nút Duyệt khi `joinReviewer=false`. Không sửa web.
- `joinAdmin` tính từ `packAccessInput(view,"contracts",u)` ⇒ tenant_admin không Group vẫn bị 403 như mọi gói (đúng luật quyền hiện có).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Duyệt đơn xin tham gia Bảng tin cần quyền quản trị Sổ Hợp Tác
Chỉ người nội bộ có quyền QUẢN TRỊ Sổ Hợp Tác xem danh sách và duyệt đơn xin tham gia (vì duyệt ghi hồ sơ đối tác); nhân viên chỉ có quyền Sửa không thấy đơn, không có mục menu và nhận 403 khi quyết. Ẩn bài/báo cáo đối tác, đăng bài, bình luận vẫn cho mọi nhân viên nội bộ.
- Kịch bản: khi nhân viên chỉ có quyền Sửa xem danh sách hoặc quyết đơn tham gia thì nhận 403 [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » khe community.partner-join]
- Kịch bản: khi quản trị Sổ Hợp Tác quyết đơn thì duyệt được và liên kết công ty đối tác [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » khe community.partner-join]
- Kịch bản: khi nhân viên chỉ có quyền Sửa mở menu thì không có mục đơn tham gia và joinReview = false [test: apps/hub-api/src/modules/packs/community/adapters/community.flows-nav.int.test.ts » GET /flows/nav]
