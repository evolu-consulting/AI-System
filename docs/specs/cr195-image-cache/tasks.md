---
id: cr195-image-cache
lát: cr195-image-cache
cr: CR-195
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ảnh bảng tin hiện chậm vì mỗi lần mở đều tải lại (`no-store`). Giữ kiểm đăng nhập + quyền; cho trình duyệt giữ 1 ngày và giữ byte theo phiên.

## Làm
- [x] `downloadHeaders`: `Cache-Control: private, max-age=86400` (hằng `DOWNLOAD_CACHE_CONTROL`); nosniff, CSP, Content-Disposition giữ nguyên.
- [x] Web: `shared/kernel/file-blob-cache.ts` (LRU 80 mục / 64 MB, dùng chung lượt tải đang chạy) + `http.ts` `fileObjectUrl`/`downloadFile` qua cache; `platform/auth/session.ts` `onEnd` xoá cache.
- [x] Đo server (int, kho giả): xem Quyết định.

## Không làm / Chạm
Không đổi quyền xem tệp (`visibleFile`/`crossFile`), không đổi đăng nhập/cookie, không sửa `PostCard`/`AttachGallery`/Dialog.
Chạm: `community/domain/file.rules.ts`, `adapters/http.ts`, `platform/auth/session.ts`, `shared/kernel/file-blob-cache.ts`.

## Test tối thiểu
unit `file.rules.test.ts`, `file-blob-cache.test.ts`, `http.test.ts`; int `community-files.int.test.ts`.

## Quyết định trong lúc làm
- Đo int (DB thật, kho giả, kiểm quyền giả lập, bỏ qua JWT): tệp 200 KB ≈ 2,2–2,4 ms, 2 MB ≈ 2,2–3,1 ms tới khi có header ⇒ phần server (SQL quyền + gửi) không đáng kể. Phần còn lại ~3 s nằm ở FileBox `getContent` (đọc hết byte), mạng tải ảnh gốc và `no-store`: không đo được `store.get` thật vì không có token hợp lệ trên bản test (không đọc mật khẩu).
- Cache Blob thay vì objectURL: bộ hiển thị chung (`useLazyUrl`) thu hồi URL khi gỡ khỏi màn hình ⇒ URL cache sẽ chết; mỗi lần tạo URL mới từ Blob có sẵn.
- Không thêm `Vary: Authorization` (token đổi mỗi lần refresh sẽ phá cache). Hệ quả: máy dùng chung, người sau đăng nhập trong 1 ngày mở đúng id tệp đã cache bởi người trước chỉ thấy được khi biết id (UUID, lấy từ bảng tin họ được xem) ⇒ chấp nhận; đánh đổi đã ghi ở CR-195.
- Stream thay vì đọc hết: bỏ (cần đổi cổng `CommunityBlobs` + `FileboxClient` + kho giả, > 30 dòng) ⇒ `docs/TECH-DEBT.md` #306.
- Lỗi (404…) đi đường `mapError`, không qua `downloadHeaders` ⇒ không có `max-age`. Route tệp khác dùng chung `downloadHeaders`: không có (chỉ `files.service.ts`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Tải tệp đính kèm theo quyền xem bài (CR-118 §11.1) (nguồn: cr118-community-files)
Phản hồi 200 của `GET /pack/community/files/:id` (đã qua kiểm quyền) có `Cache-Control: private, max-age=86400`; lỗi (404) không cache. Web giữ byte tệp đã tải theo phiên (tối đa 80 tệp / 64 MB), không tải lại ảnh đã có; đăng xuất hoặc hết phiên thì xoá.
- Kịch bản: khi tải tệp thành công thì header là private max-age 1 ngày [test: apps/hub-api/src/modules/packs/community/domain/file.rules.test.ts » [CR-195] tải tệp: Cache-Control private 1 ngày, không no-store, không public]
- Kịch bản: khi tải tệp thành công thì có max-age, khi người được giao không phải người tạo hoặc tệp ngoài tầm nhìn thì 404 không cache [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-195] 200 có private max-age 1 ngày, 404 (không quyền / id rác) không có max-age]
- Kịch bản: khi mở lại ảnh đã tải thì không gọi mạng, sau đăng xuất thì tải lại [test: apps/workspace-web/src/modules/community/adapters/http.test.ts » [CR-195] ảnh đã tải thì lần mở lại không gọi mạng, đăng xuất (xoá cache) ⇒ tải lại]
- Kịch bản: khi vượt 80 mục thì đẩy mục cũ nhất ra [test: apps/workspace-web/src/shared/kernel/file-blob-cache.test.ts » [CR-195] vượt số mục ⇒ đẩy mục cũ nhất ra, mục vừa dùng được giữ]
- Kịch bản: khi hết phiên thì xoá hết và tải dở không ghi vào phiên mới [test: apps/workspace-web/src/shared/kernel/file-blob-cache.test.ts » [CR-195] xoá khi hết phiên: không còn mục nào, tải dở của phiên cũ không ghi vào phiên mới]

## Việc còn lại
- Chưa đo trên bản test (`-test`) lần đầu / mở lại bằng trình duyệt thật; chưa kiểm HTTP cache trình duyệt giữ phản hồi `fetch` có `Authorization` (nên xem DevTools «from disk cache»). Cache Blob theo phiên đã bù phần này trong cùng phiên tab.
- Ảnh thu nhỏ + stream FileBox: đề xuất nếu lần đầu vẫn chậm (TECH-DEBT #306).
