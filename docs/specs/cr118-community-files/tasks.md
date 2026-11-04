---
id: cr118-community-files
lát: cr118-community-files
cr: CR-118
làn: đầy đủ (F — RLS + migration + truy cập tệp)
migration: pack-community 0006_post_files (journal when 1803200000000)
phụ thuộc:
---
## Plan (ngắn)
Spec `docs/specs/CR-118/spec.md` §11.1 "Đính kèm": bài đính kèm tệp bất kỳ trong danh sách upload hiện có (`ATTACH_ALLOWED`,
trần `ATTACH_MAX_BYTES`), server sniff nội dung (không tin đuôi). Byte ở FileBox org `t_<tenant>` (client gói `packs.filebox.ts`),
hàng ở bảng khung `community.files`; quyền tải = quyền xem bài (RLS).

## Làm
- Migration 0006: `media` nhận kind `file` + `name/mime/size_bytes` + FK kép (file_id, tenant_id) → `files`; `files` thêm policy
  RESTRICTIVE `files_visible` (người tải lên ∨ EXISTS media ⇒ `media_visible` ⇒ `posts_visible`), `files_insert/update` (dưới tên mình).
- Contract `@ai/contracts/community`: `MEDIA_KINDS` (+`file`), `MediaItemSchema.{fileId,name,size,mime}`, `CommunityFileSchema`,
  `MEDIA_LIMITS.file`; `ProfileMediaItemSchema` kind + `fileId/name/size/mime`.
- API: `POST /pack/community/files` (thân thô + `X-Filename`), `GET /pack/community/files/:id`; bài: media `{kind:"file", fileId}`.
- Luật thuần `community/domain/file.rules.ts` (sniff, tên an toàn, header tải về); cổng `CommunityBlobs` (FileBox) tiêm ở `community-wire.mount.ts`.

## Không làm / Chạm
Không web (composer ở `slice/cr118-shell`), không DLC, không gói khác. Không đổi module `attachments` của hub.

## Test tối thiểu
- unit `apps/hub-api/src/modules/packs/community/domain/file.rules.test.ts`
- int `apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts` (viết trước code) + hồi quy community int liên quan.

## Quyết định trong lúc làm
- Không dùng `/attachments` của hub: sweeper xoá hàng chưa gắn tin sau 24 h và mồ côi kho local ⇒ tệp bài sẽ mất; dùng bảng khung
  gói `community.files` + FileBox như `packFiles` (PK-FR-06).
- Gói không được import `modules/attachments` (depcruise `pack-no-hub-modules`) ⇒ sniff tự chứa ở `file.rules.ts`, cùng danh sách/trần.
- Sniff: nhị phân phải khớp chữ ký của đuôi; nhóm chữ phải UTF-8 sạch, không NUL, không markup chạy được (html/script/svg/iframe…);
  MZ/ELF/`#!` luôn chặn. `mime` lưu = theo đuôi đã kiểm nội dung.
- Tải về đi qua API (không 302 FileBox) để giữ `Content-Disposition: attachment` (ảnh raster: `inline`), `nosniff`, CSP `sandbox`,
  `Cache-Control: private, no-store`.
- Gắn tệp vào bài: chỉ tệp chính mình tải lên hoặc đã nằm trên chính bài đó (sửa bài); metadata/kind lấy từ hàng `files`, client
  gửi `name/mime/size` bị bỏ; ảnh tải lên ⇒ `kind=image`.
- FileBox chưa cấu hình (`FILEBOX_URL/TOKEN` vắng) ⇒ `/files` 503 `FILES_UNAVAILABLE`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Đính kèm tệp vào bài (CR-118 §11.1)
Người đăng tải tệp lên `POST /pack/community/files` (thân thô, header `X-Filename`), nhận `CommunityFile {id,name,mime,size}`, rồi
gửi bài với media `{kind:"file", fileId}`. Loại/trần theo cấu hình upload hiện có; nội dung phải khớp đuôi.
- Kịch bản: khi tải PDF thật thì 201, `mime` theo nội dung, tên đã làm sạch [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-118] PDF thật ⇒ 201 {id,name,mime,size}; mime theo nội dung]
- Kịch bản: khi exe/html đội lốt .pdf, html đội lốt .txt hoặc đuôi lạ thì 415 [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-118] exe/html đội lốt .pdf, html đội lốt .txt, đuôi lạ ⇒ 415]
- Kịch bản: khi tệp vượt `ATTACH_MAX_BYTES` thì 413; thiếu tên thì 400 [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-118] quá ATTACH_MAX_BYTES ⇒ 413; thiếu tên ⇒ 400]
- Kịch bản: khi đăng bài kèm tệp của mình thì media mang fileId/name/size/mime; tệp của người khác hoặc thiếu fileId thì 400 [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-118] media kind=file mang fileId/name/size/mime; dùng fileId của người khác ⇒ 400]
- Kịch bản: khi sniff tên/nội dung thì đội lốt, markup, file chạy được bị chặn [test: apps/hub-api/src/modules/packs/community/domain/file.rules.test.ts » đội lốt / chạy được / markup / đuôi lạ / rỗng ⇒ null]

### MODIFIED community/hien-thi.md
#### Yêu cầu: Tải tệp đính kèm theo quyền xem bài (CR-118 §11.1)
`GET /pack/community/files/:id` trả byte khi người xem THẤY bài chứa tệp (cùng luật bảng tin, gồm đối tác theo audience) hoặc là
người tải lên; còn lại 404 giống hệt. Luôn `attachment` (ảnh raster `inline`), `X-Content-Type-Options: nosniff`, CSP `sandbox`.
- Kịch bản: khi thành viên cùng tenant hoặc đối tác trong audience tải thì 200 kèm attachment + nosniff [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-118] thành viên cùng tenant + đối tác trong audience tải được: attachment + nosniff]
- Kịch bản: khi đối tác không thấy bài hoặc bài của đối tác khác thì 404 [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-118] đối tác không thấy bài ⇒ 404; bài đối tác khác ⇒ 404; chủ quản thấy bài đối tác]
- Kịch bản: khi tenant khác hoặc tệp chưa gắn bài của người khác thì 404 [test: apps/hub-api/src/modules/packs/community/adapters/community-files.int.test.ts » [CR-118] tenant khác ⇒ 404; tệp chưa gắn bài của người khác ⇒ 404; id rác ⇒ 404]

## Việc còn lại
- Web (lát sau, `slice/cr118-shell`): composer gọi `POST /pack/community/files` rồi gửi `media:[{kind:"file", fileId}]`; thẻ tệp
  tải `GET /pack/community/files/:fileId`. `apps/community-web/.../adapters/seed.ts:96` kiểu local `"image"|"video"` cần thêm `"file"`
  (typecheck community-web đỏ 1 lỗi tới khi web theo contract mới).
- TECH-DEBT: tệp tải lên không gắn bài / bài bị xoá ⇒ hàng `community.files` + byte FileBox không được dọn (cần vòng quét).
