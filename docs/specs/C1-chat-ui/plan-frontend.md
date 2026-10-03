---
spec: C1-chat-ui
part: frontend
owner: frontend-lead
status: draft
requirements: [CHAT-AC-01..30, CHAT-AC-34..36]
---

# Plan frontend · C1 · `apps/chat-web`

Nguồn: spec §1/§2/§5/§6/§9 · `usecases-chat.md` UC-01…08 · canvas `docs/design/chat-app/canvas/*` · `ui-chat-extension.md` §2–5, §7–11 · token `docs/design/canvas/tokens-map.md`. Không chép BA/contract — trỏ mục. Contract: `plan.md` (backend-lead) + `@ai/contracts/chat` (Q1).

## 0. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Không tạo `packages/ui-chat` ở C1**; mọi component trong `apps/chat-web/src/features/*`, component trình bày chỉ nhận props (không import `~/lib`, router, query) để tách ra package khi làm Extension | Extension ngoài phạm vi C1 (YAGNI); package mới cần thêm Tailwind `@source`, tsconfig, alias depcruise; không đụng admin-web. → `TECH-DEBT.md` |
| D2 | **Chép tối thiểu** từ admin-web (không import chéo app): `components/ui/*` (shadcn, file sinh), `lib/http.ts`, `lib/auth/{session,refresh-lock,auth-channel}.ts`, `lib/clipboard.ts`, `lib/utils.ts` (`cn`), `styles/globals.css` (token), `scripts/check-bundle.ts` | Hai app độc lập; phiên M4 đang sửa admin-web. Trùng lặp → `TECH-DEBT.md` |
| D3 | Router TanStack Router file-based + TanStack Query (ADR-0001), i18next/react-i18next như admin-web | Bắt chước code có sẵn |
| D4 | Alias import `~/*` → `apps/chat-web/src/*` (**không** dùng `@/`) + thêm 1 dòng alias vào `tsconfig.depcruise.json` | `@/*` trong `tsconfig.depcruise.json` đang trỏ cố định admin-web → dùng `@/` sẽ làm depcruise resolve sai |
| D5 | **Khớp `plan.md` Q2 (backend-lead):** client gọi đường dẫn tương đối = path contract; dev/preview Rsbuild **proxy** `/auth` → `AUTH_URL` (trống = `HUB_URL`), `/conversations` `/runs` `/health` → `HUB_URL` (mặc định `http://localhost:4020`), đọc env trong `rsbuild.config.ts` như admin-web `ADMIN_API_URL`. **Bỏ `PUBLIC_HUB_URL`** | Cùng origin → cookie `ai_rt` `SameSite=Strict` chạy như admin-web, không CORS, bundle không chứa URL. CHAT-AC-34 hiểu là "đổi `HUB_URL` rồi chạy lại → request tới địa chỉ mới" (lệch mặc định spec Q2 — Câu hỏi H3) |
| D6 | SSE bằng `fetch` + `ReadableStream` + `TextDecoder` → `createSseParser`/`toChatEvent`/`isNewEvent` của `@ai/contracts/chat` (`plan.md` §2.7), **không** `EventSource`, không thư viện | `EventSource` không POST được, không gắn `Authorization`; parser dùng chung với bộ test contract |
| D7 | Chuỗi chat ở file riêng `packages/i18n/locales/chat/{vi,en}.json` + export `@ai/i18n/chat-locales`; mở rộng `i18n:check` kiểm thêm cặp này | Không kéo 60 KB chuỗi Admin vào chat-web; tránh xung đột với phiên M4 đang sửa `vi.json`/`en.json` |
| D8 | Markdown: `react-markdown` + `remark-gfm` + `highlight.js/lib/core` (≈10 ngôn ngữ), nạp lazy — **ADR-0006 Proposed** (Q3) | §11 |
| D9 | Cổng dev/preview **3100** `strictPort` (Q4) | §11 |
| D10 | Logo: chép `D:\AI\logo\evoluconsulting-icon.svg`, `…-logo-horizontal.svg` → `apps/chat-web/public/brand/` | yêu cầu điều phối |

## 1. Cấu trúc `apps/chat-web`

```
apps/chat-web/
├─ package.json  rsbuild.config.ts  index.html  tsconfig.json  tsconfig.node.json  components.json  README.md
├─ public/brand/  evoluconsulting-icon.svg · evoluconsulting-logo-horizontal.svg
├─ scripts/check-bundle.ts (+ .test.ts)          # chép admin-web, ngân sách §10
└─ src/
   ├─ main.tsx  env.d.ts  routeTree.gen.ts (sinh)
   ├─ app/        providers.tsx · router.ts · query-client.ts · i18n.ts
   ├─ routes/     __root.tsx · index.tsx (→ /c/new) · login.tsx · _authed.tsx · _authed/c.new.tsx · _authed/c.$id.tsx
   ├─ components/ui/       shadcn (button input textarea label dialog alert-dialog dropdown-menu sheet skeleton tooltip collapsible sonner)
   ├─ components/shared/   ConsultantAvatar · ConnectionBanner · KeyHint
   ├─ lib/        http.ts · sse.ts · auth/* · clipboard.ts · storage.ts (localStorage an toàn) · time-groups.ts · utils.ts  (tiêu đề/bỏ dấu/idle: `rules` của contract)
   ├─ styles/globals.css
   └─ features/
      ├─ auth/          api.ts · pages/LoginPage.tsx · components/{LoginForm,LockedDialog}.tsx · lib/schemas.ts
      ├─ shell/         components/{AppShell,Sidebar,ConversationList,ConversationItem,RenameDialog,DeleteDialog,SettingsDialog,UserMenu}.tsx · hooks/use-shortcuts.ts
      ├─ conversations/ api.ts (list, create, rename, delete, flows, messages) · lib/group.ts
      ├─ thread/        pages/{WelcomePage,ConversationPage}.tsx · components/{FlowBlock,ThreadView,NewMessagesButton,ThreadSkeleton,NotFoundState,SuggestionCards}.tsx · hooks/use-autoscroll.ts
      ├─ answer/        components/{AnswerBody,StepList,AskCard,ErrorCard,CancelledNote,ColdResumeNote,Markdown,CodeBlock}.tsx · lib/{error-map,highlight}.ts
      ├─ composer/      components/{Composer,QuotaNotice}.tsx · hooks/use-draft.ts
      ├─ flow-panel/    components/{FlowPanel,FlowSheet}.tsx
      └─ run/           api.ts (send, events, cancel) · run-store.ts · hooks/{use-run-stream,use-send}.ts · lib/{reducer,reconnect}.ts
```
Mỗi feature có `README.md` một dòng mã AC. Giới hạn CONVENTIONS §4 (component ≤ 200 dòng, ≤ 10 file ngang hàng).

## 2. Route & điều hướng

| Route | Guard | Nội dung | Ghi chú |
|---|---|---|---|
| `/login?next=` | đã đăng nhập → `/c/new` | LoginPage | `next` lọc như `lib/auth/next.ts` admin (chỉ đường nội bộ) |
| `/` | — | redirect `/c/new` | |
| `_authed` (layout) | `beforeLoad`: chưa có token → thử `POST /auth/refresh` một lần; fail → `/login?next=` | AppShell (sidebar + outlet) | refresh trả `user` (Me) → tên, công ty |
| `/c/new` | `_authed` | WelcomePage + Composer chính | Gửi tin đầu → `POST /conversations {title: deriveTitle(content)}` rồi `POST …/messages` → `navigate('/c/:id', replace)`; stream tiếp tục (run-store không gắn với route) |
| `/c/:id?flow=<flow_id>` | `_authed` | ConversationPage; `flow` có → FlowPanel/FlowSheet mở | search param zod `{flow?: string}`; Back đóng khung; flow lạ → bỏ param |
| khác | — | về `/c/new` | |

Phím: `Ctrl+Shift+O` → `/c/new`; `Ctrl+K` → focus "Tìm hội thoại" (mở sheet nếu < 1024); `Esc` → dừng run của composer đang focus (hoặc run duy nhất đang chạy), đóng khung flow nếu không có run.

## 3. State

| Loại | Nơi giữ | Key / hình dạng | Vòng đời |
|---|---|---|---|
| Phiên (token, Me) | `lib/auth/session.ts` (bộ nhớ) + BroadcastChannel `ai-chat-auth` + Web Lock `ai-chat-refresh` | như admin | logout/refresh fail → xoá |
| Danh sách hội thoại | Infinite query `['conversations', q]` (E5, `q` = ô tìm, debounce 250 ms, server `foldVi`) | `ChatPage<Conversation>` | invalidate sau create/rename/delete/run kết thúc |
| Hội thoại + flow | Query `['conv', id]` (E7) · infinite `['conv', id, 'flows']` (E10, `preview` cho khối flow) | `Conversation`, `ChatPage<Flow>` | invalidate flows sau run kết thúc |
| Tin của một flow (khung) | Infinite `['flow', flowId, 'messages']` (E11 `flow_id`, cursor cũ hơn khi cuộn lên) | `ChatPage<Message>` | invalidate sau run kết thúc |
| Run đang chạy | `run/run-store.ts` (store ngoài React, `useSyncExternalStore`, selector theo `flowId`) | `RunState {runId, flowId, convId, origin: 'main'\|'flow', request:{content, flowId?}, phase, text, steps[], ask?, error?, quota?, lastEventId}` | xoá khi query đã chứa `message_id` của run (tránh nháy) |
| `phase` | reducer thuần `run/lib/reducer.ts` | `sending → cold → streaming → reconnecting → finished \| asked \| failed \| cancelled \| lost` | `cold` = gửi vào flow có `isFlowIdle(last_active_at)` (contract) cho tới `run.started` (UC-06) |
| Nháp | `localStorage` `chat:draft:<userId>:<convId\|new>:<flowId\|main>` | string | debounce 300 ms; xoá khi gửi ok, đăng xuất, hết phiên |
| Mã công ty | `localStorage` `chat:tenant_key` | string | lưu khi login ok |
| Ẩn nhắc quota | `sessionStorage` `chat:quota-dismissed` | `1` | hết phiên |
| Sidebar thu gọn | `localStorage` `chat:sidebar` | `open\|closed` | |

Luật: một hội thoại chỉ một run chạy (UC-02: gõ trước được, không gửi được). Nút gửi của composer kia bị `disabled` + tooltip `chat.composer.busy`.

## 4. HTTP, auth, SSE

| Thành phần | Hành vi |
|---|---|
| `rsbuild.config.ts` | `HUB_URL` (mặc định `http://localhost:4020`), `AUTH_URL` (trống = `HUB_URL`) → `server.proxy` cho dev + preview (D5). `src/` không chứa URL tuyệt đối (unit test quét `src/**`, CHAT-AC-34) |
| `lib/http.ts` | chép admin: JSON, `ApiError`, Bearer, `credentials: "same-origin"`, `Accept-Language` theo ngôn ngữ UI. **401 bất kỳ mã** (Hub: `AUTH_EXPIRED`) ngoài `/auth/*` → refresh đúng 1 lần, gọi lại (CHAT-AC-03); refresh fail → xoá phiên, `/login?next=` + toast `chat.session.expired`. `TypeError` fetch → `NETWORK_ERROR` |
| `lib/sse.ts` | `readEvents(body, onEvent, signal)`: `TextDecoder` stream → `createSseParser` → `toChatEvent`; sự kiện parse lỗi → bỏ qua (dev `console.warn`), không làm hỏng run |
| `run/api.ts` | `sendMessage(convId, {content, flow_id?}, signal)` → Response stream + header `X-Run-Id`, `X-Flow-Id`, `X-Message-Id`; lỗi trước stream là JSON (409 `FLOW_BUSY` → toast `toast.flowBusy`, giữ chữ); `openEvents(runId, lastEventId, signal)`; `cancelRun(runId)` |
| `use-run-stream` | Đọc stream → dispatch reducer. `delta` gom vào buffer, **flush 1 lần/khung hình** (`requestAnimationFrame`) — spec §6 (500 delta). Ghi `lastEventId` mỗi sự kiện. `run.finished.content` **thay** chữ đã ghép (CHAT-AC-06). Mở hội thoại/khung có `active_run_id` → gắn lại bằng E13 `last_event_id=0` |
| Nối lại (C1-R06, Q5) | Stream đóng/lỗi mạng **trước** sự kiện kết thúc → `phase=reconnecting`, banner "Đang kết nối lại…" → `GET /runs/:id/events` + `Last-Event-ID: <lastEventId>` (chưa có sự kiện nào → không gửi header). Backoff 0,5 · 1 · 2 · 4 · 8 s (5 lần ≈ 15 s). Sự kiện `id ≤ lastEventId` → bỏ (chống lặp). Hết lượt → `phase=lost`, banner đỏ "Không kết nối được máy chủ" + Thử lại (= nối lại từ `lastEventId`). `410 EVENTS_EXPIRED` → refetch flows/messages rồi xoá run |
| Dừng (UC-04) | ■ / `Esc` → `POST /runs/:id/cancel`; giữ chữ đã stream; chờ `run.failed CANCELLED` (Hub ≤ 5 s) rồi `cancelled`; nhận `run.finished` trước → hiện kết quả bình thường. Dừng không abort fetch (để nhận sự kiện cuối) |
| Chạy lại / Thử lại | gửi lại `request.content`; `origin='main'` → không `flow_id` (flow mới, UC-04), `origin='flow'` → cùng `flow_id` |
| Hub sập (CHAT-AC-29) | Query list/flows/messages hoặc gửi lỗi `NETWORK_ERROR` → banner đỏ ở đầu vùng nội dung + Thử lại (`refetchQueries` active; gửi lỗi giữ chữ trong composer) |

## 5. Màn ↔ artboard ↔ UC/AC ↔ trạng thái

| Màn / thành phần | Artboard · số đo | Trạng thái | UC · AC |
|---|---|---|---|
| LoginPage | không có artboard chat → bố cục Login Admin (form giữa trang, logo ngang trên đầu, không có panel hero) | đang gửi (nút disabled + "Đang đăng nhập…"), lỗi chung (`role=alert`), khoá → `LockedDialog`, mất mạng, `password_change_required`/`totp_required` → alert `chat.login.useAdmin` | UC-01 · 01, 02 |
| AppShell + Sidebar | Main: `nav` 260px, nền `--card`, viền phải `--border`, padding 16/12; đầu: logo + "AI Chat · {tenant}"; nút "Hội thoại mới" + kbd `Ctrl⇧O`; ô tìm; nhóm; cuối: avatar chữ tắt + tên + username, nút Cài đặt | tải (skeleton 6 dòng), rỗng (`chat.sidebar.empty`), tìm không thấy (`chat.sidebar.noMatch`), lỗi → banner Hub | UC-07 · 19, 21–23 |
| ConversationItem `⋯` | DropdownMenu: Đổi tên (Dialog, input ≤ 200 ký tự, không rỗng) · Xoá (AlertDialog) | đang lưu, lỗi → toast `chat.toast.renameFailed`; xoá hội thoại đang mở → `/c/new` | UC-07 · 21, 22 |
| WelcomePage `/c/new` | Welcome: cột 720px, logo 48px, "Chào {name}, hôm nay cần gì?", phụ đề, lưới 2×2 thẻ (tiêu đề + câu mẫu), dòng gợi ý dưới | bấm thẻ → điền composer + focus, **không gửi** | UC-07 · 18 |
| ConversationPage `/c/:id` | Main: luồng max 720–800px giữa; tiêu đề hội thoại + "{n} flow"; FlowBlock (`border 1px, radius 14, padding 16, gap 12`), câu hỏi phải nền `--row-divider` radius 12 max 80% | tải: skeleton 3 tin; 404 → NotFoundState "Hội thoại không tồn tại" + nút "Về trang chào"; rỗng (hội thoại chưa có flow) → hiện như trang chào không thẻ | UC-07 · 20 |
| FlowBlock | Main: `Flow.preview` = câu hỏi đầu + câu trả lời **đầu** của flow (khớp canvas FlowOpen; flow chưa có trả lời → stream ngay trong khối) + footer viền trên: Copy · Trả lời tiếp · "+{n} tin trong flow · {thời gian}" (`message_count − 2`, `last_active_at`); flow đang mở bên phải → "Đang mở bên phải · {n} tin"; run chạy trong khung → footer hiện spinner + đếm cập nhật ("đồng bộ" UC-06) | streaming (con trỏ nhấp nháy `aria-hidden`), steps (`run.steps` sau F5), ask, error, cancelled, cold | UC-02 · 05, 06 |
| ConsultantAvatar | `.who`: icon 22px + "Consultant" 13px/600 `--primary-strong`. Không bao giờ hiện agent/provider | — | CR-022 · 06, 30 |
| StepList | States: đang chạy (spinner + nhãn, ✓ + "2,1s"), xong → Collapsible "✓ {n} bước · {s}s" (định dạng số theo locale); ✕ cho `failed`; 0 bước → không hiện | | UC-03 · 08, 09 |
| AskCard | States: viền `--primary`, tiêu đề "Consultant cần thêm thông tin", câu hỏi, chip cao 32 radius 999; gợi ý "Bấm chip là gửi luôn. Vẫn gõ tự do được." | chip bấm → gửi ngay cùng `flow_id`; sau khi có tin kế → chip `disabled` | UC-05 · 12, 13 |
| ErrorCard | States: nền `--danger-bg`, tiêu đề + câu theo **mã** (i18n, không hiện `message`/`hint` thô của Hub — CHAT-AC-30), nút, dòng mono `{CODE} · run {id}` | Báo admin → clipboard `"{CODE} · run {id}"` + toast "Đã sao chép"; Thử lại → run mới. Nút theo mã: `TIMEOUT`/`UPSTREAM_ERROR` Thử lại · `ALL_PROVIDERS_EXHAUSTED` Thử lại + Báo admin · `NOT_CONFIGURED` Báo admin · `BUDGET_EXCEEDED` không nút · `CANCELLED` Chạy lại (nhỏ, xám) · lạ/`INTERNAL_ERROR` Thử lại + Báo admin (ui-chat §8) | UC-08 · 24–27, 30 |
| CancelledNote | States: "Đã dừng" xám + nút nhỏ "Chạy lại" | | UC-04 · 10, 11 |
| ColdResumeNote | States: spinner + "Đang mở lại flow, lần đầu có thể mất vài giây…" trong khối/khung flow tới `run.started`/`delta` đầu | | UC-06 · 16 |
| Composer | Main/Welcome: textarea tự giãn ≤ 8 dòng, nút Gửi 36px → ■ Dừng khi run chạy; placeholder chính "Hỏi điều mới…", trong flow "Trả lời trong flow…"; nhãn trên composer "Câu hỏi mới" + mô tả (Main) | rỗng → Gửi disabled; busy → gõ được, gửi disabled; gửi lỗi mạng → giữ chữ | UC-02/04 · 05, 10 |
| QuotaNotice | dòng xám trên composer khi `run.started.quota.state = over`, nút ✕ | | UC-02 |
| NewMessagesButton | nổi giữa đáy luồng: "↓ Tin mới" | hiện khi cách đáy > 80px lúc stream | UC-02 · 07 |
| FlowPanel (≥ 640) | FlowOpen: `aside` flex `1 1 420px`, max 480px, nền trắng, viền trái, bóng; header: tiêu đề flow + "{n} tin · nhớ cả flow" + ✕; luồng đủ tin của flow; composer "Trả lời trong flow…" | mở: tải tin (skeleton 3), focus ô nhập (AC-14); đổi flow → thay nội dung; cold | UC-06 · 14, 15, 16 |
| FlowSheet (< 640) | Mobile: Sheet đáy, cao ~83vh, radius 16 trên, tay nắm kéo (`button` `aria-label="Kéo để đóng"`); header ✕ "Đóng khung flow" + "Thu nhỏ flow" | kéo xuống > 120px, ✕ hoặc "Thu nhỏ flow" (C1 cùng hành vi ✕) → đóng (xoá `?flow`) | UC-06 · 17 |
| ConnectionBanner | States: vàng "Đang kết nối lại…" (`role=status`), đỏ "Không kết nối được máy chủ" + Thử lại (`role=alert`) | | UC-08 · 28, 29 |
| SettingsDialog | không có artboard: Dialog (ui-chat §7) — Ngôn ngữ (Tiếng Việt/English), Tài khoản (tên, công ty), dòng Quyền riêng tư, nút Đăng xuất. Giao diện Sáng/Tối/Theo hệ thống: `plan-frontend-theme.md` (F14) | đăng xuất → `POST /auth/logout`, xoá phiên + query cache, `/login` | UC-01 · 04 |


## 6. Câu chữ

Bảng key ↔ VI ↔ EN: **`plan-frontend-i18n.md`** (phụ lục, cho task có chữ). Luật: `Intl.RelativeTimeFormat`/`NumberFormat` theo locale; mã lỗi giữ nguyên (ui-chat §10); mã lỗi lạ/`INTERNAL_ERROR` → `errors.unknown`; **không** hiện `message`/`hint` thô của Hub (CHAT-AC-30).

## 7. Nhãn / role cho e2e (VI, giữ nguyên khi code)

| Vùng | Locator Playwright |
|---|---|
| Login | `textbox "Mã công ty"` · `textbox "Tên đăng nhập"` · `textbox "Mật khẩu"` (input password có `<label>`) · `button "Đăng nhập"` · `button "Đổi công ty"` · `alert` chứa câu lỗi · `alertdialog` "Tài khoản đang bị khoá…" |
| Sidebar | `navigation "Hội thoại"` · `link "Hội thoại mới"` · `searchbox "Tìm hội thoại"` · `heading` cấp 2 "Hôm nay"/"7 ngày qua"/"30 ngày qua"/"Cũ hơn" (mỗi nhóm `list`) · `link "<tiêu đề>"` (`aria-current="page"` khi mở) · `button "Thao tác khác"` · `menuitem "Đổi tên"`/`"Xoá"` · `dialog "Đổi tên hội thoại"` + `textbox "Tên hội thoại"` + `button "Lưu"` · `alertdialog "Xoá hội thoại?"` + `button "Xoá"`/`"Huỷ"` · `button "Cài đặt"` · `button "Danh sách hội thoại"` (< 1024) |
| Welcome | `heading` "Chào {name}, hôm nay cần gì?" · `button` "<tiêu đề thẻ>" (4 thẻ: Soạn email, Tóm tắt văn bản, Dịch, Lên dàn ý) |
| Luồng | `log "Nội dung hội thoại"` · mỗi flow `article "Flow: <tiêu đề>"` · trong article: `button "Copy"` · `button "Trả lời tiếp"` · text "Consultant" + `img "EvoluConsulting"` |
| Bước | `button` "✓ 2 bước · 7,8s" (`aria-expanded`) · `list "Các bước"` · `listitem` nhãn bước |
| Hỏi lại | `region "Consultant cần thêm thông tin"` · `button "<choice>"` (disabled sau trả lời) |
| Lỗi | `alert` trong article: tiêu đề · `button "Thử lại"` · `button "Báo admin"` · text `ALL_PROVIDERS_EXHAUSTED · run <id>` · "Đã dừng" + `button "Chạy lại"` |
| Composer chính | `textbox "Tin nhắn"` (placeholder "Hỏi điều mới…") · `button "Gửi"` · `button "Dừng"` · `button "↓ Tin mới"` · text nhắc quota + `button "Ẩn nhắc"` |
| Khung flow | `complementary "Flow đang mở"` (≥ 640) / `dialog "Flow đang mở"` (< 640) · `textbox "Tin nhắn trong flow"` · `button "Gửi trong flow"` · `button "Đóng khung flow"` · `button "Thu nhỏ flow"` (mobile) · `status` "Đang mở lại flow…" |
| Kết nối | `status` "Đang kết nối lại…" · `alert` "Không kết nối được máy chủ" + `button "Thử lại"` |
| Cài đặt | `dialog "Cài đặt"` · `radio "Tiếng Việt"`/`"English"` · `button "Đăng xuất"` |

`data-testid` chỉ khi role không đủ: `data-run-id` trên article đang chạy (qc đối chiếu cancel), `data-flow-id` trên article.

## 8. Responsive

| Bề rộng | Bố cục |
|---|---|
| ≥ 1024 | Sidebar 260px cố định (thu gọn được) + luồng; khung flow `aside` bên phải (Main co lại, flex như FlowOpen) |
| 640–1023 | Sidebar thành Sheet trái mở bằng ☰ "Danh sách hội thoại"; khung flow vẫn `aside` phải, chiếm tối đa 480px, luồng chính co |
| < 640 | Toàn màn hình, header 56px (☰ + tiêu đề), nút chạm 44px; composer dính đáy, né bàn phím ảo (`env(safe-area-inset-bottom)` + `visualViewport` resize); khung flow là Sheet đáy (Mobile), kéo xuống/✕ đóng |

## 9. Accessibility

| Mục | Cách làm |
|---|---|
| Luồng tin | `role="log"` `aria-live="polite"` `aria-relevant="additions"`; chữ đang stream nằm trong vùng `aria-hidden`/`aria-busy="true"`, khi run xong mới chèn bản đầy đủ vào vùng live (đọc một lần, ui-chat §11) |
| Bàn phím | mọi nút là `button`; Enter gửi/Shift+Enter xuống dòng; Esc dừng/đóng; focus về ô nhập khung flow khi mở (AC-14), trả focus nút "Trả lời tiếp" khi đóng; Dialog/Sheet giữ focus (Radix) |
| Icon | nút chỉ icon có `aria-label` (§7); icon bước luôn kèm chữ; spinner `aria-hidden` + chữ |
| Tương phản | token tokens-map (AA); chữ phụ dùng `--subtle-foreground` (#736C89) |
| Chuyển động | con trỏ nhấp nháy + kéo sheet tôn trọng `prefers-reduced-motion` |
| Ngôn ngữ | `<html lang>` theo locale |

## 10. Hiệu năng & bundle

| Chỉ số | Ngân sách | Cách |
|---|---|---|
| JS ban đầu (gzip) | **≤ 150 KB** (spec §6) | route chunk (`autoCodeSplitting`), locale nạp động, login là chunk riêng; `check:bundle` chép admin, đổi ngưỡng |
| CSS ban đầu | ≤ 25 KB | Tailwind v4 |
| Chunk bất đồng bộ | ≤ 50 KB mỗi chunk | markdown ≈ 44 KB (react-markdown 34,1 + remark-gfm 9,8); highlight ≈ 15–20 KB chunk riêng (ADR-0006) |
| Stream 500 delta | không giật (**mục tiêu thiết kế**, không phải AC) | gộp delta theo `requestAnimationFrame`; `FlowBlock` `memo` + selector run-store theo `flowId` (flow khác không render lại); Markdown: tách khối đã đóng (`\n\n`) memo, chỉ khối cuối parse lại |
| Danh sách | sidebar trang 50 (E5), "tải thêm" khi cuộn tới cuối, ≤ 200 mục → không virtualize; flows trang 50 (E10); tin trong khung trang 50, cuộn lên tải thêm (cursor) | |
| Prefetch | sau login idle → `import()` chunk markdown | câu trả lời đầu đã có markdown |

## 11. Trả lời câu hỏi mở FE (spec §9)

| # | Trả lời |
|---|---|
| Q3 | `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 + `highlight.js` 11.12.0 (**core** + 10 ngôn ngữ, tự đăng ký) — **không** dùng `rehype-highlight` (kéo cả gói `common` ~37 ngôn ngữ của lowlight, vượt 50 KB/chunk). Lazy 2 tầng. Không `rehype-raw` (không render HTML thô). ADR: `docs/adr/0006-chat-markdown.md` (Proposed, trình Gate) |
| Q4 | Cổng 3100 `strictPort` cho `dev` và `preview` (e2e) |
| Q2 (phần FE) | Theo `plan.md` Q2: proxy `HUB_URL`/`AUTH_URL`, **không** `PUBLIC_HUB_URL` (D5). `apps/chat-web/.env.example`: `HUB_URL=http://localhost:4020` |
| Q5 | Có — §4 "Nối lại" |

## 12. Đề xuất contract cho backend-lead

Đã đối chiếu `plan.md` (2026-10-03): login `tenant_key` + `TokenGrant.user`; 401 `AUTH_EXPIRED`; `Flow.message_count`/`active_run_id`/`preview`; `Message.run` (steps, error) + `ask`; E5 `q` + sắp `updated_at`; `run.finished.content`; bất biến `id` SSE; proxy cùng origin — **đủ cho FE**. Còn lại:

| # | Đề xuất | Lý do · mặc định FE nếu không nhận |
|---|---|---|
| P1 | `Conversation` thêm `flow_count` int ≥ 0 | Tiêu đề "{n} flow" (Main) khi flows còn `next_cursor`. Mặc định: đếm flow đã tải, ẩn số khi còn trang |
| P2 | Ghi rõ trong contract: `content` tin user lưu nguyên văn kể cả tiền tố `#scn:` (plan §3.3) — FE hiển thị nguyên văn | e2e nên chọn kịch bản bằng `POST /__mock/scenario` để chữ câu hỏi sạch |
| P3 | `Flow.preview.answer` cập nhật cùng lúc tin assistant đầu được lưu (trước khi stream đóng) | Tránh khối flow nháy rỗng giữa `run.finished` và refetch |

## 13. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Phiên M4 sửa cùng `tsconfig.depcruise.json`, `tools/scripts/src/i18n-check.ts` | Sửa tối thiểu (1 dòng alias; vòng lặp cặp locale), commit riêng, đọc lại file ngay trước khi sửa |
| Chép code auth/http từ admin → hai bản lệch | Ghi `TECH-DEBT.md`; test unit chép kèm |
| Stream + markdown re-parse gây giật | rAF batching, memo khối đã đóng; mục tiêu thiết kế, đo thủ công |

## 14. Câu hỏi cho người dùng (mỗi câu có mặc định)

| # | Câu hỏi | Mặc định |
|---|---|---|
| H1 | ADR-0006 thêm 3 thư viện markdown (≈ 44 KB + 15–20 KB gzip, nạp lazy) | Duyệt |
| H2 | Sáng/Tối trong Cài đặt | **Đã chốt: Sáng + Tối** (CR-027), xem `plan-frontend-theme.md` |
| H3 | Spec §9 Q2 / CHAT-AC-34 ghi `PUBLIC_HUB_URL`; backend + FE chốt proxy `HUB_URL` (D5) | Theo proxy; docs-architect sửa câu chữ Q2/AC-34 trong spec |
| H4 | Khối flow ở luồng chính hiện trả lời **đầu** (canvas FlowOpen, `preview`); câu trả lời mới chỉ thấy trong khung | Theo canvas |
