---
id: C1-chat-ui
title: Chat UI + contract Chat↔Hub + mock Hub
milestone: C1
status: approved           # draft → ready → approved → in-progress → done
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
**Nguồn chính: `plan.md` §2** (schema từng trường, endpoint E1–E15, SSE, bất biến stream, hàm thuần). Tóm tắt:

- Vị trí: subpath `@ai/contracts/chat` → `packages/contracts/src/chat/` (Q1); không đụng `src/index.ts`.
- Thực thể strict: `Conversation {id, title, flow_count, created_at, updated_at}` · `Flow {id, conversation_id, title, created_at, last_active_at, message_count, active_run_id, preview}` · `Message {id, conversation_id, flow_id, role, content, run_id, created_at, run: RunSummary|null, ask|null}` · `Run {id, conversation_id, flow_id, status: running|finished|failed|cancelled, started_at, finished_at, last_event_id, error}`. Đăng nhập dùng lại nguyên `auth.ts` của Admin (`{tenant_key, username, password}` → `LoginResponse`, cookie `ai_rt`).
- Endpoint: `/auth/login|refresh|logout`, `/health`, `GET·POST /conversations` (cursor, `q` không dấu), `GET·PATCH·DELETE /conversations/:id`, `GET /conversations/:id/flows`, `GET·POST /conversations/:id/messages` (POST trả SSE, `flow_id?`), `GET /runs/:id/events` (`Last-Event-ID`), `GET /runs/:id`, `POST /runs/:id/cancel`. Phân trang `{items, next_cursor}`.
- SSE: `run.started`, `step.started`, `step.finished`, `delta`, `ask`, `run.finished {run_id, message_id, content, ms}`, `run.failed {run_id, message_id, code, message, hint}`; `id` liên tiếp từ 1 theo run; đúng một sự kiện kết thúc; không `agent`/`provider` (strict).
- Lỗi HTTP chat: `VALIDATION_ERROR` 400 · `AUTH_EXPIRED` 401 · `NOT_FOUND` 404 (cả tài nguyên của người khác) · `FLOW_BUSY` 409 · `EVENTS_EXPIRED` 410. Mã `run.failed`: `ALL_PROVIDERS_EXHAUSTED`, `TIMEOUT`, `UPSTREAM_ERROR`, `CANCELLED`, `BUDGET_EXCEEDED`, `NOT_CONFIGURED`, `INTERNAL_ERROR` (câu chữ: `ui-chat-extension.md` §8).

## 4. Dữ liệu (backend-lead)
C1 **không có DB**: mock giữ dữ liệu trong bộ nhớ (reset khi khởi động lại; có `POST /__mock/reset`). Schema `hub` thật (`flows`, `flow_id` ở message/run) thuộc mốc H1; mô hình đã ghi ở `ba-agent-hub.md` §8.
Cấu trúc store, seed, user mẫu: `plan.md` §3.4–§3.5.

## 5. UI (frontend-lead)
Artboard: Main, FlowOpen, Welcome, States, Mobile. Câu chữ VI lấy nguyên văn canvas + `ui-chat-extension.md` §8; EN do frontend-lead dịch.
Chi tiết: `plan-frontend.md` (cấu trúc, route, state, SSE, màn ↔ artboard ↔ AC, nhãn e2e, responsive, a11y, bundle) + `plan-frontend-i18n.md` (key VI/EN). Q3 → ADR-0006 (Proposed); Q4 → 3100.

| Màn / thành phần | Trạng thái cần có | UC |
|---|---|---|
| `/login` | lỗi, đang gửi, khoá | UC-01 |
| `/c/new` (trang chào) | 4 thẻ gợi ý điền sẵn (C1 chưa có command ⇒ thẻ là câu hỏi mẫu) | UC-07 |
| `/c/:id` luồng flow + sidebar | tải (skeleton 3 tin), rỗng, không tồn tại, tìm không thấy | UC-02/07 |
| Khối bước, thẻ hỏi lại, thẻ lỗi | theo States | UC-03/05/08 |
| Khung flow phải / sheet mobile | mở, đang mở lại flow, lỗi | UC-06 |
| Banner kết nối | "Đang kết nối lại…", đỏ "Không kết nối được máy chủ" | UC-08 |

## 6. Hiệu năng
Theo `CONVENTIONS.md` §6. Riêng C1: JS đầu của chat-web ≤ 150 KB gzip (đo như `check:bundle` của admin-web); stream 500 `delta` không giật là **mục tiêu thiết kế** (gộp delta theo khung hình), không phải AC.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Agent Hub | Mock Hub chat trong `tools/mocks` (cổng 4020), chọn kịch bản (dưới) |
| Admin auth | Mock login trong mock Hub (user mẫu `plan.md` §3.4: `acme/minh`, `acme/lan`, `acme/hoa`, `beta/an`, `acme/khoa` khoá); JWT EdDSA, khoá sinh lúc khởi động (Q7). **Không gọi Admin** |
| Claude CLI, Coordinator, Worker | Không có; mock sinh câu trả lời tất định |

**Kịch bản mock** (chi tiết sự kiện, thời gian, thứ tự chọn: `plan.md` §3.3; chọn bằng tiền tố `#scn:<tên>` ở đầu nội dung tin — test contract chỉ dùng cách này; `POST /__mock/scenario {name}` đặt mặc định toàn cục cho e2e; mặc định `normal`; thêm `markdown`, `quota-warn`):

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
| `HUB_URL` | đích Hub của bộ test contract (trống → mock trong tiến trình) và proxy `/conversations` `/runs` `/health` của dev/preview chat-web. Không đưa vào bundle (Q2) | `http://localhost:4020` |
| `AUTH_URL` | đích proxy `/auth` của chat-web và `/auth/*` của test contract; trống → = `HUB_URL`; đổi sang admin-api khi bỏ mock login | trống |
| `CHAT_CONTRACT_USERS` | JSON user cho test contract với Hub thật (`plan.md` §4.1); trống → user mock | trống |
| `MOCK_FLOW_IDLE_S` | ngưỡng flow nghỉ của mock | `600` |
| `MOCK_FAST` | mock rút ngắn thời gian chờ (÷10, trừ `slow`/`flow-cold`) trong e2e | mặc định `0`, e2e đặt `1` |
| `MOCK_EVENTS_RETENTION_S` | giữ sự kiện run sau khi kết thúc (M4); test 410 đặt 1 | mặc định 600 |

## 8. Tiêu chí nghiệm thu (qc)
AC UC-01…UC-08 = **CHAT-AC-01…30** trong `docs/design/chat-app/usecases-chat.md` (Given/When/Then ở đó, không chép lại). Bổ sung kỹ thuật:

| AC | Given / When / Then | Test |
|---|---|---|
| CHAT-AC-31 | Given bộ test contract, When chạy với `HUB_URL` = mock, Then xanh toàn bộ (login/refresh, CRUD hội thoại, tạo flow, gửi tin vào flow, đủ 7 loại sự kiện SSE, `Last-Event-ID`, cancel, 401/404, cách ly user) | `tests/contract/chat/*.contract.test.ts` (`plan.md` §4) |
| CHAT-AC-32 | Given bộ test contract, When đổi `HUB_URL` sang địa chỉ khác (instance mock thứ hai), Then không sửa mã mà vẫn xanh. Cam kết: Hub thật pass bộ này thì Chat chạy | như trên |
| CHAT-AC-33 | Given payload SSE của mock, Then mọi sự kiện parse được bằng zod của contract và **không** có `agent`/`provider` (C1-R04) | như trên |
| CHAT-AC-34 | Given chat-web, When đổi `HUB_URL`/`AUTH_URL` (proxy dev/preview) rồi chạy lại, Then Chat gọi địa chỉ mới (không hằng số URL trong code) | unit hoặc e2e |
| CHAT-AC-35 | Given e2e Playwright với mock, Then CHAT-AC-01…30 đều có test tự động (UC-08 `drop`, `flow-cold` dùng `MOCK_FAST`) | `e2e/chat/*.chat.ts` |
| CHAT-AC-36 | Given VI/EN, Then không thiếu khoá i18n (script i18n của repo), mọi chuỗi hiển thị qua `packages/i18n` | script i18n |

Lệnh xong mốc: lệnh hàng QV trong `tasks.md` (`test:lock:verify`, `test:contract:chat`, `bun test tests/acceptance/C1`, e2e) kèm `bun run typecheck`, `bun test`, `bun run check:size --all`, `bunx depcruise --all`, `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web check:bundle`, `bun run test:contract:chat`, `bunx playwright test -c e2e/chat/playwright.config.ts`, `bun run test:lock:verify`.

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
| Q2 | Tên biến môi trường Hub: repo đã có `HUB_BASE_URL` (Admin→Hub) | `HUB_URL` cho test contract, mặc định lấy `HUB_BASE_URL` nếu `HUB_URL` trống; → **đã chốt khác mặc định** (proxy `HUB_URL`/`AUTH_URL`, không `PUBLIC_HUB_URL`), xem dưới |
| Q3 | Thư viện render markdown + highlight code (cần ADR → trình người dùng ở Gate) | Đề xuất `react-markdown` + `remark-gfm` + `rehype-highlight`, nạp lazy; ADR mới (số do docs-architect cấp) |
| Q4 | Cổng dev chat-web | `3100` (admin-web 3000, mock Hub 4020) |
| Q5 | Có làm nối lại `Last-Event-ID` ở C1 không | **Có** (UI đã vẽ banner; UC-08, CHAT-AC-28) |
| Q6 | Ai cắt `agent`/`provider` khỏi SSE | Hub: kênh chat chỉ phát payload của §3; trace/Studio giữ đầy đủ. Bộ test contract kiểm CHAT-AC-33 |
| Q7 | Ký JWT mock | EdDSA bằng khoá dev cố định (cùng dạng Admin; Hub thật sau verify khoá công khai của Admin) |

### Quyết định PLAN backend (2026-10-03, chi tiết `plan.md` §1)
- Q1: `@ai/contracts/chat` (`packages/contracts/src/chat/`), thêm 1 dòng `exports`; fallback `@ai/contracts-chat` nếu tooling đỏ.
- Q2: `HUB_URL` + `AUTH_URL` (trống → `HUB_URL`) là env **server-side**: dev/preview chat-web proxy `/auth` → `AUTH_URL`, `/conversations` `/runs` `/health` → `HUB_URL` (như admin-web proxy `ADMIN_API_URL`); client gọi đường dẫn tương đối. Bỏ `PUBLIC_HUB_URL` và fallback `HUB_BASE_URL` (Bun tự nạp `.env.local` → `bun test` sẽ gọi cổng không chạy). CHAT-AC-34 đã sửa theo (điều phối, 2026-10-03).
- Q5: có; `id` liên tiếp từ 1, `Last-Event-ID` header hoặc query `last_event_id`; 410 `EVENTS_EXPIRED` sau 600 s.
- Q6: payload kênh chat strict, chỉ trường của contract; test contract parse strict.
- Q7: mock ký EdDSA bằng `jose` (ADR-0001, không ADR mới), khoá Ed25519 sinh lúc khởi động, claims như Admin.
- Kịch bản: `#scn:` theo tin (ưu tiên) → flow nghỉ ⇒ `flow-cold` → mặc định toàn cục `/__mock/scenario` → `normal`.
- Endpoint Hub trả 401 `AUTH_EXPIRED` (token thiếu/sai/hết hạn); `/auth/*` giữ mã Admin. Thêm `GET /conversations/:id`, `409 FLOW_BUSY`, `run.finished.content/ms`, `run.failed.message_id`, `Flow.preview/message_count/active_run_id`, `Message.run/ask` (để tải lại hội thoại vẽ đủ khối bước, thẻ hỏi lại, thẻ lỗi). `POST /conversations` bắt buộc `title` (client tính `deriveTitle`).
- `ask` không kết thúc stream một mình: luôn theo sau bởi `run.finished` (mỗi stream đúng một sự kiện kết thúc).

### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

### Điều phối xử lý test-plan §8 (2026-10-04, Luật 2: chọn phương án đơn giản, dễ đổi)
| # | Quyết định |
|---|---|
| M1 | `tests/contract/**` thêm vào ignore của `bunfig.toml`; tạo `bunfig.contract.toml` + script `test:contract:chat` (như `test:int`). `bun test` gốc không chạy bộ contract. Lệnh xong C1 gồm `bun run test:contract:chat` |
| M2 | Lệnh AC-32 (instance mock thứ hai) chạy kèm `DIFY_MOCK_PORT=4011` |
| M3 | Mock thu hồi access theo mốc ms (hoặc `sid`), không theo `iat` giây (B2) |
| M4 | Env `MOCK_EVENTS_RETENTION_S` (mặc định 600) để test 410 `EVENTS_EXPIRED` (B5) |
| M5–M6 | FE: bước đang chạy có `aria-busy="true"`; tay nắm sheet mobile là `button` có `aria-label="Kéo để đóng"` (không trùng nút ✕ "Đóng khung flow") (F9, F10). Nút "Thu nhỏ flow" (mobile) ở C1 cùng hành vi ✕: đóng sheet, xoá `?flow` |
| M7 | Cột Lệnh xong F4–F13 đổi sang `bunx playwright test -c e2e/chat/playwright.config.ts` (đã sửa tasks.md) |
| M8 | `Last-Event-ID` sai định dạng → coi như không có (phát lại từ đầu), không thêm mã lỗi |
| M9 | Ô đổi tên UI giới hạn 200 ký tự, khớp contract |
| M10 | Quét URL tuyệt đối trong `src/**` chỉ do test qc U-9; F13 bỏ phần quét |
| Lock | Khoá `tests/acceptance/**`, `e2e/**`, `tests/contract/**`; backend-lead thêm `tests/contract` vào `LOCKED_DIRS` (`tools/scripts/src/test-lock.ts`) ở **B0** (cùng `bunfig` + script, trước QB) |

### Bổ sung sau readiness lần 1 (2026-10-04, `readiness.md`)
- Contract `plan.md` §2 là nguồn cho C1; BA §9.2–9.3 bổ sung `FLOW_BUSY`, `EVENTS_EXPIRED`, `run.failed.message_id` và ui-chat §7 (refresh lỗi → về /login, C1-R08) ghi backlog docs cho H1 (`TECH-DEBT.md`).
- H2 (chờ người dùng ở Gate): mặc định C1 chỉ giao diện Sáng, ghi TECH-DEBT. H4 (mặc định, theo canvas FlowOpen): khối flow ở luồng chính hiện câu trả lời **đầu** (`preview`); câu mới chỉ thấy trong khung flow.
- **Gate 2026-10-04 (CR-027):** H2 đã chốt **Sáng + Tối** (+ Theo hệ thống), thay mặc định trên — token Tối đạt AA, logo tối, chống nháy: `plan-frontend-theme.md`, task F14.

## 10. Tranh chấp test
- (không)
