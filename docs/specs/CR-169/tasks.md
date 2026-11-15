# CR-169 — Nhắn tin người–người giữa công ty đã kết nối · tasks

Spec: `docs/specs/CR-169/spec.md` (câu mở §9 — mặc định nếu không trả lời). Thay phần trò chuyện của CR-161.

## Chia lát

### Bản đồ file
Viết tắt: `H` = `apps/hub-api/src/modules/packs/contracts`, `W` = `apps/workspace-web/src`, `CW` = `apps/chat-web/src`, `MW` = `packages/messages-web/src`, `C` = `packages/contracts/src/pack-contracts`.

| Vùng | File (tạo mới trừ khi ghi «sửa»/«xoá») |
|---|---|
| Migration hub | `packages/db/migrations-hub/0149_cr169_pmsg.sql`, `0150_cr169_pmsg_files_people.sql`, `0151_cr169_pmsg_grants.sql` + `meta/_journal.json` (sửa) |
| Migration pack-contracts | `packages/db/migrations-pack-contracts/0118_cr169_pmsg_grants.sql` + `meta/_journal.json` (sửa) |
| Contract zod | sửa `C/messages.ts` (+ `.test.ts`), `C/company-connect.ts` (+ `.test.ts`) |
| Luật thuần | `H/messages/domain/partner.rules.ts` (+ `.test.ts`) |
| API danh sách | sửa `H/messages/adapters/messages.repo.ts` (union), `messages.routes.ts` (`company`, `/companies`, create partner), `H/messages/application/messages.usecase.ts`, `messages.view.ts`; mới `H/messages/adapters/partner.repo.ts` |
| API cuộc partner | mới `H/messages/adapters/partner.routes.ts`, `partner-files.routes.ts`, `H/messages/application/partner.usecase.ts`; sửa `H/messages/messages.mount.ts`, `domain/messages.events.ts` |
| Gỡ trò chuyện CR-161 | xoá `H/connect/adapters/chat.repo.ts`, `chat.routes.ts`, `chat-files.routes.ts`, `H/connect/application/chat.usecase.ts` (+ test), `chat.ports.ts`, `H/connect/domain/chat.errors.ts`, `chat.files.ts`, `connect.chat.routes.int.test.ts`, `apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts`; sửa `H/connect/connect.mount.ts`, `connect.repo.ts` (`cc_links` bỏ unread), `connect.rules.ts` (bỏ `canSendChat`/`validateChatMessage`/`ccDedupKey`), `posts.routes.ts` (guard read), `connect.perf.int.test.ts` |
| Purge | sửa `tools/scripts/src/tenant-purge.partner.ts` (`anonymizeChat` ⇒ `purgePartnerMessages`), `tenant-purge.rules.ts` (+ test, int purge có sẵn) |
| Gói web chung | mới `packages/messages-web/` (`package.json`, `tsconfig.json`, `MW/index.ts`, `MW/lib/**`, `MW/api.ts` transport tiêm, `MW/hooks/**`, `MW/components/**`, `MW/i18n/{vi,en}.json`); chuyển từ `W/features/messages/**` (xoá ở W, giữ `W/features/messages/index.ts` mỏng gắn transport + router) |
| Web Tin nhắn mới | `MW/components/CompanyFilter.tsx`, `PeopleSearch.tsx`, `PartnerFeedPanel.tsx` (chuyển từ `W/features/partners/components/ConnectedFeedTab.tsx`), `ReadOnlyNotice.tsx`; sửa `ConversationList.tsx`, `ConversationRow.tsx`, `ChatView.tsx`, `MW/lib/conversations.ts`, `MW/api.ts` |
| Trang đối tác | sửa `W/features/partners/lib/partner-v2.ts` (TABS = overview, contracts, review), `PartnerTabs.tsx`, `pages/PartnerDetailPage.tsx`, `PartnerHeader.tsx` (bỏ PopMenu, nút «Sửa liên hệ»), `ConnectedPanel.tsx` (bỏ unread, thêm «Nhắn tin»); xoá `ChatTab.tsx`, `ChatComposer.tsx`, `ChatMessage.tsx`, `chat-labels.ts`, `CommunityTab.tsx`, `hooks/use-cc-chat.ts`, `lib/cc-chat.ts` (+ test); khoá i18n VI/EN |
| chat-web | `CW/features/messages/` (gắn `MW`: route `/messages`, mục thanh bên, badge), sửa `CW/features/realtime/event-router.ts` (định tuyến `msg.*`), `CW/features/shell/**` (mục menu), `apps/chat-web/package.json` (dep `@ai/messages-web`) |
| e2e | `e2e/cr169/nhan-tin-cong-ty.spec.ts`; sửa `e2e/cr161/ket-noi-cong-ty.spec.ts` (bỏ bước J3–J5, J7 phần trò chuyện), fixture `e2e/_kit` 2 công ty (thêm nhân viên) |

### Lát
| # | Lát | Model | Phạm vi | Phụ thuộc | Migration | Opus soát | Rủi ro | Đọc |
|---|---|---|---|---|---|---|---|---|
| 1 | `cr169-contract` | Sonnet | zod §4 + `partner.rules.ts` + unit | — | — | không | thường | spec §3–4 | [x] [test: packages/contracts/src/pack-contracts/messages.test.ts » CR-169 · partner] [test: apps/hub-api/src/modules/packs/contracts/messages/domain/partner.rules.test.ts » partnerSendError (P4)]
| 2a | `cr169-db-core` | Sonnet `high` | 0149 (gỡ `cc_*`, bảng `pmsg_*`, hàm open/inbox/detail/page/send/delete/read/unread) + int `H/messages/pmsg-db.int.test.ts` (công ty thứ ba, external, chỉ đọc sau ngắt, N2, idempotent) | — (song song 1) | hub 0149 | **có** (RLS, DEFINER) | cao | spec §3, §5; `migrations-hub/0146_cr161_cc_threads.sql` |
| 2a ✅ | `cr169-db-core` | Sonnet `high` | 0149 (gỡ `cc_*`, bảng `pmsg_*`, hàm open/inbox/detail/page/send/delete/read/unread) + int `H/messages/pmsg-db.int.test.ts` (công ty thứ ba, external, chỉ đọc sau ngắt, N2, idempotent) | — (song song 1) | hub 0149 | **có** (RLS, DEFINER) | cao | spec §3, §5; `migrations-hub/0146_cr161_cc_threads.sql` |
| 2b | `cr169-db-files` | Sonnet `high` | 0150 + 0151 + pack-contracts 0118 + int (tệp, danh bạ ∩ kết nối, role khác không EXECUTE — P12) | 2a | hub 0150, 0151; pc 0118 | **có** | cao | spec §5; `0148_cr161_cc_files_box_id.sql`, `kit/adapters/directory-page.ts`, `migrations-pack-contracts/0116_cr161_cc_grants.sql` | [x] [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-files-db.int.test.ts » tệp (P3, P4)] [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-files-db.int.test.ts » Minor 2a] [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-files-db.int.test.ts » danh bạ (P8)] [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-files-db.int.test.ts » danh sách công ty (P10)] [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-files-db.int.test.ts » P12 / 0151] [test: packages/db/src/migrate-hub.int.test.ts]
| 3a ✅ | `cr169-api-list` | Sonnet `high` | **đo trước** perf CR-132; danh sách union, unread, people/companies, create partner, `posts` guard, `cc_links` bỏ unread + int route + perf | 1, 2b | — | **có** (quyền) | cao | spec §4, §6; `messages.repo.ts`, `messages.perf.int.test.ts` | [x] [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-api.int.test.ts » CR-169 3a · danh sách hợp nhất + chưa đọc] [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-api.int.test.ts » CR-169 3a · quyền: không có quyền Sổ Hợp Tác / external ⇒ 403 ở mọi route] [test: apps/hub-api/src/modules/packs/contracts/messages/application/messages.view.test.ts » CR-169 · cuộc partner (view)]
| 3b | `cr169-api-partner` | Sonnet `high` | `/messages/partner/:id/*` + tệp + stream + gỡ trò chuyện CR-161 + int + `pmsg.perf.int.test.ts` | 3a (chung `messages.routes.ts`/mount) | — | **có** | cao | spec §4, §7; `connect/adapters/chat-files.routes.ts` |
| 4 | `cr169-purge` | Sonnet | `purgePartnerMessages` + rules + int purge | 2a | — | **có** (dữ liệu khách) | cao | spec §5 cuối | [x] [test: tools/scripts/src/tenant-purge.partner.int.test.ts » CR-169 · nhắn tin] |
| 5a | `cr169-web-pkg-lib` | Sonnet | tạo `packages/messages-web`, chuyển `lib/`, `api.ts` (transport tiêm), `hooks/` + test; W gắn lại; hành vi không đổi | — | — | không | thường | `W/features/messages/**`, `packages/web-kit/src/notify/client.ts` | | [x] [test: packages/messages-web/src/lib/messages-lib.test.ts » CR-169 · chuyển gói]
| 5a | `cr169-web-pkg-lib` | Sonnet | tạo `packages/messages-web`, chuyển `lib/`, `api.ts` (transport tiêm), `hooks/` + test; W gắn lại; hành vi không đổi | — | — | không | thường | `W/features/messages/**`, `packages/web-kit/src/notify/client.ts` |
| 5b | `cr169-web-pkg-ui` | Sonnet | chuyển `components/`, i18n; W trang + khoang dùng gói; unit + j18/j19 vẫn chạy được (không chạy e2e) | 5a | — | không | thường | như 5a | | [x] [test: packages/messages-web/src/lib/errors.test.ts » CR-169 · chuyển gói]
| 6 | `cr169-web-partner` | Sonnet | lọc công ty, tìm người tải dần, dòng/khung `partner`, chỉ đọc, Bảng tin công ty + unit lib | 1, 3b, 5b | — | không | thường | spec §8 |
| 7 | `cr169-web-partner-page` | Sonnet | trang đối tác 3 tab, bỏ «Thao tác», «Nhắn tin» ở khối kết nối, xoá UI trò chuyện + unit `partner-v2.test.ts` | 1 | — | không | thường | spec §8 hàng «Trang đối tác» | [x] [test: apps/workspace-web/src/features/partners/lib/partner-v2.test.ts » CR-169 · 3 tab] |
| 8 | `cr169-chat-web` | Sonnet | chat-web mục «Tin nhắn» (gắn gói, badge, stream), ẩn khi không quyền SHT, không vào ngữ cảnh trợ lý + unit | 6 | — | không | thường | spec §7–8, P12; `CW/features/realtime/event-router.ts` |
| 9 | `cr169-e2e` | Sonnet | fixture + e2e hành trình (chỉ viết; điều phối chạy cuối đợt) + sửa e2e CR-161 | 6, 7, 8 | — | không | thường | mục e2e dưới |

Thứ tự: {1, 2a, 5a} song song → {2b, 4, 5b, 7} → 3a → 3b → 6 → 8 → 9. Tối đa 4 agent cùng lúc (A1). 3a/3b chung `messages.routes.ts` ⇒ nối tiếp. 2a sát trần 20 phút — quá thì tách `pmsg_delete`/`pmsg_unread` sang 2b.

### e2e hành trình (G4, N2) — `e2e/cr169/nhan-tin-cong-ty.spec.ts`
Fixture: NitiGroup (Tiên Toàn quyền, Vy nhân viên, Lan nhân viên), Preschool (Dung Toàn quyền, Hà nhân viên), đã kết nối (Tiên mời — Dung đồng ý, tạo qua API fixture); Preschool có 1 bài Bảng tin công khai.
1. Vy (nhân viên, không phải người tạo kết nối) › Tin nhắn › chip «Preschool» › tìm «Hà» (theo chức vụ) ⇒ thấy «Hà · <chức vụ> · Preschool», không thấy email/điện thoại › nhắn chữ + PDF.
2. Hà (Preschool) thấy số chưa đọc ở menu «Tin nhắn» › mở ⇒ tin + tải PDF › trả lời ⇒ Vy thấy «Đã xem» và câu trả lời tức thì.
3. Hà › chip «NitiGroup» › «Bảng tin NitiGroup» ⇒ khung bài (nếu NitiGroup có bài) / Vy › «Bảng tin Preschool» ⇒ thấy bài công khai đã che.
4. Lan (NitiGroup, ngoài cuộc) không thấy cuộc Vy–Hà; công ty thứ ba (fixture) tìm người ⇒ không có ai của NitiGroup/Preschool.
5. **Chat AI app**: Hà đăng nhập chat-web › mục «Tin nhắn» ⇒ cùng cuộc với Vy, gửi một tin ⇒ Vy (workspace-web) nhận tức thì; hỏi trợ lý «tóm tắt tin nhắn của Vy» ⇒ trợ lý không có dữ liệu (không trích tin).
6. Tiên › Đối tác › Preschool: chỉ 3 tab Tổng quan · Hợp đồng · Sổ việc & ghi chú, không có nút «Thao tác» › Ngắt kết nối ⇒ Vy mở cuộc với Hà thấy tin cũ + câu chỉ đọc, không có ô soạn; chip «Preschool» biến mất.

## Việc
| # | Việc | Lát | Trạng thái |
|---|---|---|---|
| 1 | Contract zod + luật thuần | cr169-contract | [x] |
| 2 | Migration 0149 + int | cr169-db-core | [x] |
| 3 | Migration 0150/0151 + pc 0118 + int | cr169-db-files | [ ] |
| 4 | API danh sách/danh bạ/công ty + perf (đo trước) | cr169-api-list | [ ] |
| 5 | API cuộc partner + tệp + stream, gỡ trò chuyện CR-161 | cr169-api-partner | [ ] |
| 6 | Purge công ty | cr169-purge | [x] |
| 7 | Gói `messages-web` (lib/api/hooks) | cr169-web-pkg-lib | [ ] |
| 8 | Gói `messages-web` (components) | cr169-web-pkg-ui | [ ] |
| 9 | Web Tin nhắn với công ty kết nối | cr169-web-partner | [ ] |
| 10 | Trang đối tác 3 tab | cr169-web-partner-page | [x] |
| 11 | chat-web «Tin nhắn» | cr169-chat-web | [ ] |
| 12 | e2e hành trình | cr169-e2e | [ ] |

## Quyết định trong lúc làm
- (PLAN) Lưu `partner` ở `hub.pmsg_*` (xuyên tenant, DEFINER), giữ `contracts.msg_*` cho nội bộ; một contract/một UI/một họ sự kiện `msg.*` — lý do spec §2.
- (PLAN) Số migration thật: hub 0149–0151, pack-contracts 0118 (đã kiểm: cuối hiện có hub 0148, pc 0117).
- (PLAN) Delta CR-161 chưa gộp: khối «ADDED sht/tro-chuyen-cong-ty.md» của `docs/specs/CR-161/tasks.md` bị CR-169 thay ⇒ khi gộp đợt KHÔNG tạo file đó; hai yêu cầu CR-161 khác (Ngắt kết nối, Bảng tin) được CR-169 sửa ở Delta dưới — gộp CR-161 trước rồi CR-169.

- (lát 2a) Mã lỗi DB hàm `pmsg_*`: SQLSTATE riêng, MESSAGE = mã nghiệp vụ — `CC404` MSG_NOT_FOUND · `CC403` MSG_NOT_SENDER · `CC409` MSG_NOT_CONNECTED/MSG_PEER_INACTIVE · `CC422` MSG_USER_INVALID/MSG_FILE_INVALID · `CC400` MSG_EMPTY/MSG_TOO_LONG/MSG_TOO_MANY_FILES · `22023` đầu vào sai · `42501` không được dùng (P1). Route ánh xạ theo MESSAGE.
- (lát 2a) Chữ ký thật: `pmsg_open(p_tenant,p_user)→(id,created)`; `pmsg_inbox(p_company,p_cur_t,p_cur_id,p_limit)` (cột `last` jsonb có thêm `sender_name`; `last_at` timestamptz, route đổi sang ISO µs cho con trỏ); `pmsg_detail(p_id)` = cột inbox + `my_read_seq`,`peer_read_seq`; `pmsg_page(p_id,p_before,p_limit)→(items,has_more)` (items đã là Message jsonb, seq giảm dần, has_more tính trong hàm — route KHÔNG xin limit+1); `pmsg_send(p_id,p_client_id,p_body,p_file_ids)→(seq,created,message,notify)`; `pmsg_delete(p_id,p_seq)→text[]` (id FileBox cần gỡ byte); `pmsg_mark_read(p_id,p_seq)→bigint`; `pmsg_unread()→int`. Hàm nội bộ không cấp: `pmsg_ctx`, `pmsg_eligible_raw`, `pmsg_view`, `pmsg_msg_json`.
- (lát 2a) `eligible` = active, không `locked_by_tenant`, `kind<>external`, thuộc Group có grant contracts-read/write/admin (entitlement còn, feature ≠ off); `peer_active` = eligible của người kia; `read_only` = NOT(connected AND eligible).
- (lát 2a) Khoá: advisory SHARED theo cặp (cùng khoá 161 của cc_invite/cc_disconnect) ở open/send ⇒ gửi song song được nhưng tuần tự với ngắt/mời; rồi FOR UPDATE thread. Người gửi tiến mốc đọc tới tin vừa gửi (tin đối phương trước đó coi như đã đọc — như CR-161).
- (lát 2a) SỬA migration đã áp pack-contracts 0116/0117 (bỏ GRANT các hàm trò chuyện chung đã gỡ): hub luôn chạy trước gói ⇒ DB dựng sạch lỗi «function does not exist» nếu giữ. DB đã áp không ảnh hưởng. Lát 2b: pack 0118 chỉ cấp hàm `pmsg_*` (+ cc_links nếu cần: 0116 vẫn cấp cc_links không điều kiện, chạy sau hub 0149 nên còn nguyên).
- (lát 2a) 0149 đã tự cấp `pmsg_*` + cc_links cho hub_rw và (khối DO) contracts_rw — để int chạy bằng role thật ở lát này; 0151 (lát 2b) chỉ cần cấp lại/đối chiếu cho hàm 0150.
- (lát 2a) `cc_links` bỏ cột `unread` (DROP + CREATE theo thân 0145) ⇒ `connect.repo.ts:62-81` (`unread` trong SELECT) và `connect-links.int.test.ts:63,197` vỡ cho tới lát 3a/3b (spec §4: «CcLink bỏ unread»). Ghi để lát đó xử lý.
- (lát 2a) Đã sửa `packages/db/src/migrate-hub.int.test.ts` (danh sách bảng: bỏ cc_*, thêm pmsg_*; kiểm quyền hàm mới + cc_* đã gỡ).
- (lát 2a) Chạy lại 0149 được (DO-loop DROP theo tên, DROP … IF EXISTS, CREATE … IF NOT EXISTS, CREATE OR REPLACE; cc_links DROP + CREATE + cấp lại quyền) — int phủ.
- (lát 2a) Còn trỏ `cc_*` (chỉ ghi, lát 4/3a/3b xử): `tools/scripts/src/tenant-purge.partner.ts` + `.int.test.ts`; `apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts`, `cc-chat-files-db.int.test.ts`, `connect-links.int.test.ts`; `packs/contracts/connect/**` (chat.repo/chat.routes/chat-files.routes/chat.usecase/chat.ports/chat.files/connect.chat.routes.int.test/connect.perf.int.test/connect.rules `canSendChat`…); web `partners/hooks/use-cc-chat.ts`, `lib/cc-chat.ts`; `packages/contracts` (`cc.msg`, `Cc*` thread schema).
- (lát 2b) Chữ ký thật 0150: `pmsg_file_add(p_id thread,p_file_id,p_box_id,p_name,p_mime,p_size,p_storage_key)→jsonb {id,name,mime,size}` (lỗi: CC404 không phải đầu cuộc · CC409 MSG_NOT_CONNECTED/MSG_PEER_INACTIVE · CC422 MSG_FILE_INVALID tên/mime/size/khoá/box id sai hoặc ≥ 50 tệp chưa gắn/người · 22023 null); `pmsg_file_get(p_id thread,p_file_id)→(storage_key,box_file_id)` 0 dòng = 404 (có `p_id`: tệp phải thuộc đúng cuộc); `pmsg_files_sweep(p_older)→(file_id,storage_key,box_file_id)` chỉ system, ≥ 1 h, KHÔNG cấp contracts_rw; `pmsg_people(p_tenants uuid[],p_q,p_cur_name,p_cur_id,p_limit 1..101)→(user_id,name,job_title,tenant_id,company_name,department_id,department_name,sort_key)`; `pmsg_companies(p_cur_name,p_cur_id,p_limit)→(company_id,name,sort_key)`. Con trỏ keyset = (`sort_key`,`user_id`/`company_id`) của dòng cuối — route trả thẳng cột `sort_key`, không tự tính. Nội bộ không cấp: `pmsg_connected(uuid)`.
- (lát 2b) Danh bạ dùng `pmsg_eligible_raw` làm nguồn «có quyền Sổ Hợp Tác» (G1 thắng nhanh; ~1 lần gọi hàm/dòng ứng viên, chưa đo — perf để sau). Phòng ban (`department_*`) chỉ cho người của A, lấy cùng cách `directory-page.ts`, join sau LIMIT. Route `own` vẫn có thể dùng `directory-page.ts` hoặc `pmsg_people([A])`; `all`/công ty B dùng `pmsg_people`.
- (lát 2b) Trần 50 tệp chưa gắn/người chính xác khi tải song song: thêm advisory theo người (`hashtextextended('pmsg_file_add:'||uid,169)`), sau khoá cặp SHARED — không hàm nào khác lấy nên không vòng khoá.
- (lát 2b) Minor 2a đã xử trong 0150 (`CREATE OR REPLACE pmsg_send`, không sửa 0149): gửi lặp cùng client_id kiểm sau FOR UPDATE, trước kiểm kết nối ⇒ sau ngắt vẫn trả tin cũ (created=false, notify rỗng); client_id mới ⇒ CC409. UPDATE gắn tệp lọc thêm tenant_id/user_id/seq IS NULL. Thứ tự khoá vẫn advisory → hàng thread; gửi bị từ chối vì ngắt nay cũng giữ FOR UPDATE ngắn.
- (lát 2b) 0151 cấp lại cả hàm 0149 + 0150 cho hub_rw/contracts_rw (khối DO); pack 0118 cấp không điều kiện (kèm `cc_links`, vì hub 0149 DROP+CREATE). Cả ba đã vào `_journal.json` (hub idx 133/134, pack 114).
- (lát 2b) Đã sửa `packages/db/src/migrate-hub.int.test.ts` (quyền hàm 0150 trên DB dựng sạch). Int chạy evotest: pmsg-files-db + pmsg-db + migrate-hub → 41 pass, 0 fail (1 lượt).

## Tranh chấp test

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md
#### Yêu cầu: Nhắn 1-1 với người của công ty đã kết nối (CR-169)
Ngoài 1-1/nhóm trong công ty, nhân viên nội bộ có quyền Sổ Hợp Tác nhắn 1-1 với nhân viên của công ty đang kết nối (CR-161); cùng màn, cùng khung chat, đính kèm, thu hồi, «Đã xem», realtime như tin nội bộ. Không chuông, không email. Nhóm nhiều công ty không có.
- Kịch bản: khi Vy (NitiGroup) nhắn Hà (Preschool) kèm PDF thì Hà thấy số chưa đọc, mở thấy tin, tải được tệp và Vy thấy «Đã xem» [test: thủ công — chưa viết]
- Kịch bản: khi mở lại 1-1 với cùng người thì ra đúng cuộc cũ, gửi lặp cùng mã chỉ một tin [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-db.int.test.ts » P2 mở 1–1; apps/hub-api/src/modules/packs/contracts/messages/pmsg-db.int.test.ts » P4 gửi]
- Kịch bản: khi người gửi thu hồi tin thì nội dung và tệp biến mất ở cả hai công ty [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-db.int.test.ts » P5 thu hồi]

#### Yêu cầu: Cách ly tin giữa công ty kết nối
Chỉ hai người trong cuộc đọc được; đồng nghiệp khác, công ty thứ ba, user đối tác (external), người không có quyền Sổ Hợp Tác không thấy, không gửi, không tải tệp; người ngoài nhận «không tìm thấy».
- Kịch bản: khi công ty thứ ba hoặc đồng nghiệp ngoài cuộc gọi đọc/gửi/tải tệp thì 404 và không thấy dòng nào [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-db.int.test.ts » P3 chỉ hai đầu thấy]
- Kịch bản: khi gọi thẳng hàm cơ sở dữ liệu mà không có công ty/người dùng hoặc bằng vai không được cấp thì bị từ chối [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-db.int.test.ts » P1 chỉ người hợp lệ]

#### Yêu cầu: Ngắt kết nối thì cuộc trò chuyện chỉ đọc
Hai công ty không còn kết nối (hoặc người kia không còn dùng Sổ Hợp Tác) ⇒ vẫn xem tin cũ và tệp, không gửi, không tải lên; màn nói lý do. Kết nối lại dùng đúng cuộc cũ.
- Kịch bản: khi Tiên ngắt kết nối thì Vy mở cuộc với Hà thấy tin cũ, câu chỉ đọc, gửi bị 409 `MSG_NOT_CONNECTED` [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-db.int.test.ts » P7 chỉ đọc sau ngắt]

#### Yêu cầu: Danh sách lọc theo công ty, tìm người, tải dần
Danh sách cuộc gần đây trước; chip Tất cả / công ty mình / từng công ty đã kết nối; tìm người theo tên hoặc chức vụ (không phân biệt hoa/dấu), tải dần; người công ty kia hiện tên, chức vụ, tên công ty — không email, điện thoại, phòng ban.
- Kịch bản: khi chọn chip «Preschool» thì chỉ thấy cuộc với người Preschool và tìm «kế toán» ra người Preschool có chức vụ đó [test: thủ công — chưa viết]
- Kịch bản: khi lọc theo công ty chưa kết nối thì danh sách rỗng, không lỗi [test: thủ công — chưa viết]
- Kịch bản: khi có 200 cuộc mỗi loại và 100.000 tin thì danh sách 30 cuộc p95 ≤ 50 ms một câu SQL, tổng chưa đọc ≤ 20 ms [test: thủ công — chưa viết]

#### Yêu cầu: Xem Bảng tin công ty kết nối trong Tin nhắn
Khi lọc theo một công ty đã kết nối, nút «Bảng tin <Công ty>» mở bài công khai của công ty đó (bản đã che, chỉ đọc) cho mọi nhân viên nội bộ; ngắt kết nối ⇒ mất ngay.
- Kịch bản: khi Vy bấm «Bảng tin Preschool» thì thấy bài công khai còn hạn, đã che liên hệ [test: thủ công — chưa viết]

#### Yêu cầu: Tin nhắn trong ứng dụng Chat AI, trợ lý AI không truy cập
Ứng dụng Chat AI có mục «Tin nhắn» (khi người dùng có quyền Sổ Hợp Tác) cùng dữ liệu và cùng màn với Sổ Hợp Tác. Trợ lý AI không đọc, không gửi, không tóm tắt tin nhắn ở bất kỳ app nào.
- Kịch bản: khi Hà gửi tin trong Chat AI thì Vy thấy ngay trong Sổ Hợp Tác [test: thủ công — chưa viết]
- Kịch bản: khi hỏi trợ lý về tin nhắn thì trợ lý không có dữ liệu tin nhắn [test: thủ công — chưa viết]

### MODIFIED platform/partner-links.md
#### Yêu cầu: Ngắt kết nối (CR-169)
Ngắt kết nối như CR-161 (mất gửi HĐ đi thẳng, mất xem bài); mọi cuộc tin nhắn 1-1 giữa người hai công ty thành chỉ đọc. Danh sách «Công ty đã kết nối» không còn số chưa đọc; mỗi công ty có nút «Nhắn tin» mở Tin nhắn lọc theo công ty đó.
- Kịch bản: khi bấm «Nhắn tin» ở công ty đã kết nối thì mở Tin nhắn với chip công ty đó [test: thủ công — chưa viết]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Công ty đã kết nối xem bài công khai của nhau (CR-169)
Như CR-161 nhưng mọi nhân viên nội bộ có quyền Sổ Hợp Tác (không chỉ Toàn quyền) xem được, và xem trong «Tin nhắn» thay vì trang đối tác.
- Kịch bản: khi nhân viên thường gọi xem bài công ty đã kết nối thì 200 bản đã che; user external thì 403 [test: thủ công — chưa viết]

### ADDED sht/trang-doi-tac.md
#### Yêu cầu: Trang chi tiết đối tác chỉ còn ba tab
Tab: Tổng quan · Hợp đồng · Sổ việc & ghi chú. Không còn «Bảng tin», «Trò chuyện», «Bảng tin công ty», không có nút «Thao tác»; «Sửa liên hệ» là nút chữ cạnh khối liên hệ cho người có quyền ghi. Đường dẫn tab cũ về Tổng quan.
- Kịch bản: khi mở `?tab=chat` hoặc `?tab=community` thì về Tổng quan [test: thủ công — chưa viết]
- Kịch bản: khi người có quyền ghi bấm «Sửa liên hệ» thì mở khung sửa liên hệ [test: thủ công — chưa viết]
- (lát 4) Purge theo luật người dùng chốt (thay câu spec §5 «tin xoá mềm»): tin của A GIỮ chữ, `sender_user`→tombstone, `files='[]'`, `client_id` đổi mới; mốc đọc A→0; thread giữ cho B; bên kia đã xoá ⇒ xoá thread. Nhiều thread cùng (người B) gộp vào (tombstone,B) đã có hoặc thread nhỏ nhất (seq dời cộng dồn). Số liệu audit đổi tên `pmsg*`. `scrubChatBells` giữ (chuông `cc.*` kết nối còn dùng).
- (lát 7) «Nhắn tin» dẫn `/contracts/messages?company=<tenant_id>` (route chưa có `company` — `search` ép kiểu, lát 6 phải nhận tham số); xoá luôn tab/hook Bảng tin (CommunityTab, use-partner-community, community-block), số chưa đọc ở khối kết nối. e2e cần sửa (lát 9): `e2e/cr161/ket-noi-cong-ty.spec.ts:48` (tab=chat, ChatTab/Bảng tin công ty), `e2e/_kit/two-companies.seed.ts`, `e2e/community-web/cr130-journey.cs.ts` (tab Bảng tin), nút «Mở trang đối tác»/`connect-unread` ở khối kết nối; `act-editContact` nay là nút chữ (không qua menu «Thao tác»).
- (lát 3a) Số đo (evotest, `-Step perf`). TRƯỚC (CR-132, HEAD 1d0a513cb): unread p95 5,6 ms/1 câu · danh sách 30 p95 36,2 ms/1 câu. SAU (hai nguồn, 200 nhóm + 200 partner × 500 tin): unread 7,4 ms/1 câu ✅ (≤ 20) · danh sách 30 p95 **111,8 ms**/1 câu ❌ (ngưỡng 50 — `pmsg_inbox` gọi `pmsg_view` (eligible_raw + cc_connected_raw + 2 lateral) cho mỗi cuộc; việc dở, cần tối ưu `pmsg_view` theo tập hoặc đo lại trên máy ít tải). Danh bạ `pmsg_people` (5.000 người/50 công ty, `all` 30 người): TRƯỚC 0152 p95 826 ms → SAU 0152 (set-based qua view) 191 ms ❌ (ngưỡng 40; 1 câu ✅); `q` 839 → 184 ms; `pmsg_companies` 41 → 32,5 ms (tx trống 13,7 ms ⇒ thuần SQL 18,7 ms ✅). Đã thử top-N mỗi công ty bằng LATERAL + index `(tenant_id, fold(tên), id)`: tệ hơn (648 ms: EXISTS «hợp lệ» chạy từng ứng viên, ~0,4 ms/dòng) ⇒ đã bỏ. Hướng tiếp: tách bước «nhóm được cấp contracts-read/write/admin theo công ty» (tính MỘT lần mỗi công ty) khỏi bước «người thuộc nhóm đó», và/hoặc lưu sẵn `fold(tên)` — cần ADR/đổi schema nên để lát sau.
- (lát 3a) 0152: «thân điều kiện hợp lệ dùng chung» là VIEW `hub.pmsg_eligible_v` (không phải hàm trả tập — hàm DEFINER/`SET search_path` không được inline nên không đẩy điều kiện tenant/user xuống). `pmsg_eligible_raw` = EXISTS trên view; `pmsg_people` join view theo tập công ty (không gọi hàm theo từng người). View không cấp cho ai (migrate-hub int kiểm). Thêm `hub.pmsg_self_company()` (tên công ty của chính người gọi, cho danh bạ `own`; hub_rw không đọc được `admin.tenants`) + index trigram `admin.users` fold(tên) nếu có pg_trgm (lỗi ⇒ bỏ qua).
- (lát 3a) Danh sách hợp nhất: `messages.repo.ts` `listSql` — CTE `im` (nội bộ, keyset+LIMIT) `UNION ALL` CTE `pm` (`pmsg_inbox`, LIMIT n+1), sắp/LIMIT ngoài; cột `partner` json mang người/công ty/read_only. `unread` = `least(msg + hub.pmsg_unread(), 999)` MỘT câu. Hệ quả: `pmsg_ctx` đòi người gọi có quyền Sổ Hợp Tác ⇒ list/unread/markRead của người KHÔNG có quyền ném 42501 ⇒ route 403 `PACK_FORBIDDEN` (`partner.errors.ts`); test CR-132 (`messages*.int.test.ts`) nay cấp nhóm contracts cho user.
- (lát 3a) Danh bạ: `own` giữ nguồn CR-148 (`directory-page.ts`, phòng ban rồi tên) + `job_title` + `company`; `all`/công ty = `pmsg_people` (sắp tên). Hai loại con trỏ khác nhau (4 phần vs `[sort_key,id]`); con trỏ sai loại ⇒ 400. `company=<uuid không kết nối>` ⇒ rỗng (bỏ im lặng, theo 0150).
- (lát 3a) `GET /connect/posts/:tenant_id` guard `read` (đổi từ `admin`); `connect.routes.int` bỏ route bài khỏi ca «Vy ⇒ 403 mọi route», thêm ca Vy xem bài ⇒ 200. `CcLink`/`cc_links` bỏ `unread` (contract + repo + test). Web `partners/components/ConnectedPanel.tsx` còn đọc `l.unread` ⇒ lỗi kiểu ở workspace-web cho tới lát 6 (không đụng web ở lát này).
- (lát 3a) Còn đỏ do lát 2a (thuộc 3b «gỡ trò chuyện CR-161»): `connect.routes.int.test.ts › quyền DB cho role gói (0116)` kiểm hàm `hub.cc_thread_page…` đã DROP. `pmsg-db.int.test.ts:412` lỗi kiểu `tsc` có sẵn từ 2a.
- (lát 3a · Việc còn lại) Perf chưa đạt ngưỡng (không chặn mốc): danh sách 2 nguồn p95 ~112 ms/ngưỡng 50; `pmsg_people` ~191 ms/ngưỡng 40 — xem TECH-DEBT #274 (hướng: tính sẵn nhóm quyền theo công ty, lưu fold(tên)). Số lượt chạy lại bản a77490c1f ghi ngay dưới nếu khác.
