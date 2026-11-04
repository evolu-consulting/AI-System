---
id: cr118-r2-server
lát: cr118-r2-server
cr: CR-118
làn: nhanh (phần quyền/tenant + xoá dữ liệu: test viết trước code)
migration: pack-community 0007 (journal when 1803300000000)
phụ thuộc: cr118-flow-routing (26247785), cr118-community-files (1d4c57b4)
---
## Plan (ngắn)
1. `GET /hub-admin/tenants/:tid/process-routing/:slot/processes/:defId` — xem sơ đồ một quy trình trong tập đã gán (cho
   `@ai/flow-canvas` chế độ xem ở màn luật chọn quy trình). Trả `ProcessRoutingDefView` = `{def_id, slot, name, rel_version,
   stages, slot_body}` — `slot_body` cùng hình `ProcessDef.slot_body` (web dùng lại `rowsFromSlotBody`), lấy từ BẢN XUẤT BẢN
   đang dùng (`published_version`; chưa có ⇒ nháp). MỘT câu SQL cố định (tập gán ⋈ def ⋈ bản phát hành). Quyền: platform_admin;
   tenant_admin chính tenant; tenant khác ⇒ 404; def ∉ tập gán ⇒ 404; member ⇒ 403.
2. Dọn tệp Community (`community.files`): mỗi tenant bật gói, trong vòng nền Community có sẵn (`sweepCommunityOnce`), pha
   `files`: (a) claim ≤ limit hàng KHÔNG nằm trên bài nào (không có `community.media` trỏ tới) và (tạo quá 24 h ∨ đã đánh
   dấu) — `FOR UPDATE SKIP LOCKED`, đánh dấu `deleted_at` (= chờ xoá byte; tải về/gắn bài đã lọc `deleted_at is null`);
   (b) NGOÀI tx xoá byte FileBox từng tệp (lỗi ⇒ giữ hàng đã đánh dấu, lượt sau làm lại); (c) MỘT câu DELETE các hàng đã xoá
   byte (vẫn không có media). Bài bị xoá ⇒ media xoá dây chuyền ⇒ tệp thành "không gắn" ⇒ cùng luật.

## Làm
- [x] Delta
- [x] Contract `ProcessRoutingDefViewSchema` + route/service/repo + int (viết trước)
- [x] Migration pack-community 0007: `GRANT DELETE` cho `community_rw` + policy RESTRICTIVE `files_delete` (chỉ scope hệ
      thống, chỉ hàng đã đánh dấu, không còn media)
- [x] `files.sweep.ts` + nối vào `sweepTenant` (tuỳ chọn `blobs`) + `mountCommunity` truyền `blobs`
- [x] int dọn tệp (viết trước)

## Không làm / Chạm
Không UI web (lát sau). Không DLC. Không gói khác. Không đổi route/hành vi cũ của `process-routing`.

## Test tối thiểu
int `apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts` (ca mới);
int `apps/hub-api/src/modules/packs/community/adapters/community-files-sweep.int.test.ts`.

## Quyết định trong lúc làm
- Xem def: platform_admin cũng phải nằm trong tập gán (route theo tenant; xem def bất kỳ đã có `GET /process-defs/:id`).
- Xem def trả bản xuất bản (cái launch thật sự chạy), không trả nháp thư viện đang sửa dở.
- Cổng `/processes/*` cũ (`requirePlatformAdmin`) chỉ còn cho PUT/DELETE; GET qua `requireAdminRole` + service chốt tenant.
- Kit 0001 thu hồi DELETE trên `files` ("xoá = deleted_at") ⇒ cần migration 0007 cho riêng `community.files`, giới hạn bằng
  policy RESTRICTIVE: chỉ system, chỉ hàng `deleted_at` đã đặt, không còn media ⇒ user không bao giờ xoá cứng được.
- "Tệp của bài đã xoá": bài xoá cứng (media ON DELETE CASCADE) ⇒ không phân biệt được với "chưa gắn" khi không thêm cột; luật
  chung "không gắn + tạo quá 24 h" (tệp bài xoá trong 24 h đầu đợi tới mốc 24 h). Không thêm cột.
- Tenant tắt gói ⇒ vòng nền không quét tenant đó (giống các pha khác của vòng nền Community).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Xem sơ đồ quy trình đã gán (màn luật chọn quy trình)
`GET /tenants/:tid/process-routing/:slot/processes/:defId` trả sơ đồ bản xuất bản đang dùng (`stages`, `slot_body`) của một
quy trình trong tập đã gán cho tenant × khe. platform_admin và tenant_admin chính tenant; tenant khác ⇒ 404; quy trình chưa
gán ⇒ 404; member ⇒ 403. Một câu SQL.
- Kịch bản: tenant admin xem quy trình đã gán OK; tenant khác ⇒ 404; chưa gán ⇒ 404; member ⇒ 403 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » xem sơ đồ quy trình đã gán: quyền + tập gán]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Dọn tệp đính kèm không dùng
Vòng nền Community xoá tệp không nằm trên bài nào sau 24 h (gồm tệp của bài đã xoá): xoá byte FileBox rồi mới xoá hàng; xoá
byte lỗi ⇒ giữ hàng (đã đánh dấu, không tải/gắn được) để lượt sau làm lại. Lô ≤ limit, số câu SQL cố định mỗi lô, chạy lại
không đổi kết quả.
- Kịch bản: không gắn > 24 h bị xoá (hàng + byte); < 24 h giữ; đang gắn giữ; tệp của bài đã xoá bị xoá [test: apps/hub-api/src/modules/packs/community/adapters/community-files-sweep.int.test.ts » dọn tệp không gắn, giữ tệp mới và tệp đang gắn]
- Kịch bản: FileBox lỗi ⇒ hàng giữ (đánh dấu), lượt sau xoá xong [test: apps/hub-api/src/modules/packs/community/adapters/community-files-sweep.int.test.ts » FileBox lỗi ⇒ giữ hàng để làm lại]
- Kịch bản: số câu SQL mỗi lô cố định [test: apps/hub-api/src/modules/packs/community/adapters/community-files-sweep.int.test.ts » số câu SQL mỗi lô cố định]
- Kịch bản: user không xoá cứng được tệp (RLS) [test: apps/hub-api/src/modules/packs/community/adapters/community-files-sweep.int.test.ts » user không xoá cứng được tệp]

## Việc còn lại
- Web: màn luật chọn quy trình gọi API xem sơ đồ (lát UI).
- TD: claim quét mọi tệp của tenant (chống-nối media qua `media_file_idx`); khối lượng lớn ⇒ cân nhắc cột `attached` + index một phần.
