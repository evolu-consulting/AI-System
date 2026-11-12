---
id: cr132-m5
lát: cr132-m5 (M5 của CR-132 · tệp trong tin nhắn)
cr: CR-132
làn: đầy đủ phần RLS (0108 · Opus soát) + nhanh phần còn lại
migration: 0108_cr132_files_policy (migrations-pack-contracts, journal idx 104, when 1807000218000)
phụ thuộc: cr132-m3, cr132-m4 (đã merge)
---
## Plan (ngắn)
Tệp đính kèm tin nhắn (spec `docs/specs/CR-132/spec.md` §3 `contracts.files`, §4 hai route tệp): byte ở FileBox (org `t_<tenant>`, cùng kho CR-133), hàng `contracts.files` + `msg_files` gắn lúc tải lên; gắn vào tin qua `file_ids` (đã có ở M3); chỉ THÀNH VIÊN hội thoại tải được — kể cả đường chung `GET /pack/contracts/files/:id/content`.

## Làm
- `0108_cr132_files_policy.sql`: hàm definer `contracts.msg_file_visible(fid)` (tệp không có hàng `msg_files` ⇒ true như cũ; có ⇒ chỉ nhân viên nội bộ là thành viên hội thoại) + policy RESTRICTIVE SELECT `files_msg_sel` trên `contracts.files`. Dùng hàm definer vì RLS của `msg_files` giấu hội thoại người khác nên subquery trong policy sẽ thấy «không có hàng» và cho qua nhầm.
- `application/messages-files.usecase.ts`: `upload` (thành viên 404 → đuôi `ATTACH_ALLOWED` 415 → ≤ `ATTACH_MAX_BYTES` 413 → byte lên FileBox NGOÀI tx → ghi DB; DB lỗi ⇒ xoá byte vừa đưa lên), `link` (thành viên; tệp chưa gửi chỉ người tải lên), `dropBytes` (gỡ byte SAU commit, đồng thời, lỗi nuốt).
- Repo: `insertFile` (2 câu cùng tx: `files` rồi `msg_files` — policy INSERT của `msg_files` kiểm `files` bằng subquery không thấy hàng vừa chèn trong cùng câu CTE), `fileRef`, `convFiles`; `revoke` trả thêm `gone` (org + file_id của tệp vừa soft-delete, cùng câu).
- Thu hồi tin ⇒ `dropBytes(gone)` sau commit; người cuối rời ⇒ `convFiles` (TRƯỚC khi xoá hàng mình vì sau đó RLS giấu) rồi `dropBytes` sau commit.
- Route: `POST /messages/conversations/:id/files` (multipart `file`, `bodyLimit`, 201 `FileRef`; 415 `MSG_FILE_TYPE`, 413 `MSG_FILE_TOO_LARGE`), `GET …/files/:fileId` (302 FileBox; 404 `MSG_NOT_FOUND`); FileBox vắng ⇒ 503 `FILE_STORAGE_UNAVAILABLE` (tin chữ vẫn chạy). Mount: `messagesModule(db, view, publish, filebox)`.

## Perf (Luật 4c)
Tải lên: 1 câu kiểm thành viên + 2 câu ghi (+ FileBox ngoài tx). Tải xuống: 1 câu + `getLink`. Policy `files_msg_sel`: mỗi hàng `files` đọc ra = 1 tra cứu PK `msg_files (tenant_id,file_id)` (+ 1 tra cứu PK `msg_members` khi là tệp tin nhắn); không vòng theo hàng ở code. Gỡ byte: `Promise.allSettled` ≤ 10 tệp/tin (chưa có API xoá lô — TECH-DEBT #265).
Chạy lại `messages.perf.int.test.ts` sau M4 (markRead trả thêm `prev`/`member_ids`) + 0108, p95 (ngưỡng): unread 4.8 ms (20) · danh sách 30 28.5 ms (50) · 50 tin 6.8 ms (30) · gửi 7.6 ms (40) · đọc 8.1 ms (20); số câu 1/1/1/2/2 như M3.

## Test
int `messages-files.int.test.ts` (4 ca, FileBox giả): thành viên tải lên → gửi kèm → người kia thấy + tải được; 415/413/người ngoài (không byte lên FileBox); gắn tệp của người khác ⇒ `MSG_FILE_INVALID`; đường chung `PackFiles.link` cho thành viên có link, người ngoài hội thoại cùng công ty và công ty khác ⇒ null; DB 1/0/0 hàng; tệp HĐ (không gắn `msg_files`) vẫn tải được, chéo công ty 0 hàng; thu hồi / người cuối rời ⇒ gỡ byte + soft-delete.
Hồi quy: `messages.int`, `messages-rls.int`, `messages-stream.int` (24 pass tổng).

## Quyết định trong lúc làm
- Tệp chưa gửi (seq NULL) chỉ người tải lên tải được; sau khi gửi mọi thành viên tải được.
- `mimeByName` (đuôi, không tin MIME khai báo) dùng chung với CR-133; tên tệp qua `cleanFileName`.
- Không giới hạn số tệp chưa gửi (TECH-DEBT #265 — vòng dọn như `community.files.sweep`).
- Không chạy kiểm magic bytes như tải HĐ (tệp chỉ lưu/tải lại, không đọc nội dung).

## Việc còn lại
Soát Opus (RLS 0108, `msg_file_visible`). UI tệp (W2/W3), e2e hành trình cuối đợt.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
### ADDED pack-contracts/tin-nhan-tep.md
#### Yêu cầu: Tệp trong tin nhắn chỉ thành viên hội thoại tải được (nguồn: CR-132)
Nhân viên tải tệp (PDF, ảnh, Office… theo danh sách chung, tối đa 20 MB) vào hội thoại rồi gửi kèm tin (tối đa 10 tệp). Chỉ thành viên hội thoại xem và tải được tệp đã gửi; đồng nghiệp ngoài hội thoại và công ty khác không tải được, kể cả qua đường tải tệp chung của Sổ Hợp Tác. Tệp hợp đồng vẫn tải như cũ.
- Kịch bản: khi thành viên tải tệp lên và gửi kèm thì người kia thấy tệp và tải được, đuôi lạ hoặc quá dung lượng bị từ chối trước khi lưu, người ngoài hội thoại không tải lên được [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » thành viên tải lên]
- Kịch bản: khi người cùng công ty ngoài hội thoại hoặc công ty khác tải tệp tin nhắn qua đường chung thì không có link và không thấy hàng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » đường tải CHUNG]
- Kịch bản: khi tệp không thuộc tin nhắn (tệp hợp đồng) thì mọi người trong công ty vẫn tải được, công ty khác không [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » tệp HĐ]
#### Yêu cầu: Thu hồi tin hoặc xoá hội thoại thì gỡ tệp khỏi kho (nguồn: CR-132)
Thu hồi tin có tệp thì tệp không tải được nữa và dung lượng ở kho tệp được giải phóng; người cuối rời nhóm thì hội thoại và mọi tệp của nó bị xoá.
- Kịch bản: khi thu hồi tin có tệp thì tệp bị đánh dấu xoá và byte bị gỡ, khi người cuối rời thì byte các tệp còn lại bị gỡ [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » thu hồi tin có tệp]
