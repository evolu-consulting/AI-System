# fix-269-community-partners — TECH-DEBT #269 (CR-151: danh sách đối tác cộng đồng không cắt trong bộ nhớ)

## Plan
`GET /pack/community/partners?limit&offset&q`: tên công ty nằm ở danh bạ (cache, 0 SQL) ⇒ lọc `q` + cắt trang ở đó, rồi MỘT câu đọc hồ sơ đối tác (`contracts.community_partners(uuid[])`) chỉ cho công ty trong trang. Luật ai thấy công ty nào giữ nguyên (chủ quản: cả danh bạ; đối tác: công ty mình; id luôn giao với phạm vi thấy được). Ô chọn công ty ở Composer tìm ở máy chủ + «Xem thêm». Không đụng `features/partners` của SHT.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | `pageOrgIds` + `partnerViews(…, only)` + `partners(uow, a, only)`; route chỉ đọc hồ sơ của trang | `views.ts`, `org.service.ts`, `org.routes.ts` | [x] |
| 2 | Ô chọn công ty (Composer) tìm theo tên ở máy chủ, tải dần 50/lần; xem trước nói «danh sách đang tải» khi còn công ty khác | `CompanyPicker.tsx`, `Composer.tsx`, i18n `community.audience.company*` | [x] |
| 3 | TECH-DEBT #269 = đã xử lý | `docs/TECH-DEBT.md` | [x] |

## Quyết định trong lúc làm
- Không `limit` ⇒ giữ nhánh cũ (khách cũ) nhưng vẫn qua cùng đường một câu.
- Tìm tên ở danh bạ (nguồn tên của gói) thay vì SQL: không thêm bảng/cột, 0 SQL cho lọc + cắt; SQL chỉ còn theo kích cỡ trang.
- Xem trước người nhận ở Composer không đếm đủ khi có > 50 công ty (chỉ có trang đầu) ⇒ hiện câu «xem trước theo danh sách đang tải» thay vì số sai.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md

#### Yêu cầu: Danh sách đối tác cộng đồng chỉ đọc hồ sơ của công ty trong trang
- Kịch bản: khi xem trang 2 đối tác thì giống đoạn tương ứng của danh sách đầy đủ, tìm không khớp thì rỗng, tenant khác bị chặn [test: apps/hub-api/src/modules/packs/community/adapters/community.routes.int.test.ts » #269 · trang chỉ mang hồ sơ của công ty trong trang, q không khớp thì rỗng, tenant khác bị chặn]
- Kịch bản: khi lọc và cắt trang thì đối tác chỉ thấy công ty mình, tìm không phân biệt hoa thường [test: apps/hub-api/src/modules/packs/community/adapters/views.page.test.ts » đối tác chỉ thấy công ty mình]


## Số câu SQL mỗi trang
- `GET /partners?limit=`: 1 câu hồ sơ đối tác (chỉ `limit` công ty) + câu RLS của uow như cũ; lọc tên 0 SQL. Trước: 1 câu cho TOÀN BỘ danh bạ rồi cắt bộ nhớ.

## Việc còn lại
- e2e (ghi cho QC): soạn bài › Người xem = Công ty › gõ vào `company-search`, bấm `company-more`; chưa viết/chạy. Chưa đo số câu bằng bộ đếm; theo thiết kế cố định 1.
