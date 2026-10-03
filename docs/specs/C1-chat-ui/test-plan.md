# Test plan · C1-chat-ui (qc)

Chế độ **TEST-PLAN** · 2026-10-04 · Chưa có file test; viết ở QB/QA/QE (§7), khoá ở QL.
"Đúng" = CHAT-AC-01…30 (`usecases-chat.md`), CHAT-AC-31…36 + C1-R01…R09 (`spec.md` §2, §8), contract `plan.md` §2, mock `plan.md` §3, nhãn `plan-frontend.md` §7, câu chữ `plan-frontend-i18n.md`.

## 1. Quy ước

- **Tên test:** `"CHAT-AC-nn · …"` (luật: `"C1-R09 · …"`); ca có nhiều mã ghi mã chính trước. Mã ca trong file này (`K-A1`, `E-S3`, `U-4`) đặt ở cuối tên test để truy vết: `it("CHAT-AC-05 · gửi ở ô chính tạo flow mới, không flow_id [K-M1]")`.
- **3 loại:** `contract` (`tests/contract/chat/*.contract.test.ts`, gọi HTTP tới `HUB_URL`, không DB) · `unit` (`tests/acceptance/C1/*.test.ts`, hàm thuần/quét file, `bun test`) · `e2e` (`e2e/chat/*.chat.ts`, Playwright, chromium, `vi-VN`, `Asia/Ho_Chi_Minh`).
- **Ca "mọi Hub" / "chỉ mock":** `_env.ts` gọi `GET /__mock/ping` một lần; 204 ⇒ `isMock`. Ca chỉ-mock nằm trong `describe.if(isMock)` (plan §6 R6) — đây là điều kiện đích, không phải `skip`. Không `skip`/`only`/`todo`.
- **Kịch bản:** contract **chỉ** dùng tiền tố `#scn:<tên>` (`CHAT_SCN_PREFIX` import từ contract); e2e cũng gõ `#scn:` vào composer (Chạy lại/Thử lại gửi lại nguyên văn nên giữ kịch bản); `/__mock/scenario` chỉ dùng khi UI tự gửi câu không có tiền tố (không ca nào cần ở C1). Không `sleep`; chờ theo sự kiện SSE/`expect.poll`/`waitForRequest`/`toBeVisible`.
- **Parse strict:** mọi body thành công parse bằng schema `@ai/contracts/chat` (strict ⇒ thừa trường là đỏ); lỗi parse `ErrorResponseSchema` + `status === CHAT_API_ERRORS[code]` (`/auth/*`: `API_ERRORS`). Khung SSE đọc bằng `createSseParser` + `toChatEvent` của contract (`_client.readStream`).
- **Dữ liệu:** contract tạo hội thoại mới mỗi ca (tiêu đề có hậu tố `#n` theo bộ đếm file, tất định), user A = `lan`, B = `hoa` (cùng tenant), C = `an` (khác tenant), khoá = `khoa` (hoặc `CHAT_CONTRACT_USERS`); **không** `/__mock/reset` trong contract (Hub thật không có). Ca dùng seed (`minh`, plan §3.5) là chỉ-mock. E2e: `beforeEach` `POST /__mock/reset` rồi đăng nhập `acme/minh/dev-password-1`.
- **Ngưỡng thời gian:** `≥`/`≤` rộng, không `==`.

## 2. Hạ tầng chạy (đề xuất, chốt ở QB/QE)

| Mục | Đề xuất | Ai làm |
|---|---|---|
| Contract — đích | `_env.ts`: `HUB_URL` trống → `Bun.serve({port: 0, fetch: createHubMock(loadMockEnv({MOCK_FAST: "1"})).fetch})` trong tiến trình (import tương đối `../../../tools/mocks/src/{hub,env}`; dùng `loadMockEnv` để typecheck xanh cả trước B2); `AUTH_URL` trống → `HUB_URL`; users từ `CHAT_CONTRACT_USERS` hoặc plan §3.4 | qc (QB) |
| Contract — tách khỏi `bun test` gốc | Như `test:int` (lý do §8 M1): `bunfig.toml` thêm `"tests/contract/**"` vào `pathIgnorePatterns`; `bunfig.contract.toml` (không ignore); script `"test:contract:chat": "bun --config=bunfig.contract.toml test --timeout 30000 tests/contract/chat"` | backend-lead/điều phối, **trước khi commit QB** |
| E2e — tách khỏi admin | Config riêng `e2e/chat/playwright.config.ts` (qc giữ, bị khoá): `testDir: "."`, `testMatch: "**/*.chat.ts"`, `workers: 1`, `fullyParallel: false`, `baseURL: http://localhost:3100`, `locale: "vi-VN"`, viewport 1280×800. `.chat.ts` không khớp `testMatch` mặc định của config admin ⇒ **không sửa** `playwright.config.ts`, hai bộ không chạy lẫn | qc (QE) |
| E2e — webServer | (1) mock: `bun tools/mocks/src/server.ts`, env `HUB_MOCK_PORT=${P}` (`P = CHAT_E2E_HUB_PORT ?? 4020`), `DIFY_MOCK_PORT=${P-8}` (tránh 4010 của mock dev), `MOCK_FAST=1`, `url: http://localhost:${P}/health`, `reuseExistingServer: false`. (2) chat-web: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview`, env `HUB_URL=http://localhost:${P}`, `AUTH_URL=""`, `url: http://localhost:3100`, `reuseExistingServer: false` (AC-34). | qc (QE) |
| Script | `"e2e:chat": "playwright test -c e2e/chat/playwright.config.ts"` | backend-lead B6 (chỉ `scripts`) |
| Lock | `tools/scripts/src/test-lock.ts` `LOCKED_DIRS` thêm `"tests/contract"` (hiện chỉ `tests/acceptance`, `e2e`) | backend-lead (B6 hoặc trước QL) |

**Thứ tự chạy:** contract: file chạy tuần tự trong một tiến trình (mặc định bun), ca trong file tuần tự; không trạng thái toàn cục trừ K-A9 (`expire-access`, đặt **cuối** `auth.contract.test.ts`, sau đó đăng nhập lại). E2e: `workers: 1`, mỗi test `beforeEach` reset mock ⇒ tuần tự tuyệt đối (dùng `/__mock/reset`, `/__mock/expire-access`). Contract (cổng ngẫu nhiên) và e2e (4020) không chung mock; e2e chat không đụng cổng admin (3000/3001).

**Lệnh**

| Mục đích | Lệnh |
|---|---|
| Contract, mock trong tiến trình | `bun run test:contract:chat 2>&1 \| tail -40` |
| CHAT-AC-32 (instance thứ hai) | `DIFY_MOCK_PORT=4011 HUB_MOCK_PORT=4021 MOCK_FAST=1 bun run mocks` (nền) · `HUB_URL=http://localhost:4021 bun run test:contract:chat \| tail -40` |
| Hub thật (H1) | `HUB_URL=… AUTH_URL=… CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat` (plan §4.1) |
| Unit acceptance | `bun test tests/acceptance/C1 2>&1 \| tail -40` |
| E2e chat | `bunx playwright test -c e2e/chat/playwright.config.ts --reporter=line \| tail -40` (một file: thêm `auth`) |
| CHAT-AC-34 (đổi đích) | `CHAT_E2E_HUB_PORT=4021 bunx playwright test -c e2e/chat/playwright.config.ts --reporter=line auth send \| tail -40` |
| Lock | `bun run test:lock:write` (chỉ qc, QL) · `bun run test:lock:verify` |

## 3. Ma trận AC → test

Given/When/Then: `usecases-chat.md`, spec §8. Loại: K = contract · U = unit acceptance · E = e2e. Mã ca ở §4–§6. Task = task code làm xanh.

| AC | K | U | E | Kịch bản / dữ liệu | Task |
|---|---|---|---|---|---|
| 01 | A1 | — | A1 | `acme/minh` | B2, F4 |
| 02 | A2, A3 | — | A2 | sai pass/tenant/user | B2, F4 |
| 03 | A5, A8, A9 | — | A3, A5 | `/__mock/expire-access` | B2, F3 |
| 04 | A7 | — | A4 | — | B2, F4 |
| 05 | M1, M10 | — | S1 | seed "Soạn email…" (2 flow) | B3, B4, F7, F8 |
| 06 | S1, S10 | — | S2 | `normal`, `markdown` | B4, F5, F8 |
| 07 | — | — | S3 | `#scn:slow` | F8 |
| 08 | S4 | — | T1 | `#scn:steps` | B4, F9 |
| 09 | S4, C10 | — | T2 | `#scn:steps`; seed F1 | B4, F9 |
| 10 | X1, X2 | — | T3, T4 | `#scn:slow` | B5, F5, F9 |
| 11 | X4 | — | T5 | `#scn:slow` | B5, F9 |
| 12 | S5, M8 | — | T6 | `#scn:ask` | B4, F9 |
| 13 | M2 | — | T7 | `#scn:ask` | B4, F9 |
| 14 | M3 | — | F1 | seed "Soạn email…" F2 | B3, F10 |
| 15 | M2, M4 | — | F2 | `normal` | B4, F10 |
| 16 | F1–F3 | U-4 | F3 | seed "Hoá đơn…" (nghỉ 3 ngày) | B4, F5, F10 |
| 17 | — | — | F4, F5 | viewport 390×844 | F10 |
| 18 | C1 | — | S4 | — | F7 |
| 19 | C4, C5, C9 | — | V1 | seed 4 mốc | B3, F6 |
| 20 | M3, C10 | — | V2 | seed "Soạn email…" | B3, F8 |
| 21 | C2 | — | V3 | — | B3, F6 |
| 22 | C3 | — | V4 | — | B3, F6 |
| 23 | C6 | U-2, U-3 | V5 | seed | B3, F6 |
| 24 | S7 | — | R1 | `#scn:err-exhausted` | B4, F9 |
| 25 | — | — | R2 | `#scn:err-exhausted` | F9 |
| 26 | S7, M11 | — | R3 | `#scn:err-timeout`; seed "Tóm tắt họp…" | B4, F9 |
| 27 | S7 | — | R4 | `#scn:err-upstream` | B4, F9 |
| 28 | R1–R4 | U-5, U-7 | N1 | `#scn:drop` | B5, F5, F11 |
| 29 | — | — | N2 | `page.route(...).abort()` | F11 |
| 30 | S2 | U-6 | R5 | `err-*` + seed TIMEOUT | B4, F9 |
| 31 | toàn bộ K | U-1…8 | — | — | B1–B6 |
| 32 | toàn bộ K (lệnh §2) | — | — | mock cổng 4021 | B6 |
| 33 | S1, S2 | U-6 | — | mọi kịch bản | B1, B4 |
| 34 | — | U-9 | lệnh AC-34 (§2) | mock cổng 4021 | F1, F13 |
| 35 | — | — | toàn bộ E (cột E không trống, trừ ghi chú §8 M6/M7) | — | F4–F13 |
| 36 | — | U-10 | I1 | `radio "English"` | F2 |
| C1-R09 | I1–I4 | — | — | `lan` vs `hoa`, `an` | B3–B5 |

## 4. Contract — `tests/contract/chat/` (QB)

Helper: `_env.ts` (đích, `isMock`, users) · `_client.ts` (`login`, `api`, `send` đọc hết stream → `ChatEvent[]` + header, `openStream` đọc tăng dần, `newConv`, `deepKeys`). "M" = chỉ mock.

**`auth.contract.test.ts`**

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| A1 | login `lan` | 200 `LoginResponseSchema`, `status:"authenticated"`, `user.username="lan"`; `Set-Cookie` `ai_rt` có `HttpOnly`, `SameSite=Strict`, `Path=/auth` | 01 |
| A2 | sai mật khẩu · tenant lạ · user lạ | cả 3: 401 `INVALID_CREDENTIALS`, `code`+`message` giống hệt nhau; không `Set-Cookie` | 02 |
| A3 | body thiếu `password` · thừa trường | 400 `VALIDATION_ERROR` | 02 |
| A4 | login user khoá | 403 `ACCOUNT_LOCKED` | UC-01 phụ |
| A5 | refresh bằng cookie → lại refresh bằng cookie **cũ** · cookie rác · `X-Client: extension` + body | 200 `RefreshResponseSchema`, cookie mới ≠ cũ · 401 `REFRESH_SUPERSEDED` · 401 `INVALID_REFRESH_TOKEN` · 200 | 03 |
| A6 | `GET /health` không token | 200 `HealthResponseSchema` | 31 |
| A7 | logout → refresh cùng cookie → logout lần 2 | 204 · 401 · 204 (idempotent) | 04 |
| A8 | E5 không `Authorization` · `Bearer rac` · token đã logout vẫn còn hạn (không đòi) | 401 `AUTH_EXPIRED` (2 ca đầu) | 03, 31 |
| A9 (M, cuối file) | login → `/__mock/expire-access` → E5 → refresh → E5 token mới | 401 `AUTH_EXPIRED` → 200 → 200 (token mới chạy **ngay**, xem §8 M3) | 03 |

**`conversations.contract.test.ts`**

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| C1 | E6 `{title:"Báo giá #1"}` → E7 | 201 `ConversationSchema`, `flow_count=0`; E7 bằng hệt | 18, 05 |
| C2 | E8 `{title:"Báo giá đổi tên"}` → E5 | 200, `updated_at` ≥ trước; E5 có tiêu đề mới; E10 tiêu đề flow không đổi | 21 |
| C3 | E9 → E7, E8, E9, E10, E11, E12 cùng id; E5 | 204 · tất cả 404 `NOT_FOUND`; E5 không còn id | 22 |
| C4 | tạo X, Y; gửi tin vào X | E5: X trước Y; sắp `updated_at` giảm, hoà → `id` giảm | 19 |
| C5 | `limit=1` đi theo `next_cursor` tới `null` · `cursor=rác` | không lặp id, hợp = danh sách `limit=200` · 400 | 19 |
| C6 | tạo "Hoá đơn tháng 9 #n", "Kế hoạch #n"; `q=hoa don`, `q=HOÁ ĐƠN`, `q=` | 2 câu đầu chỉ ra "Hoá đơn…" (trong số hội thoại của ca); `q=` = không lọc; `q` 101 ký tự → 400 | 23 |
| C7 | E6 `title` `""`, `"   "`, 201 ký tự, thừa trường · E8 thừa trường · E5 `limit=0`, `201` | 400 `VALIDATION_ERROR` | 31 |
| C8 | E7 `/conversations/abc` · uuid ngẫu nhiên | 404 `NOT_FOUND` (không 400) | 31 |
| C9 (M) | `minh` E5 | 4 hội thoại seed, `updated_at` ≈ now−2 phút / −3 ngày / −20 ngày / −60 ngày (sai số ±1 giờ) | 19 |
| C10 (M) | `minh` E10 "Soạn email báo giá Minh Phát" | 2 flow, `created_at` tăng; F1 `preview.answer.run.steps` 2 bước, `run.ms=7800`; F2 `message_count=4` | 09, 20 |

**`messages.contract.test.ts`**

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| M1 | E12 không `flow_id` 2 lần ("Câu 1", "Câu 2") | `content-type` `text/event-stream`; `X-Run-Id`/`X-Flow-Id` = `run.started.run_id/flow_id`, `X-Message-Id` uuid; 2 flow khác nhau; E10 có 2 flow, `title = deriveTitle(content)` | 05, C1-R01 |
| M2 | E12 `flow_id` = flow 1 | `run.started.flow_id` = flow 1; E10 vẫn 2 flow; flow 1 `message_count` 2 → 4 | 13, 15 |
| M3 | E11 `?flow_id=` · không `flow_id` | chỉ tin flow đó, `created_at` tăng; tin user giữ nguyên văn (kể cả `#scn:`); tin assistant `run.status=finished`, `ask=null`, `id` = `run.finished.message_id` · mọi flow | 14, 20 |
| M4 (M) | câu trả lời `normal` của tin thứ 2 trong flow | dòng cuối "Flow này có 3 tin nhắn." (C1-R02) | 15 |
| M5 | `content` `""`, `"  "`, 16001 ký tự · `flow_id:"x"` · thừa trường | 400 `VALIDATION_ERROR` (JSON, không stream) | 31 |
| M6 | `flow_id` của hội thoại khác (cùng user) · uuid lạ · hội thoại lạ | 404 `NOT_FOUND` | 31 |
| M7 (M) | E12 `#scn:slow` (giữ stream) → E12 cùng `flow_id`; rồi E15 dọn | 409 `FLOW_BUSY`; E10 `active_run_id` = run đang chạy | 31 |
| M8 (M) | `#scn:ask` xong → E11 | tin assistant `ask.question` "Bạn muốn tóm tắt cuộc họp nào?", `choices` đúng 2 câu plan §3.3 | 12 |
| M10 | sau M1 → E7 | `flow_count=2`, `updated_at` tăng | 05 |
| M11 (M) | `#scn:err-timeout` xong → E11 | tin assistant `run.status=failed`, `run.error.code=TIMEOUT` (tải lại vẽ thẻ lỗi) | 26 |

**`stream.contract.test.ts`**

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| S1 | E12 "Xin chào" (mọi Hub) | bất biến plan §2.5 (1)–(6): đầu `run.started` `id=1`; `id` liên tiếp; đúng 1 sự kiện kết thúc ở cuối rồi đóng; `step.finished` có `step.started` trước; `ask` ngay trước `run.finished`; nối `delta` = `run.finished.content`; `message_id` = tin assistant E11 | 06, 31, 33 |
| S2 | mọi frame của S1, S4–S7 + body E10/E11/E14 | `deepKeys` không chứa `agent`, `provider`, `model`, `usage` ở mọi độ sâu; `ChatEventSchema` strict parse được | 30, 33 |
| S3 | E14 sau S1 | `RunSchema`, `status=finished`, `finished_at` ≠ null, `last_event_id` = id cuối, `error=null` | 31 |
| S4 (M) | `#scn:steps` | `step.started{s1,"Hiểu yêu cầu"}` → `finished{ok,2100}` → `s2 "Đang viết email"` → `{ok,5700}` → delta → `run.finished.ms=7800` | 08, 09 |
| S5 (M) | `#scn:ask` | `ask` (2 choices) rồi `run.finished` ngay sau | 12 |
| S6 (M) | `#scn:quota-over` · `#scn:quota-warn` · không tiền tố | `quota` `{over,104}` · `{warn,85}` · `{ok,12}` | UC-02 |
| S7 (M) | `#scn:err-exhausted`, `err-timeout`, `err-upstream` | `step.finished{failed}` rồi `run.failed{code đúng, message 1–500, hint, message_id}`; E14 `status=failed`, `error.code` khớp | 24, 26, 27 |
| S8 (M) | gộp S1–S7 | tập `event` đã thấy = đủ 7 loại | 31 |
| S10 (M) | `#scn:markdown` | `content` chứa bảng `|` và khối ```` ```ts ```` | 06 |

**`resume.contract.test.ts`**

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| R1 | run xong (n sự kiện) → E13 `Last-Event-ID: 2` | đúng sự kiện `id` 3…n, không lặp, kết thúc rồi đóng | 28 |
| R2 | query `last_event_id=2` · header 3 + query 1 | = R1 · bắt đầu từ 4 (header thắng) | 28 |
| R3 | không header · `Last-Event-ID: 0` | phát lại đủ 1…n, giống stream gốc | 28 |
| R4 (M) | `#scn:drop` | stream E12 đóng sau delta thứ 5 (id cuối 6), **không** có sự kiện kết thúc; E13 `Last-Event-ID: 6` → id 7…n; delta gộp không trùng = `run.finished.content`; E14 cuối `finished` | 28 |
| R5 | E13/E14 uuid lạ | 404 `NOT_FOUND` | 31 |
| R6 (M) | 410: mock `eventsRetentionS=1`, run kết thúc, chờ 1,1 s rồi gọi E13 | 410 `EVENTS_EXPIRED` | 31 |
| R7 | E13 `Last-Event-ID: abc` (sai định dạng, M8) | 200, phát lại từ id 1…n | 31 |

**`cancel.contract.test.ts`**

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| X1 (M) | `#scn:slow`, đọc ≥ 3 delta → E15 | 200 `RunSchema`; stream kết thúc `run.failed CANCELLED` ≤ 5000 ms sau E15; E11 tin assistant `content` = delta đã nhận, `run.status=cancelled`, `error.code=CANCELLED` | 10 |
| X2 (M) | E15 lần 2 | 200 `status=cancelled`; E13 từ id cuối không có sự kiện mới | 10 |
| X3 | run đã xong → E15 | 200 `status=finished`; E13 phát lại không có `CANCELLED` | UC-04 |
| X4 (M) | sau X1, E12 cùng `content` không `flow_id` | `run_id`, `flow_id` mới ≠ cũ (Chạy lại câu ô chính = flow mới); E15 dọn | 11 |
| X5 | E15 uuid lạ | 404 | 31 |

**`isolation.contract.test.ts`** (C1-R09; mọi Hub)

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| I1 | `lan` tạo hội thoại + 1 flow (run xong) + 1 run `#scn:slow` (mock) | — (dựng) | — |
| I2 | `hoa` (cùng tenant) gọi E7, E8, E9, E10, E11, E11 `?flow_id`, E12 (có/không `flow_id`), E13, E14, E15 trên id của `lan` | tất cả 404 `NOT_FOUND`, body không lộ tiêu đề | C1-R09 |
| I3 | như I2 với `an` (khác tenant) | như I2 | C1-R09 |
| I4 | sau I2–I3: `lan` E7, E14; `hoa`/`an` E5 và E5 `q=<tiêu đề của lan>` | tiêu đề không đổi, hội thoại còn, run chưa bị huỷ; E5 của họ không chứa id của `lan` | C1-R09 |

**`flow-cold.contract.test.ts`** (chỉ mock)

| Ca | Dữ liệu / bước | Kỳ vọng | AC |
|---|---|---|---|
| F1 | `#scn:flow-cold` | header về < 1000 ms; `run.started` đến ≥ 1000 ms sau header (`fast`) | 16 |
| F2 | tin kế cùng flow | `run.started` < 500 ms sau gửi | 16 |
| F3 | `minh`, flow seed "Hoá đơn…" (nghỉ), không tiền tố | hành vi cold như F1 | 16 |

## 5. Unit acceptance — `tests/acceptance/C1/` (QA; import tĩnh `@ai/contracts/chat`, chạy sau B1)

| Ca | File | Kỳ vọng | AC |
|---|---|---|---|
| U-1 | `rules.test.ts` | `deriveTitle`: bỏ `#scn:steps `; gộp khoảng trắng; 40 code point + "…"; emoji không cắt đôi; chuỗi rỗng/chỉ tiền tố → "…"; đúng 40 → không "…" | 05, 31 |
| U-2 | `rules.test.ts` | `foldVi("Hoá Đơn")` = `"hoa don"`; `Đ/đ` → `d` | 23 |
| U-3 | `rules.test.ts` | `matchesQuery("Hoá đơn tháng 9…","hoa don")` true; `q` trống/`undefined` true; `"  hoa  "` trim | 23 |
| U-4 | `rules.test.ts` | `isFlowIdle`: đúng 600 s → true; 599 999 ms → false; `idleS` tuỳ chọn | 16 |
| U-5 | `rules.test.ts` | `createSseParser`: chunk cắt giữa dòng/giữa `\r\n`; dòng `: ping` bỏ; 2 dòng `data:` nối `\n`; `id` vắng → `null` | 28, 33 |
| U-6 | `rules.test.ts` | `toChatEvent`: hợp lệ → `ChatEvent`; `data` có `agent`/`provider` → `ZodError`; JSON hỏng → `SyntaxError`; `event` lạ → `ZodError` | 30, 33 |
| U-7 | `rules.test.ts` | `isNewEvent(5,5)` false, `(6,5)` true | 28 |
| U-8 | `rules.test.ts` | `encodeSseEvent` → `createSseParser` → `toChatEvent` khứ hồi bằng nhau (7 loại) | 31 |
| U-9 | `no-hub-url.test.ts` | `apps/chat-web/src/**/*.{ts,tsx}` tồn tại và không chứa `localhost`, `127.0.0.1`, `:4020`, `:3001`; nếu có `apps/chat-web/dist` thì bundle không chứa `localhost:4020` | 34 |
| U-10 | `i18n-chat.test.ts` | `packages/i18n/locales/chat/{vi,en}.json`: cùng tập key, không giá trị rỗng, cùng biến `{{x}}` mỗi key; có key e2e dùng (`login.invalid`, `login.locked`, `session.expired`) | 36 |
| U-11 | `contrast.test.ts` | Đọc `apps/chat-web/src/styles/globals.css`, tách `:root` (Sáng) / `.dark` (Tối); mọi cặp plan-frontend-theme §2: chữ ≥ 4.5, ring/viền flow mở/error-border/warning-solid ≥ 3 (`--input` chỉ kiểm ở Tối; Sáng 1.44 là ngoại lệ canvas). Thêm theo CR-027 (đề xuất T3 của frontend-lead, §6 plan-frontend-theme) | 35 |

## 6. E2e — `e2e/chat/` (QE)

Helper `_support.ts`: `resetMock`, `expireAccess`, `login`, `nextSend` (`waitForRequest` E12 → body), `article(title)`, `HUB` (theo `CHAT_E2E_HUB_PORT`). Nhãn nguyên văn `plan-frontend.md` §7.

| Ca | File | Bước | Kỳ vọng | AC |
|---|---|---|---|---|
| A1 | `auth.chat.ts` | điền `textbox "Mã công ty"` acme, "Tên đăng nhập" minh, "Mật khẩu", `button "Đăng nhập"` | URL `/c/new`; `heading` "Chào Minh, hôm nay cần gì?" | 01 |
| A2 | `auth.chat.ts` | mật khẩu sai | ở `/login`; `alert` "Sai mã công ty, tên đăng nhập hoặc mật khẩu"; `context.cookies()` không có `ai_rt`; local/sessionStorage không có giá trị chứa "eyJ" | 02 |
| A3 | `auth.chat.ts` | đăng nhập → `expireAccess` → click `link "Hoá đơn tháng 9 cần đối chiếu"` | đúng **1** request POST `/auth/refresh`; nội dung hội thoại hiện; URL không `/login` | 03 |
| A4 | `auth.chat.ts` | `button "Cài đặt"` → `button "Đăng xuất"` → `goto /c/new` | request POST `/auth/logout`; URL `/login`; sau `goto` vẫn `/login` | 04 |
| A5 | `auth.chat.ts` | `expireAccess` + `context.clearCookies()` → click hội thoại | về `/login`, thấy "Phiên đã hết hạn" | 03 phụ |
| A6 | `auth.chat.ts` | đăng nhập `acme/khoa` | `alertdialog` "Tài khoản đang bị khoá. Liên hệ quản trị viên công ty" | UC-01 phụ |
| S1 | `send.chat.ts` | mở "Soạn email báo giá Minh Phát" (2 `article`), gõ "Câu mới" + Enter | body không có `flow_id`; số `article "Flow: …"` 2 → 3 | 05 |
| S2 | `send.chat.ts` | `/c/new`, gõ "Xin chào" + Enter | URL `/c/:id`; trong lúc stream text tăng dần (`expect.poll` độ dài tăng ≥ 2 lần); cuối = `run.finished.content` (lấy từ `response.text()` của SSE, parse bằng contract); "Consultant" + `img "EvoluConsulting"`; sidebar có tiêu đề "Xin chào" | 06, 18 |
| S3 | `send.chat.ts` | gửi `#scn:slow kể chuyện`, cuộn `log` lên 400px | vị trí cuộn không về đáy khi có delta mới; `button "↓ Tin mới"` hiện; bấm → ở đáy, nút ẩn | 07 |
| S4 | `send.chat.ts` | `/c/new`, bấm `button` /^Soạn email/ | `textbox "Tin nhắn"` = "Soạn email báo giá gửi khách hàng", có focus; 4 thẻ; **0** request POST `/conversations*` | 18 |
| S5 | `send.chat.ts` | gửi `#scn:quota-over …` | dòng nhắc quota hiện; `button "Ẩn nhắc"` ẩn được; composer vẫn gửi được | UC-02 |
| T1 | `states.chat.ts` | gửi `#scn:steps viết email` | `listitem` "Hiểu yêu cầu" xuất hiện ở trạng thái đang chạy rồi có "2,1s"; "Đang viết email" "5,7s"; không chữ agent/provider (§8 M5) | 08 |
| T2 | `states.chat.ts` | sau T1 | `button` /2 bước · 7,8s/ `aria-expanded=false`; bấm → `true` + `list "Các bước"`; bấm → `false` | 09 |
| T3 | `states.chat.ts` | `#scn:slow …`, chờ delta, `button "Dừng"` | request POST `/runs/<data-run-id>/cancel`; "Đã dừng" + `button "Chạy lại"`; `button "Gửi"` trở lại; chữ đã stream còn | 10 |
| T4 | `states.chat.ts` | như T3 nhưng `Esc` | như T3 | 10 |
| T5 | `states.chat.ts` | sau T3 bấm "Chạy lại" | body `content` = câu gốc (kể cả tiền tố), không `flow_id`; `X-Run-Id` mới ≠ cũ | 11 |
| T6 | `states.chat.ts` | `#scn:ask tóm tắt họp` | `region "Consultant cần thêm thông tin"` có câu hỏi + 2 `button` chip | 12 |
| T7 | `states.chat.ts` | bấm `button "Họp giao ban sáng nay"` | request ngay (không Enter), body `{content:"Họp giao ban sáng nay", flow_id: data-flow-id}`; chip `disabled` | 13 |
| F1 | `flow.chat.ts` | "Soạn email…" → `article` F2 `button "Trả lời tiếp"` | `complementary "Flow đang mở"` hiện câu hỏi/trả lời của flow; `textbox "Tin nhắn trong flow"` có focus; URL `?flow=` | 14 |
| F2 | `flow.chat.ts` | gõ trong khung + `button "Gửi trong flow"` | body `flow_id` = `data-flow-id`; số `article` không đổi; trả lời hiện trong khung, footer khối flow cập nhật đếm | 15 |
| F3 | `flow.chat.ts` | "Hoá đơn tháng 9…" → Trả lời tiếp → gửi | `status` "Đang mở lại flow, lần đầu có thể mất vài giây…" hiện rồi ẩn khi có chữ | 16 |
| F4 | `flow.chat.ts` (`test.use` viewport 390×844) | Trả lời tiếp → `button "Đóng khung flow"` | `dialog "Flow đang mở"` (sheet đáy: `boundingBox.y` > 0, đáy = đáy viewport); đóng → ẩn, URL bỏ `?flow` | 17 |
| F5 | `flow.chat.ts` (390×844) | kéo tay nắm xuống 200px | sheet đóng (§8 M6) | 17 |
| V1 | `conversations.chat.ts` | vào `/c/new` | `heading` "Hôm nay"/"7 ngày qua"/"30 ngày qua"/"Cũ hơn", mỗi `list` chứa đúng hội thoại seed tương ứng | 19 |
| V2 | `conversations.chat.ts` | click "Soạn email báo giá Minh Phát" | 2 `article` theo thứ tự F1 rồi F2; `aria-current="page"` trên link | 20 |
| V3 | `conversations.chat.ts` | `button "Thao tác khác"` → `menuitem "Đổi tên"` → `textbox "Tên hội thoại"` "Báo giá Minh Phát v2" → `button "Lưu"` | chờ response PATCH 200; link sidebar + tiêu đề trang = tên mới | 21 |
| V4 | `conversations.chat.ts` | `menuitem "Xoá"` → `button "Huỷ"`; rồi Xoá → `button "Xoá"` | còn nguyên; sau xác nhận response DELETE 204, link biến mất; nếu đang mở → URL `/c/new` | 22 |
| V5 | `conversations.chat.ts` | `searchbox "Tìm hội thoại"` "hoa don" | chỉ còn link "Hoá đơn tháng 9 cần đối chiếu"; "xyz" → câu không thấy | 23 |
| V6 | `conversations.chat.ts` | `goto /c/<uuid lạ>` | "Hội thoại không tồn tại" + `button`/`link` "Về trang chào" | UC-07 phụ |
| R1 | `errors.chat.ts` | `#scn:err-exhausted x` | `alert` trong `article`: "Hệ thống đang quá tải", "AI tạm hết lượt dùng. Hãy thử lại sau ít phút.", `button "Thử lại"`, `button "Báo admin"`, text `/ALL_PROVIDERS_EXHAUSTED · run [0-9a-f-]{36}/` | 24 |
| R2 | `errors.chat.ts` | `grantPermissions(clipboard-read/write)`; Báo admin; Thử lại | clipboard chứa mã + run id của thẻ; Thử lại → request E12 cùng `content`, `X-Run-Id` mới | 25 |
| R3 | `errors.chat.ts` | `#scn:err-timeout x`; và mở seed "Tóm tắt họp giao ban" | "Hệ thống xử lý quá lâu" + Thử lại (cả khi tải lại) | 26 |
| R4 | `errors.chat.ts` | `#scn:err-upstream x` | "Dịch vụ AI đang gặp sự cố" + Thử lại | 27 |
| R5 | `errors.chat.ts` | text của mọi thẻ ở R1–R4 | không khớp `/agent|provider|claude|anthropic|openai|gpt|gemini|stack|at \S+ \(/i` | 30 |
| N1 | `connection.chat.ts` | `#scn:drop x` | `status` "Đang kết nối lại…" hiện; request GET `/runs/<id>/events` header `last-event-id: 6`; text cuối = `content` tin assistant (E11 qua `request`), câu cuối xuất hiện đúng 1 lần; banner ẩn | 28 |
| N2 | `connection.chat.ts` | `page.route("**/conversations**", abort)` → reload | `alert` "Không kết nối được máy chủ" + `button "Thử lại"`; `unroute` → Thử lại → alert ẩn, sidebar có dữ liệu | 29 |
| I1 | `i18n.chat.ts` | Cài đặt → `radio "English"` | welcome "Hi Minh, what do you need today?"; không chuỗi dạng key (`/\b[a-z]+\.[a-zA-Z.]+\b/` trong `main`) | 36 |

## 7. Nhóm WRITE (mỗi lần gọi qc một nhóm) và phạm vi lock

| Nhóm | Task | File | Điều kiện trước | Đỏ đúng lý do |
|---|---|---|---|---|
| Contract | QB | `tests/contract/chat/{_env,_client}.ts`, `{auth,conversations,messages,stream,resume,cancel,isolation,flow-cold}.contract.test.ts` (≈ 55 ca) | B1 xong; bunfig tách (§2) | đỏ ở `expect` status 404 (route chat chưa có) — không đỏ ở `_env` dựng mock |
| Unit acceptance | QA | `tests/acceptance/C1/{rules,no-hub-url,i18n-chat}.test.ts` (≈ 30 ca) | B1 (rules) | `rules` xanh ngay nếu B1 đúng (B1 có trước) — ghi rõ; `no-hub-url`/`i18n-chat` đỏ vì chưa có thư mục/file |
| E2e | QE | `e2e/chat/{playwright.config.ts,_support.ts}`, `{auth,send,states,flow,conversations,errors,connection,i18n}.chat.ts` (≈ 37 ca) | B2 (mock login chạy) để kiểm đỏ đúng lý do | đỏ ở locator/URL (chat-web chưa có màn), không đỏ ở webServer mock |
| Khoá | QL | `tests/.lock` | QB, QA, QE ghi kết quả ở §9; `LOCKED_DIRS` có `tests/contract` | — |

**Phạm vi lock đề xuất:** `tests/acceptance/**` (gồm `C1/`), `e2e/**` (gồm `e2e/chat/**` và `e2e/chat/playwright.config.ts`), **thêm `tests/contract/**`** — bộ contract là cam kết "Hub thật pass thì Chat chạy", backend-lead không được sửa để cho xanh.

## 8. Mơ hồ / mâu thuẫn (cho spec-readiness / điều phối)

| # | Chỗ | Vấn đề | Đề xuất mặc định |
|---|---|---|---|
| M1 | plan §4.1 "`bun test` (gốc)" chạy contract | Contract đỏ từ QB tới B5 → `bun test` gốc đỏ, ảnh hưởng phiên M4 | Tách như `test:int` (§2); "Lệnh xong" C1 thêm `bun run test:contract:chat` |
| M2 | plan §4.1 dòng 3, tasks B6 | `bun run mocks` mở cả Dify 4010 → instance thứ hai đụng cổng | Thêm `DIFY_MOCK_PORT=4011` vào lệnh AC-32 |
| M3 | plan §3.6 `expire-access`: "`iat` ≤ now" | `iat` tính theo giây ⇒ token cấp lại trong cùng giây cũng bị từ chối → K-A9/E-A3 chập chờn | Mock ghi mốc theo ms/`sid` (token cấp **sau** lệnh luôn hợp lệ) — backend-lead B2 |
| M4 | plan §2.4 E13 410 | Không có cách tạo 410 trong test (600 s) | Thêm `POST /__mock/expire-events {run_id}` hoặc env `MOCK_EVENTS_RETENTION_S` — backend-lead B5; K-R6 chờ |
| M5 | plan-frontend §7 Bước | Không có role/nhãn cho spinner "đang chạy"; với `MOCK_FAST` bước 1 chỉ 210 ms | FE thêm `aria-busy="true"` trên `listitem` đang chạy; E-T1 ghi nhận bằng `MutationObserver` cài trước khi gửi (không phụ thuộc polling) |
| M6 | plan-frontend §7 Khung flow mobile | Tay nắm kéo không có nhãn → E-F5 phải kéo theo toạ độ | FE thêm `aria-label="Kéo để đóng"` cho tay nắm (hoặc chấp nhận F5 theo toạ độ header sheet) |
| M7 | spec §8 AC-35 `e2e/chat-*.spec.ts`; tasks F4–F13 lệnh `bunx playwright test … e2e/chat-*.spec.ts` | qc chốt `e2e/chat/*.chat.ts` + config riêng | Điều phối sửa cột "Lệnh xong" F4–F13: `bunx playwright test -c e2e/chat/playwright.config.ts --reporter=line <tên> \| tail -40` |
| M8 | plan §2.4 E13 lỗi | `Last-Event-ID: abc` không ghi mã lỗi (bảng chỉ 401·404·410) | 400 `VALIDATION_ERROR` theo thứ tự kiểm chung; **Đã chốt (spec §9 M8): sai định dạng → coi như không có** (phát lại từ đầu); ca viết theo đó |
| M9 | plan-frontend §5 Đổi tên "≤ 120 ký tự" vs contract `title` 1–200 | Lệch giới hạn | Không test giới hạn UI; contract kiểm 200 |
| M10 | tasks F13 "test CHAT-AC-34 quét `src/**`" | Trùng U-9 của qc (bị khoá) | F13 bỏ phần test đó, chỉ chạy U-9 |

## 9. Kết quả đỏ đúng lý do (điền ở QB/QA/QE)

**Quyết định QA (bun test gốc):** `bunfig.toml` chỉ loại `tests/contract/**`; các mốc trước (M1) để ca acceptance đỏ trong `bun test` gốc ("đỏ lúc chạy" tới khi code xong). Để không làm đỏ phiên M4 song song, ca phụ thuộc chat-web (`no-hub-url`, `i18n-chat`, `contrast`) bọc `describe.skipIf(!CHAT_WEB_ENABLED)` (`tests/acceptance/C1/_gate.ts`): tắt khi chưa có `apps/chat-web`, **tự bật** khi F1 tạo thư mục; `C1_STRICT=1` ép bật (dùng khi kiểm đỏ đúng lý do, CI và VERIFY — thiếu thư mục là đỏ). Đây là cổng theo điều kiện đích, không phải `skip` vĩnh viễn. Lưu ý: `apps/chat-web` đã có ⇒ ba file này đang chạy và đỏ trong `bun test` gốc cho tới khi F1/F14/F-i18n xong.

| Nhóm | Số ca | Đỏ đúng lý do / tổng | Ghi chú |
|---|---|---|---|
| Contract | 62 (auth 13 · conversations 12 · messages 10 · stream 9 · resume 7 · cancel 5 · isolation 3 · flow-cold 3) | 62 đỏ đúng lý do / 62 | Chạy 2026-10-04 (`bun run test:contract:chat`, mock trong tiến trình, trước B2): 58 ca đỏ ở bước gọi route chat chưa có — `POST /auth/login` → 401 `UNAUTHORIZED` của middleware M0 (`scenarioMiddleware`, chưa phải 404 vì middleware đòi token trước khi tới `notFound`), K-A2/A3/A4/A5-rác/A8 đỏ ở mã (`UNAUTHORIZED` ≠ mã kỳ vọng), K-A8 token rác → 404; **K-A6** đỏ ở `HealthResponseSchema.parse` (`/health` của mock trả `version:"mock"`, contract đòi semver → B2 sửa). Không ca nào đỏ ở import/`_env`/`TypeError`. `isMock` = mock trong tiến trình **hoặc** `/__mock/ping` 204 (trước B2 ping chưa có nên ca chỉ-mock vẫn chạy và đỏ). K-R6 chỉ chạy khi mock trong tiến trình (`describe.if(inProcess)`, dựng mock thứ hai `MOCK_EVENTS_RETENTION_S=1`). |
| Unit acceptance | 39 (rules 25 · no-hub-url 3 · i18n-chat 5 · contrast 6) | 9 đỏ đúng lý do / 39; 30 xanh (`rules` 25/25 xanh ngay vì B1 `da8ca10` có trước, đúng dự kiến) | Chạy 2026-10-04 lúc `apps/chat-web` đã có (F1 đang làm): `no-hub-url` 3/3 xanh (src chưa có URL cứng); `i18n-chat` 5/5 đỏ ở `expect(existsSync(packages/i18n/locales/chat/vi.json)).toBe(true)` (chưa có file); `contrast` 4/6 đỏ: `globals.css` chưa đủ token (`.dark` 14 var < 20; thiếu `code-*`, `input`...) — 2 ca còn lại (Sáng ≥3:1) xanh vì đã có đủ var cần. Không ca nào đỏ ở dựng dữ liệu. |
| E2e | — | — | — |
