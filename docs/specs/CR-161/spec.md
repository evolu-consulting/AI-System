# CR-161 — Kết nối hai công ty, không cần hợp đồng

Nguồn: `docs/CHANGE-REQUESTS.md` dòng CR-161 · bản mẫu `prototype.json` (người dùng «đồng ý hết» 5 câu ⇒ lấy đúng `default`).
Mâu thuẫn có chủ ý (đã chốt): `docs/current/platform/partner-links.md:8` (lời mời chỉ sinh khi gửi HĐ) và `docs/current/community/nghiep-vu.md:25` (không kết nối trực tiếp giữa công ty) ⇒ thêm đường mời độc lập + trò chuyện công ty↔công ty + xem bài Bảng tin của nhau.

## 1. Phạm vi
| Làm | Không làm |
|---|---|
| Tìm công ty (tên/MST, chỉ công ty bật Danh bạ) + «Gửi lời mời kết nối» kèm lời nhắn | Email (mọi bước chỉ chuông, q-e) |
| Bên nhận: chuông + băng lời mời ⇒ Đồng ý / Từ chối (= chặn có sẵn) | Nhân viên thường thấy/nhắn trò chuyện (q-a: chỉ Toàn quyền) |
| Đã kết nối: hiện trong Đối tác, gửi HĐ đi thẳng (hai chiều) | Thu hồi/sửa tin, nhóm nhiều công ty, gọi thoại |
| Tab «Trò chuyện» trong trang đối tác (q-d): một luồng chung cho 2 công ty, đính kèm tệp | Chọn bài chia sẻ riêng cho đối tác (q-b: mọi bài công khai) |
| Xem bài Bảng tin công khai của công ty đã kết nối (chỉ đọc) | Bình luận/Lưu báo giá trên bài của công ty kết nối |
| «Ngắt kết nối»: tin cũ giữ, chỉ đọc (q-c); nối lại = lời mời mới | Đổi đường cũ «gửi HĐ lần đầu tự kèm lời mời» (giữ nguyên) |

## 2. Luật nghiệp vụ (if/else — QC viết test theo đây)
Ký hiệu: A = công ty đang thao tác (`app.tenant_id`), B = công ty kia. Dòng `hub.partner_links (from,to)` có sẵn = «from được gửi HĐ cho to».

**Định nghĩa một nguồn (G1):** `connected(A,B)` ⇔ có cả dòng (A→B) và (B→A), cả hai `accepted_at IS NOT NULL` và `blocked_at IS NULL`. Không thêm bảng «kết nối» riêng; trạng thái kết nối luôn suy ra từ `partner_links`.

| # | Luật | Điều kiện ⇒ kết quả |
|---|---|---|
| R1 | Ai thao tác | Mọi thao tác CR-161 (tìm, mời, đồng ý, từ chối, ngắt, xem/nhắn trò chuyện, xem bài) chỉ cho user có việc `admin` của gói `contracts` (= nhóm «Sổ Hợp Tác – Toàn quyền», `packGuard(view,"contracts","admin")`). Khác ⇒ 403 `PACK_FORBIDDEN`, 0 SQL nghiệp vụ. |
| R2 | Tìm công ty | `q` trim, MST đúng 10/13 số hoặc tên ≥ 3 ký tự; chỉ `admin.tenants.active AND directory_listed`, loại chính A; ≤ 20 dòng; mỗi dòng kèm `status` theo R7. |
| R3 | Gửi lời mời | B không bật Danh bạ hoặc không active ⇒ 422 `CONNECT_NOT_LISTED`. B==A ⇒ 400. `connected` ⇒ trả `connected`, không đổi gì. Dòng (A→B) đang `blocked_at` (B đã từ chối/chặn) ⇒ 409 `CONNECT_DECLINED`, không đổi gì. Đã có lời mời chờ (A→B `connect_requested_at` not null) ⇒ trả `pending`, không đổi (idempotent). Có lời mời ngược chờ (B→A `connect_requested_at` not null) ⇒ coi như A đồng ý (R4) ⇒ `connected`. Còn lại ⇒ upsert (A→B): `requested_at = coalesce(requested_at, now())`, `connect_requested_at = now()`, `connect_note`, `connect_by = user`; A từng chặn B trên dòng (B→A) ⇒ gỡ chặn của A (A chủ động mời). Gửi chuông cho người Toàn quyền của B (R9). **Chặn-trước (lát 5):** B đã chặn A khi A chưa từng mời (dòng A→B có `blocked_at`, không có `requested_at`) ⇒ trả `pending_out` nhưng KHÔNG ghi gì và không chuông/stream cho B (giữ «không lộ» của 0118); A tải lại thấy «chưa kết nối» (không có trạng thái lưu phía A). |
| R4 | Đồng ý | Chỉ B (bên nhận) qua `hub.partner_link_accept(A)` (hàm có sẵn, thay thân). Không có dòng (A→B) ⇒ 42501 như cũ. Dòng có `connect_requested_at` ⇒ trong **một câu lệnh**: (A→B) `accepted_at=coalesce(..,now())`, `blocked_at=null`, `connect_requested_at=null`; upsert (B→A) `requested_at=coalesce(..,now())`, `accepted_at=coalesce(..,now())`, `blocked_at=null` ⇒ `connected`. Dòng không có `connect_requested_at` (đường cũ HĐ) ⇒ hành vi cũ, chỉ một chiều. Chuông «đã đồng ý» cho người mời (`connect_by`). |
| R5 | Từ chối | = `hub.partner_link_block(A)` có sẵn (thêm: xoá `connect_requested_at`). A thấy `declined`, không gửi lại được (R3). Không chuông cho A (tránh quấy rầy; A thấy trạng thái khi mở Tìm công ty). |
| R6 | Ngắt kết nối | Chỉ khi `connected(A,B)`; khác ⇒ 409 `CONNECT_NOT_CONNECTED`. Xoá cả hai dòng (A→B),(B→A) có `blocked_at IS NULL` (một câu `DELETE … WHERE (from,to) IN (…)`). Hệ quả: mất quyền gửi HĐ đi thẳng hai chiều (đường cũ tự kèm lời mời lại khi gửi HĐ). Luồng trò chuyện giữ, thành chỉ đọc (R8). Ghi `audit` một dòng. Chuông cho người Toàn quyền của B. |
| R7 | Trạng thái nhìn từ A | `connected` (R-định nghĩa) · `pending_out` (A→B có `connect_requested_at`) · `pending_in` (B→A có `connect_requested_at`) · `declined` (A→B `blocked_at` not null **và** `requested_at` not null — giữ quy tắc «chặn trước không lộ» của 0118) · `none`. Thứ tự ưu tiên đúng như liệt kê. |
| R8 | Trò chuyện | Một luồng duy nhất cho cặp (min(A,B), max(A,B)), tạo lười ở tin đầu. Đọc: A thuộc cặp (kể cả đã ngắt). Gửi: chỉ khi `connected`; khác ⇒ 409 `CONNECT_READ_ONLY`. Tin: `body` 0–4000 ký tự, ≤ 10 tệp, `body` rỗng chỉ khi có tệp. Gửi lặp cùng `client_id` ⇒ trả tin cũ, không tăng `seq`, không chuông lặp. |
| R9 | Chuông (không email) | Người nhận = mọi user nội bộ active có việc `admin` gói `contracts` của công ty nhận (cùng nguồn grant mà `packAccessInput` đọc). Loại: `cc.invite` (lời mời), `cc.accepted`, `cc.disconnected`, `cc.msg`. `cc.msg` khử trùng: `dedup_key = 'cc.msg:'||thread||':'||last_read_seq_của_người_nhận` ⇒ tối đa một chuông chưa đọc mỗi luồng mỗi người tới khi họ đọc. Không chuông cho chính người gửi/cùng công ty người gửi. |
| R10 | Xem bài Bảng tin | Chỉ khi `connected(A,B)` (ngắt ⇒ mất ngay). Bài của B: `author_org IS NULL AND aud_mode='all' AND status='active' AND NOT hidden AND expires_at > now()` (q-b «mọi bài công khai»). Trả bản **đã che** (`title_masked`, `body_masked`, `fields_masked`) — giữ luật chống đi tắt D4. B không bật gói Bảng tin ⇒ danh sách rỗng (không lỗi). |
| R11 | Tệp | Tải lên ≤ 20 MB, đuôi theo danh sách chung của tin nhắn SHT; chỉ người Toàn quyền của 2 công ty trong cặp tải xuống; tệp chưa gắn tin sau 24 h bị dọn bởi việc nền có sẵn kiểu tệp tin nhắn. |

**Hàm thuần** (`apps/hub-api/src/modules/packs/contracts/connect/domain/connect.rules.ts`, QC test trước):
```ts
export type LinkPair = { out: LinkRow | null; in: LinkRow | null }; // out = A→B, in = B→A
export type LinkRow = { requested_at: string|null; accepted_at: string|null; blocked_at: string|null; connect_requested_at: string|null };
export type ConnectStatus = "connected" | "pending_out" | "pending_in" | "declined" | "none";
export function connectStatusOf(p: LinkPair): ConnectStatus;                         // R7
export function inviteOutcome(p: LinkPair, listed: boolean): "invite" | "accept_reverse" | ConnectStatus | "not_listed"; // R3
export function canSendChat(s: ConnectStatus): boolean;                               // R8
export function validateChatMessage(body: string, fileCount: number): null | "MSG_EMPTY" | "MSG_TOO_LONG" | "MSG_TOO_MANY_FILES";
export function ccDedupKey(threadId: string, lastReadSeq: number): string;           // R9
export function pairOf(a: string, b: string): { lo: string; hi: string };            // R8
```
SQL trong hàm DEFINER là nơi thi hành thật; hàm thuần trùng logic để UI/route dùng và để test nhanh (ghi chú «trùng `connect.rules.ts`» trong migration như 0001 community).

## 3. API (zod: `packages/contracts/src/pack-contracts/company-connect.ts`, mọi schema `z.strictObject`)
Gốc `/pack/contracts`. Mọi route `packGuard(view,"contracts","admin")` trước đọc thân. Thân/query sai ⇒ 400; lỗi nghiệp vụ trả `{ code }`.

| Method · path | Vào | Ra 200 | Lỗi |
|---|---|---|---|
| GET `/connect/search?q=` | `ConnectSearchQuery {q: string trim 3..120}` | `{items: ConnectCompany[]}` (≤ 20) | 400 |
| POST `/connect/invites` | `ConnectInviteBody {tenant_id: uuid, note?: string trim ≤ 500}` | `{status: ConnectStatus}` | 422 `CONNECT_NOT_LISTED`, 409 `CONNECT_DECLINED`, 400 |
| POST `/connect/links/:tenant_id/accept` · `/decline` | — (`:tenant_id` = công ty mời) | `{ok:true}` | 404 (42501, không lộ) · 400 id sai |
| POST `/partner/invites/:from/accept` · `/block` | (có sẵn, giữ nguyên; sau cổng tính năng `contracts-partner-confirm`) | `{ok:true}` | 42501⇒404 như cũ |
| DELETE `/connect/links/:tenant_id` | — | `{ok:true}` | 409 `CONNECT_NOT_CONNECTED` |
| GET `/connect/links?cursor=&limit=` | `ConnectListQuery {cursor?: string ≤ 200, limit: int 1..50 = 20, status?: "connected"\|"pending_in"\|"pending_out"}` | `{items: ConnectLink[], next_cursor: string\|null}` | 400 |
| GET `/connect/threads/:tenant_id/messages?before=&limit=` | `{before?: int ≥ 1, limit: int 1..100 = 50}` | `{items: CcMessage[], next_before: number\|null, read_only: boolean, last_read_seq: number}` | 404 `CONNECT_NO_THREAD` khi chưa từng kết nối |
| POST `/connect/threads/:tenant_id/messages` | `CcSendBody {client_id: uuid, body: string ≤ 4000 = "", file_ids: uuid[] ≤ 10 = []}` | `{message: CcMessage, created: boolean}` | 409 `CONNECT_READ_ONLY`, 422 `MSG_EMPTY`/`MSG_FILE_INVALID` |
| POST `/connect/threads/:tenant_id/read` | `{seq: int ≥ 0}` | `{last_read_seq: number}` | — |
| POST `/connect/threads/:tenant_id/files` | multipart `file` | `{file: CcFile}` | 409 `CONNECT_READ_ONLY`, 413, 415 |
| GET `/connect/files/:file_id` | — | 302 tới link ký hạn 5 phút | 404 (không lộ có/không) |
| GET `/connect/posts/:tenant_id?cursor=&limit=` | `{cursor?: string ≤ 200, limit: 1..50 = 20}` | `{items: CcPost[], next_cursor: string\|null}` | 404 `CONNECT_NOT_CONNECTED` |

Kiểu ra:
- `ConnectCompany {tenant_id: uuid, legal_name: string, tax_code: string, verified: boolean, status: ConnectStatus}`
- `ConnectLink {tenant_id, legal_name, tax_code, verified, status: ConnectStatus, note: string|null, invited_by_name: string|null, since: iso, unread: int ≥ 0}` — `unread` chỉ cho `connected`/đã ngắt có luồng.
- `CcMessage {seq: int, sender_tenant: uuid, sender_name: string, sender_company: string, body: string, files: CcFile[], created_at: iso, mine: boolean}`
- `CcFile {id: uuid, name: string 1..255, mime: string, size: int ≤ 20_971_520}`
- `CcPost {id: uuid, type: "sell"|"buy"|"note", title: string, body: string, fields: record<string,unknown>, cats: string[], created_at: iso, file_count: int}`
- Con trỏ (CR-151): `cursor` = base64url của `{t: iso, id: uuid}` (keyset `(ts,id) DESC`), sai dạng ⇒ 400; tin nhắn dùng `before=seq`.
- Realtime: khung `/me/stream` mới `cc.msg {tenant_id: uuid /*công ty kia*/, seq: int}` và `cc.link {tenant_id, status: ConnectStatus}`; người nhận = R9 của cả hai công ty trừ không ai bị loại (tab khác của người gửi cũng nhận). Thêm vào union `MeStream*Event` hiện có.

## 4. Dữ liệu (hub, Postgres)
**0145 `cr161_connect_links.sql`** — `ALTER TABLE hub.partner_links ADD COLUMN connect_requested_at timestamptz NULL, connect_note text NULL CHECK (length ≤ 500), connect_by uuid NULL, connect_by_name text NULL CHECK (length ≤ 200)`. Index: `CREATE INDEX partner_links_to_connect_ix ON hub.partner_links (to_tenant) WHERE connect_requested_at IS NOT NULL`. Hàm DEFINER (search_path cố định, REVOKE PUBLIC, GRANT hub_rw + `contracts_rw` trong khối DO như 0118): `hub.cc_search(q text)`, `hub.cc_invite(p_to uuid, p_note text, p_user uuid, p_user_name text) → text`, thay thân `hub.partner_link_accept` / `partner_link_block` (R4/R5), `hub.cc_disconnect(p_other uuid) → boolean`, `hub.cc_links(p_status text, p_cur_t timestamptz, p_cur_id uuid, p_limit int)`, `hub.cc_connected(a uuid, b uuid) → boolean` (STABLE), `hub.cc_owner_users(p_tenants uuid[]) → (tenant_id, user_id)`, `hub.cc_notify(p_batch jsonb)` (chèn `hub.notifications` cho tenant **khác** — chỉ nhận `user_id` thuộc `cc_owner_users` của công ty đang `connected`/có lời mời với `app.tenant_id`; ngoài ra bỏ qua im lặng).

**0146 `cr161_cc_threads.sql`**
| Bảng | Cột (kiểu, null, default) | Khoá / index / xoá |
|---|---|---|
| `hub.cc_threads` | `id uuid PK default gen_random_uuid()`, `tenant_lo uuid NN`, `tenant_hi uuid NN`, `last_seq bigint NN 0`, `last_at timestamptz NULL`, `created_at timestamptz NN now()` | `CHECK (tenant_lo < tenant_hi)`, `UNIQUE (tenant_lo, tenant_hi)`; index `(tenant_lo, last_at DESC)`, `(tenant_hi, last_at DESC)` |
| `hub.cc_messages` | `thread_id uuid NN`, `seq bigint NN`, `sender_tenant uuid NN`, `sender_user uuid NN`, `sender_name text NN` (≤200), `body text NN ''` (≤4000), `files jsonb NN '[]'` (mảng ≤ 10), `client_id uuid NN`, `created_at timestamptz NN now()` | PK `(thread_id, seq)`; `UNIQUE (thread_id, sender_user, client_id)`; FK thread `ON DELETE CASCADE`; `CHECK sender_tenant` ∈ cặp (trigger không cần — hàm gửi đặt) |
| `hub.cc_reads` | `thread_id uuid NN`, `user_id uuid NN`, `tenant_id uuid NN`, `last_read_seq bigint NN 0` | PK `(thread_id, user_id)`; FK cascade |
| `hub.cc_files` | `id uuid PK`, `thread_id uuid NN`, `tenant_id uuid NN` (bên tải), `user_id uuid NN`, `name text NN` (1..255), `mime text NN`, `size bigint NN` (≤ 20 MB), `storage_key text NN`, `seq bigint NULL` (gắn tin), `created_at NN now()`, `deleted_at NULL` | FK thread cascade; index `(thread_id, seq)`; index một phần `(created_at) WHERE seq IS NULL AND deleted_at IS NULL` cho dọn |

RLS: bật (KHÔNG FORCE — chủ hàm DEFINER sẽ bị chính policy chặn; giống `partner_links` 0117) trên 4 bảng; **chỉ** policy `app.scope='system'` cho hub_rw. Người dùng/gói đi qua hàm DEFINER, luồng luôn suy từ (`app.tenant_id`, `p_other`) — không nhận id luồng từ ngoài ⇒ công ty thứ ba chỉ chạm được luồng của chính nó (kết nối chưa có ⇒ CC404/CC409; route ⇒ 404/409).

**Người dùng KHÔNG là tham số** (soát Opus lát 3): mọi hàm dưới đây đọc `app.user_id` qua `hub.cc_ctx()` (nội bộ, không GRANT): thiếu `app.tenant_id` hoặc `app.user_id`, hoặc user không phải người Toàn quyền của công ty ⇒ 42501. Không ai đứng tên thay người Toàn quyền khác cùng công ty.
Hàm công khai (hub_rw, contracts_rw):
- `hub.cc_thread_page(p_other uuid, p_before bigint, p_limit int) → (read_only bool, last_read_seq bigint, items jsonb)` — một dòng; limit kẹp 1..101; chưa có luồng: đang connected ⇒ trống, chưa từng kết nối ⇒ `CC404 CONNECT_NO_THREAD`.
- `hub.cc_send(p_other uuid, p_client_id uuid, p_user_name text, p_body text, p_file_ids uuid[]) → (thread_id, seq, created, message jsonb, notify jsonb)` — một lần gọi: khoá advisory cặp (cùng khoá cc_invite/cc_disconnect) + `cc_threads FOR UPDATE`, tăng `last_seq`, chèn tin, gắn tệp `= any(p_file_ids)` (chỉ tệp của chính người gửi, cùng luồng, chưa gắn, không trùng), cập nhật đã-đọc của người gửi, chèn chuông R9 một câu; `notify` = [{tenant_id, user_id}] người Toàn quyền của cả hai công ty. Lỗi: `CC409 CONNECT_READ_ONLY`, `CC422 MSG_EMPTY|MSG_FILE_INVALID`, `22023 MSG_TOO_LONG|MSG_TOO_MANY_FILES`.
- `hub.cc_mark_read(p_other uuid, p_seq bigint) → bigint` — chỉ tiến, kẹp ≤ `last_seq`; chưa có luồng ⇒ 0.
- `hub.cc_file_add(p_other uuid, p_id uuid, p_name text, p_mime text, p_size bigint, p_storage_key text) → jsonb (CcFile)` — chỉ khi connected (`CC409`); kiểm trong hàm: tên 1..255, mime 1..100, 1 ≤ size ≤ 20 MB, `storage_key = '<tenant bên tải>/<id>'`, tối đa 50 tệp chưa gắn mỗi người ⇒ `CC422 MSG_FILE_INVALID`.
- `hub.cc_file_get(p_file_id uuid) → text|null` — khoá lưu trữ; chỉ người Toàn quyền của một trong hai công ty trong cặp (đã ngắt vẫn được); tệp chưa gắn tin chỉ người tải; không thấy ⇒ NULL.
- `hub.cc_unread(p_others uuid[]) → (other_tenant, unread)` — một câu, ≤ 100 công ty; `hub.cc_links` (0145) thay thân ở 0146 để có `unread` theo `app.user_id`.
- `hub.cc_files_sweep(p_older interval) → (file_id, storage_key)` — việc nền, **chỉ scope system** (khác ⇒ 42501), `p_older ≥ 1 giờ`; soft delete tệp chưa gắn tin quá hạn; không cấp UPDATE trực tiếp trên bảng.

**0147 `cr161_cc_grants.sql`** — GRANT EXECUTE hàm công khai cho hub_rw + `contracts_rw` (khối DO nếu role có), SELECT 4 bảng cho hub_rw (RLS system), không UPDATE/INSERT/DELETE trực tiếp + kind chuông `cc.*` nếu CHECK của `hub.notifications` cần (regex hiện tại `^[a-z][a-z0-9_.]{1,40}$` đã nhận ⇒ có thể không cần; không cần thì trả số).

**pack-contracts 0116 `cr161_cc_grants.sql`** (lát 5) — cấp lại cho `contracts_rw`: `USAGE` schema `hub` + `EXECUTE` mọi hàm công khai của 0145/0146 (+ `partner_link_accept/block`), và `community.cc_posts` (+ `USAGE` schema `community`, trong khối DO nếu hàm đã có). Cần vì khối DO của hub 0145/0147 và community 0020 bị bỏ qua trên DB dựng sạch (role gói tạo SAU hub). Hàm nội bộ không cấp.

**pack-community 0020 `cr161_connected_posts.sql`** — `community.cc_posts(p_owner uuid, p_cur_t timestamptz, p_cur_id uuid, p_limit int)` DEFINER: kiểm `hub.cc_connected(app.tenant_id, p_owner)` (false ⇒ 42501), lọc R10 trên `tenant_id = p_owner`, keyset `(created_at,id) DESC`, trả cột đã che + `file_count` (đếm `community.media` theo lô). Index có sẵn `posts (tenant_id, created_at)` — kiểm khi làm; thiếu thì thêm một phần `WHERE author_org IS NULL AND aud_mode='all'`. GRANT `contracts_rw`. **0021 không dùng** (trả lại).

Seed: không đổi seed chung. Fixture e2e tạo NitiGroup (Tiên Toàn quyền, Vy nhân viên) + Preschool (Dung Toàn quyền), cả hai `directory_listed`, Preschool có gói Bảng tin + 2 bài `aud_mode='all'`.

## 5. Quyền / cách ly — bảng kiểm (int)
| Ca | Mong đợi |
|---|---|
| Vy (nhân viên NitiGroup) gọi mọi route CR-161 | 403, 0 SQL nghiệp vụ |
| Công ty C (thứ ba, Toàn quyền) đọc/gửi luồng A–B, tải tệp, xem bài B qua A | 404 / 42501, không dòng |
| Gọi thẳng hàm DEFINER không đặt `app.tenant_id` | 42501 |
| Đã ngắt: đọc tin được, gửi/tải lên ⇒ 409, xem bài ⇒ 404 | đúng |
| Người được giao (N2): Dung là người Toàn quyền **khác** người tạo tài khoản công ty/không phải tenant_admin vẫn đồng ý & nhắn được | đúng |
| B từ chối ⇒ A gửi lại ⇒ 409; A vẫn không thấy tên B nếu B «chặn trước» khi A chưa từng mời | đúng (giữ 0118) |

## 6. Hiệu năng (N7, CONVENTIONS §6)
| Thao tác | Ngưỡng p95 (dữ liệu) | Số câu SQL | Index |
|---|---|---|---|
| Tìm công ty | ≤ 25 ms (20.000 công ty, 2.000 dòng link của A) | 1 (`cc_search`, kèm trạng thái bằng `LEFT JOIN` 2 lần trên PK `(from,to)`) | trigram/MST có sẵn của `directory_search` |
| Danh sách kết nối + chưa đọc | ≤ 30 ms (500 kết nối, 50 luồng × 2.000 tin) | 1 (`cc_links` gồm `unread` qua `cc_reads` + `cc_threads.last_seq`, không đếm tin) | PK `partner_links`, `partner_links_to_connect_ix`, UNIQUE cặp luồng |
| Trang tin (50) | ≤ 20 ms (100.000 tin/luồng) | 1 | PK `(thread_id, seq)` |
| Gửi tin + chuông | ≤ 40 ms | 1 hàm (`cc_send`) + 1 pipeline Redis publish | PK, UNIQUE client |
| Bài công khai (20) | ≤ 30 ms (10.000 bài của B) | 1 | `posts(tenant_id, created_at)` |
Luật: không vòng lặp SQL theo hàng; người nhận chuông/stream lấy theo lô `= any(array)`; dữ liệu lô qua một tham số JSON; không sleep/poll (stream là đẩy). Đường nóng mới, không chạm code cũ ở đường nóng ⇒ không cần đo trước. Test: `apps/hub-api/src/modules/packs/contracts/connect/connect.perf.int.test.ts`.

## 7. Thông báo
Chuông `hub.notifications` (source `contracts`), link: `cc.invite` ⇒ `/contracts/partners?invites=1`; `cc.accepted`/`cc.msg` ⇒ `/contracts/partners?party=<tên>&tenant=<id>&tab=chat`; `cc.disconnected` ⇒ `/contracts/partners`. Tiêu đề VI (i18n EN theo khoá): «{Công ty} muốn kết nối với bạn», «{Công ty} đã đồng ý kết nối», «{Công ty} đã ngắt kết nối», «Tin nhắn mới từ {Công ty}». Không email, không push.

## 8. Giao diện — trạng thái (workspace-web, chi tiết trong lát web)
| Màn | Trạng thái |
|---|---|
| Đối tác › «Tìm công ty» (hộp thoại) | đang tìm · chưa đủ ký tự · không thấy («Chỉ hiện những công ty đã bật Danh bạ.») · mỗi dòng: `none` ⇒ nút «Gửi lời mời kết nối» (hộp xác nhận + lời nhắn) · `pending_out` ⇒ nhãn chờ · `pending_in` ⇒ «Đồng ý» · `connected` ⇒ nhãn + «Mở trang đối tác» · `declined` ⇒ nhãn đỏ + «Bạn không thể gửi lại lời mời cho công ty này.» · lỗi mạng |
| Đối tác (danh sách) | băng lời mời đến (Đồng ý / Từ chối có hộp xác nhận nguy hiểm) — cùng thành phần với lời mời ở Hộp thư đối tác; cột «Tình trạng» (Đã kết nối / Chưa kết nối); công ty đã kết nối chưa có HĐ vẫn có dòng; nhân viên: không nút mời, băng giải thích |
| Trang đối tác › tab «Trò chuyện» | trống («Hãy nhắn lời chào đầu tiên…») · có tin (theo ngày, tải thêm cũ) · đang gửi / gửi lỗi (thử lại) · chỉ đọc sau ngắt (ẩn ô soạn, băng «Đã ngắt kết nối — chỉ xem lại tin cũ») · tệp dùng `AttachDraft`/`AttachGallery` (CR-164) |
| Trang đối tác › tab «Bảng tin» | băng «Bạn đang xem bài của công ty đã kết nối: X» · trống · tải thêm · không kết nối ⇒ tab ẩn |
| Nút «Ngắt kết nối» | hộp xác nhận nguy hiểm, sau đó về danh sách + toast |

## 9. Quyết định / câu hỏi
- Q1 (mặc định đã dùng): liên kết dòng HĐ cũ ↔ công ty đã kết nối theo **MST trùng** (`contracts` công ty đối tác có MST) rồi tới **tên pháp lý trùng chính xác**; không trùng ⇒ dòng riêng.
- Q2: bài Bảng tin của công ty kết nối hiện chữ + số tệp, **chưa** xem ảnh/tệp của bài (mặc định); muốn xem ảnh ⇒ CR sau.
- Q3: «Từ chối» không báo chuông cho bên mời (mặc định).
- D1: không bảng «kết nối» mới — suy ra từ `partner_links` hai chiều (G1).
- D2: ngắt = xoá 2 dòng link chưa chặn (không cột `disconnected_at`), vì giữ dòng sẽ làm `partner_link_request` trả `pending` sai (0118).
