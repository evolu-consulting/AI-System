---
id: CR-132
title: Tin nhắn giữa người dùng trong Sổ Hợp Tác (1-1 + nhóm, cùng công ty, realtime)
fr: [HD-MSG-01..HD-MSG-12]
cr: CR-132
depends: [CR-130 pha 1 (khoang trợ lý một bản), CR-131 (EmptyState web-kit)]
status: Draft (PLAN, backend-lead 2026-11-12)
---

# CR-132 · Tin nhắn trong Sổ Hợp Tác

## 1. Mục tiêu
Nhân viên cùng công ty nhắn nhau (1-1 và nhóm) ngay trong Sổ Hợp Tác, kèm tệp, tin tới tức thì. Thông báo chỉ nằm trong khoang chat. **Tách hẳn** khỏi rooms của chat-web (X2a): bảng, API, sự kiện riêng; X2a chỉ là khuôn tham khảo (seq, `last_read_seq`, `/me/stream`).

## 2. Phạm vi
| Làm (v1) | Không làm |
|---|---|
| Hội thoại 1-1 (một hội thoại duy nhất mỗi cặp) và nhóm (≤ 50 người) | Liên công ty, đối tác (user ngoài) — 403 |
| Gửi chữ thuần (≤ 4000 ký tự, tự nhận link) + ≤ 10 tệp/tin theo `ATTACH_ALLOWED`, ≤ 20 MB/tệp | Sửa tin, trả lời trích, thả cảm xúc, @nhắc, tin hệ thống («A đã thêm B») |
| Thu hồi tin của mình (mọi lúc) | Chuông chung, email, push, toast |
| Realtime qua `/me/stream` có sẵn | Tìm trong nội dung tin (chỉ lọc danh sách theo tên trên client) |
| Chưa đọc: chấm đỏ + số ở nút mở khoang, tab «Tin nhắn», mục menu; hội thoại có tin mới in đậm, lên đầu | Xoá cả hội thoại; ghim; tắt tiếng |
| «Đã xem» (1-1) / «Đã xem: n» (nhóm, tooltip tên) dưới tin cuối của mình | Dọn tệp tải lên mà không gửi (ghi TECH-DEBT) |

## 3. Mô hình dữ liệu (schema `contracts`, migration `packages/db/migrations-pack-contracts/0107_cr132_messages.sql`)
Mọi bảng: `tenant_id uuid NOT NULL`, `SELECT packs.secure_table('contracts', '<bảng>')` (policy tenant), cộng policy **RESTRICTIVE** thành viên dưới đây. Không FK sang `admin.*` (luật pack-sql) — use case kiểm user qua kit.

| Bảng | Cột (kiểu · null · default) | Khoá / ràng buộc / chỉ mục |
|---|---|---|
| `msg_conversations` | `id uuid` def `gen_random_uuid()` · `kind text` (`direct`\|`group`) · `title text NULL` · `dm_key text NULL` · `created_by uuid` def `app.user_id` · `created_at timestamptz` def now() · `last_seq bigint` def 0 · `last_at timestamptz` def now() | PK `(tenant_id,id)`; CK: `direct` ⇔ `dm_key NOT NULL AND title IS NULL`; `group` ⇒ `char_length(title) BETWEEN 1 AND 80`; UNIQUE `(tenant_id,dm_key)`; idx `(tenant_id,last_at DESC,id)` |
| `msg_members` | `conversation_id uuid` · `user_id uuid` · `role text` (`owner`\|`member`) def `member` · `joined_at` def now() · `last_read_seq bigint` def 0 | PK `(tenant_id,conversation_id,user_id)`; FK `(tenant_id,conversation_id)` → conversations ON DELETE CASCADE; idx `(tenant_id,user_id,conversation_id)` |
| `msg_messages` | `conversation_id uuid` · `seq bigint` · `id uuid` def gen · `sender_id uuid` · `client_id uuid` · `body text` def `''` · `created_at` def now() · `deleted_at timestamptz NULL` | PK `(tenant_id,conversation_id,seq)`; UNIQUE `(tenant_id,conversation_id,sender_id,client_id)` (chống gửi đôi); CK `char_length(body) <= 4000`; FK conv CASCADE |
| `msg_files` | `file_id uuid` · `conversation_id uuid` · `seq bigint NULL` (NULL = đã tải lên, chưa gửi) · `uploaded_by uuid` | PK `(tenant_id,file_id)`; FK `(file_id,tenant_id)` → `contracts.files(id,tenant_id)`; FK conv CASCADE; idx `(tenant_id,conversation_id,seq)` |

- **Một nguồn sự thật:** tin = `msg_messages`; đã đọc = `msg_members.last_read_seq`; số chưa đọc **không lưu**, luôn tính (§6). `last_seq/last_at` là bộ đếm cấp `seq` (ghi trong CÙNG câu chèn tin, khoá hàng hội thoại), không phải bản sao; int `messages-consistency` kiểm `last_seq = max(seq)`.
- `dm_key = least(a,b) || ':' || greatest(a,b)` (hàm thuần `dmKey`).
- **Hàm RLS** (SECURITY DEFINER, STABLE, `search_path` cố định, GRANT EXECUTE cho `contracts_rw`): `contracts.msg_my_conversations() RETURNS uuid[]` — id hội thoại mà `user_id = app.user_id` trong tenant hiện tại; `contracts.msg_created_by_me(cid uuid) RETURNS boolean`.
- **Policy RESTRICTIVE** (đều kèm `packs.viewer_ext_org() IS NULL`):

| Bảng | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| conversations | `id = ANY((SELECT msg_my_conversations()))` | `created_by = app.user_id` | thành viên | không cấp (xoá chỉ qua CASCADE khi người cuối rời, chạy bằng hàm definer `msg_drop_if_empty(cid)`) |
| members | thành viên của `conversation_id` | thành viên **hoặc** `msg_created_by_me(conversation_id)` | thành viên | thành viên |
| messages | thành viên | thành viên **và** `sender_id = app.user_id` | `sender_id = app.user_id` | không cấp |
| files (`msg_files`) | thành viên | thành viên **và** `uploaded_by = app.user_id` | thành viên | không cấp |
| `contracts.files` (thêm, RESTRICTIVE SELECT) | `NOT EXISTS (msg_files của file này) OR conversation_id thuộc msg_my_conversations()` — tệp tin nhắn không lộ qua `GET /pack/contracts/files/:id/content` cho người ngoài hội thoại | — | — | — |

Quyền chi tiết (chủ nhóm, thu hồi) kiểm ở use case; RLS là lưới chặn cuối (tenant + thành viên).

## 4. Contract API (`packages/contracts/src/pack-contracts/messages.ts`, xuất qua `@ai/contracts/pack-contracts`)
Mount `apps/hub-api/src/modules/packs/contracts/messages/` (domain/application/adapters, `messages.mount.ts`), dưới `/pack/contracts`, `packGuard(view,'contracts','read')`; user ngoài ⇒ 403 `PACK_FORBIDDEN`. Không phải thành viên / không có / tenant khác ⇒ **404 `MSG_NOT_FOUND` giống hệt nhau**.

| Method · đường | Vào (zod) | Ra | Lỗi |
|---|---|---|---|
| GET `/messages/conversations` | `cursor?: string≤200`, `limit: int 1..50 = 30` | `{items: ConversationSummary[], next_cursor: string\|null}` sắp `last_at desc, id desc` | 400 |
| GET `/messages/unread` | — | `{total: int 0..999}` (trần 999) | — |
| POST `/messages/conversations` | `{kind:'direct', user_id: uuid}` \| `{kind:'group', title: trim 1..80, member_ids: uuid[] 1..49 (unique, ≠ mình)}` | 201 `ConversationDetail` (direct đã có ⇒ 200 bản cũ) | 400 `MSG_DM_SELF`; 422 `MSG_USER_INVALID` (không phải nhân viên còn dùng của công ty) |
| GET `/messages/conversations/:id` | — | `ConversationDetail` | 404 |
| PATCH `/messages/conversations/:id` | `{title: trim 1..80}` (ghi đè, không version) | `ConversationDetail` | 403 `MSG_NOT_OWNER`; 409 `MSG_DIRECT_FIXED` |
| POST `…/:id/members` | `{user_ids: uuid[] 1..20}` | `ConversationDetail` | 403 `MSG_NOT_OWNER`; 409 `MSG_DIRECT_FIXED`; 422 `MSG_USER_INVALID`, `MSG_GROUP_FULL` (> 50) |
| DELETE `…/:id/members/:userId` | — | 204 | 403 `MSG_NOT_OWNER` (xoá người khác mà không phải chủ); 409 `MSG_DIRECT_FIXED` |
| GET `…/:id/messages` | `before_seq?: int ≥1`, `limit: int 1..100 = 50` | `{items: Message[] (seq tăng), has_more: boolean}` | 404 |
| POST `…/:id/messages` | `{client_id: uuid, body: string (trim) 0..4000, file_ids: uuid[] 0..10 = []}`; `body` rỗng ⇒ phải có tệp | 201 `Message` (trùng `client_id` ⇒ 200 bản cũ) | 400 `MSG_EMPTY`; 422 `MSG_FILE_INVALID` (tệp không phải do mình tải vào đúng hội thoại, hoặc đã gửi); 409 `MSG_PEER_INACTIVE` (1-1 với người đã khoá) |
| DELETE `…/:id/messages/:seq` | — | 204 (thu hồi: `deleted_at`, `body=''`, tệp gỡ khỏi tin + soft-delete `contracts.files`) | 403 `MSG_NOT_SENDER`; 404 |
| POST `…/:id/read` | `{seq: int ≥0}` | `{unread_total: int}` | 404 |
| POST `…/:id/files` (multipart `file`) | mime ∈ `ATTACH_MIMES`, ≤ `ATTACH_MAX_BYTES` | 201 `FileRef` | 415 `MSG_FILE_TYPE`; 413 `MSG_FILE_TOO_LARGE` |
| GET `…/:id/files/:fileId` | — | 302 tới link FileBox | 404 |

Chọn người: dùng lại `GET /pack/contracts/members` (đã có, chỉ nhân viên nội bộ).

Schema:
- `ConversationSummary = {id, kind, title: string|null, peer: {id,name,active}|null (direct), member_count, last_message: {seq, sender_id, sender_name, preview: string≤120, has_files, deleted, at}|null, unread: int 0..99 (99 = 99+), last_at}`
- `ConversationDetail = ConversationSummary & {my_role:'owner'|'member', members: {user_id, name, role, last_read_seq, active}[]}`
- `Message = {id, seq, conversation_id, sender_id, client_id, body, files: FileRef[], at, deleted: boolean}`; `FileRef = {id, name, mime: AttachMime, size}`.

**Luật thuần** `apps/hub-api/src/modules/packs/contracts/messages/domain/messages.rules.ts` (QC viết test trước):
```ts
dmKey(a: string, b: string): string
canEditGroup(c: {kind: ConvKind}, role: MemberRole): boolean            // group && owner
canRemoveMember(c: {kind}, actor: {id; role}, targetId: string): boolean // group && (actor.id===targetId || actor.role==='owner')
nextOwner(rest: {user_id; role; joined_at}[]): string | null             // khi chủ rời: người vào sớm nhất; rỗng ⇒ null (xoá hội thoại)
groupSizeOk(current: number, adding: number): boolean                    // current+adding <= 50
clampRead(current: number, requested: number, lastSeq: number): number   // max(current, min(requested,lastSeq))
seenBy(members: {user_id; last_read_seq}[], me: string, seq: number): string[]
messageEmpty(body: string, fileCount: number): boolean
```

## 5. Sự kiện realtime (`/me/stream`)
Phát **sau commit**, một `pipeline` Redis mỗi thao tác qua kit `packStreamPublish` (mở rộng union `PackStreamEvent`); zod ở `packages/contracts/src/chat/me-stream-msg.ts`, hằng `ME_STREAM_MSG_EVENTS`; `chat-gate` cho qua kể cả công ty tắt Chat AI (thêm vào tập của `meStreamEventAllowed`).

| Sự kiện | Gửi tới | `data` |
|---|---|---|
| `msg.new` | mọi thành viên (cả người gửi — tab khác) | `{conversation_id, message: Message, unread_total?}` — `unread_total` không gửi (client tự +1); nối lại/`stream.reset` ⇒ client gọi lại `GET /messages/unread` + trang 1 danh sách |
| `msg.deleted` | mọi thành viên | `{conversation_id, seq}` |
| `msg.read` | mọi thành viên | `{conversation_id, user_id, seq}` (cập nhật «Đã xem»; tab khác của chính mình xoá chấm) |
| `msg.conversation` | người bị đổi (thêm/bớt) + thành viên còn lại | `{conversation_id, change: 'added'\|'removed'\|'updated'}` ⇒ client tải lại hội thoại đó |

Web: **một** kết nối `/me/stream` mỗi tab — tách `features/contract-approval/stream/process-stream.ts` thành bộ phát chung (`platform/stream/me-stream.ts`, đăng ký theo tên sự kiện); thẻ duyệt và tin nhắn cùng nghe (giới hạn `USER_STREAM_CONN_MAX = 5`/user).

## 6. Chưa đọc + hiệu năng (Luật 4c)
Chưa đọc của (tôi, hội thoại) = số tin `seq > last_read_seq`, `sender_id ≠ tôi`, `deleted_at IS NULL`. Tổng (một câu, văn bản cố định):
```sql
select least(coalesce(sum(u.n),0), 999)::int as total from contracts.msg_members m
join contracts.msg_conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id
  and c.last_seq > m.last_read_seq                       -- bỏ ngay hội thoại đã đọc hết
cross join lateral (select count(*) as n from (select 1 from contracts.msg_messages x
   where x.tenant_id = m.tenant_id and x.conversation_id = m.conversation_id and x.seq > m.last_read_seq
     and x.sender_id <> m.user_id and x.deleted_at is null limit 100) s) u
where m.tenant_id = $tenant and m.user_id = $me
```
Index: `msg_members (tenant_id,user_id,…)` + PK `msg_messages (tenant_id,conversation_id,seq)` (quét khoảng, trần 100/hội thoại); kết quả kẹp 999.

| Thao tác | Số câu SQL (cố định) | Ngưỡng p95 (bộ dữ liệu: 1 user trong 200 hội thoại, 100.000 tin, 50 thành viên/nhóm) |
|---|---|---|
| `GET /messages/unread` | 1 | ≤ 20 ms |
| `GET /messages/conversations` (30 dòng, unread + tin cuối bằng lateral theo PK) | 1 (+1 tên qua `memberNamesOf`) | ≤ 50 ms |
| `POST …/messages` | 1 CTE (tăng `last_seq` khoá hàng → chèn tin → gắn `msg_files` → trả danh sách thành viên) + 1 pipeline Redis | ≤ 40 ms (không tính tệp) |
| `POST …/read` | 1 `UPDATE … RETURNING` + câu tổng | ≤ 20 ms |
| `GET …/messages` (50) | 1 (+ tệp qua `= any(array)`, gộp trong câu) | ≤ 30 ms |

Test `messages.perf.int.test.ts` đo 3 dòng đầu + đếm số câu. Không vòng theo hàng, không chờ bằng sleep.

## 7. Quyền (mặc định, ghi rõ)
| Việc | Ai | Ghi chú |
|---|---|---|
| Nhắn 1-1, tạo nhóm | Mọi nhân viên nội bộ có quyền đọc Sổ Hợp Tác | Người tạo nhóm = chủ nhóm |
| Đổi tên, thêm, bớt thành viên | Chủ nhóm | Một chủ; không chuyển tay v1 |
| Rời nhóm | Mọi thành viên | Chủ rời ⇒ người vào sớm nhất thành chủ; người cuối rời ⇒ xoá hội thoại + tệp |
| Thu hồi tin | Người gửi, mọi lúc | Không sửa tin |
| Người bị khoá/ngưng | Giữ trong hội thoại; 1-1 thì khoá ô gửi | Quản trị không đọc được tin người khác (không có quyền đặc biệt) |
Người bị bớt khỏi nhóm mất quyền xem toàn bộ lịch sử (đơn giản, khớp RLS thành viên).

## 8. Luồng UI (`apps/workspace-web/src/features/messages/`, cùng component cho khoang và toàn màn)
| Màn | Bố cục |
|---|---|
| Khoang phải (hẹp) | Đầu khoang: tab «Trợ lý AI \| Tin nhắn» (tab có chấm đỏ + số). Tab Tin nhắn: `ConversationList` (ô lọc «Tìm người hoặc nhóm», nút «Nhắn tin mới») → bấm ⇒ `ConversationView` thay chỗ, đầu có nút ‹ về danh sách + tên + (nhóm) «n thành viên» mở `GroupMembersSheet`. Nhớ hội thoại đang mở khi đóng/mở khoang. Nút ‹ dẫn về danh sách, không đóng khoang |
| Toàn màn `/contracts/messages` (`?c=<id>`) | Mục menu «Tin nhắn» (biểu tượng + số chưa đọc) sau «Đề nghị»; trái `ConversationList` 320 px, phải `ConversationView`; < 768 px dùng kiểu khoang hẹp |
| Nút mở khoang (đầu trang) | Chấm đỏ + số tổng chưa đọc (99+) |
| Danh sách | Avatar/tên (nhóm: tên nhóm), xem trước «Bạn: …» / «Tên: …» / «📎 Tệp» / «Tin nhắn đã được thu hồi», giờ; chưa đọc ⇒ tên + xem trước in đậm, số bên phải; tin mới ⇒ lên đầu |
| Hội thoại | Tin theo ngày (vạch «Hôm nay»/ngày), cuộn lên tải thêm 50; tin của mình bên phải; «Đã xem» / «Đã xem: n»; ô soạn: đính kèm (chỉ icon), Enter gửi, Shift+Enter xuống dòng; tin đang gửi mờ, lỗi ⇒ «Chưa gửi được. Bấm để gửi lại.» |
| `NewConversationDialog` | Chọn 1 người ⇒ mở 1-1; chọn ≥ 2 ⇒ hiện ô «Tên nhóm» (bắt buộc), nút «Tạo nhóm» |

Mở hội thoại (hoặc tin tới khi đang mở và tab trình duyệt hiển thị) ⇒ `POST …/read` với seq cuối. Trạng thái trống/lỗi dùng `EmptyState` (`packages/web-kit/src/ui/`, CR-131).

**Câu chữ (vi):** «Tin nhắn» · «Trợ lý AI» · «Nhắn tin mới» · «Tạo nhóm» · «Tên nhóm» · «Rời nhóm» · «Thêm người» · «Bỏ khỏi nhóm» · «Thu hồi» · trống danh sách: «Chưa có tin nhắn nào» + «Nhắn cho đồng nghiệp trong công ty để trao đổi nhanh về hợp đồng, đối tác.» [Nhắn tin mới] · hội thoại trống: «Hãy gửi lời chào đầu tiên.» · lỗi tải: «Không tải được tin nhắn. Kiểm tra kết nối rồi bấm Thử lại.» · mất kết nối: «Đang kết nối lại — tin mới sẽ hiện khi có mạng.» · tệp sai: «Không gửi được tệp này. Nhận PDF, Word, Excel, ảnh…, tối đa 20 MB.» · bị bỏ khỏi nhóm: «Bạn không còn trong cuộc trò chuyện này.» [Về danh sách] · 1-1 người đã khoá: «Người này không còn dùng hệ thống nên không nhận được tin.» · nhóm đầy: «Nhóm tối đa 50 người.»

## 9. Chia lát
Số migration giao trước (gói contracts): **0107** `0107_cr132_messages` (`when` 1807000217000), **0108** `0108_cr132_files_policy` (`when` 1807000218000). Không đổi bảng ngoài gói.

| Lát | Vùng code | Việc | Model | ~ phút | Phụ thuộc |
|---|---|---|---|---|---|
| M1 | `packages/db/migrations-pack-contracts` | 0107: 4 bảng, hàm RLS, policy; int RLS (chéo tenant, người ngoài hội thoại, user ngoài) | Sonnet high viết · **Opus low soát** | 50 | — |
| M2 | `packages/contracts` + `messages.rules.ts` | zod §4–5, luật thuần + unit | Sonnet | 40 | — (song song M1) |
| M3 | `packs/contracts/messages/**` | API hội thoại/thành viên/tin/đọc/chưa đọc + kit `activeInternalAmong` (1 câu) + int đường chính + perf | Sonnet high · **Opus low soát** quyền | 60 | M1, M2 |
| M4 | kit `pack-stream-publish`, `chat-gate`, send/read use case | 4 sự kiện, phát sau commit, int nhận sự kiện | Sonnet high · **Opus low soát** | 40 | M3 |
| M5 | `packs/contracts/messages` (files) + 0108 | tải lên/tải xuống tệp, policy `contracts.files`, int chặn người ngoài | Sonnet high · **Opus low soát** | 45 | M3 (song song M4) |
| W1 | `workspace-web/platform/stream`, `features/messages/api|hooks` | tách bộ phát `/me/stream` chung (thẻ duyệt chuyển sang), client API, kho chưa đọc | Sonnet | 50 | M2 (song song M3) |
| W2 | `features/messages/components`, route `/contracts/messages`, `nav.ts` | danh sách, hội thoại, ô soạn, tạo nhóm, thành viên, toàn màn, mục menu + số | Sonnet | 60 | W1 |
| W3 | `features/shell` (AssistantDock/Panel) | tab «Trợ lý AI \| Tin nhắn», chấm đỏ nút khoang + tab, viết e2e hành trình (không chạy) | Sonnet | 40 | W2, CR-130 pha 1 |

Thứ tự gộp: M1 ‖ M2 → M3 ‖ W1 → M4 ‖ M5 ‖ W2 → W3 → e2e cuối đợt (qc, một lần).

**Test tối thiểu**
- Unit: `messages.rules.test.ts` (7 hàm §4); zod `messages.test.ts`; web `unread-store.test.ts` (cộng/xoá theo sự kiện, nối lại ⇒ lấy lại).
- Int đường chính: `messages.int.test.ts` — tạo 1-1 (lặp ⇒ cùng id), tạo nhóm, gửi + idempotent `client_id`, đọc ⇒ unread 0, chủ rời ⇒ chuyển chủ, thu hồi; `messages-files.int.test.ts` — tải lên/gửi/tải xuống; `messages-stream.int.test.ts` — B nhận `msg.new`, `msg.read`.
- Int chặn: `messages-rls.int.test.ts` — tenant khác không thấy hàng (4 bảng); nhân viên cùng tenant ngoài hội thoại: 404 mọi endpoint + RLS 0 hàng + `GET /pack/contracts/files/:id/content` của tệp tin nhắn ⇒ 404; user ngoài ⇒ 403.
- Perf: `messages.perf.int.test.ts` (§6).
- e2e hành trình `e2e/contracts/journey-messages.spec.ts`: A (đăng nhập thật) mở khoang → tab Tin nhắn → Nhắn tin mới → chọn B → gửi «Chào B» + 1 PDF; B (ngữ cảnh thứ hai) thấy chấm đỏ «1» ở nút khoang và tab, hội thoại in đậm ở đầu; B mở ⇒ chấm mất, A thấy «Đã xem»; B mở `/contracts/messages` toàn màn thấy cùng hội thoại. Không seed sẵn hội thoại.

## 10. Quyết định trong lúc làm
- Đặt dữ liệu trong schema `contracts` (gói Sổ Hợp Tác), tiền tố `msg_`; không tạo gói mới (tránh manifest/registry mới — ranh giới đóng băng, `modules.md`).
- Tệp đi qua `contracts.files` (kit FileBox) + `msg_files` gắn ngay lúc tải lên ⇒ policy RESTRICTIVE mới chặn đường tải chung.
- Không có câu hỏi mở: mọi điểm chưa chốt đã chọn mặc định ở §2 (không sửa tin, không tin hệ thống) và §7 (quyền).
