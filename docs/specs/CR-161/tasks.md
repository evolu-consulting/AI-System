# CR-161 — Kết nối hai công ty, không cần hợp đồng · tasks

Spec: `docs/specs/CR-161/spec.md` · bản mẫu: `prototype.json` (5 câu = `default`).

## Chia lát

### Bản đồ file
| Vùng | File (tạo mới trừ khi ghi «sửa») |
|---|---|
| Migration hub | `packages/db/migrations-hub/0145_cr161_connect_links.sql`, `0146_cr161_cc_threads.sql`, `0147_cr161_cc_grants.sql` + `meta/_journal.json` (sửa) |
| Migration community | `packages/db/migrations-pack-community/0020_cr161_connected_posts.sql` + `meta/_journal.json` (sửa) · 0021 trả lại |
| Contract zod | `packages/contracts/src/pack-contracts/company-connect.ts` (+ `.test.ts`), `index.ts` (sửa, export), union `MeStream*Event` (sửa, thêm `cc.msg`/`cc.link`) |
| Luật thuần | `apps/hub-api/src/modules/packs/contracts/connect/domain/connect.rules.ts` (+ `.test.ts`) |
| API kết nối | `H/connect/adapters/connect.repo.ts`, `connect.routes.ts`, `connect.mount.ts`, `H/connect/application/connect.usecase.ts`; mount vào `H/partner-routes.mount.ts` (sửa 1 dòng) |
| API trò chuyện | `H/connect/adapters/chat.repo.ts`, `chat.routes.ts`, `chat-files.routes.ts`, `H/connect/application/chat.usecase.ts` (publish `/me/stream` qua port có sẵn của messages) |
| API bài | `H/connect/adapters/posts.repo.ts`, `posts.routes.ts` |
| Web kết nối | `W/features/partners/components/ConnectSearchDialog.tsx`, `InviteBanner.tsx`, `ConnectStatusBadge.tsx`, `DisconnectButton.tsx`, `W/features/partners/api.connect.ts`, `hooks/use-connect.ts`; sửa: trang danh sách đối tác (`W/routes/_authed/contracts/partners.tsx` + trang danh sách), `PartnerHeader.tsx`, Hộp thư `partner-inbox` dùng `InviteBanner` |
| Web trò chuyện + bài | `W/features/partners/components/ChatTab.tsx`, `ConnectedFeedTab.tsx`, `hooks/use-cc-chat.ts`; sửa `lib/partner-v2.ts` (TABS thêm `chat`), `PartnerTabs.tsx`, `pages/PartnerDetailPage.tsx`, khoá i18n VI/EN |
| e2e + fixture | `e2e/cr161/ket-noi-cong-ty.spec.ts`, fixture tenant NitiGroup/Preschool trong `e2e/_kit` (không đổi seed chung) |

Viết tắt: `H` = `apps/hub-api/src/modules/packs/contracts`, `W` = `apps/workspace-web/src`.

### Lát
| # | Lát | Model | Phạm vi | Phụ thuộc | Migration | Opus soát | Rủi ro | Đọc |
|---|---|---|---|---|---|---|---|---|
| 1 | `cr161-contract` | Sonnet | zod + luật thuần + unit | — | — | không | thường | spec §2–3 |
| 2 | `cr161-link-db` | Sonnet `high` | 0145 + int `connect-links.int.test.ts` (R3–R7, R9 chuông, cách ly, N2) | — (song song 1) | hub 0145 | **có** (RLS, DEFINER, quyền) | cao | spec §2, §4; `0118_partner_links_fn.sql`; `0040_n3_notify.sql` |
| 3 | `cr161-chat-db` | Sonnet `high` | 0146 + 0147 + int `cc-chat-db.int.test.ts` (cách ly công ty thứ ba, chỉ đọc sau ngắt, seq/idempotent, tệp) | 2 | hub 0146, 0147 | **có** | cao | spec §4–5 |
| 4 | `cr161-posts-db` | Sonnet | community 0020 + int (R10, ngắt ⇒ 42501, che) | 2 (song song 3) | community 0020 | **có** | cao | spec §2 R10, §4; `community/0001_init.sql` posts |
| 5 | `cr161-link-api` | Sonnet | routes tìm/mời/ngắt/danh sách + bài (`posts.*`) + int route (403 Vy, mã lỗi) | 1, 2, 4 | — | **có** (quyền) | cao | spec §3, §5 |
| 6 | `cr161-chat-api` | Sonnet `high` | routes trò chuyện + tệp + stream + int + `connect.perf.int.test.ts` | 1, 3, 5 (chung `connect.mount.ts`) | — | **có** | cao | spec §3, §6; `messages/application/messages.usecase.ts` |
| 7 | `cr161-web-link` | Sonnet | Tìm công ty, băng lời mời, cột Tình trạng, Ngắt, nhân viên không nút + unit lib | 5 | — | không | thường | spec §8; `prototype.json` màn tim/loi-moi/ds/vy |
| 8 | `cr161-web-chat` | Sonnet | tab Trò chuyện + tab Bảng tin kết nối (CR-164 `AttachGallery`/`AttachDraft`) | 6, 7 (chung `PartnerTabs`/`partner-v2.ts`) | — | không | thường | spec §8; màn chat/bai |
| 9 | `cr161-e2e` | Sonnet | fixture 2 công ty + e2e hành trình 2 vai (chỉ viết; điều phối chạy cuối đợt) | 7, 8 | — | không | thường | prototype `flow` |

Thứ tự: {1, 2} song song → {3, 4} song song → 5 → 6 → 7 → 8 → 9. Lát 6 và 7 có thể chạy song song (không chung file) nếu đủ chỗ agent; 8 phải sau 7.
Mỗi lát ≤ 20 phút; lát 3 và 6 sát trần — nếu quá, tách «tệp» (0146 phần `cc_files` + `chat-files.routes.ts`) thành lát 3b/6b nối tiếp.

### e2e hành trình (G4, N2) — `e2e/cr161/ket-noi-cong-ty.spec.ts`
1. Tiên (NitiGroup, Toàn quyền) › Đối tác › Tìm công ty «Preschool» › Gửi lời mời kèm lời nhắn ⇒ thấy «Đã gửi lời mời — chờ Preschool trả lời».
2. Dung (Preschool, Toàn quyền, không phải người tạo dữ liệu) thấy chuông «NitiGroup muốn kết nối với bạn» › băng lời mời có lời nhắn › Đồng ý.
3. Tiên thấy Preschool «Đã kết nối» › tab Trò chuyện › nhắn + đính kèm PDF.
4. Dung mở chuông «Tin nhắn mới…» › thấy tin + tệp › trả lời › tab Bảng tin của NitiGroup thấy bài công khai.
5. Vy (nhân viên NitiGroup) › Đối tác: thấy «Đã kết nối», không có nút mời, không có tab Trò chuyện.
6. Tiên › Ngắt kết nối ⇒ Dung mở trò chuyện thấy tin cũ, không có ô soạn; tab Bảng tin ẩn.

## Việc
| # | Việc | Lát | Trạng thái |
|---|---|---|---|
| 1 | Contract zod + luật thuần | cr161-contract | [x] |
| 2 | Migration 0145 + int link | cr161-link-db | [x] |
| 3 | Migration 0146/0147 + int chat | cr161-chat-db | [x] |
| 4 | Migration community 0020 + int | cr161-posts-db | [x] |
| 5 | API kết nối + bài | cr161-link-api | [ ] |
| 6 | API trò chuyện + perf | cr161-chat-api | [ ] |
| 7 | Web kết nối | cr161-web-link | [ ] |
| 8 | Web trò chuyện + Bảng tin | cr161-web-chat | [ ] |
| 9 | e2e hành trình | cr161-e2e | [ ] |

## Quyết định trong lúc làm
- (lát 2) Lỗi nghiệp vụ DB dùng SQLSTATE riêng: `CC422` (CONNECT_NOT_LISTED → 422), `CC409` (MESSAGE `CONNECT_DECLINED` | `CONNECT_NOT_CONNECTED` → 409); `42501` → 403/404 như cũ; `22023` → 400.
- (lát 2) `cc_invite` buộc `p_user` là người Toàn quyền của tenant đang thao tác (42501 nếu không); các hàm khác chỉ kiểm tenant, cổng người dùng là `packGuard` ở route (R1).
- (lát 2) B chặn A TRƯỚC khi A từng mời ⇒ `cc_invite` trả `pending_out` im lặng, không đổi dòng (giữ «không lộ» của 0118); R3 `CONNECT_DECLINED` chỉ khi A đã xin (`requested_at` có).
- (lát 2) Audit «ngắt kết nối» do route ghi (CHECK `hub.audit_log.action` không có giá trị phù hợp, hàm DB không biết người thao tác). Lát 5 làm.
- (lát 2) Chuông viết thẳng trong hàm DEFINER (`hub.cc_bell`, `fanout_at = now()` ⇒ không email/push); tiêu đề VI cố định ở DB. `cc.accepted` ⇒ người mời nếu còn Toàn quyền, không thì mọi người Toàn quyền bên mời; `cc.invite`/`cc.disconnected` ⇒ mọi người Toàn quyền. Route/stream (`cc.link`) lát 5 phát.
- (lát 2) `hub.cc_links` trả `unread = 0` ở 0145; lát 3 (0146) `CREATE OR REPLACE` cùng chữ ký để tính chưa đọc. `p_limit` kẹp 1..101 (route xin limit+1).
- (lát 2) Thêm index `partner_links_to_ix (to_tenant)` (phía «in» của cc_links/cc_search; PK chỉ phủ from_tenant) ngoài index một phần của spec.
- (lát 2) Kịch bản dòng «ngắt ⇒ gửi tin 409» và «Vy gọi API ⇒ 403» mới phủ phần DB; lát 3/5/6 thêm đường dẫn test route/chat vào cùng dòng khi viết.
- (lát 2) Gọi `cc_notify` từ route: truyền lô bằng `${JSON.stringify(rows)}::text::jsonb` (postgres.js mã hoá chuỗi `::jsonb` thành chuỗi JSON ⇒ lỗi «lô phải là mảng»).
- (lát 4) `community.cc_posts(p_owner, p_cur_t, p_cur_id, p_limit)` → cột `file_count`; GRANT `community_rw` + `contracts_rw` (khối DO, chỉ cấp khi role đã có — role tạo sau thì pack contracts phải cấp lại); `app.user_kind=external` ⇒ 42501; bên đăng phải có add-on `contracts-community` chưa thu hồi (không ⇒ rỗng). Lệch spec: thêm tham số/ý ngoài §4 không có; không thêm index (posts_feed_idx đủ, lọc công khai trên (tenant_id, created_at)).
- (lát 3) Hàm trò chuyện nhận `p_user` và gọi `hub.cc_ctx(p_user)`: có `app.tenant_id`, p_user = `app.user_id` (nếu đã đặt) và là người Toàn quyền ⇒ không thì 42501 (nhân viên bị chặn cả ở DB, không chỉ ở route). Chữ ký lệch spec §4 chỉ ở chỗ thêm `p_user`: `cc_thread_page(p_other, p_user, p_before, p_limit)`, `cc_file_get(p_file_id, p_user)`. Luồng luôn suy từ (tenant, p_other), không nhận id luồng.
- (lát 3) Mã lỗi DB: `CC409` MESSAGE `CONNECT_READ_ONLY` (gửi/tải lên khi chưa connected), `CC404` `CONNECT_NO_THREAD` (đọc khi chưa từng kết nối), `CC422` `MSG_EMPTY`/`MSG_FILE_INVALID`, `22023` `MSG_TOO_LONG`/`MSG_TOO_MANY_FILES`. Route lát 6 ánh xạ: CC409⇒409, CC404⇒404, CC422⇒422, 22023⇒400. Thân chỉ khoảng trắng/xuống dòng tính là rỗng.
- (lát 3) RLS bật KHÔNG FORCE (như `partner_links` 0117) — spec §4 ghi FORCE nhưng chủ hàm DEFINER sẽ bị chính policy hub_rw chặn; policy duy nhất `app.scope='system'`. 0147 cấp `SELECT` 4 bảng + `UPDATE(deleted_at)` cc_files cho hub_rw (việc nền dọn tệp), không INSERT/DELETE; `contracts_rw` chỉ EXECUTE hàm. `cc.msg` đã hợp CHECK `notifications_ck` ⇒ không đổi CHECK.
- (lát 3) `cc_send` trả `notify` = [{tenant_id, user_id}] mọi người Toàn quyền của CẢ HAI công ty (route phát `cc.msg` cho từng người, `tenant_id` khung = công ty kia); chuông chèn thẳng trong hàm, dedup `cc.msg:<thread>:<last_read_seq người nhận>`, `fanout_at=now()`. `message.created_at` là ISO của Postgres (`...+00:00`); `seq`, `size` trong jsonb là số, còn cột `seq`/`last_read_seq` bigint ra postgres.js là chuỗi ⇒ route `Number()`.
- (lát 3) `cc_file_add(p_other, p_user, p_id, p_name, p_mime, p_size, p_storage_key)`: route sinh id, `storage_key` bắt buộc = `<tenant bên tải>/<id>` (CHECK `cc_files_key_ck`); mime/đuôi/413/415 do route kiểm (DB chỉ kiểm tên 1..255, size 1..20 MB). Truyền `uuid[]` cho `cc_send`/`cc_unread`: dùng `array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::text::jsonb) x)` (như cách `::text::jsonb` của cc_notify).
- (lát 3) `hub.cc_links` thay thân (0146, cùng chữ ký): `unread` tính theo `app.user_id` (chưa đặt ⇒ 0), một câu, không đếm tin. Chưa đọc = `last_seq − last_read_seq`; người gửi tự coi là đã đọc tới tin mình (gửi trả lời cũng xoá chưa đọc cũ — chấp nhận).
- (lát 3) Việc nền dọn tệp chưa gắn sau 24 h (R11) chưa viết: index `cc_files_unbound_ix` + quyền `UPDATE(deleted_at)` đã sẵn; job thuộc lát 6.
- (PLAN) Kết nối suy ra từ `hub.partner_links` hai chiều, không bảng mới (G1). Ngắt = xoá 2 dòng chưa chặn.
- (PLAN) Số migration: hub 0145–0147 (hiện có tới 0144), community 0020 (hiện có tới 0019); community 0021 trả lại.

- (lát 1) Sự kiện `cc.msg`/`cc.link` thêm vào union `MeStreamMsgEventSchema` + `ME_STREAM_MSG_EVENTS` (messages.ts, cùng họ tin nhắn; chat-gate cho đi qua) thay vì union `MeStreamEvent` của rooms; schema dữ liệu định nghĩa ở company-connect.ts.

## Tranh chấp test
(trống)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED platform/partner-links.md
#### Yêu cầu: Lời mời kết nối độc lập, không cần hợp đồng (CR-161)
Ngoài đường cũ (gửi HĐ lần đầu tự kèm lời mời, một chiều), người Toàn quyền Sổ Hợp Tác tìm công ty đã bật Danh bạ và gửi lời mời kết nối kèm lời nhắn. Bên nhận đồng ý ⇒ hai công ty kết nối hai chiều (gửi HĐ đi thẳng cả hai phía); từ chối = chặn có sẵn, bên mời không gửi lại được. Kết nối = có quyền gửi cả hai chiều, không chặn.
- Kịch bản: khi Tiên mời Preschool đã bật Danh bạ thì Preschool có lời mời chờ và người Toàn quyền của Preschool nhận chuông, mời lại không tạo thêm [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]
- Kịch bản: khi công ty chưa bật Danh bạ thì mời bị từ chối 422 [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]
- Kịch bản: khi Dung đồng ý lời mời thì hai bên đều thấy «Đã kết nối» và gửi HĐ cho nhau không cần hỏi lại [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]
- Kịch bản: khi Dung từ chối thì Tiên thấy «Preschool đã từ chối lời mời» và mời lại bị 409 [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]
- Kịch bản: khi hai công ty mời chéo nhau thì lời mời thứ hai thành đồng ý ngay [test: apps/hub-api/src/modules/packs/contracts/connect/domain/connect.rules.test.ts » có lời mời ngược chờ ⇒ accept_reverse; apps/hub-api/src/modules/partners/connect-links.int.test.ts]
- Kịch bản: khi lời mời tới từ đường gửi HĐ cũ thì đồng ý vẫn chỉ mở một chiều như trước [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]

#### Yêu cầu: Ngắt kết nối
Một trong hai bên ngắt ⇒ mất quyền gửi HĐ đi thẳng cả hai chiều, mất xem bài của nhau; tin nhắn cũ giữ, chỉ đọc; nối lại phải mời mới.
- Kịch bản: khi Tiên ngắt kết nối thì cả hai thấy «Chưa kết nối», trò chuyện chỉ đọc, gửi tin bị 409 [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts; apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » sau ngắt chỉ đọc]
- Kịch bản: khi chưa kết nối mà gọi ngắt thì 409 không đổi dữ liệu [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]

#### Yêu cầu: Chỉ người Toàn quyền thao tác kết nối
Tìm, mời, đồng ý, từ chối, ngắt chỉ cho người có việc `admin` gói Sổ Hợp Tác; nhân viên thấy tình trạng nhưng không có nút.
- Kịch bản: khi Vy (nhân viên) gọi API mời/đồng ý/ngắt thì 403 và không đổi dữ liệu [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]
- Kịch bản: khi người Toàn quyền không phải người tạo công ty đồng ý lời mời thì thành công [test: apps/hub-api/src/modules/partners/connect-links.int.test.ts]

### ADDED sht/tro-chuyen-cong-ty.md
#### Yêu cầu: Trò chuyện giữa hai công ty đã kết nối
Mỗi cặp công ty một luồng chung trong tab «Trò chuyện» của trang đối tác; chỉ người Toàn quyền hai công ty thấy và nhắn; tin ≤ 4000 ký tự, ≤ 10 tệp ≤ 20 MB; tin mới báo chuông (một chuông chưa đọc mỗi luồng), không email.
- Kịch bản: khi Tiên nhắn kèm tệp thì Dung thấy tin + tệp tức thì và nhận một chuông [test: apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » R8 gửi tin, R9 chuông; apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » R11 tệp]
- Kịch bản: khi gửi lặp cùng mã thì chỉ có một tin và một chuông [test: apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » R8 gửi tin, R9 chuông; apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » đồng thời]
- Kịch bản: khi công ty thứ ba hoặc nhân viên thường đọc, gửi, tải tệp của luồng thì 404/403 và không thấy dòng nào [test: apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » công ty thứ ba không đọc/ghi luồng A–B; apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » kiểm đầu vào và quyền]
- Kịch bản: khi đã ngắt kết nối thì vẫn đọc được tin cũ, không gửi/tải lên được [test: apps/hub-api/src/modules/partners/cc-chat-db.int.test.ts » sau ngắt chỉ đọc, kết nối lại dùng chính luồng cũ]
- Kịch bản: khi luồng có 100.000 tin thì trang 50 tin p95 ≤ 20 ms và gửi tin p95 ≤ 40 ms [test: thủ công — chưa viết]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Công ty đã kết nối xem bài công khai của nhau (CR-161)
Ngoại lệ có chủ ý với «không kết nối trực tiếp giữa công ty»: người Toàn quyền của công ty đã kết nối (CR-161) xem được mọi bài chủ quản đang hiệu lực có người xem «tất cả» của công ty kia, bản đã che liên hệ, chỉ đọc; ngắt kết nối thì mất ngay.
- Kịch bản: khi Dung mở tab Bảng tin của NitiGroup thì thấy bài công khai còn hạn, không thấy bài giới hạn người xem, bài ẩn hay hết hạn [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts (phần DB; route + web: lát 5, 7)]
- Kịch bản: khi chưa hoặc đã ngắt kết nối thì xem bài bị 404 [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts (42501 ⇒ 404 ở route: lát 5)]
- Kịch bản: khi bài có số điện thoại thì công ty kết nối chỉ thấy bản đã che [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts]
