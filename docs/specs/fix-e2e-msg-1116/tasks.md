---
id: fix-e2e-msg-1116
lát: fix-e2e-msg-1116
cr: CR-178
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lượt e2e toàn bộ (dd8cfc7b8) đỏ 3 ca Tin nhắn. Phân loại nguyên nhân từ out.log + error-context + trace.

## Làm
- [x] Ca «A chèn emoji và dán ảnh» (j18-tin-nhan): LỖI CODE/CẤU HÌNH — Tailwind app không quét `packages/messages-web/src` nên lớp của bảng emoji không sinh (ô emoji 18px, khung cao hơn màn hình, ô đầu ngoài khung nhìn). Sửa ở commit 6259c02c3 (staging; đã gộp vào lát bằng `git merge staging`), không cần sửa thêm. Sau đó còn 2 lỗi TEST của chính ca (lần đầu chạy): regex `p{…}` thiếu `\` (SyntaxError) và chip ảnh dán là thumbnail (alt = tên tệp) nên `getByText` không thấy ⇒ dùng `getByRole("listitem", { name })`.
- [x] Ca «B tìm «bao gia» … xem trước PDF» (j18-tim-tin-nhan): LỖI CODE — `fetchFileBlob` gọi `fetch` thẳng tới link FileBox (`http://127.0.0.1:44583/d/…`, khác origin với app `localhost:3550`) ⇒ CORS chặn ⇒ «Không tải được tệp». Sửa: hub-api thêm `GET …/files/:fileId/content` (nội bộ + `partner`), cùng kiểm quyền như `/link`; web tải qua `apiResponse` (Bearer, cùng origin) rồi gắn `mime` đã lưu và xem bằng `blob:`.
- [x] Ca CR169-J1 (và J3 cùng lỗi): LỖI TEST — M3 làm «tìm ≥ 2 ký tự» mở tab «Tin nhắn» trước, người/cuộc nằm ở tab «Người»; test cũ đọc ngay `people-results`. Sửa: bấm `find-tab-people` sau khi gõ. Ý nghĩa ca giữ nguyên (Vy, không phải người mời, tìm Hà ở «Đối tác › Preschool», thấy tên + công ty, không email, nhắn được).

## Không làm / Chạm
Không đổi migration, contract zod, web-kit. Chạm: `apps/hub-api/.../messages/**` (route, usecase, mount), `packages/messages-web/src/{api,host}.ts`, host của workspace-web + chat-web (thêm `apiResponse`), `e2e/cr169/tin-nhan-cong-ty.spec.ts`.

## Test tối thiểu
`bun test packages/messages-web` · tsc messages-web/hub-api/chat-web/workspace-web · int (chạy trên evotest, không chạy trong lát): `messages-files.int.test.ts`, `pmsg-partner-api.int.test.ts` · e2e `cr127,cr169`.

## Quyết định trong lúc làm
- Byte tệp trả bằng `content-type: application/octet-stream` + `nosniff` + `content-disposition: attachment` + CSP `sandbox` (server không tin kiểu tệp); web gắn `mime` đã lưu từ danh sách «Ảnh & tệp» và chỉ ảnh raster/PDF mới hiển thị (qua `previewKind`), PDF trong `<iframe sandbox>`.
- Server đọc byte máy chủ ↔ máy chủ bằng `filebox(org).getContent(id, ATTACH_MAX_BYTES)` (có token, timeout, retry; chạy được cả khi bật `FILEBOX_PUBLIC_PATH`). Vượt 20 MB (theo `content-length` hoặc đếm khi đọc, `readCapped`) ⇒ 413 `MSG_FILE_TOO_LARGE`; FileBox lỗi ⇒ 503 `FILE_STORAGE_UNAVAILABLE`, không lộ URL nội bộ. Hiện buffer cả tệp (≤ 20 MB), chưa stream.
- Việc ngoài phạm vi (A12): `pmsg-db.int.test.ts:412` đang lỗi tsc sẵn (không do lát này).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md

#### Yêu cầu: Xem trước tệp qua hub-api
Xem trước ảnh/PDF của «Ảnh & tệp» tải byte qua hub-api (`GET …/files/:fileId/content`, Bearer, cùng origin; cả cuộc nội bộ và `partner`), không `fetch` xuyên origin tới FileBox. Quyền như link tải: chỉ thành viên (người chưa được thấy/ngoài cuộc ⇒ 404 `MSG_NOT_FOUND`). Server luôn trả `application/octet-stream` + `nosniff`; web gắn loại đã lưu, SVG/HTML/loại khác không hiển thị.
- Kịch bản: người nhận (khác người tải) lấy được byte; người ngoài cuộc 404 [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-partner-api.int.test.ts » CR-178 · xem trước]
- Kịch bản: cuộc nội bộ — thành viên đọc được byte, người ngoài cuộc MSG_NOT_FOUND [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » thành viên tải lên]
- Kịch bản: B mở «Ảnh & tệp» ⇒ «Xem trước» PDF hiển thị trong hộp [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A, mở đúng tin]

## Việc còn lại
Không. (e2e `cr127,cr169` xanh phần Tin nhắn; `j07` flaky ngoài phạm vi. Int `messages-files`, `pmsg-partner-api`, `messages-read-cr178` xanh 31/0.)
