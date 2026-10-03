# Plan · C1-chat-ui (backend)

Tác giả: backend-lead · 2026-10-03 · Phần frontend: `plan-frontend.md` (không lặp lại).
**Nguồn chính của contract Chat↔Hub là §2 file này** (spec §3 chỉ tóm tắt + trỏ về đây). Hub thật (H1) phải giữ đúng §2 và pass bộ test §4.
Symbol thật đã đọc (2026-10-03): schema auth + `REFRESH_COOKIE`, `X_CLIENT_HEADER` (`contracts/src/auth.ts`), `ErrorResponseSchema`, `UuidSchema`, `IsoDateTime`, `HealthResponseSchema`; `createHubMock`, `scenarioMiddleware`, `loadMockEnv` (`tools/mocks/src`); claims Admin `iss=admin`, `aud=ai-system`, `{sub,tid,role,sid}` (`apps/admin-api/src/lib/jwt.ts`, chỉ đọc).

## 1. Quyết định câu hỏi mở (spec §9)

| # | Quyết định | Lý do |
|---|---|---|
| Q1 | Subpath export `@ai/contracts/chat` → `packages/contracts/src/chat/index.ts`; thêm **1 dòng** `"./chat": "./src/chat/index.ts"` vào `exports` của `packages/contracts/package.json`. **Không** đụng `src/index.ts`, `common.ts`, `errors.ts` (chỉ import) | Tách khỏi file M4 đang sửa; depcruise đã có `exportsFields: ["exports"]` nên subpath resolve được. Vướng tooling (tsc/rsbuild/depcruise đỏ ở T-B1) → fallback package `packages/contracts-chat` (`@ai/contracts-chat`) cùng nội dung |
| Q2 | Env server-side, **không** có URL nào trong bundle chat-web: `HUB_URL` (đích Hub), `AUTH_URL` (đích `/auth/*`; trống → = `HUB_URL`; sau này = admin-api `http://localhost:3001`). Dev server + preview của chat-web **proxy** `/auth` → `AUTH_URL`, `/conversations` `/runs` `/health` → `HUB_URL`. Client gọi đường dẫn tương đối = path contract. **Không** dùng `PUBLIC_HUB_URL`; **không** lấy `HUB_BASE_URL` làm mặc định | Cùng origin → cookie `ai_rt` (`Path=/auth; SameSite=Strict`) chạy như admin-web, không cần CORS; fallback `HUB_BASE_URL` (Bun tự nạp `.env.local`) làm test gọi cổng không chạy |
| Q5 | Có. Mỗi sự kiện có `id` số nguyên tăng dần từ 1 theo run; `GET /runs/:id/events` nhận header `Last-Event-ID` (hoặc query `last_event_id`, header thắng) và trả **chỉ** sự kiện `id >` giá trị đó, rồi phát tiếp nếu run còn chạy | UC-08, CHAT-AC-28 |
| Q6 | Hub cắt ở **biên kênh chat**: payload SSE và REST của §2 là `z.strictObject` — chỉ đúng các trường liệt kê; `agent`, `provider`, `model`, `usage`, `kind`, `type` của BA §9.2 **không** phát ra kênh chat (vẫn ở trace/Studio). Bộ test §4 parse strict ⇒ thừa trường là đỏ | CR-022, CHAT-AC-30/33 |
| Q7 | Mock ký JWT **EdDSA** bằng `jose` (đã có ở ADR-0001, chỉ thêm vào `tools/mocks/package.json`) với cặp khoá Ed25519 **sinh lúc khởi động** (không đọc `JWT_PRIVATE_KEY`, không cần `keys:dev`); claims như Admin: `iss="admin"`, `aud="ai-system"`, `sub`, `tid`, `role="member"`, `sid`, TTL 900 s, header `kid="mock"` | Không có secret; Chat không verify JWT (lấy user từ `user` của `TokenGrant`) nên khoá đổi mỗi lần chạy không ảnh hưởng |
| Q-scn | Kịch bản chọn theo thứ tự: (1) tiền tố `#scn:<tên>` ở đầu `content` (theo từng tin, không trạng thái chung → test song song an toàn); (2) mặc định toàn cục đặt bằng `POST /__mock/scenario {name}` (cho e2e khi UI tự gửi lại: Chạy lại, chip); (3) `normal`. Flow "nghỉ" (`last_active_at` cũ hơn `FLOW_IDLE_S`) tự áp hành vi `flow-cold` cho tin đầu | Bộ test contract chỉ dùng (1); `/__mock/*` không thuộc contract |
| Q-401 | Endpoint Hub (không phải `/auth/*`) trả **401 `AUTH_EXPIRED`** cho token thiếu/sai/hết hạn (BA §9.3). `/auth/*` giữ mã Admin (`INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `REFRESH_SUPERSEDED`, `UNAUTHORIZED`, `ACCOUNT_LOCKED`). Client: 401 từ endpoint Hub → refresh **một** lần → gọi lại; refresh 401 → `/login` | C1-R08; giữ đúng dạng Admin |

## 2. Contract `@ai/contracts/chat`

### 2.1 File

| File | Nội dung | Dòng ước |
|---|---|---|
| `packages/contracts/src/chat/index.ts` | Re-export 4 file dưới + re-export auth dùng lại (`LoginRequestSchema`, `LoginResponseSchema`, `TokenGrantSchema`, `MeSchema`, `RefreshRequestSchema`, `RefreshResponseSchema`, `LogoutRequestSchema`, `REFRESH_COOKIE`, `X_CLIENT_HEADER`, `ErrorResponseSchema`, `HealthResponseSchema`) | ~25 |
| `chat/entities.ts` | Hằng, `Conversation`, `Flow`, `Message`, `Run`, `RunSummary`, `StepSummary`, `RunError`, `Ask`, request/query/page | ~170 |
| `chat/events.ts` | 7 sự kiện SSE, envelope `ChatEvent`, `CHAT_RUN_ERROR_CODES` | ~110 |
| `chat/errors.ts` | `CHAT_API_ERRORS` (mã → HTTP) | ~25 |
| `chat/rules.ts` | Hàm thuần dùng chung client/mock/test (§2.7) | ~120 |
| `chat/*.test.ts` | Unit test schema + rules (backend, cạnh file) | — |

### 2.2 Hằng

| Hằng | Giá trị | Dùng |
|---|---|---|
| `CHAT_CONTENT_MAX` | 16000 | `content` tin user (sau trim, ≥ 1) |
| `CHAT_ANSWER_MAX` | 64000 | `content` tin assistant |
| `CHAT_TITLE_MAX` | 200 | tiêu đề hội thoại/flow |
| `CHAT_TITLE_DERIVED_LEN` | 40 | tiêu đề tự sinh (UC-02) |
| `CHAT_CURSOR_MAX` | 200 | cursor opaque |
| `CHAT_LIMIT_DEFAULT` / `MAX` | 50 / 200 | = `LIST_LIMIT_DEFAULT/MAX` |
| `CHAT_ASK_CHOICES_MAX` / `CHAT_ASK_CHOICE_MAX` | 6 / 200 | `ask.choices` |
| `CHAT_ERROR_TEXT_MAX` | 500 | `message`, `hint` |
| `FLOW_IDLE_S` | 600 | flow coi là "nghỉ" (HUB-FR-45); client hiện "Đang mở lại flow…" khi gửi vào flow có `now − last_active_at ≥ FLOW_IDLE_S` cho tới `run.started` |
| `SSE_HEARTBEAT_S` | 15 | dòng chú thích `: ping` |
| `RUN_EVENTS_RETENTION_S` | 600 | giữ sự kiện sau khi run kết thúc; quá → 410 |
| `CHAT_SCN_PREFIX` | `"#scn:"` | chỉ mock dùng (§3.3); để ở contract để e2e/test import |

### 2.3 Thực thể (tất cả `z.strictObject`; `id` = `UuidSchema`; thời gian = `IsoDateTime` UTC)

| Schema | Trường (kiểu · ràng buộc) |
|---|---|
| `ConversationSchema` | `id` · `title` string 1–200 · `created_at` · `updated_at` (= lúc có tin mới nhất hoặc đổi tên; sidebar nhóm theo trường này) · `flow_count` int ≥ 0 (FE P1) |
| `StepSummarySchema` | `step_id` string 1–64 · `label` string 1–200 · `status` `ok\|failed` · `ms` int ≥ 0 |
| `RunErrorSchema` | `code` ∈ `CHAT_RUN_ERROR_CODES` · `message` 1–500 · `hint` 0–500 |
| `AskSchema` | `question` 1–2000 · `choices` string[] 0–6, mỗi chuỗi 1–200 (rỗng = không chip) |
| `RunSummarySchema` | `id` · `status` `finished\|failed\|cancelled` · `ms` int ≥ 0 · `steps` StepSummary[] (≤ 50) · `error` RunError \| null (khác null ⇔ `failed`/`cancelled`) |
| `MessageSchema` | `id` · `conversation_id` · `flow_id` · `role` `user\|assistant` · `content` string 0–64000 (user: ≥ 1) · `run_id` uuid \| null · `created_at` · `run` RunSummary \| null (chỉ assistant) · `ask` Ask \| null (chỉ assistant, khi run kết thúc bằng hỏi lại). `content` user lưu nguyên văn kể cả tiền tố `#scn:` (FE P2) |
| `FlowSchema` | `id` · `conversation_id` · `title` 1–200 (= `deriveTitle` tin đầu) · `created_at` · `last_active_at` · `message_count` int ≥ 1 · `active_run_id` uuid \| null (run đang chạy → client nối `GET /runs/:id/events`) · `preview` `{question: Message, answer: Message \| null}` (tin đầu của flow và trả lời đầu; `answer` có ngay khi tin trả lời đầu được lưu (FE P3); khối flow ở luồng chính + "+N tin trong flow · <thời gian>") |
| `RunSchema` | `id` · `conversation_id` · `flow_id` · `status` `running\|finished\|failed\|cancelled` · `started_at` · `finished_at` \| null · `last_event_id` int ≥ 0 · `error` RunError \| null |
| `ChatPageSchema(item)` | `{items: item[], next_cursor: string(1–200) \| null}` |

Luật lưu (Hub thật làm như mock): mỗi run kết thúc (finished/failed/cancelled, kể cả `ask`) tạo **đúng một** tin assistant: `content` = nối các `delta` đã phát (có thể rỗng), `run` = RunSummary, `ask` nếu có. Run đang chạy chưa có tin assistant.

### 2.4 Endpoint

Header chung: `Authorization: Bearer <access>` (trừ `/auth/*`, `/health`). Lỗi = `ErrorResponseSchema`. Mọi path có `:id` của user khác (cùng hoặc khác tenant), đã xoá, hoặc không phải uuid → **404 `NOT_FOUND`** (không 403, C1-R09). Thứ tự kiểm: auth (401) → path uuid (404) → sở hữu (404) → body/query (400) → trạng thái (409/410).

| # | Method · Path | Request | Response | Lỗi |
|---|---|---|---|---|
| E1 | POST `/auth/login` | `LoginRequestSchema` `{tenant_key, username, password}` (đúng Admin) | 200 `LoginResponseSchema`; web nhận cookie `ai_rt` | 400 `VALIDATION_ERROR` · 401 `INVALID_CREDENTIALS` · 403 `ACCOUNT_LOCKED` |
| E2 | POST `/auth/refresh` | body rỗng + cookie (web) hoặc `RefreshRequestSchema` + `X-Client: extension` | 200 `RefreshResponseSchema`; xoay cookie | 401 `INVALID_REFRESH_TOKEN` / `REFRESH_SUPERSEDED` |
| E3 | POST `/auth/logout` | `LogoutRequestSchema` | 204; xoá cookie; idempotent | — |
| E4 | GET `/health` | — | 200 `HealthResponseSchema` | — |
| E5 | GET `/conversations` | query `ConversationListQuery` `{q?: 0–100 (rỗng = bỏ), cursor?, limit?: 1–200 = 50}` | 200 `ChatPage<Conversation>`; sắp `updated_at` giảm, hoà thì `id` giảm. `q`: chứa trong `title`, không phân biệt hoa thường **và dấu** (`foldVi`, §2.7) | 400 · 401 |
| E6 | POST `/conversations` | `{title: 1–200 trim}` (client tính bằng `deriveTitle(content)` tin đầu) | 201 `Conversation` | 400 · 401 |
| E7 | GET `/conversations/:id` | — | 200 `Conversation` | 401 · 404 |
| E8 | PATCH `/conversations/:id` | `{title: 1–200 trim}` | 200 `Conversation` (`updated_at` mới) | 400 · 401 · 404 |
| E9 | DELETE `/conversations/:id` | — | 204; xoá mềm, sau đó E7/E10/E11/E12 → 404, run đang chạy bị huỷ | 401 · 404 |
| E10 | GET `/conversations/:id/flows` | `{cursor?, limit?}` | 200 `ChatPage<Flow>`; sắp `created_at` **tăng** (luồng chính từ trên xuống), `next_cursor` = trang sau | 400 · 401 · 404 |
| E11 | GET `/conversations/:id/messages` | `{flow_id?: uuid, cursor?, limit?}` | 200 `ChatPage<Message>`: trang đầu = `limit` tin **mới nhất**, `items` sắp `created_at` **tăng**; `next_cursor` = trang **cũ hơn**. Không `flow_id` = mọi flow | 400 · 401 · 404 (cả `flow_id` không thuộc hội thoại) |
| E12 | POST `/conversations/:id/messages` | `SendMessageRequest` `{content: 1–16000 trim, flow_id?: uuid}`. Không `flow_id` → flow mới (C1-R01); có → tin vào flow đó | 200 `text/event-stream; charset=utf-8`, header `X-Run-Id`, `X-Flow-Id`, `X-Message-Id` (tin user), `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Lỗi trước khi mở stream trả JSON | 400 · 401 · 404 · 409 `FLOW_BUSY` (flow có `active_run_id`) |
| E13 | GET `/runs/:id/events` | header `Last-Event-ID` hoặc query `last_event_id` (int ≥ 0; thiếu hoặc sai định dạng = 0, spec §9 M8) | 200 SSE: sự kiện `id >` giá trị, rồi phát tiếp tới sự kiện kết thúc; run đã kết thúc → phát phần còn lại rồi đóng | 401 · 404 · 410 `EVENTS_EXPIRED` (run kết thúc > `RUN_EVENTS_RETENTION_S`) |
| E14 | GET `/runs/:id` | — | 200 `Run` | 401 · 404 |
| E15 | POST `/runs/:id/cancel` | body rỗng | 200 `Run` (ảnh chụp lúc nhận). Run đang chạy → stream phát `run.failed CANCELLED` ≤ 5 s (HUB-FR-43). Đã kết thúc → không đổi gì, 200 (UC-04 phụ). Idempotent | 401 · 404 |

`CHAT_API_ERRORS` (`chat/errors.ts`): `VALIDATION_ERROR` 400 · `AUTH_EXPIRED` 401 · `NOT_FOUND` 404 · `FLOW_BUSY` 409 · `EVENTS_EXPIRED` 410 · `INTERNAL_ERROR` 500 (+ mã `/auth/*` lấy từ `API_ERRORS` của Admin).

### 2.5 SSE

Khung: `id: <n>\nevent: <tên>\ndata: <JSON một dòng>\n\n`; `: ping\n\n` mỗi 15 s (bỏ qua khi parse). Envelope `ChatEventSchema` = `z.discriminatedUnion("event", …)` của `{id: int ≥ 1, event, data}`.

| event | `data` (strict) | Ghi chú |
|---|---|---|
| `run.started` | `{run_id, flow_id, quota: {state: ok\|warn\|over, pct: int ≥ 0}}` | luôn là `id: 1`; `warn` ≥ 80, `over` ≥ 100, không chặn |
| `step.started` | `{step_id: 1–64, label: 1–200}` | `label` chỉ mô tả việc |
| `step.finished` | `{step_id, status: ok\|failed, ms: int ≥ 0}` | |
| `delta` | `{text: string 1–4000}` | |
| `ask` | `{question: 1–2000, choices: string[] 0–6}` | ngay sau là `run.finished` |
| `run.finished` | `{run_id, message_id, content: 0–64000, ms: int ≥ 0}` | `content` = nối mọi `delta` (CHAT-AC-06); `ms` = thời lượng ("✓ 2 bước · 7,8s") |
| `run.failed` | `{run_id, message_id, code ∈ CHAT_RUN_ERROR_CODES, message: 1–500, hint: 0–500}` | |

`CHAT_RUN_ERROR_CODES` = `ALL_PROVIDERS_EXHAUSTED`, `TIMEOUT`, `UPSTREAM_ERROR`, `CANCELLED`, `BUDGET_EXCEEDED`, `NOT_CONFIGURED`, `INTERNAL_ERROR`.

**Bất biến stream** (test §4 kiểm, Hub thật phải giữ): (1) sự kiện đầu là `run.started`; (2) `id` liên tiếp 1,2,3… không lặp, không hở; (3) đúng **một** sự kiện kết thúc (`run.finished` hoặc `run.failed`), là sự kiện cuối, sau đó server đóng stream; (4) mỗi `step.finished` có `step.started` cùng `step_id` trước nó; (5) `ask` chỉ đứng ngay trước `run.finished`; (6) không trường nào ngoài bảng trên.

### 2.6 Quy ước hội thoại / flow

| Tình huống | Client gọi | Hub làm |
|---|---|---|
| Gửi đầu tiên ở `/c/new` | E6 `{title: deriveTitle(content)}` → E12 không `flow_id` | tạo hội thoại; tạo flow + run |
| Gửi ở ô chính (hội thoại có sẵn) | E12 không `flow_id` | flow mới, `flow.title = deriveTitle(content)` |
| Gửi trong khung flow / bấm chip `ask` | E12 có `flow_id` | tin vào flow; context = các tin của flow (C1-R02); 409 nếu flow đang chạy |
| Chạy lại / Thử lại | E12 cùng `content`; câu ở ô chính → không `flow_id` (flow mới), trong khung → `flow_id` | như trên |
| Mở lại hội thoại | E7 + E10 (preview) | — |
| Mở khung flow | E11 `?flow_id=` (+ cursor để tải cũ hơn); `active_run_id` ≠ null → E13 `last_event_id=0` | — |
| Mất kết nối | E13 với `Last-Event-ID` = id cuối đã nhận; delta id ≤ đó bỏ qua (`isNewEvent`) | — |
| Đổi tên | E8 | không đổi tiêu đề flow |

### 2.7 Hàm thuần `chat/rules.ts` (chữ ký chốt, qc viết test trước)

| Chữ ký | Hành vi |
|---|---|
| `deriveTitle(content: string): string` | Bỏ tiền tố `#scn:<tên>` + khoảng trắng sau nó; gộp mọi khoảng trắng thành 1; trim; cắt **40 ký tự** (đếm theo code point, không cắt đôi cặp surrogate); kết quả rỗng → `"…"`; bị cắt → thêm `"…"` |
| `foldVi(s: string): string` | NFD, bỏ dấu kết hợp (`\p{M}`), `đ/Đ` → `d`, lower-case (dùng cho `q`, CHAT-AC-23 "hoa don" khớp "Hoá đơn") |
| `matchesQuery(title: string, q: string \| undefined): boolean` | `q` trống → true; ngược lại `foldVi(title).includes(foldVi(q.trim()))` |
| `isFlowIdle(lastActiveAt: string, nowMs: number, idleS = FLOW_IDLE_S): boolean` | `nowMs − Date.parse(lastActiveAt) ≥ idleS·1000` |
| `createSseParser(onEvent: (e: RawSseEvent) => void): (chunk: string) => void` | Parser tăng dần theo spec SSE: gộp chunk, tách theo dòng trống (chấp nhận `\n`, `\r\n`), bỏ dòng `:`; `RawSseEvent = {id: string \| null, event: string, data: string}` (nhiều dòng `data:` nối bằng `\n`); không parse JSON |
| `toChatEvent(raw: RawSseEvent): ChatEvent` | `JSON.parse(data)` + `ChatEventSchema.parse({id: Number(id), event, data})`; ném `ZodError`/`SyntaxError` |
| `isNewEvent(id: number, lastId: number): boolean` | `id > lastId` (chống lặp khi nối lại) |
| `encodeSseEvent(e: ChatEvent): string` | Ngược của parser (mock dùng); `data` = `JSON.stringify` một dòng |

## 3. Mock Hub chat (`tools/mocks/src/chat/`)

### 3.1 File (mỗi file ≤ 250 dòng; hàm ≤ 50)

| File | Trách nhiệm |
|---|---|
| `hub.ts` (sửa 3 dòng) | `app.route("/", createChatMock(opts))` **trước** `app.use(scenarioMiddleware…)` (như `/health`) → route chat không qua token `mock-ok`; route M0 giữ nguyên hành vi |
| `env.ts` (sửa) | thêm `MOCK_FAST` (`0\|1`, mặc định 0), `MOCK_FLOW_IDLE_S` (mặc định `FLOW_IDLE_S`), `MOCK_EVENTS_RETENTION_S` (mặc định `RUN_EVENTS_RETENTION_S`=600, M4); `MockEnv` + `createHubMock` thêm `fast`, `flowIdleS`, `eventsRetentionS` |
| `chat/index.ts` | `createChatMock(opts: ChatMockOptions): Hono` — ghép các router, giữ một `ChatStore` |
| `chat/auth.ts` | E1–E3 + middleware Bearer (jose `SignJWT`/`jwtVerify`, khoá Ed25519 sinh bằng `generateKeyPair("EdDSA")` lúc tạo app); refresh token opaque xoay vòng; `expireBefore` |
| `chat/users.ts` | user/tenant mẫu (§3.4), dựng `Me` |
| `chat/store.ts` | `ChatStore` trong bộ nhớ: `Map` users/conversations/flows/messages/runs; truy vấn lọc `user_id` (= `sub`) |
| `chat/seed.ts` | dữ liệu mẫu tương đối theo `now` (§3.5); gọi lúc tạo store và `/__mock/reset` |
| `chat/conversations.routes.ts` | E5–E11 (parse bằng contract, gọi store) |
| `chat/messages.routes.ts` | E12–E15 |
| `chat/runs.ts` | `RunEngine`: mỗi run `{events: ChatEvent[], listeners: Set, status, cancelRequested}`; vòng sinh chạy kịch bản; dọn run kết thúc > `RUN_EVENTS_RETENTION_S` hoặc khi > 500 run |
| `chat/sse.ts` | `streamRun(run, fromId, {dropAfterDeltas?})` → `Response` (ReadableStream): phát lại `id > fromId`, đăng ký listener, ping 15 s, đóng sau sự kiện kết thúc |
| `chat/scenarios.ts` | `buildScript(name, ctx): Beat[]` thuần — `Beat = {waitMs: number, event: Omit<ChatEvent,"id">}`; `pickScenario` (§3.3) |
| `chat/control.ts` | `/__mock/*` (§3.6) |
| `chat/*.test.ts` | unit test (backend) |

Engine: `waitMs` thật = `fast ? max(1, round(waitMs/10)) : waitMs`, **trừ** `slow` và `flow-cold` (có sàn riêng §3.3). `ms` trong `step.finished`/`run.finished` là hằng của kịch bản (không theo `fast`) để câu "2,1s", "7,8s" tất định. Huỷ: engine kiểm `cancelRequested` trước mỗi beat → phát `run.failed CANCELLED` (giữ delta đã phát). Run tiếp tục chạy khi client rớt mạng (HUB-FR-42).

### 3.2 Nội dung tất định
- Trả lời `normal`: markdown cố định 30 `delta` (mỗi delta 1 từ + khoảng trắng), dòng cuối `Flow này có {n} tin nhắn.` (n = số tin của flow kể cả tin vừa gửi — chứng minh C1-R02).
- `run.started.quota` mặc định `{state:"ok", pct: 12}`.

### 3.3 Kịch bản (`pickScenario({content, fallback, flowIdle}): ScenarioName`; `content` lưu nguyên văn kể cả tiền tố để "Chạy lại" gửi lại đúng)

| Tên | Chuỗi sự kiện (chờ thật ở chế độ thường / `MOCK_FAST`) | AC |
|---|---|---|
| `normal` | `run.started` → 30 × `delta` (40 ms / 4 ms) → `run.finished` | 05, 06, 07, 14, 15 |
| `markdown` | như `normal`, nội dung có tiêu đề, danh sách, bảng, khối code `ts` | 06 (render) |
| `steps` | `run.started` → `step.started{s1,"Hiểu yêu cầu"}` → (2100 ms) `step.finished{ok,2100}` → `step.started{s2,"Đang viết email"}` → (5700 ms) `step.finished{ok,5700}` → 20 × `delta` → `run.finished{ms:7800}` | 08, 09 |
| `ask` | `run.started` → `ask{question:"Bạn muốn tóm tắt cuộc họp nào?", choices:["Họp giao ban sáng nay","Họp khách hàng Minh Phát"]}` → `run.finished` | 12, 13 |
| `slow` | `run.started` → 60 × `delta` mỗi 250 ms (`fast`: 100 ms; không nhỏ hơn) → `run.finished` | 10, 11 |
| `err-exhausted` | `run.started` → `step.started{"Đang xử lý yêu cầu"}` → `step.finished{failed}` → `run.failed{ALL_PROVIDERS_EXHAUSTED}` | 24, 25, 30 |
| `err-timeout` · `err-upstream` | như trên với `TIMEOUT` · `UPSTREAM_ERROR` | 26, 27 |
| `drop` | như `normal`, 30 delta mỗi 100 ms; **lần kết nối đầu** (E12) đóng stream ngay sau `delta` thứ 5; run vẫn chạy; E13 + `Last-Event-ID` trả phần còn lại | 28 |
| `flow-cold` | chờ 3000 ms (`fast`: 1000 ms) **sau** khi gửi header, trước `run.started`; rồi `normal`. Tự áp cho tin đầu vào flow có `isFlowIdle` = true | 16 |
| `quota-warn` · `quota-over` | `normal` với `quota {warn,85}` · `{over,104}` | 02 phụ |

Thứ tự chọn: tiền tố `#scn:<tên hợp lệ>` → flow nghỉ ⇒ `flow-cold` → mặc định toàn cục (`/__mock/scenario`) → `normal`. Tên lạ sau `#scn:` → bỏ qua tiền tố (coi như `normal`). Hub sập (CHAT-AC-29): dừng tiến trình hoặc e2e `page.route(...).abort()` — không có kịch bản.

### 3.4 Đăng nhập mock (mật khẩu dev chung `dev-password-1`; không phải secret)

| tenant_key | username | display_name | Trạng thái | Dùng |
|---|---|---|---|---|
| `acme` | `minh` | Minh | active, có seed | e2e chính, CHAT-AC-01 |
| `acme` | `lan` | Lan | active, rỗng | test contract (user A) |
| `acme` | `hoa` | Hoa | active, rỗng | cách ly cùng tenant (user B) |
| `beta` | `an` | An | active | cách ly khác tenant |
| `acme` | `khoa` | Khoa | locked → 403 `ACCOUNT_LOCKED` | CHAT-AC lỗi khoá |

Sai tenant/user/mật khẩu → 401 `INVALID_CREDENTIALS` (không nói trường nào). Login luôn trả `status:"authenticated"` (`TokenGrant`, `user` = `Me` đủ trường: `role:"member"`, `locale:"vi"`, `totp_enabled:false`, `backup_codes_left:0`, `email:null`). Cookie `ai_rt=<opaque>; HttpOnly; SameSite=Strict; Path=/auth; Max-Age=2592000`. Refresh xoay vòng: token **ngay trước** dùng lại → 401 `REFRESH_SUPERSEDED` (không thu hồi chuỗi); token cũ hơn hoặc lạ → `INVALID_REFRESH_TOKEN` (khác Admin: Admin thu hồi chuỗi). Logout huỷ refresh token.

### 3.5 Seed của `minh` (thời điểm tương đối lúc khởi động / reset)

| Hội thoại | `updated_at` | Flow |
|---|---|---|
| "Soạn email báo giá Minh Phát" | now − 2 phút | F1 (2 tin, finished, `steps` 2 bước 7,8 s) · F2 (4 tin, `last_active_at` now − 2 phút) |
| "Hoá đơn tháng 9 cần đối chiếu" | now − 3 ngày | 1 flow, `last_active_at` now − 3 ngày (nghỉ → `flow-cold`, CHAT-AC-16) |
| "Tóm tắt họp giao ban" | now − 20 ngày | 1 flow, có tin assistant `run.failed TIMEOUT` (thẻ lỗi khi tải lại) |
| "Kế hoạch marketing Q3" | now − 60 ngày | 1 flow |

### 3.6 Điều khiển mock (không thuộc contract, không auth, chỉ mock)

| Endpoint | Tác dụng |
|---|---|
| GET `/__mock/ping` | 204 — test §4 dùng để biết đích là mock (bật ca chỉ-mock) |
| POST `/__mock/reset` | 204 — xoá store, run, refresh token; nạp lại seed; mặc định toàn cục = `normal` |
| POST `/__mock/scenario` `{name: string \| null}` | 204 — đặt mặc định toàn cục; tên lạ → 400 `VALIDATION_ERROR` |
| POST `/__mock/expire-access` | 204 — mọi access token cấp trước mốc ms hiện tại (hoặc `sid` cũ, M3) → 401 `AUTH_EXPIRED` (CHAT-AC-03) |

Trạng thái toàn cục (`scenario`, `expire-access`, `reset`) không an toàn khi chạy song song → e2e dùng chúng phải `test.describe.serial` hoặc project `workers: 1` (frontend/qc chốt).

## 4. Bộ test contract (`tests/contract/chat/`, qc viết trước, backend làm xanh)

### 4.1 Cách chạy

| Lệnh | Đích |
|---|---|
| `bun run test:contract:chat` (không trong `bun test` gốc, M1) | `HUB_URL` trống → `_env.ts` dựng mock **trong tiến trình** `Bun.serve({port: 0, fetch: createHubMock({…, fast: true}).fetch})` |
| `HUB_URL=http://localhost:4020 bun run test:contract:chat` | mock đang chạy (`MOCK_FAST=1 bun run mocks`) |
| `HUB_MOCK_PORT=4021 DIFY_MOCK_PORT=4011 bun run mocks` rồi `HUB_URL=http://localhost:4021 bun run test:contract:chat` | CHAT-AC-32 (instance thứ hai) |
| `HUB_URL=<hub thật> AUTH_URL=<admin thật> CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat` | Hub H1: ca chỉ-mock tự bỏ qua (`GET /__mock/ping` ≠ 204) |

Script gốc mới: `"test:contract:chat": "bun --config=bunfig.contract.toml test --timeout 30000 tests/contract/chat"`. `CHAT_CONTRACT_USERS` = JSON `{a, b, other_tenant, locked}` mỗi phần tử `{tenant_key, username, password}`; trống → user §3.4. `bunfig.toml` ignore `tests/contract/**`; khoá qua `LOCKED_DIRS` (B0). `tsconfig.tests.json` đã bao `tests/**`. Import mock bằng đường tương đối `../../../tools/mocks/src/hub` (gốc không khai `@ai/mocks`).

### 4.2 File và ca (tên test `"<AC> · …"`)

| File | Ca | AC | Mọi Hub / chỉ mock |
|---|---|---|---|
| `_env.ts` · `_client.ts` | resolve `HUB_URL`/`AUTH_URL`/users; `login(user)`, `authed(fetch)`, `readStream(res): ChatEvent[]` dùng `createSseParser` + `toChatEvent`; `send(convId, content, flowId?)` | — | — |
| `auth.contract.test.ts` | login đúng → `TokenGrantSchema` + cookie `ai_rt` HttpOnly; sai mật khẩu/tenant/user → 401 `INVALID_CREDENTIALS` cùng body; `khoa` → 403 `ACCOUNT_LOCKED`; refresh xoay, dùng lại cũ → 401; logout 204 rồi refresh → 401; E5 không token / token rác → 401 `AUTH_EXPIRED`; `expire-access` → 401 rồi refresh → gọi lại 200 | 01, 02, 03, 04, 31 | mọi Hub (trừ `expire-access`) |
| `conversations.contract.test.ts` | E6→E7→E8→E5 thấy tiêu đề mới; E9 → E7/E10/E11 404; E5 sắp `updated_at` giảm; `limit=1` có `next_cursor`, đi hết không lặp; `q="hoa don"` khớp "Hoá đơn…"; body thừa trường / title rỗng / >200 → 400; `limit=0`/`201` → 400 | 18–23, 31 | mọi Hub |
| `messages.contract.test.ts` | E12 không `flow_id` 2 lần → E10 có 2 flow; E12 có `flow_id` → vẫn 2 flow, `message_count` tăng 2; header `X-Run-Id`/`X-Flow-Id`/`X-Message-Id` khớp `run.started`; E11 `?flow_id` chỉ tin của flow, sắp tăng; `content` rỗng/16001 → 400; `flow_id` của hội thoại khác → 404; gửi vào flow đang chạy (`#scn:slow`) → 409 `FLOW_BUSY`; tin assistant có `run` sau khi xong | 05, 13, 15, 20, 31 | mọi Hub (409: chỉ mock) |
| `stream.contract.test.ts` | mọi khung parse bằng `ChatEventSchema` strict; bất biến §2.5 (1)–(6); nối `delta` = `run.finished.content`; không key `agent`/`provider`/`model`/`usage` ở bất kỳ độ sâu nào; E14 sau khi xong `status=finished`, `last_event_id` = id cuối; kịch bản `steps`/`ask`/`quota-over`/`err-*` cho đủ 7 loại sự kiện và mã lỗi | 06, 08, 12, 24, 26, 27, 30, 31, 33 | bất biến: mọi Hub; kịch bản: chỉ mock |
| `resume.contract.test.ts` | run xong → E13 `Last-Event-ID: k` trả đúng `id > k`, không lặp; `last_event_id` query = header; `#scn:drop` → stream E12 đóng sớm, E13 từ id cuối → nội dung nối = `run.finished.content`, không trùng; run của user khác → 404 | 28, 31 | replay: mọi Hub; drop: chỉ mock |
| `cancel.contract.test.ts` | `#scn:slow` → E15 → stream kết thúc `run.failed CANCELLED` ≤ 5 s, delta đã nhận giữ trong tin assistant; E15 lần 2 → 200 không đổi; E15 run đã xong → 200 `finished` | 10, 11, 31 | huỷ giữa chừng: chỉ mock; idempotent: mọi Hub |
| `isolation.contract.test.ts` | user `hoa` (cùng tenant) và `an` (khác tenant) gọi E7–E15 trên tài nguyên của `lan` → 404 `NOT_FOUND`; E5 của họ không chứa hội thoại của `lan` | C1-R09, 31 | mọi Hub |
| `flow-cold.contract.test.ts` | `#scn:flow-cold`: header về ngay, `run.started` sau ≥ 1000 ms (fast); tin kế tiếp cùng flow < 500 ms | 16 | chỉ mock |

CHAT-AC-32: lệnh dòng 3 bảng 4.1 xanh. CHAT-AC-34 (frontend): `AUTH_URL`/`HUB_URL` đổi → proxy chat-web trỏ đích mới; grep bundle không có `localhost:4020`.

## 5. Hiệu năng (thêm vào CONVENTIONS §6)

| Chỉ số | Ngân sách (mock, máy dev) | Đo |
|---|---|---|
| E5/E7/E10/E11 | p95 < 50 ms (bộ nhớ); Hub thật: < 300 ms với 5.000 hội thoại/user (index `(user_id, updated_at desc, id)`, `(conversation_id, created_at)` cho flows/messages — ghi cho H1) | test contract đo thô, không chặn |
| E12 → header | < 200 ms (trừ `flow-cold`) | stream test |
| E12 → `run.started` | < 500 ms (trừ `flow-cold`) | stream test |
| Nối lại E13 | sự kiện đầu < 300 ms | resume test |
| Bộ nhớ mock | ≤ 500 run giữ sự kiện; ≤ 5.000 sự kiện/run (vượt → `run.failed INTERNAL_ERROR`) | unit `runs.test.ts` |
| Mọi list | `limit` ≤ 200 | contract |

## 6. Rủi ro

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| R1 | Subpath `@ai/contracts/chat` vướng tsc/rsbuild/depcruise/biome | B1 chạy typecheck + depcruise; đỏ → package `@ai/contracts-chat` (§1 Q1) |
| R2 | Phiên M4 cũng sửa `packages/contracts/package.json` → xung đột merge | Sửa đúng 1 dòng `exports`; `git add` đúng file; xung đột thì giữ cả hai |
| R3 | Proxy dev server (rsbuild/http-proxy) đệm/nén SSE → không thấy delta dần | Mock `Cache-Control: no-cache`; FE tắt compress proxy; e2e AC-06 bắt |
| R4 | `bun test` chậm/flaky do kịch bản có chờ | Mock trong tiến trình chạy `fast`; ca timing dùng ngưỡng rộng (≥, không ==) |
| R5 | Trạng thái toàn cục `/__mock/*` làm e2e song song nhiễu | Ưu tiên `#scn:`; ca dùng `/__mock/*` chạy serial |
| R6 | Hub thật (H1) không tất định → ca kịch bản không chạy được | Ca kịch bản gắn "chỉ mock" (`describe.if(isMock)`); bất biến §2.5 vẫn chạy mọi Hub |
| R7 | Strict schema: Hub thật thêm trường → Chat đỏ | Cố ý (Q6, chống lộ agent/provider). Thêm trường = đổi contract + chạy lại bộ test |
| R8 | `AUTH_EXPIRED` (Hub) khác `UNAUTHORIZED` (Admin) → client nhầm | Client refresh khi **401 bất kỳ** từ endpoint Hub; `/auth/*` không vòng refresh |
| R9 | Đóng stream ở `drop` giữa chừng trên Bun làm rò listener | `sse.ts` gỡ listener ở `cancel()` của ReadableStream; unit test đếm listener = 0 |
