# CR-169 — Nhắn tin người–người giữa công ty đã kết nối (Tin nhắn + Chat AI, không trợ lý AI)

Nguồn: `docs/CHANGE-REQUESTS.md:7` (CR-169). Thay phần trò chuyện chung của CR-161 (`docs/specs/CR-161/spec.md` R8, R9 `cc.msg`, R11, §4 0146–0148). Mâu thuẫn có chủ ý (đã chốt): `docs/current/pack-contracts/tin-nhan.md:3` «tách hẳn chat-web» và CR-132 «chỉ trong cùng công ty» ⇒ nay Tin nhắn có người công ty đã kết nối và hiện cả trong chat-web (chung dữ liệu Tin nhắn, KHÔNG phải phòng X2a).

## 1. Phạm vi
| Làm | Không làm |
|---|---|
| 1–1 giữa nhân viên (nội bộ, có quyền đọc Sổ Hợp Tác) của 2 công ty đang kết nối, trong «Tin nhắn» | Nhóm nhiều công ty; gọi thoại; email/push/chuông cho tin |
| Đính kèm (CR-164 `AttachDraft`/`AttachGallery`), thu hồi, đã đọc/«Đã xem», realtime như CR-132 | Trợ lý AI đọc/gửi/tóm tắt tin (cấm) |
| Danh sách: gần đây trước; lọc Tất cả / công ty mình / từng công ty đã kết nối; tìm tên/chức vụ; tải dần | Lộ email, điện thoại, phòng ban của người công ty kia; user external |
| Xem Bảng tin công ty kia ngay trong Tin nhắn (khi lọc theo công ty đó) | Bình luận/Lưu báo giá trên bài công ty kia |
| Chat AI app (chat-web) có mục «Tin nhắn» cùng dữ liệu, cùng màn | Đổi luồng mời/đồng ý/ngắt của CR-161 (giữ, vẫn chỉ Toàn quyền) |
| Trang đối tác chỉ còn Tổng quan · Hợp đồng · Sổ việc & ghi chú; bỏ nút «Thao tác» | Backfill `cc_*` (chưa có dữ liệu thật — xoá, tạo lại) |

## 2. Chọn thiết kế (G1, ít khái niệm nhất)
Một khái niệm cho người dùng: **cuộc trò chuyện trong «Tin nhắn»**, kiểu `direct` | `group` | `partner`. Một màn, một danh sách, một khung chat, một họ sự kiện `msg.*`.
- **Lưu**: `direct`/`group` giữ nguyên `contracts.msg_*` (RLS theo tenant, CR-132). `partner` lưu ở bảng mới `hub.pmsg_*` (xuyên 2 tenant, chỉ qua hàm DEFINER — khuôn `cc_*` của CR-161: kiểm `hub.cc_connected`, FileBox, chỉ đọc sau ngắt). Mỗi cuộc trò chuyện nằm đúng một chỗ, không bản sao.
- **Vì sao không nới `msg_*` sang 2 tenant**: PK/FK/RLS của 4 bảng `msg_*` và mọi câu SQL CR-132 khoá `tenant_id = app.tenant_id`; tệp nằm `contracts.files` theo tenant. Nới ra = viết lại RLS + mọi query + tệp của mô-đun đang chạy (rủi ro cao, không đổi gì cho người dùng).
- **Vì sao không giữ `cc_*` chung**: CR đổi ngữ nghĩa từ «luồng 2 công ty» sang «1–1 người». Đổi khoá + đọc/chưa đọc 2 người + thu hồi ⇒ xoá `cc_*` (chưa dữ liệu) và tạo `pmsg_*` gọn, lấy lại khuôn hàm.
- **API**: tất cả dưới `/pack/contracts/messages/**` (một biên, một guard). Danh sách/chưa đọc trộn 2 nguồn trong **một câu SQL**. Thao tác trên cuộc `partner` đi `/messages/partner/:id/*` (cùng contract thân/kết quả với `direct`); web chọn đường theo `kind`.
- **Web**: chuyển `apps/workspace-web/src/features/messages` thành gói nội bộ `packages/messages-web` (transport + nhãn tiêm vào, khuôn `web-kit/notify`), workspace-web và chat-web cùng gắn. Không thêm thư viện ngoài (cả hai app đã có react-query, react-i18next).

## 3. Luật nghiệp vụ (if/else — QC test theo đây)
Ký hiệu: A = công ty người gọi (`app.tenant_id`), u = người gọi (`app.user_id`), B = công ty kia. `connected(A,B)` = `hub.cc_connected` (CR-161, một nguồn).
**Người hợp lệ** `eligible(T, v)` ⇔ v là thành viên active, `user_kind <> 'external'`, có quyền `read` gói `contracts` của T (cùng nguồn grant `packAccessInput`).

| # | Luật | Điều kiện ⇒ kết quả |
|---|---|---|
| P1 | Ai dùng | Route `/messages/**`: `packGuard(read,"contracts")`; external ⇒ 403 `PACK_FORBIDDEN` (như cũ). Hàm DEFINER: thiếu `app.tenant_id`/`app.user_id` hoặc `NOT eligible(A,u)` ⇒ 42501. |
| P2 | Mở 1–1 | `POST /messages/conversations {kind:"partner", tenant_id:B, user_id:v}`: `tenant_id = A` ⇒ 422 `MSG_USER_INVALID` (cùng công ty dùng `kind:"direct"`); `NOT connected(A,B)` ⇒ 409 `MSG_NOT_CONNECTED`; `NOT eligible(B,v)` ⇒ 422 `MSG_USER_INVALID`; đã có cuộc của cặp (A,u)–(B,v) ⇒ trả cuộc cũ (`created:false`); khác ⇒ tạo. Không chèn tin. |
| P3 | Đọc | u là một trong 2 đầu của cuộc (kể cả đã ngắt) ⇒ đọc trang tin, chi tiết, tệp. Khác ⇒ 404 `MSG_NOT_FOUND` (không lộ). |
| P4 | Gửi / tải lên | Chỉ khi `connected(A,B)` **và** `eligible(B,v)`. Không kết nối ⇒ 409 `MSG_NOT_CONNECTED`; người kia không còn hợp lệ ⇒ 409 `MSG_PEER_INACTIVE` (mã cũ). Tin: `body` 0–4000, ≤ 10 tệp, rỗng chỉ khi có tệp (`MSG_EMPTY`); gửi lặp cùng `client_id` ⇒ tin cũ, không tăng `seq`, không phát lại. |
| P5 | Thu hồi | Chỉ người gửi, mọi lúc (cả sau ngắt): `body=''`, `files=[]`, `deleted_at=now()`, tệp đánh dấu xoá + gỡ byte FileBox; không tính chưa đọc. Khác ⇒ 403 `MSG_NOT_SENDER`. |
| P6 | Đã đọc | Mốc chỉ tiến, kẹp ≤ `last_seq` (`clampRead` CR-132). «Đã xem» = mốc của đầu kia. |
| P7 | Chỉ đọc | `read_only = NOT connected(A,B) OR NOT eligible(B,v)`; tính lúc đọc (không lưu). UI: ẩn ô soạn + câu lý do (§8). Nối lại ⇒ dùng lại đúng cuộc cũ. |
| P8 | Danh bạ người | `GET /messages/people?company=`: `own` ⇒ người A (như CR-132, có phòng ban); `<uuid B>` ⇒ chỉ khi `connected(A,B)`, khác ⇒ trang rỗng (không lỗi, không lộ); `all` ⇒ A ∪ mọi B đang kết nối. Trường người công ty kia: `id, name, job_title, company{id,name}`, `department:null`. Không trả email/điện thoại. Loại chính u. `q`: khớp tên **hoặc** chức vụ, không phân biệt hoa/dấu. |
| P9 | Danh sách cuộc | `company=all` (mặc định) ⇒ `direct`+`group`+`partner`; `own` ⇒ `direct`+`group`; `<uuid B>` ⇒ `partner` có đầu kia thuộc B (kể cả đã ngắt). Thứ tự `(last_at DESC, id DESC)`, cursor keyset. |
| P10 | Danh sách công ty | `GET /messages/companies` ⇒ công ty đang kết nối với A (`id`, `name`), theo tên, cursor. Công ty đã ngắt ⇒ không có chip; cuộc cũ vẫn ở «Tất cả» (câu mở 8). |
| P11 | Bảng tin công ty kia | `GET /connect/posts/:tenant_id` (CR-161 R10) đổi guard `admin` ⇒ `read` (mọi nhân viên nội bộ); luật lọc/che giữ nguyên. Ngắt ⇒ 404. |
| P12 | Trợ lý AI | Không tool/agent nào đọc/gửi tin. Hàm `pmsg_*` chỉ GRANT `hub_rw`, `contracts_rw`. Route `/messages/**` chỉ phiên người dùng (JWT người; không có đường agent tới). Chat-web: nội dung Tin nhắn không vào ngữ cảnh trợ lý (không đưa vào composer/answer context). |
| P13 | Thông báo | Như CR-132: chỉ số chưa đọc + realtime; **không chuông**. Bỏ chuông `cc.msg` (xoá hàng cũ ở 0149). |
| P14 | Ngắt kết nối | CR-161 R6 giữ; hệ quả mới: mọi cuộc `partner` của cặp thành chỉ đọc ngay (P7) + phát `cc.link` (có sẵn) để UI làm mới. |

**Hàm thuần** — `apps/hub-api/src/modules/packs/contracts/messages/domain/partner.rules.ts` (QC test trước; SQL trong DEFINER là nơi thi hành thật, ghi «trùng partner.rules.ts» trong migration):
```ts
export type PartnerEnd = { tenantId: string; userId: string };
export function partnerPair(x: PartnerEnd, y: PartnerEnd): { a: PartnerEnd; b: PartnerEnd };   // sắp (tenant,user) tăng; x.tenantId===y.tenantId ⇒ throw
export function partnerReadOnly(connected: boolean, peerEligible: boolean): boolean;            // P7
export function partnerSendError(connected: boolean, peerEligible: boolean): null | "MSG_NOT_CONNECTED" | "MSG_PEER_INACTIVE"; // P4, thứ tự này
export type CompanyFilter = { kind: "all" } | { kind: "own" } | { kind: "company"; tenantId: string };
export function parseCompanyFilter(raw: string | undefined, ownTenant: string): CompanyFilter;  // vắng/"all" ⇒ all; "own" hoặc = ownTenant ⇒ own; uuid ⇒ company; khác ⇒ throw ZodError ở biên
export function sourcesOf(f: CompanyFilter): { internal: boolean; partner: boolean };           // P9
```

## 4. API (zod: `packages/contracts/src/pack-contracts/messages.ts`; mọi schema mới `z.strictObject`)
Đổi contract có sẵn (đúng từng trường):
- `ConvKindSchema = z.enum(["direct","group","partner"])`.
- `PeerSchema += job_title: z.string().max(80).nullable()`.
- `ConversationSummarySchema += company: z.object({id: z.uuid(), name: z.string().max(200)}).nullable()` (chỉ `partner`: công ty đầu kia; còn lại null) `+ read_only: z.boolean()` (`direct`/`group` luôn false). `member_count` `partner` = 2.
- `CreateConversationRequestSchema` union thêm `z.strictObject({kind: z.literal("partner"), tenant_id: z.uuid(), user_id: z.uuid()})`.
- `MsgConversationsQuerySchema += company: z.string().max(40).optional()` (vào `parseCompanyFilter`; sai dạng ⇒ 400 `VALIDATION`).
- `MsgPeopleQuerySchema += company` (cùng kiểu). `MsgPersonSchema += job_title: string(≤80)|null, company: {id,name}` (`own` cũng trả `company` = A).
- `MSG_ERRORS += MSG_NOT_CONNECTED: 409`.
- `ME_STREAM_MSG_EVENTS`: bỏ `"cc.msg"`; giữ `"cc.link"`.
- Mới: `MsgCompanySchema = {id: uuid, name: string≤200}`, `MsgCompaniesQuerySchema = {cursor?: string≤200, limit: coerce int 1..50 default 30}`, `MsgCompanyPageSchema = {items: MsgCompany[], next_cursor: string|null}`.
- `company-connect.ts`: bỏ schema trò chuyện (`CcThreadPage`, `CcSend*`, `CcFile*`, `CcMessage`); `CcLink` bỏ `unread`.

| Phương thức + đường (`/pack/contracts`) | Vào | Ra | Lỗi |
|---|---|---|---|
| `GET /messages/conversations` | `MsgConversationsQuery` (+company) | `ConversationPage` | 400 |
| `POST /messages/conversations` (kind partner) | như trên | 201 `ConversationDetail` / 200 nếu đã có | 409 `MSG_NOT_CONNECTED`, 422 `MSG_USER_INVALID` |
| `GET /messages/unread` | — | `UnreadResponse` (msg + pmsg, kẹp 999) | — |
| `GET /messages/people` | `MsgPeopleQuery` (+company) | `MsgPeoplePage` | 400 |
| `GET /messages/companies` | `MsgCompaniesQuery` | `MsgCompanyPage` | 400 |
| `GET /messages/partner/:id` | — | `ConversationDetail` (members 2, `my_role:"member"`) | 404 |
| `GET /messages/partner/:id/messages` | `MsgListQuery` | `MessagePage` | 404 |
| `POST /messages/partner/:id/messages` | `SendMessageRequest` | 201/200 `Message` | 404, 409 `MSG_NOT_CONNECTED`/`MSG_PEER_INACTIVE`, 400 `MSG_EMPTY`, 422 `MSG_FILE_INVALID` |
| `DELETE /messages/partner/:id/messages/:seq` | — | 204 | 404, 403 `MSG_NOT_SENDER` |
| `POST /messages/partner/:id/read` | `MarkReadRequest` | `MarkReadResponse` | 404 |
| `POST /messages/partner/:id/files` | multipart 1 tệp ≤ 20 MB, `ATTACH_ALLOWED` | 201 `FileRef` | 404, 409, 413, 415 |
| `GET /messages/partner/:id/files/:fileId/link` | — | `{url}` (FileBox ngắn hạn, cùng dạng route `direct`) | 404 |
| `GET /connect/posts/:tenant_id` | (CR-161) | (CR-161) | guard đổi `read` |
Bỏ: `/connect/threads/**`, `/connect/files/**`. Cursor danh sách: base64url `{t: iso, id: uuid}` dùng chung hai nguồn (`messages.view.ts` `decodeCursor` có sẵn).

## 5. Dữ liệu (hub, Postgres)
**hub 0149 `cr169_pmsg.sql`** — (1) `DROP` hàm `hub.cc_thread_page, cc_send, cc_mark_read, cc_file_add, cc_file_get, cc_unread, cc_files_sweep, cc_thread_ensure, cc_msg_json` + bảng `hub.cc_files, cc_reads, cc_messages, cc_threads` (kiểm `pg_depend`: `cc_ctx`/`cc_links` còn dùng thì giữ `cc_ctx`, `cc_links` DROP+CREATE bỏ cột `unread`); `DELETE FROM hub.notifications WHERE kind = 'cc.msg'`. (2) Bảng:

| Bảng | Cột (kiểu, null, default) | Khoá / index / xoá |
|---|---|---|
| `hub.pmsg_threads` | `id uuid PK default gen_random_uuid()`, `a_tenant uuid NN`, `a_user uuid NN`, `b_tenant uuid NN`, `b_user uuid NN`, `last_seq bigint NN 0`, `last_at timestamptz NN now()`, `a_read_seq bigint NN 0`, `b_read_seq bigint NN 0`, `created_at timestamptz NN now()` | `CHECK (a_tenant <> b_tenant)`, `CHECK ((a_tenant,a_user) < (b_tenant,b_user))`, `UNIQUE (a_tenant,a_user,b_tenant,b_user)`; index `(a_tenant,a_user,last_at DESC,id DESC)`, `(b_tenant,b_user,last_at DESC,id DESC)` |
| `hub.pmsg_messages` | `thread_id uuid NN`, `seq bigint NN`, `id uuid NN default gen_random_uuid()`, `sender_user uuid NN`, `body text NN ''` (≤4000), `files jsonb NN '[]'` (FileRef[], ≤10), `client_id uuid NN`, `created_at timestamptz NN now()`, `deleted_at timestamptz NULL` | PK `(thread_id,seq)`; `UNIQUE (thread_id,sender_user,client_id)`; `UNIQUE (id)`; FK thread `ON DELETE CASCADE` |
| `hub.pmsg_files` | `id uuid PK`, `thread_id uuid NN`, `tenant_id uuid NN` (bên tải), `user_id uuid NN`, `name text NN` 1..255, `mime text NN` 1..100, `size bigint NN` 1..20 MB, `storage_key text NN` (`'<tenant>/<id>'`), `box_file_id text NN` CHECK `^[A-Za-z0-9_-]{1,64}$`, `seq bigint NULL`, `created_at NN now()`, `deleted_at NULL` | FK thread cascade; index `(thread_id,seq)`; một phần `(created_at) WHERE seq IS NULL AND deleted_at IS NULL`; một phần `(user_id) WHERE seq IS NULL AND deleted_at IS NULL` |

RLS: bật (không FORCE) 3 bảng, chỉ policy `app.scope='system'` cho hub_rw (khuôn 0146). Không người dùng nào đọc bảng trực tiếp.
(3) Hàm DEFINER (search_path cố định, REVOKE PUBLIC), đọc `app.tenant_id`/`app.user_id` qua `hub.pmsg_ctx()` (nội bộ: P1 ⇒ 42501), **id người dùng không là tham số**:
- `pmsg_open(p_tenant uuid, p_user uuid) → (id uuid, created bool)` — P2; khoá `pg_advisory_xact_lock` cặp tenant (cùng khoá `cc_invite`/`cc_disconnect`) + `INSERT … ON CONFLICT DO NOTHING RETURNING`.
- `pmsg_inbox(p_company uuid, p_cur_t timestamptz, p_cur_id uuid, p_limit int) → setof (id, peer_user, peer_name, peer_title, peer_active, company_id, company_name, last jsonb, unread int, last_at, read_only bool)` — limit kẹp 1..51; `unread` = số tin `seq > mốc đọc của u`, `sender_user <> u`, `deleted_at IS NULL`, đếm trong subquery `LIMIT 100` trên PK (kẹp 100 như CR-132; thu hồi tin chưa đọc ⇒ số giảm); `p_company` null = mọi công ty.
- `pmsg_detail(p_id) → row` (như inbox + `peer_read_seq`, `my_read_seq`). `pmsg_page(p_id, p_before bigint, p_limit int) → (items jsonb, has_more bool)` kẹp 1..100.
- `pmsg_send(p_id, p_client_id, p_body, p_file_ids uuid[]) → (seq, created, message jsonb, notify jsonb)` — `FOR UPDATE` dòng thread, P4, gắn tệp `= any(p_file_ids)` (của chính u, cùng thread, chưa gắn), tiến mốc đọc người gửi; `notify` = `[{tenant_id,user_id}]` 2 đầu.
- `pmsg_delete(p_id, p_seq) → (box_ids text[])` P5. `pmsg_mark_read(p_id, p_seq) → bigint` P6. `pmsg_unread() → int` (cùng luật đếm, kẹp 999).

**hub 0150 `cr169_pmsg_files_people.sql`** — `pmsg_file_add(p_id, p_file_id, p_box_id, p_name, p_mime, p_size, p_storage_key) → jsonb` (P4, ≤ 50 tệp chưa gắn/người ⇒ `MSG_FILE_INVALID`), `pmsg_file_get(p_id, p_file_id) → (storage_key, box_file_id)` (P3; tệp chưa gắn chỉ người tải), `pmsg_files_sweep(p_older interval)` (chỉ system, ≥ 1 h), `pmsg_people(p_tenants uuid[], p_q text, p_cur_name text, p_cur_id uuid, p_limit int) → setof (user_id, name, job_title, tenant_id, company_name)` (lọc `p_tenants` ∩ ({A} ∪ connected), bỏ im lặng phần còn lại; keyset `(lower(unaccent(name)), id)` theo khuôn `kit/adapters/directory-page.ts`), `pmsg_companies(p_cur_name text, p_cur_id uuid, p_limit int)` (P10). Phòng ban người A: route `own` dùng nguồn `directory-page.ts` có sẵn; `all` gộp trong `pmsg_people` (department chỉ trả cho người A — join cùng nguồn).
**hub 0151 `cr169_pmsg_grants.sql`** — GRANT EXECUTE hàm công khai cho `hub_rw` + `contracts_rw` (khối DO), SELECT bảng cho hub_rw (system). Không cấp cho role khác (P12).
**pack-contracts 0118 `cr169_pmsg_grants.sql`** — cấp lại `contracts_rw` (USAGE `hub` + EXECUTE hàm 0149/0150) vì khối DO của hub bị bỏ trên DB dựng sạch (khuôn 0116).
**Không** đổi community (guard bài là ở route). Seed chung không đổi. Purge công ty (`tools/scripts/src/tenant-purge.partner.ts` `anonymizeChat` ⇒ `purgePartnerMessages`): tệp `pmsg_files` do công ty bị xoá tải ⇒ soft delete + gỡ byte FileBox (theo lô, một câu `UPDATE … RETURNING`); tin của công ty bị xoá: `body=''`, `files='[]'`, `deleted_at=now()` (một câu); thread giữ (đầu kia thấy «Công ty đã xoá», chỉ đọc vì không còn kết nối); bỏ `scrubChatBells` `cc.msg`.

## 6. Hiệu năng (N7, CONVENTIONS §6)
| Thao tác | Ngưỡng p95 (dữ liệu) | Số câu SQL | Index |
|---|---|---|---|
| Danh sách 30 cuộc, `all` | ≤ 50 ms (200 `msg` + 200 `pmsg` cuộc, 100.000 tin mỗi nguồn) | 1 (CTE `msg` keyset LIMIT n+1 `UNION ALL` `pmsg_inbox` LIMIT n+1, ORDER/LIMIT ngoài) | `msg_conversations_recent_idx`; `pmsg_threads (a|b_tenant,a|b_user,last_at DESC,id DESC)` |
| Tổng chưa đọc | ≤ 20 ms | 1 (`SELECT least(msg_total + hub.pmsg_unread(), 999)`) | như trên |
| Trang 50 tin `partner` | ≤ 20 ms | 1 | PK `(thread_id,seq)` |
| Gửi `partner` | ≤ 40 ms | 1 hàm + 1 pipeline Redis publish 2 người | PK, UNIQUE client |
| Danh bạ 30 người, `all` | ≤ 40 ms (5.000 người / 50 công ty) | 1 (`pmsg_people`, tenant `= any(array)`) | membership `(tenant_id,user_id)`, trigram tên nếu đã có (kiểm khi làm) |
| Danh sách công ty | ≤ 20 ms (500 kết nối) | 1 | PK `partner_links` |
Luật: không SQL theo hàng; tên/ chức vụ/ công ty lấy theo lô trong hàm (join, không vòng lặp); SQL văn bản cố định; không sleep/poll (realtime đẩy). **Chạm đường nóng cũ** (`GET /messages/conversations`, `/messages/unread` của CR-132) ⇒ đầu lát api-list đo `messages.perf.int.test.ts` (số trước) rồi ghi số trước → sau vào `tasks.md`. Test: `messages.perf.int.test.ts` (sửa, thêm nguồn pmsg) + `pmsg.perf.int.test.ts` (mới). Xoá `connect/connect.perf.int.test.ts` phần trò chuyện.

## 7. Realtime
Phát sau commit qua port publish có sẵn của messages, một pipeline/lô: `msg.new {conversation_id, message}`, `msg.deleted`, `msg.read {conversation_id,user_id,seq}`, `msg.conversation {conversation_id, change:"added"}` (khi `pmsg_open` tạo mới — cho đầu kia). Người nhận = 2 đầu (cả tab khác của người gửi); khử trùng như `messages.events.ts`. Gửi lặp không phát. `cc.link` (CR-161) giữ — web làm mới danh sách để `read_only` đúng. Chat-web nhận cùng `/me/stream` (đã có `features/realtime`), định tuyến `msg.*` vào gói `messages-web`.

## 8. Giao diện (2 nơi, cùng component `packages/messages-web`)
| Trạng thái | Hiện |
|---|---|
| Thanh lọc | Chip «Tất cả» · «<Tên công ty mình>» · từng công ty đã kết nối (≥ 6 ⇒ chip «Công ty khác ▾» mở danh sách có tìm + tải dần) |
| Danh sách | Cuộc gần đây trước; dòng `partner` có tên người · chức vụ · **tên công ty** (nhãn phụ); chưa đọc như CR-132 |
| Tìm | Ô «Tìm người theo tên, chức vụ»: hiện cuộc khớp + mục «Người» (từ `/messages/people`, tải dần khi cuộn); bấm người ⇒ mở 1–1 (`partner` nếu khác công ty) |
| Lọc theo 1 công ty | Đầu danh sách có nút «Bảng tin <Công ty>» ⇒ khung bài công khai (đã che, chỉ đọc; component `ConnectedFeedTab` chuyển vào gói) |
| Chỉ đọc | Thay ô soạn: «<Công ty> không còn kết nối với công ty bạn. Bạn vẫn xem được tin cũ.» / người kia rời: «<Tên> không còn dùng Sổ Hợp Tác ở <Công ty>.» |
| Đang tải / lỗi / rỗng | Như CR-132; rỗng khi lọc công ty: «Chưa nhắn với ai ở <Công ty>. Tìm người để bắt đầu.» |
| workspace-web | Trang «Tin nhắn» + khoang trợ lý tab «Tin nhắn» (giữ CR-132) |
| chat-web | Mục «Tin nhắn» trên thanh bên (chỉ khi người dùng có quyền đọc SHT), số chưa đọc; mở màn cùng component; tách hẳn khung trợ lý (P12) |
| Trang đối tác | Tab: Tổng quan · Hợp đồng · Sổ việc & ghi chú; bỏ «Bảng tin», «Trò chuyện», «Bảng tin công ty»; bỏ menu «Thao tác» — «Sửa liên hệ» thành nút chữ cạnh khối liên hệ (chỉ người có quyền ghi). URL `?tab=chat|feed|community` cũ ⇒ về Tổng quan |
| Khối «Công ty đã kết nối» (CR-161) | Bỏ số chưa đọc; mỗi công ty có nút «Nhắn tin» ⇒ `/messages?company=<id>` |

## 9. Quyết định / câu hỏi
Câu mở (mặc định đề xuất — dùng nếu không trả lời):
1. Tin `partner` có chuông không? — **Không** (như Tin nhắn CR-132, chỉ số chưa đọc). Bỏ `cc.msg`.
2. Thu hồi tin `partner`? — **Có**, như `direct` (một control, G2).
3. Người công ty kia lộ gì? — **Tên, chức vụ, tên công ty**; không email, điện thoại, phòng ban.
4. Ai xem Bảng tin công ty kia? — **Mọi nhân viên nội bộ có quyền đọc SHT** (trước: chỉ Toàn quyền). Tìm/mời/ngắt vẫn chỉ Toàn quyền.
5. Người công ty kia không có quyền SHT có trong danh bạ không? — **Không** (không có nơi nhận tin).
6. Gói web chung `packages/messages-web` (nội bộ, không thư viện mới) thay vì chép UI sang chat-web — **Có**.
7. Bỏ «Thao tác» thì «Sửa liên hệ» ở đâu? — **Nút chữ cạnh khối liên hệ**.
8. Chip «Công ty cũ» (đã ngắt) để lọc? — **Không ở v1**; cuộc cũ vẫn ở «Tất cả».
