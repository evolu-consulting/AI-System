---
id: cr190-msg-directory-api
lát: cr190-msg-directory-api
cr: CR-190
làn: đầy đủ
migration: hub 0167 + pack-contracts 0128
phụ thuộc: cr190-msg-prefs-api
---
## Plan (ngắn)
API danh bạ nhóm cho trang Tin nhắn `GET /messages/directory`: nhóm theo thứ tự cố định (từng công ty đối tác A→Z, «Nhóm chat», «Nội bộ»). Mỗi nhóm có tổng người, số chưa đọc (cùng luật max(thật, cờ)), 15 dòng đầu + con trỏ «Xem thêm» riêng nhóm. Dòng = người/nhóm luật HIỆN TẠI cho nhắn (kể cả chưa từng nhắn) ∪ đầu kia của cuộc đã có. Sắp xếp: ghim → tin mới nhất → chưa từng nhắn theo tên A→Z. Tìm theo người, chức vụ, nhóm chat, công ty.

## Làm
- [x] Hub `0167_cr190_pmsg_directory.sql` (chỉ thêm hàm): `pmsg_dir_base` (nội bộ, không cấp), `pmsg_dir_heads` (đầu nhóm: tổng người, chưa đọc), `pmsg_dir_rows` (dòng, top-N mỗi công ty bằng cửa sổ, keyset `(k1,k2,k3,user_id)`); cấp `hub_rw` + `contracts_rw`; pack-contracts `0128` cấp lại cho DB dựng sạch.
- [x] Contract `messages.ts`: `MsgDirectoryQuerySchema`, `MsgDirectoryResponseSchema` (`MsgDirGroup`, `MsgDirRow`, `MsgDirPerson`).
- [x] Domain `messages.directory.ts`: bỏ dấu, con trỏ, thứ tự, dựng dòng nhóm «Nội bộ» và «Nhóm chat», phân trang (unit `messages.directory.test.ts`).
- [x] Repo: `messages-directory.repo.ts` (`directoryConvs`, `partnerPrefs`), `conversationsByIds` (messages.repo), `dirHeads`/`dirRows` (partner.repo); kit `directory-people.ts` (đồng nghiệp + người xin thêm + công ty người gọi).
- [x] Use case `messages-directory.usecase.ts`; route `GET /messages/directory` (`group`, `cursor`, `q`, `limit` mặc định 15, tối đa 50).
- [x] Test int `messages-directory-cr190.int.test.ts` + perf `messages-directory.perf.int.test.ts`.

## Không làm / Chạm
Không làm: UI (lát `cr190-msg-list-ui`), thay đổi ai được nhắn ai (dùng đúng `pmsg_eligible_v` + luật tạo 1-1 hiện có), API ghim/cờ (đã có ở `cr190-msg-prefs-api`).
Chạm: hub 0167 + pack-contracts 0128 (+ journal 2 bên); `packages/contracts/src/pack-contracts/messages.ts`; hub-api `packs/contracts/messages` (`domain/messages.directory.ts`, `application/messages-directory.usecase.ts`, `adapters/messages-directory.repo.ts`, `partner.repo`, `messages.repo`, `messages.routes`, `messages.ports`, `messages.usecase`, `messages.mount`); `packs/kit/adapters/directory-people.ts` + `kit/public.ts`.

## Test tối thiểu
unit `domain/messages.directory.test.ts`; int `messages-directory-cr190.int.test.ts` (route thật, evotest `-Dirty`); perf `messages-directory.perf.int.test.ts` (`-Step perf`); chạy lại cho chắc: `messages-prefs-cr190.int`, `pmsg-partner-api.int`; `tsc` hub-api (chỉ file của lát).

## Quyết định trong lúc làm
- API: `GET /messages/directory?group=<partner:<uuid>|chat|internal>&cursor=&q=&limit=` (không `group` ⇒ mọi nhóm, mỗi nhóm `limit` dòng đầu; có `group` + `cursor` ⇒ chỉ nhóm đó, trang sau). Cursor không kèm `group` hoặc hỏng ⇒ 400.
- Dòng = `{key, conversation|null, person|null}`: `conversation` là `ConversationSummary` có sẵn (tin cuối, chưa đọc, ghim, cờ) để UI dùng lại; chưa từng nhắn ⇒ `conversation: null` (mở cuộc bằng `POST /messages/conversations`). Nhóm chat: `person: null`.
- «Người nhắn được»: đối tác = `hub.pmsg_eligible_v` của công ty ĐANG KẾT NỐI (đúng nguồn `pmsg_people`/`pmsg_open`); nội bộ = nhân viên nội bộ còn dùng, không bị khoá, trừ chính mình (đúng điều kiện tạo 1-1 `createDirect`). KHÔNG mở rộng.
- Cộng thêm đầu kia của cuộc ĐÃ CÓ (kể cả người đã nghỉ / công ty đã ngắt kết nối), với cờ `active`/`read_only`: lịch sử và số chưa đọc của người dùng không biến mất khỏi danh bạ mới (tổng chưa đọc `GET /messages/unread` vẫn tính các cuộc đó). Người chưa từng nhắn thì luôn là người đủ điều kiện hiện tại. Người nghỉ mà cuộc rỗng ⇒ không hiện.
- Thứ tự trong nhóm: ghim (k1=0) → có tin (k1=1, mới nhất trước) → chưa có tin (k1=2, tên không dấu A→Z). Trong nhóm ghim vẫn theo tin mới nhất. Cuộc đã mở nhưng chưa có tin = «chưa từng nhắn». Cuộc ghim nhưng rỗng đứng nhóm ghim.
- Công ty đối tác: nhóm gồm mọi công ty đang kết nối (kể cả 0 người) + công ty đã ngắt nhưng còn cuộc. Có `q` ⇒ chỉ nhóm còn dòng khớp; `q` khớp tên công ty ⇒ mọi người của công ty đó khớp. Nhóm «Nhóm chat»/«Nội bộ» luôn có khi không `q` (có thể 0).
- Nhóm «Nội bộ» + «Nhóm chat» ghép ở TS (cuộc ở `contracts.msg_*`, người ở `admin.users` — hai kết nối). TRẦN: `CONV_CAP` = 3000 cuộc nhẹ (mới nhất trước) và `CAP` = 5000 đồng nghiệp mỗi lần, một câu mỗi nguồn. Chạm trần ⇒ log `msg-directory-convs-cap` / `msg-directory-people-cap`. Đồng nghiệp sắp `id = any(đầu kia cuộc đã có) desc, id` ⇒ chạm trần vẫn giữ đầu kia của cuộc đã có. Nhóm đối tác xếp/cắt trong DB (cửa sổ `row_number` mỗi công ty).
- Số câu cố định: mọi nhóm = 8 (cuộc nhẹ, ghim đối tác, đầu nhóm, dòng nhóm, `prefsOf`, tra người ×2 trong một kết nối hub, tin cuối); «Xem thêm» công ty 6; «Xem thêm» nội bộ 4. Không đổi theo số nhóm/dòng/limit (có test).
- Perf: bản đầu join CTE `el` hai lần ⇒ nested loop 16 triệu cặp (1,2 s); sửa bằng `bool_or` + GROUP BY (không join) ⇒ 171 ms. `pmsg_view` theo dòng thay bằng tra tin cuối theo PK (chỉ dòng của trang).
- Chưa đọc đầu nhóm kẹp 999; mỗi cuộc kẹp 100 (cùng luật). Mốc: tổng các nhóm = `GET /messages/unread` (có test).
- pack-contracts `0128` (đổi từ 0127 vì 0127 giao cho cr191-partner-connect); `when` hub 1806904200000 (0163 của CR-191 đã dùng 1806904100000), pack-contracts 1807000800000.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md
#### Yêu cầu: Danh bạ nhóm trang Tin nhắn
Trang Tin nhắn lấy danh bạ theo nhóm từ máy chủ: từng công ty đối tác (A→Z), «Nhóm chat», «Nội bộ». Mỗi nhóm có tổng người, số chưa đọc (cuộc hiển thị max(thật, cờ), không đếm đôi), 15 dòng đầu và «Xem thêm» (15/lần) theo nhóm. Mỗi nhóm liệt kê MỌI người/nhóm luật hiện tại cho nhắn, kể cả chưa từng nhắn, cộng đầu kia của cuộc đã có; không bao giờ thêm người ngoài luật. Sắp xếp: ghim → tin mới nhất → chưa từng nhắn theo tên A→Z; tìm theo người, chức vụ, nhóm chat, công ty. Số câu SQL cố định theo loại yêu cầu.
- Kịch bản: khi người được giao (không phải người tạo) mở danh bạ thì mỗi nhóm đúng thứ tự cố định, có tổng người và chưa đọc [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » thứ tự nhóm cố định (công ty A→Z, Nhóm chat, Nội bộ), đầu nhóm có tổng người + chưa đọc, đúng contract]
- Kịch bản: khi mở danh bạ thì mỗi nhóm công ty đúng tập luật cũ, không có người ngoài luật, người chưa nhắn không có cuộc [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » nhóm công ty = đúng tập `/messages/people` cũ (người ngoài luật không có: không quyền, đã nghỉ, công ty không kết nối), người chưa từng nhắn có `conversation: null`]
- Kịch bản: khi mở nhóm «Nội bộ» thì đúng tập đồng nghiệp luật cũ và người được giao thấy nhóm chat người tạo lập, người ngoài nhóm thì không [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » nhóm «Nội bộ» = đúng tập `/messages/people?company=own` cũ (đồng nghiệp còn dùng được, trừ chính mình và người đã nghỉ), N2: VY thấy nhóm chat TIEN tạo, LAN thì không]
- Kịch bản: khi nhóm có hơn 15 người thì 15 dòng đầu rồi «Xem thêm» không trùng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » 15 dòng đầu + trang tiếp theo nhóm, không trùng, giữ thứ tự tên A→Z, hết thì `next_cursor` null]
- Kịch bản: khi con trỏ hỏng hoặc thiếu nhóm thì báo 400 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » con trỏ hỏng hoặc có con trỏ mà không có nhóm ⇒ 400]
- Kịch bản: khi đã nhắn thì lên trước người chưa nhắn, tin mới nhất lên đầu [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » đã nhắn lên trước, chưa từng nhắn sau (theo tên), tin mới nhất lên đầu]
- Kịch bản: khi người dùng ghim thì lên đầu nhóm và chỉ người đó thấy [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » ghim lên đầu nhóm (kể cả cuộc cũ hơn), chỉ VY thấy ghim của VY — TIEN (người tạo nhóm chat) không thấy]
- Kịch bản: khi nhắn 1-1 nội bộ thì người đã nhắn lên trước, người đã nghỉ có lịch sử vẫn thấy [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » 1-1 nội bộ: người đã nhắn lên trước người chưa nhắn, ghim đưa lên đầu, người đã nghỉ có lịch sử vẫn thấy]
- Kịch bản: khi có tin chưa đọc và cờ thì đầu nhóm cộng max(thật, cờ) và tổng các nhóm khớp tổng chưa đọc [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » chưa đọc đầu nhóm = Σ max(thật, cờ) mỗi cuộc, tổng các nhóm khớp `GET /messages/unread`]
- Kịch bản: khi tìm kiếm thì chỉ dòng khớp, người ngoài luật không thể tìm ra [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory-cr190.int.test.ts » tìm theo tên công ty ⇒ chỉ nhóm đó, đủ người, theo người ⇒ chỉ dòng khớp, không dấu/hoa thường, không khớp ⇒ không nhóm]
- Kịch bản: khi lấy danh bạ với 4 công ty × 1.000 người thì số câu SQL cố định và nhanh [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory.perf.int.test.ts » mọi nhóm, 15 dòng đầu: số câu cố định (không theo số nhóm/limit), p95 ≤ ngưỡng, đúng tổng người]
- Kịch bản: khi bấm «Xem thêm» thì số câu cố định [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory.perf.int.test.ts » «Xem thêm» một nhóm đối tác (cursor) và nhóm nội bộ: số câu cố định, p95 ≤ ngưỡng]
- Kịch bản: khi tìm theo tên thì số câu cố định [test: apps/hub-api/src/modules/packs/contracts/messages/messages-directory.perf.int.test.ts » tìm kiếm theo tên: số câu cố định, p95 ≤ ngưỡng]
- Kịch bản: khi sắp xếp thì ghim, tin mới nhất, chưa nhắn theo tên [test: apps/hub-api/src/modules/packs/contracts/messages/domain/messages.directory.test.ts » ghim → tin mới nhất → chưa từng nhắn theo tên A→Z, người đã nghỉ chỉ khi có lịch sử]

## Việc còn lại
- Lát `cr190-msg-list-ui`: gọi `GET /messages/directory`, vẽ nhóm mở/thu, «Xem thêm (n)» = `total − số dòng đã tải`, sắp lại cục bộ theo khoá khi có tin mới.
- Chạm hub 0167 + pack-contracts 0128: điều phối kiểm `meta/_journal.json` (hub `when` tăng dần sau 0166; pack-contracts sau 0126; 0125 là của CR khác).
- `docs/current/pack-contracts/tin-nhan.md` chỉ gộp ở bước Đóng (Delta ở trên).
