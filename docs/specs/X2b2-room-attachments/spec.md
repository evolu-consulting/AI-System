---
id: X2b2-room-attachments
title: Đính kèm file trong phòng - composer phòng gửi file, thành viên xem, agent được tag chỉ thấy file của phòng này
milestone: X2b-2
status: draft              # draft → ready → approved → in-progress → done
requirements: [HUB-FR-44, HUB-FR-101, HUB-BR-21, HUB-BR-22, AC-H26, CHAT-AC-47, CHAT-AC-50, X2b2-R01..R22, X2b2-AC01..AC16]
design:
  - docs/design/agent-hub/ba-agent-hub.md (§6 FR-44 đính kèm; §6.9 FR-101 "file đính kèm chỉ dùng được nếu đã gửi vào phòng", FR-96; HUB-BR-21, HUB-BR-22; §8 `room_messages` "đính kèm (như HUB-FR-44)")
  - docs/design/chat-app/usecases-chat.md (UC-09…11; CHAT-AC-44, 47, 50). BA chưa có CHAT-AC riêng cho đính kèm phòng ⇒ spec dùng X2b2-AC, đề xuất CHAT-AC-61 khi Gate (Q14)
  - docs/specs/H2c-attachments/spec.md (R01…R29, nền kho + E12) · docs/specs/X2b-room-agents/spec.md (R07, R09, R14; Q9 + plan-questions.md §14 + Q14 `out/`)
  - docs/TECH-DEBT.md #113
  - canvas: không artboard mới (dùng lại composer + chip tệp C1; docs/design/chat-app/canvas-x2/ Main)
owner: backend-lead + frontend-lead + qc
---

# X2b-2 · Đính kèm file trong phòng

Tách từ X2b (Q9, người dùng 2026-10-08): X2b hiện **từ chối** `attachment_ids` ở tin phòng (400) và chạy run phòng không file. Sau X2b-2: thành viên đính kèm file vào tin phòng, mọi thành viên xem/tải, agent được tag dùng file **của phòng đó** bằng quyền + quota người tag. Hard stop bảo mật (cách ly phòng/tenant, rò file) ⇒ **security review riêng**, task BE rủi ro **cao** (Opus).

## 1. Phạm vi
**Làm:**

| # | Nhóm | Nội dung | Nguồn |
|---|---|---|---|
| A | Gửi file | Composer phòng bật nút đính kèm (hiện `attachments={false}`); upload `POST /attachments` (không đổi), gắn qua `POST /rooms/:id/messages` + `attachment_ids` (≤ 10), cùng luật loại file/20 MiB/hạn mức tenant | FR-44, H2c |
| B | Dữ liệu | File gắn vào **tin phòng** (`room_messages`) thay vì `messages` hội thoại; thêm cột + CHECK + policy đọc theo **thành viên** | BR-22 |
| C | Xem/tải | `GET /attachments/:id[/content]` cho thành viên hiện tại của phòng; `RoomMessage.attachments[]` (metadata) tới mọi thành viên qua `room.message` | FR-96, 99 |
| D | File cho agent | Run phòng nhận tập file **chỉ từ phòng đó** (cửa sổ ngữ cảnh), qua cơ chế job H2c (Runtime tải endpoint nội bộ) | FR-101, R09 X2b |
| E | `out/` | File agent tạo trong run phòng hiện thành đính kèm của tin agent cho cả phòng (X2b Q14) | Q14 |
| F | Vòng đời | Xoá phòng ⇒ xoá nội dung ≤ 10 phút; file chưa gắn hết hạn 24 giờ; sweeper dùng lại | FR-44 |
| G | Đóng mốc | `done:x2b2`, review ≤ 2 vòng + **security review riêng** (rò file giữa phòng/hội thoại/tenant), I2 hai trình duyệt | ROADMAP |

**Không làm:** sửa/xoá tin hay gỡ file khỏi tin · quét virus (PRODUCTION-NOTES) · driver S3 · kéo-thả/dán ảnh nếu C1 chưa có · lệnh `/` trong phòng (Q10 X2b ⇒ không có đường Dify/command) · đổi hội thoại riêng user↔agent (AC-H07) · tin chỉ có file không chữ (Q3) · xem trước (preview) file trong phòng (tải/mở như C1).

**Điểm xuất phát (code thật, 2026-10-12):**
- `hub.attachments` (0007): gắn qua `message_id → hub.messages`, `attachments_bound_ck` đòi `conversation_id` + `flow_id`; RLS `attachments_hub_rw` chỉ **chủ file** (`tenant_id` + `user_id`). `apps/hub-api/src/modules/attachments` (`run-files.ts` `checkSendable`/`bindRunFiles`, `sweeper.ts`). Migration cuối `0022_pb_runs_grant` ⇒ migration mới **0023**.
- `hub.room_messages` (0011): **không** cột đính kèm; `hub.is_room_member(room)` (definer) là hàm RLS sẵn có.
- Run phòng chạy qua hội thoại + flow nền (`rooms/agents/room-run.service.ts` → `createRunTx`); `runs.attachment_ids` = `{}` ở run phòng.
- Contract: `packages/contracts/src/chat` E12 đã có `attachment_ids`; body tin phòng (`POST /rooms/:id/messages`) hiện 400 nếu có. `CHAT_ATTACHMENT_ERRORS` (4 mã) giữ nguyên.
- FE: `chat-web/src/features/rooms/components/RoomComposer.tsx` (`<Composer attachments={false}>`), `features/attachments` (api + chip) và `features/composer` dùng lại. TECH-DEBT #113.

## 2. Nghiệp vụ (X2b2-R)
H2c-R01…R29 (loại/cỡ/tên/sniff/hạn mức/vòng đời) áp **nguyên văn**; chỉ ghi phần riêng phòng.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| X2b2-R01 | Upload giữ nguyên `POST /attachments` (file chưa gắn, thuộc người upload, 24 giờ). Chỉ **thành viên hiện tại** gắn được vào tin phòng; file phải của chính người gửi, chưa gắn (H2c-R09) | FR-44, Q1 |
| X2b2-R02 | Gắn trong **cùng transaction** ghi tin phòng; gắn thành công ⇔ tin có `room_message_id`. 404 `ATTACHMENT_NOT_FOUND{ids}` khi sai bất kỳ id (tenant khác, user khác, đã gắn, hết hạn, nội dung mất), 0 tin, 0 run. 2 POST song song cùng id ⇒ đúng 1 thành công | H2c-R09/R11 |
| X2b2-R03 | Thứ tự kiểm `POST /rooms/:id/messages`: **§3 là nguồn duy nhất**. Lỗi ở bước sau ⇒ rollback, file vẫn chưa gắn (gửi lại được) | H2c-R10, X2b |
| X2b2-R04 | Tin phòng có file: `content` vẫn bắt buộc 1…16000 ký tự (Q3); ≤ 10 file/tin, id trùng/11 id ⇒ 400 `VALIDATION_ERROR`; `client_msg_id` trùng ⇒ 200 trả lại tin cũ, **không gắn lại** | R04 X2b |
| X2b2-R05 | Đọc nội dung/metadata chỉ khi người gọi là **thành viên hiện tại** của `room_id` của file và cùng tenant; không phải thành viên (kể cả `tenant_admin`, kể cả người từng là thành viên đã rời/bị bớt) ⇒ 404 `NOT_FOUND`, không 403. Thêm thành viên mới ⇒ xem được file cũ (lịch sử, X2a) | BR-22, FR-96 |
| X2b2-R06 | File gắn vào phòng **không** đọc được qua `/conversations*`; file của hội thoại riêng **không** gắn được vào tin phòng (đã gắn ⇒ 404). Một file gắn đúng một tin, một nơi (phòng **hoặc** hội thoại) | H2c-R06, BR-22 |
| X2b2-R07 | Tập file của run phòng = file đính kèm của chính các tin trong **cửa sổ ngữ cảnh** X2b-R07 (timeline ≤ 20 tin; thread ≤ 50 tin thread + ≤ 20 tin timeline trước tin gốc) **+ tin gọi**, đúng phòng, `available`; mới nhất trước (tin gọi đầu), cắt 10 file và 100 MiB tổng (H2c-R14). Chốt lúc tạo run (`runs.attachment_ids`) | FR-101, R09 X2b |
| X2b2-R08 | **Agent chỉ thấy file của phòng này:** mọi truy vấn file-set có `room_id = runs.room_id`; không lấy file của phòng khác, hội thoại riêng, file chưa gắn của người tag, hay file người tag tự có nhưng không gắn vào tin phòng. Endpoint nội bộ Runtime chỉ phục vụ id nằm trong payload job (H2c-R15) | BR-21, BR-22 |
| X2b2-R09 | Người tag **không cần là người gửi file** (X2b-R09); nhưng agent không được thấy file mà người tag không xem được — người tag đang là thành viên (đã bảo đảm bởi R05). Người tag rời phòng giữa chừng ⇒ huỷ run (X2b-R17), file giữ nguyên trong phòng | BR-21 |
| X2b2-R10 | Quyền/quota/usage vẫn của người tag (BR-21). File đính kèm **không** tăng usage run; dung lượng tính vào hạn mức **tenant** như H2c-R16 (người upload). Người gửi file chịu trách nhiệm chia sẻ với cả phòng (câu chữ gợi ý ở composer, Q8) | BR-21 |
| X2b2-R11 | `out/` của run phòng (agent bật `Write`): gắn vào **tin agent** của phòng (`room_message_id`), `user_id` = người tag, `origin=output`; mọi thành viên xem/tải (R05); trần 5 file/job, 10 file/tin, 32 MiB (H2c). Run lỗi/huỷ ⇒ không gắn | Q14 X2b, H2c-R26 |
| X2b2-R12 | Thành viên khác **không cần quyền agent** để tải file trong phòng (kể cả `out/`); quota/usage của họ không đổi | CHAT-AC-50 |
| X2b2-R13 | Rời nhóm / bị bớt: mất quyền xem file ngay (R05); file giữ trong phòng. Xoá phòng ⇒ tin + file: nội dung xoá ≤ 10 phút (sweeper, H2c-R28 mở rộng), `/content` 404 ngay sau xoá | FR-44, FR-98 |
| X2b2-R14 | File chưa gắn hết 24 giờ (H2c-R27) xoá như cũ. Người upload không còn là thành viên khi chưa gắn: gắn bị từ chối (R01) | FR-44 |
| X2b2-R15 | Tin agent `sender_type=agent` có `attachments[]` (R11) **không** kích hoạt run (X2b-R01); tên file không được parse `@` | X2b-R01 |
| X2b2-R16 | Realtime: `room.message` mang `attachments[]` (metadata: `id`, `filename`, `mime`, `size`, `available`) tới mọi thành viên hiện tại; không phát nội dung; chưa đọc tính như tin thường | FR-99, 100 |
| X2b2-R17 | Header tải (`/content`): giữ H2c-R13 (`Content-Type` theo `mime` server, `nosniff`, `Content-Disposition: attachment`, `Cache-Control: private, no-store`) | H2c-R13 |
| X2b2-R18 | Hội thoại riêng user↔agent: toàn bộ hành vi H2c giữ nguyên, test khoá H2c + AC-H07 xanh | BR-22, X2b-R20 |
| X2b2-R19 | Phòng/DM bị ẩn phía một bên: file vẫn truy cập qua phòng khi còn là thành viên | FR-97 |
| X2b2-R20 | `!quy-trình` ở timeline kèm file ⇒ 400 (D8); file cho quy trình chỉ qua form input P-b. `!…` không file: giữ P-a, hồi quy | CR-058 |
| X2b2-R21 | Kiểm sniff/virus: như H2c (chữ ký nội dung, không quét virus) | H2c-R03 |
| X2b2-R22 | Audit/log: không ghi tên file hay nội dung vào log; chỉ `attachment_id`, `room_id`, `tenant_id` | CONVENTIONS |

## 3. Contract (backend-lead)
<!-- backend-lead · chi tiết: plan.md §2–§3 -->
`@ai/contracts/chat/rooms.ts` **chỉ thêm** (export C1 không đổi):
| Schema | Trường | Ràng buộc |
|---|---|---|
| `SendRoomMessageRequest` | `attachment_ids?: uuid[]` | 1…10, không trùng (`"duplicate"`), y hệt E12; server chuẩn hoá chữ thường |
| `RoomMessage` (kéo theo `room.message`, trang tin) | `attachments?: AttachmentRef[]` | 1…10, thứ tự `position`; vắng khi không file; `available = purged_at IS NULL` |

Thứ tự kiểm `POST /rooms/:id/messages`: 401 → 404 `ROOM_NOT_FOUND` → 400 zod → 400 tin timeline `!…` kèm file (D8) → trùng `client_msg_id` ⇒ 200 tin cũ → 404 `ATTACHMENT_NOT_FOUND{ids}` → đường X2b/P-a cũ → tx gắn (thiếu ⇒ 404, ROLLBACK) → 201. `GET /attachments/:id[/content]`: đọc được ⇔ (`room_id` NULL ∧ chủ ∧ hội thoại chưa xoá) ∨ (`room_id` ≠ NULL ∧ thành viên hiện tại); khác ⇒ 404 `NOT_FOUND`. Không mã lỗi mới; `CHAT_ATTACHMENT_ERRORS`/`CHAT_ROOM_ERRORS` giữ.

## 4. Dữ liệu (backend-lead)
<!-- backend-lead · chi tiết: plan.md §4–§7 -->
Migration `0023_x2b2_room_attachments.sql` (idx 23, idempotent; không sửa migration cũ):
| Đối tượng | Chốt |
|---|---|
| Cột | `attachments.room_id uuid NULL`, `room_message_id uuid NULL` |
| FK | `(room_id, tenant_id) → rooms(id, tenant_id)`; `(room_message_id, room_id) → room_messages(id, room_id) ON DELETE SET NULL (room_message_id)` + UNIQUE `room_messages(id, room_id)` |
| CHECK | `attachments_room_bound_ck`: `room_id` ≠ NULL ⇒ `message_id`, `conversation_id`, `flow_id` NULL ∧ `bound_at`, `position` 0…9; `attachments_room_msg_ck`: `room_message_id` ⇒ `room_id` |
| "Chưa gắn" | `message_id IS NULL AND room_id IS NULL` — sửa E12/sweeper R27/output (plan §5) |
| RLS | siết `attachments_hub_rw` (chủ chỉ thấy file phòng khi còn là thành viên) + `attachments_room_member_select` (SELECT, thành viên hiện tại, cùng tenant); ghi chỉ chủ |
| Definer | `hub.attach_claim_deleted_rooms(now, limit)` chỉ scope `system` (RLS `rooms` không có nhánh system) |
| Index | `attachments_room_message_idx (room_message_id, position)`, `attachments_room_live_idx (room_id) WHERE purged_at IS NULL`, `rooms_deleted_idx` |

Run phòng: file-set = file của tin gọi + cửa sổ ngữ cảnh (gồm tin agent), chốt `runs.attachment_ids` trong tx gọi; `createRunTx` bỏ chọn file H2c cho run phòng. `out/`: `SseWriter` không gắn khi run phòng; poster tx2 gắn vào tin agent khi `finished` ∧ `posted`. Sweeper: (b2) phòng xoá ⇒ `purged_at` + xoá nội dung (chu kỳ 600 s). Quota: không đổi (tenant, H2c-R16).

## 5. UI (frontend-lead)
Chi tiết: [`plan-frontend.md`](plan-frontend.md). **Không artboard mới** — tái dùng composer + chip tệp C1 (`Composer attachments`, `AttachBar`, `AttachmentList`). Contract tiêu thụ (backend-lead thêm, "Cần từ backend" trong plan-frontend §6): `SendRoomMessageRequest.attachment_ids?`, `RoomMessage.attachments?: AttachmentRef[]`.

| Màn / vùng | Hành vi |
|---|---|
| Composer phòng (DM, nhóm) + composer thread | Bật `attachments`: nút `button "Đính kèm tệp"`, kéo-thả, chip tiến trình/lỗi/Thử lại/Xoá (C1 nguyên văn: ≤ 10 tệp, 20 MB, loại tệp, hết dung lượng). Gửi cần có chữ (Q3): chip có mà ô trống ⇒ Gửi `disabled` + dòng gợi ý "Nhập nội dung…" |
| Dòng gợi ý chia sẻ (Q8) | Hiện dưới ô nhập **chỉ khi có chip**, `role="note"`, không hộp xác nhận: nhóm "Mọi thành viên của nhóm đều xem và tải được tệp này…"; DM "<Tên> sẽ xem và tải được…"; thread "Mọi thành viên của phòng…". Ghi rõ agent được `@` cũng đọc được (BR-21) |
| Tin phòng/thread có tệp | `MessageItem` thêm `AttachmentList` dưới bong bóng (mình: lệch phải); tin agent có `out/` (R11): `AgentBlock` thêm `AttachmentList` dưới thân. Bấm chip = tải (fetch + Authorization), không preview (Q15) |
| Trạng thái | Đang tải lên: chip "Đang tải lên…", Gửi `disabled` tooltip "Chờ tải tệp xong". `available=false`: chip xám, `aria-disabled`, tooltip "Tệp đã bị xoá". Lỗi tải: toast "Không tải được tệp." (gồm 404 khi vừa bị bớt khỏi nhóm). Lỗi gửi `ATTACHMENT_NOT_FOUND`: chip có id trong `details.ids` → lỗi `attach.err.missing` (chữ: plan-frontend §3), chữ giữ nguyên, chip khác giữ. Lỗi khác giữ chip + chữ (rollback ⇒ file còn chưa gắn, gửi lại được). Xung đột 409 `FLOW_BUSY`/429: như X2b |
| Realtime | `room.message` tới người khác mang `attachments[]` ⇒ chip hiện cùng tin (cache vá có sẵn, `insertMessage` khử trùng); nối lại SSE không lặp tin. Không phát nội dung tệp |

Chốt câu hỏi FE: **Q3** giữ (chữ bắt buộc, composer tự chặn) · **Q8** giữ (dòng gợi ý, không hộp xác nhận) · **Q13** giữ (thread có đính kèm) · **Q15** giữ (không preview).

## 6. Hiệu năng
Không siết hơn CONVENTIONS §6 (perf không chặn mốc). Mốc đo gợi ý: `POST /rooms/:id/messages` có file p95 ≤ ngân sách H2c PF2 (≤ 40 ms trên 2 file).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| H2c Storage `local` + sweeper | `HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR` tuyệt đối, đồng hồ sweeper tiêm (`sweepOnce`) |
| X2a/X2b phòng, `/me/stream`, room-run | `done:x2a`, `done:x2b`; 3 user cùng tenant + 1 user tenant khác |
| Agent đọc file / ghi `out/` | int: `jobFetch`/`jobOutput` (`_x2b2.ts`, token job); e2e: `FakeRuntime` TS op `/rt/output` |
| Dify | Không dùng (không có `/` trong phòng); không chạm Dify thật |

Env mới: không dự kiến.

## 8. Tiêu chí nghiệm thu (qc)
| AC | Given / When / Then (dữ liệu cụ thể) | Test |
|---|---|---|
| X2b2-AC01 | (FR-44, CHAT-AC-44) A upload `hoadon.pdf` 1 MiB, gửi tin "đây là hoá đơn" + id vào nhóm {A,B}: 201, `RoomMessage.attachments=[hoadon.pdf]`; B (online) nhận `room.message` kèm metadata; B tải `/content` đúng byte + header R17 | int + e2e |
| X2b2-AC02 | (R05, BR-22) C cùng tenant **không** là thành viên GET file → 404 `NOT_FOUND`; `tenant_admin` không phải thành viên → 404; user tenant khác → 404; thêm C vào phòng ⇒ C tải được file cũ; bớt C ⇒ 404 lại | int (RLS) |
| X2b2-AC03 | (R02) Id của người khác / đã gắn / hết hạn / của hội thoại riêng / phòng khác (đã gắn) → 404 `ATTACHMENT_NOT_FOUND{ids}` đúng thứ tự gửi, 0 tin, 0 run; 2 POST song song cùng id ⇒ 1 × 201, 1 × 404, file gắn 1 tin | int |
| X2b2-AC04 | (R03) Thứ tự lỗi: không phải thành viên + id sai ⇒ 404 `ROOM_NOT_FOUND`; id sai + `@x` không quyền ⇒ 404 `ATTACHMENT_NOT_FOUND` trước `AGENT_NOT_FOUND`; `TOO_MANY_RUNS` 429 ⇒ rollback, file còn chưa gắn, gửi lại được | int |
| X2b2-AC05 | (R04) 11 id / id trùng / `content` rỗng với file ⇒ 400 `VALIDATION_ERROR`; `client_msg_id` trùng ⇒ 200 tin cũ, file không gắn lại; loại/cỡ/hạn mức tenant lỗi ở upload (415/413/409) như H2c | int |
| X2b2-AC06 | (R07, FR-101) A gửi `hoadon.pdf` rồi "@hoadon kiểm tra file": `runs.attachment_ids=[hoadon.pdf]`, `jobFetch` (`_x2b2.ts`) thấy đúng `name:sha256`; B (không có quyền `hoadon`) vẫn xem kết quả | int + acceptance |
| X2b2-AC07 | (R08, BR-21) A có file riêng `rieng.pdf` ở hội thoại riêng và file `phongkhac.pdf` ở phòng P2; gọi `@hoadon` trong P1 ⇒ file-set không chứa hai file đó; deny sandbox: H2c `files.stack.test.ts` (trong `done:h2c`); token job khác ⇒ 401 | acceptance |
| X2b2-AC08 | (R07) Phòng 30 tin, file ở tin thứ 3 (ngoài 20 tin gần nhất) ⇒ không vào file-set; trong thread: file ở tin thread trong 50 ⇒ vào, ở timeline trước tin gốc trong 20 ⇒ vào; >10 file ⇒ 10 mới nhất; tin sau tin gọi không tính | int |
| X2b2-AC09 | (R09) B gọi `@hoadon` dùng file A đã gửi vào phòng ⇒ file-set có file A; usage/quota/`runs.user_id` của B; nếu B rời phòng giữa chừng ⇒ run huỷ, không ghi tin | int |
| X2b2-AC10 | (R11, R12) `jobOutput(run,"report.md")` trong run phòng của A ⇒ tin agent có `attachments=[report.md]`, B (không quyền agent) tải được; run lỗi/huỷ ⇒ không gắn; C không phải thành viên ⇒ 404 | int + acceptance |
| X2b2-AC11 | (R13, R14) Xoá nhóm ⇒ `/content` 404 ngay, nội dung mất sau 1 chu kỳ sweeper (`sweepOnce`), `purged_at` đặt; file chưa gắn quá 24 h + 1 s xoá; A rời nhóm ⇒ A 404 khi tải, B vẫn tải được | int |
| X2b2-AC12 | (R15) Tin agent chứa `attachments` tên `@hoadon.txt` hoặc nội dung "@hoadon" ⇒ 0 run | int |
| X2b2-AC13 | (R06, R18, AC-H07) `/conversations*` không trả file phòng (404); file hội thoại riêng không gắn được vào phòng; test khoá H2c + AC-H07 + X2b xanh nguyên văn; X2b-AC11 cũ (400 khi có `attachment_ids`) được **thay** có chủ đích bằng AC03/AC05 (qc ghi Tranh chấp test khoá) | contract + acceptance |
| X2b2-AC14 | (R16) Mất kết nối `/me/stream` rồi nối lại ⇒ không mất/lặp tin có file; payload không chứa byte | int |
| X2b2-AC15 | (UI, CHAT-AC-47/50 mở rộng) 2 trình duyệt: A bấm đính kèm trong DM, chọn file, thấy chip tiến trình + dòng gợi ý chia sẻ, gửi; B thấy chip, tải được; A gõ `@hoadon` ⇒ trạng thái "đang xử lý", kết quả cả phòng; file lỗi 415/413 báo đúng câu như C1 | e2e |
| X2b2-AC16 | (R20, R22) `!hoa-don` + file ⇒ 400 `VALIDATION_ERROR` path `attachment_ids` (I21); `!hoa-don` không file ⇒ P-a (I51); log không chứa tên file | int |

Lệnh xong: `bun run typecheck && bun test && bun --env-file=.env.test-qc.local run test:int && bunx playwright test -c e2e/chat/playwright.x2b2.config.ts` (= `bun run e2e:chat:x2b2`). Lệnh mốc: `done:x2b2` (qc, mẫu `done:x2b`) + hồi quy `done:h2c`, `done:x2b`.

## 9. Câu hỏi mở (đều có mặc định; không trả lời = chấp nhận mặc định — Luật 2b)
| Q | Câu hỏi | Mặc định đề xuất | Mức |
|---|---|---|---|
| Q1 | Upload dùng `POST /attachments` chung hay endpoint riêng phòng? | **Chung, không đổi** (file chưa gắn thuộc người upload, 24 giờ); gắn phòng ở `POST /rooms/:id/messages`. Tránh 2 đường upload | Thường |
| Q2 | Lưu liên kết file↔tin phòng thế nào? | Cột mới `attachments.room_id` + `room_message_id`, CHECK "gắn hội thoại **hoặc** phòng"; không đổi `room_messages`, không sửa migration cũ | Cao (RLS) |
| Q3 | Tin chỉ file, không chữ? | **Không** — `content` bắt buộc (khớp E12 và `room_messages_content_ck`); composer tự chặn gửi rỗng | Thấp |
| Q4 | Ai đọc file trong phòng? | Chỉ **thành viên hiện tại** (policy SELECT qua `hub.is_room_member`); rời/bị bớt ⇒ mất quyền ngay, thêm mới ⇒ xem cả lịch sử (khớp FR-96) | Cao |
| Q5 | Tập file của run phòng lấy từ đâu? | Cửa sổ ngữ cảnh X2b-R07 + tin gọi, ≤ 10 file/100 MiB, **không** toàn bộ lịch sử phòng (nhất quán ngữ cảnh 20/50 tin) | Cao |
| Q6 | File của hội thoại riêng người tag có dùng trong run phòng? | **Không** (chỉ file đã gắn vào tin phòng — BA FR-101) | Cao |
| Q7 | `out/` của agent trong run phòng hiện cho cả phòng? | **Có** (plan-questions Q14), gắn tin agent, `user_id` = người tag, trần H2c giữ | Thường |
| Q8 | Người gửi có cần xác nhận "chia sẻ với cả phòng"? | **Không hộp xác nhận**; chỉ dòng gợi ý dưới composer khi có file chờ (BR-21: người gọi chịu trách nhiệm chia sẻ) | Thấp |
| Q9 | Xoá file khỏi tin / thu hồi file? | **Không làm** (không sửa/xoá tin ở v1, FR-96); xoá phòng mới xoá file | Thấp |
| Q10 | Chủ nhóm có xoá file của người khác? | Không (như Q9) | Thấp |
| Q11 | Hạn mức dung lượng tính cho ai? | **Tenant** (như H2c-R16), tính theo người upload; không có hạn mức riêng phòng/người | Thấp |
| Q12 | `!quy-trình` + file trong phòng? | Giữ nguyên P-a; X2b-2 chỉ hồi quy (AC16), không mở rộng | Thường |
| Q13 | Thread (flow) có đính kèm? | **Có**, cùng luật; tin thread có `flow_id` + file; file-set theo R07 | Thường |
| Q14 | Mã CHAT-AC riêng cho đính kèm phòng? | Đề xuất `CHAT-AC-61` (đính kèm trong phòng, mở rộng CHAT-AC-47/50) và `AC-H38`; **docs-architect bổ sung vào BA/usecases khi Gate** (design chỉ sửa khi được giao); spec dùng X2b2-AC tới lúc đó | Thấp |
| Q15 | Xem trước (preview) ảnh/PDF trong phòng? | Không — tải/mở như C1 | Thấp |
| Q16 | Dify agent (`dify-*`) qua `@` có nhận file phòng? | **Không** (D12): runner Dify không dùng file như H2c T11; `runs.attachment_ids` vẫn ghi | Thường |

**PLAN BE (2026-10-12, plan §13):** giữ mặc định Q1, Q2, Q4 (+ siết policy chủ), Q5 (cửa sổ gồm tin agent), Q6, Q7, Q9–Q11, Q13; Q12 cụ thể: tin timeline `!…` kèm file ⇒ 400 như hôm nay. Q16 theo D12.

## 10. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-08: tách đính kèm khỏi X2b thành X2b-2; X2b trả 400 khi có `attachment_ids` (spec-decisions X2b Q9).
- 2026-10-10: thứ tự `P-a → X2b-2 → H4b → P-b → P-c`; 2026-10-12 (CR-062…066): `X2b-2 → H4b → P-b2 → K1 → P-c → K2`.
- 2026-10-12 PLAN BE: D1–D13 ở `plan.md` §1 (migration 0023, "chưa gắn" = 2 cột NULL, FK kép, siết RLS chủ, definer sweeper, `!…`+file 400, Q16 đổi).
### Trong lúc làm (agent tự quyết theo Luật 2)
- 2026-10-12 readiness lần 1 (NOT READY, 7 Cao), mặc định đã chấp nhận: [`spec-decisions.md`](spec-decisions.md).

## 11. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Rò file giữa phòng/hội thoại/tenant (hard stop) | RLS + test cách ly AC02/AC07, security review riêng, `db:test` thật |
| Policy SELECT mới làm chậm/đệ quy RLS (`is_room_member` trong policy `attachments`) | Dùng hàm definer sẵn có, `STABLE`; đo EXPLAIN ở PLAN |
| Race gắn 2 tin cùng file; file mồ côi khi rollback | Đếm hàng như H2c-R11; sweeper 24 giờ |
| Test khoá X2b-AC11 (400) đối nghịch hành vi mới | qc thay có chủ đích, ghi Tranh chấp test; không để code sửa test |
| Phình mốc (BE ≈ 450 dòng TS + 120 SQL, FE ≈ 300) | PLAN tách task: B1 migration+RLS (cao), B2 gắn+đọc (cao), B3 file-set+`out/` (cao), B4 sweeper, F1 composer+chip |

## 12. Tranh chấp test
- Dự kiến (PLAN, thay có chủ đích — chỉ qc sửa): `tests/acceptance/X2b/context.int.test.ts` "X2b-AC11 · attachment_ids vào tin phòng → 400" và `tests/acceptance/X2b/rules/contracts-x2b.test.ts` K5 dòng `attachment_ids ⇒ false` (plan §12). Test "run phòng không mang file" giữ.
