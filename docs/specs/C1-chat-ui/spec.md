---
id: C1-chat-ui
title: Chat UI + contract Chat↔Hub + mock Hub
milestone: C1
status: draft            # draft → ready → approved → in-progress → done
requirements: [CHAT-AC-01..30, HUB-FR-40, HUB-FR-41, HUB-FR-42, HUB-FR-43, HUB-FR-45]
design: [docs/design/chat-app/usecases-chat.md, docs/design/chat-app/ui-chat-extension.md#2-kiến-trúc-thông-tin, docs/design/agent-hub/ba-agent-hub.md#9-api--sự-kiện-stream, canvas: docs/design/chat-app/canvas/ (Main, FlowOpen, Welcome, States, Mobile)]
owner: backend-lead + frontend-lead
---

# C1 — Chat UI + contract Chat↔Hub + mock Hub

Nguồn: CR-018 (mốc C1), CR-019…022 (đã vào design). Người dùng chốt 2026-10-03: làm Chat App trước, độc lập Admin; Hub thật làm sau từng phần (H1, H2). Chỉ người dùng test; repo chưa lên GitHub.

## 1. Phạm vi
**Làm**

| # | Hạng mục | Ghi chú |
|---|---|---|
| 1 | `apps/chat-web` | Rsbuild + React + Tailwind + shadcn như `apps/admin-web`; i18n VI/EN qua `packages/i18n`; theo canvas + `usecases-chat.md` (UC-01…08) |
| 2 | **Contract Chat↔Hub** (zod) | Hội thoại, flow, message, run, sự kiện SSE, mã lỗi, đăng nhập/refresh cùng dạng Admin auth (§3) |
| 3 | **Mock Hub chat** | Mở rộng `tools/mocks` (`hub.ts`, cổng 4020, cơ chế kịch bản) phục vụ chat theo contract + mock login |
| 4 | **Bộ test contract dùng chung** | Chạy với `HUB_URL` bất kỳ: mock hôm nay, Hub thật sau này |
| 5 | E2E Playwright cho chat-web | Chạy với mock |

**Không làm (C1):** menu `/` và command, đính kèm file, Extension, Knowledge base (CR-024), chat nhóm / agent↔agent (CR-023), Coordinator và Claude CLI thật, schema `hub` thật, Worker, gọi Admin thật, thông báo trình duyệt cho job nền, quota thật (mock chỉ trả `quota.state` để hiện dòng nhắc).

## 2. Nghiệp vụ
Không chép BA; chỉ phần cụ thể hoá cho C1.

| Luật | Nội dung chính xác | Nguồn |
|---|---|---|
| C1-R01 | Tin gửi ở ô chính không kèm `flow_id` → Hub tạo flow mới; tin trong khung flow luôn kèm `flow_id` | CR-021, HUB-FR-45 |
| C1-R02 | Context của AI = flow (không phải cả hội thoại). Mock chứng minh được bằng cách nhận `flow_id` (kịch bản echo số tin của flow) | CR-021 |
| C1-R03 | Flow không có trạng thái đóng; không có endpoint đóng flow. Mock mô phỏng "nghỉ": kịch bản `flow-cold` làm tin đầu sau nghỉ chậm ≥ 3 s trước `run.started` | CR-021 |
| C1-R04 | Mọi câu trả lời hiển thị "Consultant" + icon EvoluConsulting. `step.label` chỉ mô tả việc; **payload gửi Chat không có `agent`/`provider`** (member không thấy tên agent). Hub thật phải cắt khỏi SSE kênh chat (Q6) | CR-022 |
| C1-R05 | Lỗi luôn kèm `code`, `message`, `hint`, `run_id`; Chat hiển thị theo bảng UC-08, không bịa kết quả | HUB-BR-04 |
| C1-R06 | Mất kết nối khi stream: Chat nối lại bằng `GET /runs/:id/events` + `Last-Event-ID`; mọi sự kiện có `id` tăng dần theo run; nối lại không lặp, không mất `delta` | HUB-FR-42 |
| C1-R07 | URL Hub lấy từ biến môi trường; đổi mock → thật không sửa code (Q2) | yêu cầu điều phối |
| C1-R08 | Access JWT giữ trong bộ nhớ; refresh qua cookie HttpOnly như Admin web. Refresh một lần khi gặp `AUTH_EXPIRED`; lỗi thì về `/login` | `packages/contracts/src/auth.ts` |
| C1-R09 | Chỉ thấy dữ liệu của user đăng nhập; mock từ chối truy cập hội thoại của user/tenant khác bằng 404 | HUB-FR-40 |

## 3. Contract (backend-lead)
<!-- backend-lead: điền chi tiết sau PLAN. Dưới đây là khung bắt buộc. -->
Vị trí file: **chưa chốt** (Q1). Mặc định: subpath export `@ai/contracts/chat` (file `packages/contracts/src/chat.ts`), không đụng `src/index.ts`.

**Thực thể (zod):** `Conversation {id, title, created_at, updated_at}` · `Flow {id, conversation_id, title, created_at, last_active_at}` · `Message {id, conversation_id, flow_id, role: user\|assistant, content, run_id?, created_at}` · `Run {id, flow_id, status: running\|finished\|failed\|cancelled, started_at, finished_at?}` · `AuthUser {id, username, display_name, tenant}`.

**Endpoint** (theo `ba-agent-hub.md` §9.1 + flow; Hub thật phải giữ đúng)

| Method | Path | Request | Response | Lỗi |
|---|---|---|---|---|
| POST | `/auth/login` | `{tenant_code, username, password}` (dạng Admin) | như Admin `LoginResponse` | 401 `INVALID_CREDENTIALS`, khoá tài khoản |
| POST | `/auth/refresh` · `/auth/logout` | như Admin | như Admin | 401 `AUTH_EXPIRED`/`REFRESH_*` |
| GET · POST | `/conversations` | — · `{title?}` | `Conversation[]` · `Conversation` | 401 |
| PATCH · DELETE | `/conversations/:id` | `{title}` · — | `Conversation` · 204 | 404 |
| GET | `/conversations/:id/flows` | — | `Flow[]` | 404 |
| GET | `/conversations/:id/messages` | `?flow_id&cursor&limit` | `{items: Message[], next_cursor}` | 404 |
| POST | `/conversations/:id/messages` | `{content, flow_id?}` | `text/event-stream`; header `X-Run-Id`, `X-Flow-Id` | 400, 401, 404 |
| GET | `/runs/:id/events` | header `Last-Event-ID` | SSE tiếp từ sau id đó | 404, 410 nếu quá hạn lưu |
| POST · GET | `/runs/:id/cancel` · `/runs/:id` | — | `Run` | 404 |
| GET | `/health` | — | `{status}` | — |

**Sự kiện SSE** (mỗi sự kiện có `id:` tăng dần theo run; `data` là JSON; nguồn `ba-agent-hub.md` §9.2, bỏ `agent`, `provider`, `job.progress`):

| event | data |
|---|---|
| `run.started` | `{run_id, flow_id, quota: {state: ok\|warn\|over, pct}}` |
| `step.started` | `{step_id, label}` |
| `step.finished` | `{step_id, status: ok\|failed, ms}` |
| `delta` | `{text}` |
| `ask` | `{question, choices?: string[]}` (kết thúc run, chờ tin kế) |
| `run.finished` | `{run_id, message_id}` |
| `run.failed` | `{run_id, code, message, hint}` |

**Mã lỗi dùng ở C1:** `AUTH_EXPIRED`, `ALL_PROVIDERS_EXHAUSTED`, `TIMEOUT`, `UPSTREAM_ERROR`, `CANCELLED`, `BUDGET_EXCEEDED`, `NOT_CONFIGURED` (câu chữ: `ui-chat-extension.md` §8). Lỗi HTTP = `{error:{code,message,details?}}` như Admin.

## 4. Dữ liệu (backend-lead)
C1 **không có DB**: mock giữ dữ liệu trong bộ nhớ (reset khi khởi động lại; có `POST /__mock/reset`). Schema `hub` thật (`flows`, `flow_id` ở message/run) thuộc mốc H1; mô hình đã ghi ở `ba-agent-hub.md` §8.
<!-- backend-lead: cấu trúc dữ liệu mock nếu cần -->

## 5. UI (frontend-lead)
Artboard: Main, FlowOpen, Welcome, States, Mobile. Câu chữ VI lấy nguyên văn canvas + `ui-chat-extension.md` §8; EN do frontend-lead dịch.
<!-- frontend-lead: bảng chi tiết, cấu trúc apps/chat-web, router, state SSE, nháp localStorage, nhãn role cho e2e -->

| Màn / thành phần | Trạng thái cần có | UC |
|---|---|---|
| `/login` | lỗi, đang gửi, khoá | UC-01 |
| `/c/new` (trang chào) | 4 thẻ gợi ý điền sẵn (C1 chưa có command ⇒ thẻ là câu hỏi mẫu) | UC-07 |
| `/c/:id` luồng flow + sidebar | tải (skeleton 3 tin), rỗng, không tồn tại, tìm không thấy | UC-02/07 |
| Khối bước, thẻ hỏi lại, thẻ lỗi | theo States | UC-03/05/08 |
| Khung flow phải / sheet mobile | mở, đang mở lại flow, lỗi | UC-06 |
| Banner kết nối | "Đang kết nối lại…", đỏ "Không kết nối được máy chủ" | UC-08 |

## 6. Hiệu năng
Theo `CONVENTIONS.md` §6. Riêng C1: JS đầu của chat-web ≤ 150 KB gzip (đo như `check:bundle` của admin-web); stream 500 `delta` không giật (gộp delta theo khung hình).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Agent Hub | Mock Hub chat trong `tools/mocks` (cổng 4020), chọn kịch bản (dưới) |
| Admin auth | Mock login trong mock Hub (tenant `acme`, user `minh`, mật khẩu dev; thêm user khoá, sai mật khẩu); JWT EdDSA ký bằng khoá dev (Q7). **Không gọi Admin** |
| Claude CLI, Coordinator, Worker | Không có; mock sinh câu trả lời tất định |

**Kịch bản mock** (chọn bằng tiền tố `#scn:<tên>` ở đầu nội dung tin, hoặc `POST /__mock/scenario {name}` cho test contract; mặc định `normal`):

| Tên | Hành vi | UC |
|---|---|---|
| `normal` | `run.started` → `delta` × N → `run.finished` | UC-02 |
| `steps` | 2 bước ("Hiểu yêu cầu" 2,1 s, "Đang viết email") rồi trả lời; tổng ≈ 7,8 s (tua nhanh bằng `MOCK_FAST`) | UC-03 |
| `ask` | `ask` kèm 2 `choices`; tin kế (cùng flow) → `normal` | UC-05 |
| `slow` | `delta` chậm để kịp bấm Dừng; `cancel` → `run.failed CANCELLED` | UC-04 |
| `err-exhausted` · `err-timeout` · `err-upstream` | `run.failed` với mã tương ứng | UC-08 |
| `drop` | Đóng kết nối sau N `delta`; `GET /runs/:id/events` + `Last-Event-ID` trả phần còn lại | UC-08 |
| `flow-cold` | Tin đầu vào flow "đã nghỉ" chậm ≥ 3 s trước `run.started`; tin sau nhanh | UC-06 |
| `quota-over` | `run.started` có `quota.state = over` | UC-02 |
| (Hub sập) | Dừng tiến trình mock, không cần kịch bản | UC-08 |

**Biến môi trường**

| Tên | Dùng cho | Giá trị dev |
|---|---|---|
| `HUB_URL` | bộ test contract; chat-web nhận qua `PUBLIC_HUB_URL` lúc dev/build | `http://localhost:4020` (Q2) |
| `MOCK_FAST` | mock rút ngắn thời gian chờ trong e2e | `1` |

## 8. Tiêu chí nghiệm thu (qc)
AC UC-01…UC-08 = **CHAT-AC-01…30** trong `docs/design/chat-app/usecases-chat.md` (Given/When/Then ở đó, không chép lại). Bổ sung kỹ thuật:

| AC | Given / When / Then | Test |
|---|---|---|
| CHAT-AC-31 | Given bộ test contract, When chạy với `HUB_URL` = mock, Then xanh toàn bộ (login/refresh, CRUD hội thoại, tạo flow, gửi tin vào flow, đủ 7 loại sự kiện SSE, `Last-Event-ID`, cancel, 401/404, cách ly user) | `tests/contract-hub/*.test.ts` (tên tạm) |
| CHAT-AC-32 | Given bộ test contract, When đổi `HUB_URL` sang địa chỉ khác (instance mock thứ hai), Then không sửa mã mà vẫn xanh. Cam kết: Hub thật pass bộ này thì Chat chạy | như trên |
| CHAT-AC-33 | Given payload SSE của mock, Then mọi sự kiện parse được bằng zod của contract và **không** có `agent`/`provider` (C1-R04) | như trên |
| CHAT-AC-34 | Given chat-web, When đổi `PUBLIC_HUB_URL` rồi chạy lại, Then Chat gọi địa chỉ mới (không hằng số URL trong code) | unit hoặc e2e |
| CHAT-AC-35 | Given e2e Playwright với mock, Then CHAT-AC-01…30 đều có test tự động (UC-08 `drop`, `flow-cold` dùng `MOCK_FAST`) | `e2e/chat-*.spec.ts` (tên tạm) |
| CHAT-AC-36 | Given VI/EN, Then không thiếu khoá i18n (script i18n của repo), mọi chuỗi hiển thị qua `packages/i18n` | script i18n |

Lệnh xong mốc: `bun run typecheck && bun test && <test contract> && bunx playwright test e2e/chat-` kèm `check:size --all`, `depcruise --all`, `check:bundle` cho chat-web. <!-- qc/backend-lead chốt tên script -->

## 9. Quyết định
### Trước Gate (đã chốt với người dùng, phiên điều phối 2026-10-03)
- Làm Chat App trước, độc lập Admin; C1 dùng mock Hub (CR-018). Mốc Hub sau: H1 Hub lõi, H2 Worker + Dify, Studio sau.
- Flow (CR-021), "Consultant" (CR-022), Coordinator là agent (CR-020), subscription không bắt buộc API cuối (CR-019): đã ghi vào design; C1 chỉ cần giao diện + contract.
- C1 dùng mock đăng nhập trong mock Hub; contract giữ dạng Admin `/auth/login` để đổi sang Admin thật sau.
- Bộ test contract dùng chung là cam kết "Hub thật pass thì Chat chạy".

### Câu hỏi mở (mỗi câu có mặc định; agent PLAN dùng mặc định nếu không có trả lời)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | Vị trí contract: phiên M4 đang sửa `packages/contracts/src/index.ts` | Subpath export `@ai/contracts/chat` (thêm một dòng vào `exports` + file `src/chat.ts`); backend-lead quyết cuối, được phép dùng package mới `@ai/contracts-chat` nếu subpath vướng tooling |
| Q2 | Tên biến môi trường Hub: repo đã có `HUB_BASE_URL` (Admin→Hub) | `HUB_URL` cho test contract, mặc định lấy `HUB_BASE_URL` nếu `HUB_URL` trống; chat-web dùng `PUBLIC_HUB_URL` |
| Q3 | Thư viện render markdown + highlight code (cần ADR → trình người dùng ở Gate) | Đề xuất `react-markdown` + `remark-gfm` + `rehype-highlight`, nạp lazy; ADR mới (số do docs-architect cấp) |
| Q4 | Cổng dev chat-web | `3100` (admin-web 3000, mock Hub 4020) |
| Q5 | Có làm nối lại `Last-Event-ID` ở C1 không | **Có** (UI đã vẽ banner; UC-08, CHAT-AC-28) |
| Q6 | Ai cắt `agent`/`provider` khỏi SSE | Hub: kênh chat chỉ phát payload của §3; trace/Studio giữ đầy đủ. Bộ test contract kiểm CHAT-AC-33 |
| Q7 | Ký JWT mock | EdDSA bằng khoá dev cố định (cùng dạng Admin; Hub thật sau verify khoá công khai của Admin) |

### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
