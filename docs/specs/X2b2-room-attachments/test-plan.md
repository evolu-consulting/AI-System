# Test plan · X2b2-room-attachments (qc, chế độ PLAN — chưa WRITE, chưa LOCK)

Nguồn: spec (`595ef3ae`; X2b2-R01…R22, AC01…AC16, §9, §12), plan BE `225ab5d3` (§3 thứ tự kiểm, §4 DB, §5 "chưa gắn", §8 chữ ký luật, §11 S1–S7, §12 test khoá), plan-frontend `7f9365ce` (§5 nhãn e2e). Không Dify thật, không `claude-sub`: Runtime = `ScriptRuntime` H1 (`fake-cli`, directive `#fake:files`, `#fake:out=…`, `#fake:read=`). `tests/.lock` **chưa ghi** (khoá sau Gate, task Q1). Mọi tên test bắt đầu bằng mã (`HUB-FR-44 · X2b2-AC02 · …`).

## 1. Hạ tầng
| Thứ | Nội dung |
|---|---|
| DB | **Tag riêng**: `bun run db:test:create qc` (sinh lại `.env.test-qc.local` — file sau P-b RV3 đã ghi đè cả `HUB_TEST_DATABASE_URL` và `AGENT_RT_TEST_DATABASE_URL`; file cũ trỏ `ai_system_h1_test` chung ⇒ tạo lại trước khi chạy). Chạy `bun --env-file=.env.test-qc.local --config=bunfig.int.toml test tests/acceptance/X2b2` |
| `tests/acceptance/X2b2/_x2b2.ts` | `startX2b` (X2b) + kho H2c (`HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR` = `tempDir("x2b2")`, `sweepOnce` tiêm đồng hồ) + `upload(who, name, bytes)` (POST `/attachments` multipart) + `sendRoom(who, room, {content, attachment_ids?, flow_id?, client_msg_id?})` + `roomFiles(sql, roomId)` đọc bằng `to_jsonb(a)->>'room_id'` (trước B1 cột chưa có ⇒ trả rỗng ⇒ đỏ ở `expect`, không `PostgresError 42703`) |
| `tests/acceptance/X2b2/_modules.ts` | nạp động `room-files.rules.ts`, `rooms.rules.ts`, `room-agent.rules.ts`, `@ai/contracts/chat` (vắng hàm ⇒ `{}` ⇒ đỏ `expect(typeof f).toBe("function")`, không `TypeError` khi import) |
| Người (fixture X2a/H1) | A = `lan` (quyền `hoadon`) · B = `hoa` (bỏ grant `hoadon`, như X2b) · C = `cuc` (acme, ngoài phòng) · TA = `tadmin` (`tenant_admin` acme, ngoài phòng) · Z = `zed` (tenant `zeta`) |
| Phòng | G1 nhóm {A, B} "Phòng hoá đơn" · G2 nhóm {A, C} "Phòng khác" · DM A↔B · mỗi ca tạo phòng mới (tên có số ca) — không dùng chung trạng thái giữa ca |
| File mẫu | `hoadon.pdf` 1 MiB (`%PDF-1.7` + đệm cố định, sha256 tính trước) · `rieng.pdf` 2 KiB (hội thoại riêng A) · `phongkhac.pdf` 2 KiB (G2) · `a.txt` "xin chào" · `@hoadon.txt` · `.exe` giả (415) · 20 MiB + 1 B (413) |
| Bẫy | (1) Sweeper **toàn cục** (không lọc tenant) và `purged` nay gộp phòng xoá (plan §6.5) ⇒ ca X2b2 **không** khẳng định số đếm `SweepResult`, chỉ khẳng định trạng thái hàng của chính ca (`purged_at`, file trên đĩa); H2c `sweeper.int` (A122 `purged ≥ 1`, A127 `expired` = [500, 1]) chạy cùng DB ⇒ X2b2 không để lại file **chưa gắn** quá 24 h sau ca của mình (dọn ở `afterEach`), và chạy tuần tự (`bunfig.int.toml` một tiến trình). (2) `${obj}::jsonb` → `sql.json`; mảng uuid → `sql.array(ids, 2951)`. (3) Listener `/me/stream`: tìm sự kiện từ mốc `from` của ca. (4) Không `sleep`: `waitFor` theo điều kiện (hàng `runs.status`, sự kiện SSE) |

## 2. Luật thuần + contract (`tests/acceptance/X2b2/rules/`, `bun test`)
| Mã | FR/R/AC | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| U01 | R07, AC08 | `room-files-rules.test.ts` · `pickRoomRunFiles` | 3 tin (trigger seq 30 có 1 file; seq 29 có 2 file position 1,0; seq 5 có 1) | thứ tự: file tin gọi → seq 29 (position 0, 1) → seq 5 |
| U02 | R07, H2c-R14 | ″ | 12 file 1 KiB ở 12 tin | đúng 10, mới nhất trước (dừng ở file thứ 11) |
| U03 | R07, H2c-R14 | ″ | 6 file × 20 MiB | 5 file (tổng 100 MiB; file thứ 6 vượt ⇒ dừng); biên đúng 100 MiB = nhận |
| U04 | R07 | ″ | rows rỗng / trigger không file | `[]` / bắt đầu từ seq kế |
| U05 | R07, D9 | `roomFileWindow` | trigger `m30`, main `[m11…m29]`, thread `[t1…t3]`, main trùng `m30` | `[m30, m11…m29, t1…t3]`, không trùng, giữ thứ tự xuất hiện đầu |
| U06 | R05, R06 | `canReadAttachment` | bảng 8 dòng: phòng+thành viên ✓; phòng+không thành viên ✗; phòng+chủ đã rời ✗; phòng xoá ✗; hội thoại+chủ ✓; hội thoại+người khác ✗; hội thoại xoá ✗; phòng+thành viên không phải chủ ✓ | đúng bảng |
| U07 | D3 | `isUnbound` | (null,null) ✓ · (msg,null) ✗ · (null,room) ✗ | |
| U08 | R16, C-4 | `attachmentRefs` | `[]` ⇒ `undefined`; 2 hàng, 1 `purgedAt` ⇒ `available` [true,false], đúng 5 khoá `AttachmentRef` | |
| U09 | D8, R20 | `rooms-rules.test.ts` · `roomFilesAllowed` | `!hoa-don x` engine bật không flow ⇒ false; `!` sai cú pháp ⇒ false; engine tắt ⇒ true; có `flowId` ⇒ true; có `answerRunId` ⇒ true; chữ thường ⇒ true | |
| U10 | R11, S6 | `room-agent-rules.test.ts` · `shouldBindRoomOutputs` | 4 status × 3 reason | true ⇔ `finished` ∧ `posted` |
| K1 | C-1 | `contracts-x2b2.test.ts` | `SendRoomMessageRequest` + `attachment_ids` 1 id / 10 id | pass |
| K2 | R04 | ″ | 11 id · trùng · trùng khác hoa thường (zod chỉ bắt trùng nguyên văn — ghi rõ) · `[]` · không uuid | fail (`"duplicate"` ở id trùng) |
| K3 | C-2, R16 | ″ | `RoomMessage` + `attachments` 1…10 `AttachmentRef`; 11 ⇒ fail; `[]` ⇒ fail; khoá lạ trong ref ⇒ fail; vắng ⇒ pass | |
| K4 | R16 | ″ | `parseMeStreamEvent` `room.message` có `attachments` | parse được, giữ mảng |
| K5 | D13, X2a R24 | ″ | `CHAT_ATTACHMENT_ERRORS`, `CHAT_ROOM_ERRORS`, `CHAT_ROOM_AGENT_ERRORS` | y nguyên giá trị hiện có (xanh trước code — bảo toàn) |

## 3. Acceptance int (`tests/acceptance/X2b2/*.int.test.ts`, app thật + DB tag `qc`)
### 3.1 Cách ly RLS / đọc — `access.int.test.ts` (rủi ro cao; S2)
| Mã | AC/R | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| I01 | AC01, R01, R17 | A upload `hoadon.pdf`, gửi G1 "đây là hoá đơn" + id | 201; `attachments=[{id,filename:"hoadon.pdf",mime:"application/pdf",size:1048576,available:true}]`; B GET `/content` 200, byte đúng sha256, header `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment…`, `Cache-Control: private, no-store` |
| I02 | AC02, R05 | C, TA, Z GET `/attachments/:id` và `/content` | 404 `NOT_FOUND` cả 6 (không 403); Z thử cả id đúng |
| I03 | AC02, R05 | thêm C vào G1 (API X2a) → C GET; bớt C → C GET | 200 rồi 404 |
| I04 | AC11, R05, R13 | **người upload A rời G1** → A GET `/attachments/:id` + `/content`; B GET | A 404 ×2; B 200 |
| I05 | S2, D5 | SQL trực tiếp scope `user` (đặt GUC như app, **bỏ lọc app**): `select count(*) from hub.attachments where id=$f` với C, TA, Z, A-đã-rời | 0 mọi người; B = 1 |
| I06 | R19 | B ẩn DM A↔B (`POST /rooms/:id/hide`) → B GET file của tin DM | 200 |
| I07 | AC02, R12 | B (không quyền `hoadon`) tải file `out/` (từ I30) | 200; `usage_logs` B không đổi |
| I08 | R16, AC14 | B nghe `/me/stream`; A gửi tin có file | B nhận `room.message` có `attachments` metadata, payload không có khoá chứa byte/nội dung (không `content_base64`, cỡ payload < 2 KiB) |
| I09 | AC14 | B ngắt `/me/stream` trước khi A gửi, nối lại với `Last-Event-ID` | đúng 1 lần tin có file, `attachments` đủ; trang `GET /rooms/:id/messages` có `attachments` khớp |
| I10 | R16 | `GET /rooms/:id/messages` 2 tin (1 có file, 1 không) | tin không file **vắng** khoá `attachments`; tin có file đúng thứ tự `position` |

### 3.2 Gửi / gắn — `send.int.test.ts`
| Mã | AC/R | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| I11 | AC03, R02 | 1 lượt POST có 4 id sai: id của B (chưa gắn), id A đã gắn G2, id A hết hạn (`created_at` −24 h −1 s qua SQL), id **của hội thoại riêng** A (`rieng.pdf` đã gửi `/conversations/:id/messages`) + 1 id đúng | 404 `ATTACHMENT_NOT_FOUND`, `details.ids` = 4 id sai **đúng thứ tự gửi**; 0 tin mới, 0 run; id đúng vẫn chưa gắn (`room_id` NULL) |
| I12 | AC03, R02 | id có nội dung mất (xoá file trên đĩa, `purged_at` đặt) | 404 `ATTACHMENT_NOT_FOUND` |
| I13 | AC03, R02 | 2 POST song song (2 `client_msg_id` khác) cùng id | 1 × 201, 1 × 404; file gắn đúng 1 tin; `room_messages` +1 |
| I14 | AC04, R03 | C (ngoài G1) gửi G1 + id sai | 404 `ROOM_NOT_FOUND` (không lộ file) |
| I15 | AC04, R03 | A "@khongco xem" + id sai | 404 `ATTACHMENT_NOT_FOUND` (trước `AGENT_NOT_FOUND`) |
| I16 | AC04, R03 | A đã 2 run chạy (`maxConcurrentRuns: 2`) gửi "@hoadon xem" + id đúng | 429 `TOO_MANY_RUNS`; file `room_id` NULL; gửi lại sau khi run xong ⇒ 201, gắn |
| I17 | AC05, R04 | 11 id · id trùng · `content: ""` + id · `attachment_ids: []` | 400 `VALIDATION_ERROR` ×4, 0 tin |
| I18 | AC05, R04 | gửi lại cùng `client_msg_id` + cùng id | 200, cùng `id` tin, `attachments` như cũ; `bound_at` không đổi; số hàng gắn = 1 |
| I19 | AC05 | upload `.exe` giả / 20 MiB + 1 B / vượt hạn mức tenant (`tenantMaxBytes` nhỏ) | 415 / 413 / 409 như H2c (hồi quy) |
| I20 | R04, Q13 | tin thread (`flow_id` của thread trong G1) + file | 201; `GET ?flow_id=` có `attachments`; timeline không có tin |
| I21 | D8, AC16 | engine P-a bật, G1 "!hoa-don HD-12" + id | 400 `VALIDATION_ERROR` path `attachment_ids`; file chưa gắn; 0 process-run |
| I22 | R14, R01 | A upload, A bị bớt khỏi G1, A gửi G1 + id | 404 `ROOM_NOT_FOUND`; file chưa gắn |

### 3.3 Không rò sang hội thoại riêng / DB — `isolation.int.test.ts` (rủi ro cao; S1, S4, S5)
| Mã | AC/R | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| I23 | AC13, R06, S1 | A upload `x.txt`, **gắn vào G1**, rồi gửi `POST /conversations/:id/messages` hội thoại riêng A + id đó | 404 `ATTACHMENT_NOT_FOUND`; hàng vẫn `room_id`=G1, `message_id` NULL |
| I24 | AC13, R06 | `GET /conversations/:id/messages` của A sau I23; tin trong hội thoại riêng không có file phòng | không id file phòng ở đâu |
| I25 | AC13, S1 | `DELETE /attachments/:id` (chủ A) với file đã gắn phòng | 404 (không xoá được; `deleteAttachment` chỉ chưa gắn) |
| I26 | S4 | SQL scope `system`: `UPDATE attachments SET room_id = <phòng tenant zeta>` cho file acme | lỗi 23503 (FK `attachments_room_fk`) |
| I27 | S4 | SQL: `room_id=G1`, `room_message_id` = tin của G2 | 23503 (`attachments_room_message_fk`) |
| I28 | S4, R06 | SQL: đặt `room_id` cho file đã có `message_id` (hội thoại) | 23514 (`attachments_room_bound_ck`); `room_message_id` không `room_id` ⇒ 23514 (`attachments_room_msg_ck`) |
| I29 | S2, D5 | SQL scope `user` = C (không thành viên): `UPDATE attachments SET filename='x' WHERE id=<file G1>` | 0 hàng |
| I29b | S5 | `select hub.attach_claim_deleted_rooms(now(), 10)` scope `user` | 42501 |
| Ghi | — | Trước B1: I26–I29b kiểm trước `hasColumn('room_id')` bằng `expect(...).toBe(true)` ⇒ đỏ ở `expect`, không `PostgresError` | |

### 3.4 File cho agent — `run-files.int.test.ts` (rủi ro cao; S3)
| Mã | AC/R | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| I30 | AC06, R07 | A gửi `hoadon.pdf` vào G1, rồi "@hoadon kiểm tra file #fake:files" | `runs.attachment_ids=[hoadon]`; job `payload.attachments` 1 phần tử; tin agent liệt kê `hoadon.pdf:<sha256>`; B thấy tin agent |
| I31 | AC07, R08 | A có `rieng.pdf` (hội thoại riêng, đã gắn), `phongkhac.pdf` (G2, A gửi), `chuagan.pdf` (A upload, chưa gắn); A gọi `@hoadon #fake:files` trong G1 | file-set **chỉ** file G1; không 3 file kia |
| I32 | AC07, R08 | `#fake:read=<đường dẫn job khác>/phongkhac.pdf` | deny (Runtime báo lỗi đọc, tin agent không chứa nội dung) |
| I33 | AC07 | endpoint nội bộ tải file: token job của run G2 xin id file G1; token rác | 404 (id không trong payload, H2c-R15) / 401 |
| I34 | AC08, R07 | G1 30 tin thường, file ở tin thứ 3; gọi `@hoadon` | file tin 3 **không** trong `attachment_ids` |
| I35 | AC08, R07 | thread T: file ở tin thread #5 (trong 50), file ở tin timeline ngay trước tin gốc (trong 20) | cả hai vào file-set |
| I36 | AC08 | 12 tin có file trong cửa sổ | 10 file mới nhất, file tin gọi đầu |
| I37 | AC08 | tin có file gửi **sau** tin gọi (trong lúc run chờ) | không trong `runs.attachment_ids` (chốt lúc tạo run) |
| I38 | AC09, R09, R10 | A gửi file; **B** gọi `@trello #fake:files` (B có `trello`) | file-set có file A; `runs.user_id`=B; usage B tăng, A không; usage không phụ thuộc số file (so với run cùng prompt không file: chênh 0) |
| I39 | AC09, R09 | B gọi, B rời G1 khi run đang chạy | run `cancelled`, không tin agent; file còn trong phòng, A tải 200 |
| I40 | AC12, R15 | tin agent có `attachments` tên `@hoadon.txt` (từ `#fake:out=@hoadon.txt`) và nội dung "@hoadon" | 0 run mới ngoài run gốc |
| I41 | D10 | run phòng không file (đối chứng X2b-AC11 giữ) | `payload.attachments` vắng; `runs.attachment_ids={}` |

### 3.5 `out/` — `outputs.int.test.ts`
| Mã | AC/R | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| I42 | AC10, R11 | A "@hoadon #fake:out=report.md" trong G1 | tin agent `attachments=[report.md]`; hàng `room_id`=G1, `room_message_id`=`runs.answer_message_id`, `user_id`=A, `origin=output`, `message_id`/`conversation_id`/`flow_id` NULL; B tải 200; C 404 |
| I43 | AC10, D11 | cùng run: hội thoại nền | file **không** gắn vào `hub.messages` (không thấy qua `/conversations*`) |
| I44 | AC10, S6 | run `failed` (`#fake:out` + lỗi) / A huỷ | không gắn; hàng `room_id` NULL (R27 dọn) |
| I45 | R11, H2c-R26 | `#fake:out` 6 file | 5 file gắn |
| I46 | R16 | B nghe `/me/stream` | `room.message` tin agent có `attachments` |

### 3.6 Vòng đời — `lifecycle.int.test.ts`
| Mã | AC/R | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| I47 | AC11, R13 | chủ xoá G1 (DELETE X2a) | B GET `/content` 404 **ngay**; sau `sweepOnce(now)`: hàng còn, `purged_at`=now, file mất trên đĩa |
| I48 | AC11, S1 | file gắn G1 `created_at` −25 h (SQL), G1 sống, `sweepOnce` | **không** bị xoá (không phải "chưa gắn"); B tải 200 |
| I49 | AC11, R14 | file chưa gắn −24 h −1 s | bị xoá sau `sweepOnce` |
| I50 | S5 | `sweepOnce` lần 2 sau I47 | hàng đã `purged_at` không bị claim lại (file G1 vẫn một hàng, `purged_at` không đổi) |
| Ghi | — | chỉ khẳng định hàng/file của ca; **không** `expect(r.purged).toBe(n)` (bẫy §1) | |

### 3.7 P-a + log — `regress.int.test.ts`
| Mã | AC/R | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| I51 | AC16, R20 | `!hoa-don` không file trong G1 (engine bật) | hành vi P-a như `done:pa` (process-run tạo) |
| I52 | AC16, R22, S7 | bắt log (sink H2c, như A127) qua I01, I11, I30, I47 | không dòng log nào chứa `hoadon.pdf`/`phongkhac.pdf`; có `attachment_id` khi log lỗi |

## 4. Contract (Hub thật qua hub-dev — `tests/contract/chat/x2b2-additive.contract.test.ts`)
| Mã | AC | Kỳ vọng |
|---|---|---|
| C01 | AC01, AC13 | POST tin phòng có file ⇒ thân parse `RoomMessageSchema`; `GET /rooms/:id/messages` parse `RoomMessagePageSchema` |
| C02 | AC13 | snapshot export C1/X2a không đổi (`x2a-additive` xanh) |

## 5. E2E (`e2e/chat/x2b2-attach.x2b2.ts`, 2 trình duyệt, nhãn nguyên văn plan-frontend §5)
Stack: config mới `e2e/chat/playwright.x2b2.config.ts` = `playwright.x2b.config.ts` + `HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR` tạm (stack X2b hiện **không** bật kho ⇒ cần). A = `lan` (hoadon), B = `thu` (không hoadon), như `x2b-room.x2b.ts`.
| Mã | AC | Bước | Kỳ vọng |
|---|---|---|---|
| E01 | AC15 | A mở DM "Tin nhắn cho <B>", `button "Đính kèm tệp"` → `setInputFiles(hoadon.pdf)` | `list "Tệp đính kèm"` 1 `listitem`; chip "Đang tải lên…" rồi hết; `note` chứa "<B> sẽ xem và tải được tệp này" |
| E02 | AC15, Q3 | ô trống có chip | `button "Gửi"` disabled; `note` "Nhập nội dung tin để gửi kèm tệp." |
| E03 | AC15, AC01 | A gõ "đây là hoá đơn", Gửi | A: `list "Tệp trong tin"` có `button "Tải hoadon.pdf"`; B (trình duyệt 2, không tải lại): chip xuất hiện; B bấm tải ⇒ `page.waitForEvent("download")` tên `hoadon.pdf` |
| E04 | AC15, AC06 | A gõ "@hoadon kiểm tra file" | trạng thái "đang xử lý" như X2b; B thấy `article "Trả lời của agent …"` |
| E05 | AC15, AC10 | A "@hoadon #fake:out=report.md" | `article "Trả lời của agent …"` chứa `list "Tệp trong tin"` `button "Tải report.md"`; B tải được |
| E06 | AC15 | nhóm: chip ⇒ `note` "Mọi thành viên của nhóm đều xem và tải được tệp này" | |
| E07 | AC15 | `.exe` / 20 MiB + 1 B | câu lỗi `attach.err.type` / `attach.err.tooLarge` nguyên văn C1 (như `x1-attachments.chat.ts`) |
| E08 | AC02, D10 | A bớt B khỏi nhóm; B bấm tải chip cũ | toast "Không tải được tệp." (hoặc luồng `useRoomLost`) |
Chờ theo `waitForResponse`/locator, không `waitForTimeout`.

## 6. Hồi quy (không sửa, phải xanh)
`done:h2c` (A131/A133/A134 idempotent 0007, `sweeper.int`, outputs, run-files) · `done:x2b` (trừ 2 dòng thay §7) · `done:pa` (I51 kèm) · X2a `db-rls.int` (đếm 7 policy `room_messages`), snapshot C1 · AC-H07 (`tests/acceptance/H1`/`C1`) · `e2e:chat:x2b`, `e2e:chat:x2a`, `x1-attachments.chat.ts`.

## 7. Test khoá cần thay có chủ đích (plan §12, spec §12)
| Test khoá | Hiện | Thay | Lý do (ghi vào spec §12 + `X2b-room-agents/spec-decisions.md` "Tranh chấp test") |
|---|---|---|---|
| `tests/acceptance/X2b/context.int.test.ts` "HUB-FR-101 · X2b-AC11 · attachment_ids vào tin phòng → 400…" (dòng 136) | 400 + 0 run | **xoá ca**, thay bằng con trỏ comment `// thay bởi X2b2 I11/I17 (X2b2-AC03/AC05)`; header dòng 3 bỏ "`attachment_ids` → 400" | Q9 X2b tách đính kèm sang X2b-2; hành vi mới hợp lệ ở X2b2-R01…R04 |
| `tests/acceptance/X2b/rules/contracts-x2b.test.ts` K5 (dòng 87) | `attachment_ids: [U(11)]` ⇒ false | ⇒ **true**; thêm 11 id / trùng ⇒ false; tên test bỏ "attachment_ids ⇒ fail" | contract C-1 |
| "X2b-AC11 · run phòng không mang file" | — | **giữ** (đối chứng I41) | |
Cách làm (chỉ qc): (1) sửa 2 file trong **cùng commit** với khoá X2b2 (`test(x2b-2): khoá test + thay X2b-AC11 [HUB-FR-44]`); (2) ghi dòng vào spec X2b2 §12: `- 2026-10-xx · qc · X2b-AC11 (context.int) + K5 (contracts-x2b) thay có chủ đích — đối chiếu BA FR-101 + Q9 X2b: test cũ đúng ở X2b, sai sau X2b-2; không phải code sửa test.`; (3) chạy lại `tests/.lock` cho cả hai file, `bun run test:lock:verify`. Trước khi B2/B3 xong 2 dòng mới đỏ đúng lý do (contract chưa thêm); dòng cũ không còn.

## 8. Đỏ đúng lý do (chưa chạy — điền ở WRITE, DB `ai_system_qc_test` tag `qc`)
Kỳ vọng trước B1: rules U01–U10 đỏ ở `expect(typeof …).toBe("function")`; K1/K3/K4 đỏ ở `expect(ok…)`; K5 xanh. Int I01…I52 đỏ ở `expect(status)` (400 strict X2a) hoặc `expect(hasColumn)`; xanh trước code (bảo toàn): I02 (404), I14, I19, I22, I49, I51. E2E đỏ ở locator `button "Đính kèm tệp"` trong phòng.

## 9. Lỗ hổng spec phát hiện (gửi Gate, đều có mặc định qc dùng)
| # | Chỗ | Vấn đề | Mặc định qc |
|---|---|---|---|
| G1 | R10, R12, R19 | Không có AC riêng | test I38 (usage không theo file), I07 (usage người tải), I06 (ẩn phòng) map vào R |
| G2 | R11 vs plan §13 C-2 | R11 "trần 5 file" (mỗi job) vs tin agent ≤ 10 (nhiều job Orchestrator) | test 1 job ⇒ 5 (I45); không test > 5 |
| G3 | R20 vs D8 | R20 "file theo đường process-runs" — D8 chốt `!…` + file ở timeline ⇒ 400 | theo D8 (I21) |
| G4 | Q13 | File trong **thread quy trình** (`flow_id` của process thread): gắn được (D8 cho qua) nhưng chưa rõ process engine có dùng | chỉ kiểm 201 + gắn, không kiểm input quy trình |
| G5 | AC07 "token phòng khác ⇒ 401" | Endpoint nội bộ xác thực theo **job**, không theo phòng | I33: token job khác ⇒ 404 id ngoài payload; token rác ⇒ 401 |
| G6 | R05 | `platform_admin` không nhắc | coi như người ngoài ⇒ 404 (thêm `padmin` vào I02 nếu có scope user) |
| G7 | K2 | id trùng khác hoa thường: zod không bắt, server chuẩn hoá ⇒ 400 | test ở int (I17 thêm biến thể), không ở contract |
| G8 | E2E | Stack `_x2b-stack.ts` không bật kho đính kèm; chưa có script `e2e:chat:x2b2` trong `package.json` | Cần bổ sung (frontend-lead/backend-lead): script + env kho trong stack mới |
