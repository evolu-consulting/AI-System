---
id: cr132-m3
lát: cr132-m3 (M3 của CR-132 · API tin nhắn hub-api)
cr: CR-132
làn: nhanh
migration: không (dùng 0107 của cr132-m1)
phụ thuộc: cr132-m1 (bảng + RLS + contract + luật thuần)
---
## Plan (ngắn)
Route `/pack/contracts/messages/*` (spec `docs/specs/CR-132/spec.md` §4, §6) + use case + repo trong `apps/hub-api/src/modules/packs/contracts/messages/`; mount ở `packs.mount.ts`
(`messagesModule`, không cần FileBox). Không realtime (M4: hàm `send` đã trả `memberIds` để M4 phát sau commit), không tải tệp lên (M5: `send` đã nhận `file_ids` và gắn `msg_files` seq NULL → seq tin).

## Làm
- `application/messages.usecase.ts` (+ `messages.ops.ts` bước nguyên tử trong tx, `messages.ports.ts`): list · unread · get · create (1-1 tái dùng / nhóm) · rename · addMembers · removeMember (rời/bớt/chuyển chủ/xoá) · messages · send · revoke · markRead. Lỗi = `MsgFail(mã MSG_ERRORS)` ⇒ route đổi HTTP theo `MSG_ERRORS` (không câu chữ ở server).
- `adapters/messages.repo.ts` + `messages-send.repo.ts` + `messages.sql.ts`: SQL tham số, câu hằng. `adapters/messages.routes.ts`: 11 route; user ngoài ⇒ 403 `PACK_FORBIDDEN`; id sai dạng ⇒ 404 `MSG_NOT_FOUND`.
- `application/messages.view.ts`: dựng DTO từ dòng thô, con trỏ danh sách (`last_at` µs + id, base64url).
- Kit: `internalUsersAmong(db)(who, ids)` (`member-names.ts`, xuất qua `kit/public.ts`): tên + «còn dùng» của nhân viên nội bộ — MỘT câu `id = any(array)` (tên khác spec `activeInternalAmong` vì trả cả tên + cờ).

## Số câu SQL mỗi request (cố định, đếm trong `messages.perf.int.test.ts`)
| Endpoint | Câu repo (trong 1 tx) | Ngoài tx |
|---|---|---|
| GET conversations (30) / unread | 1 / 1 | +1 tra tên (admin.users, `= any(array)`) cho danh sách |
| GET conversations/:id | 1 | +1 tên |
| POST conversations | 1-1: tx1 (tìm + đọc) · tx2 (tìm, chèn hội thoại, chèn lô thành viên, đọc) · nhóm: 3 câu ghi + 1 đọc | +1 kiểm người dùng |
| POST …/messages | tx1: 1 (facts) · tx2: 1 CTE (+1 gắn tệp khi có `file_ids`; +1 `filesOf` khi trùng `client_id`) | +1 kiểm người kia (chỉ 1-1) |
| GET …/messages (50) / POST …/read | 1 / 2 (UPDATE + tổng) | — |
| DELETE …/messages/:seq | 1 CTE (tin + soft-delete tệp) | — |
| PATCH/members | facts (khoá hàng) + ≤3 ghi + 1 đọc | +1 kiểm người dùng khi thêm |

## Perf (Luật 4c; dữ liệu 1 user / 200 hội thoại × 500 tin = 100.000 tin / nhóm 50 người; evotest, p95 của 40 lần)
| Thao tác | Ngưỡng | Trước (bản đầu) | Sau |
|---|---|---|---|
| GET /messages/unread | 20 ms | 16.3 ms | **5.3 ms** (1 câu) |
| GET /messages/conversations (30) | 50 ms | **182 ms** (tính tin cuối/chưa đọc cho cả 200 hội thoại) | **31.8 ms** (1 câu + 1 tra tên) |
| GET …/messages (50) | 30 ms | 7.3 ms | 6.0 ms (1 câu) |
| POST …/messages | 40 ms | 8.9 ms | 6.7 ms (2 câu) |
| POST …/read | 20 ms | 32.8 ms | **6.6 ms** (2 câu) |
Sửa: danh sách chọn 31 dòng đầu (thành viên × hội thoại, sắp `last_at`) TRƯỚC rồi mới tính phần đắt; tổng chưa đọc dùng vòng lặp lồng + `LIMIT 999` dừng sớm (cùng kết quả `least(sum, 999)` của spec §6, chi phí theo trần 999).

## Test
unit: `application/messages.view.test.ts` · int (use case trên DB thật): `messages.int.test.ts` (đường chính mọi endpoint + một ca NGOÀI hội thoại / công ty khác ⇒ cùng 404) · perf: `messages.perf.int.test.ts` (đếm câu + p95).

## Quyết định trong lúc làm
- `ON CONFLICT` bị policy SELECT (RESTRICTIVE) chặn khi chèn hội thoại (người tạo chưa là thành viên) ⇒ chèn thường; trùng khoá 1-1 đồng thời ⇒ 23505 ⇒ `retryOnRace` chạy lại MỘT lần (lần sau thấy bản có sẵn). Gửi trùng `client_id` đồng thời: cùng cơ chế (23505 → chạy lại → trả bản cũ).
- Mở lại 1-1 đã có thì không kiểm người kia còn dùng (vẫn đọc lịch sử); tạo mới / gửi tin thì kiểm (`MSG_USER_INVALID` / `MSG_PEER_INACTIVE`). Thêm người vào nhóm chỉ nhận nhân viên nội bộ còn dùng. `member_ids` chứa chính mình ⇒ `MSG_USER_INVALID` (422).
- Người mới thêm vào nhóm có `last_read_seq = last_seq` lúc vào (xem được lịch sử nhưng không «chưa đọc» cả lịch sử cũ).
- Gửi tin tách hai tx (đọc `facts` rồi tra người kia ở admin.users rồi CTE gửi) vì không lồng hai kết nối cùng pool; 1-1 mới cần bước tra người kia, nhóm thì không.
- `addMembers` bỏ qua người đã trong nhóm; kiểm trần 50 theo số người MỚI, khoá hàng hội thoại (`FOR UPDATE`) để hai lần thêm đồng thời không vượt trần.
- Thu hồi: soft-delete `contracts.files` của tin trong cùng câu; byte ở FileBox do M5 gỡ (không có FileBox ở M3). `msg_drop_if_empty` cũng chỉ đánh dấu `deleted_at`; byte tệp hội thoại bị xoá cũng ở M5.
- `dup`/`created` của `send` chỉ để route chọn 200/201.

## Việc còn lại
M4 (phát `msg.*` sau commit: `send` trả `memberIds`; thêm sự kiện cho `markRead`/`revoke`/thành viên), M5 (tải tệp lên/xuống + gỡ byte FileBox khi thu hồi/xoá hội thoại + policy `contracts.files` 0108). Route chưa có test HTTP (guard `read` + 403 user ngoài là mã tối thiểu trong `messages.routes.ts`; e2e hành trình cuối đợt).

## Delta (so với docs/current)
<!-- ADDED file riêng `tin-nhan-api.md`: `tin-nhan.md` của cr132-m1 chưa gộp vào docs/current; gộp cuối đợt nhập vào một file. -->
Trạng thái gộp: chưa gộp
### ADDED pack-contracts/tin-nhan-api.md
#### Yêu cầu: Nhắn tin 1-1 và nhóm trong Sổ Hợp Tác qua API riêng của công ty (nguồn: CR-132)
Nhân viên tạo hội thoại 1-1 (mỗi cặp một hội thoại, mở lại thì ra cùng hội thoại) hoặc nhóm (người tạo là chủ), gửi tin (gửi lặp cùng mã chỉ tạo một tin), xem tin theo trang, đánh dấu đã đọc và xem tổng số tin chưa đọc. Lỗi trả mã để giao diện tự dịch; người ngoài hội thoại hoặc công ty khác chỉ thấy «không tìm thấy».
- Kịch bản: khi hai nhân viên cùng mở 1-1 thì ra cùng một hội thoại, người đã khoá chỉ đọc được lịch sử [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » 1-1: tạo]
- Kịch bản: khi tạo nhóm thì người tạo là chủ và thành viên không hợp lệ bị từ chối [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » nhóm: người tạo là chủ]
- Kịch bản: khi gửi tin lặp cùng mã thì không tăng số thứ tự, danh sách hội thoại có số chưa đọc và tin cuối [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » gửi tin: tăng seq]
- Kịch bản: khi bấm đã đọc thì chưa đọc về 0 và mốc đã đọc không lùi, không vượt tin cuối [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » danh sách tin theo seq]
- Kịch bản: khi người kia của 1-1 bị khoá thì gửi tin bị chặn bằng mã [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » MSG_PEER_INACTIVE]
- Kịch bản: khi người ngoài hội thoại hoặc công ty khác gọi bất kỳ thao tác nào thì nhận cùng mã không tìm thấy và không chen được tin [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » mọi thao tác trên hội thoại của người khác]
#### Yêu cầu: Thu hồi tin, đổi tên, thêm bớt thành viên, rời nhóm (nguồn: CR-132)
Người gửi thu hồi tin của mình mọi lúc (nội dung và tệp biến mất, số chưa đọc không tính tin đó). Chỉ chủ nhóm đổi tên và thêm/bớt người; 1-1 cố định; người mới vào không bị đỏ cả lịch sử cũ. Chủ rời thì người vào sớm nhất thành chủ; người cuối rời thì hội thoại bị xoá.
- Kịch bản: khi người khác thu hồi tin của mình thì bị từ chối, chính chủ thu hồi thì tin rỗng và đánh dấu đã thu hồi [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » thu hồi]
- Kịch bản: khi thành viên thường đổi tên hoặc thêm người thì bị từ chối, chủ nhóm làm được, 1-1 không đổi được [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » đổi tên / thêm người]
- Kịch bản: khi chủ rời thì chủ mới được chọn, khi người cuối rời thì hội thoại bị xoá [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » bớt người]
#### Yêu cầu: Danh sách hội thoại và số chưa đọc nhanh với 200 hội thoại, 100.000 tin (nguồn: CR-132)
Danh sách 30 hội thoại, tổng chưa đọc, trang 50 tin, gửi tin và đã đọc dùng số câu SQL cố định và đạt ngưỡng p95 của spec.
- Kịch bản: khi một người có 200 hội thoại và 100.000 tin thì danh sách ≤ 50 ms, tổng chưa đọc ≤ 20 ms, số câu SQL không đổi [test: apps/hub-api/src/modules/packs/contracts/messages/messages.perf.int.test.ts » chưa đọc tổng]
- Kịch bản: khi lấy 30 hội thoại thì chỉ một câu SQL và ≤ 50 ms [test: apps/hub-api/src/modules/packs/contracts/messages/messages.perf.int.test.ts » danh sách 30 hội thoại]
- Kịch bản: khi dựng dữ liệu hiển thị thì con trỏ và xem trước đúng [test: apps/hub-api/src/modules/packs/contracts/messages/application/messages.view.test.ts » con trỏ danh sách hội thoại]
