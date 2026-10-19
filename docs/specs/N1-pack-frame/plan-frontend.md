# Plan frontend · N1 · khuôn `apps/contracts-web`

Spec: [spec §2 PK-FR-10](spec.md), [D-02](spec-decisions.md). Chế độ PLAN, chưa code. Nguồn UI: `reference/mgmt-app-contracts/web/src/**` (viết tắt `ref:`). Khung này dùng cho mọi gói sau (`<khoá>-web`).

## 0. Quyết định chính
| # | Quyết định | Căn cứ |
|---|---|---|
| F1 | `apps/contracts-web`: Rsbuild + React 18 + Tailwind v4 + shadcn (Radix) + TanStack Router/Query + RHF/zod + `@ai/i18n`; feature-first; gọi API chỉ trong `features/<f>/api.ts`. Khuôn = `apps/chat-web` (rsbuild.config, tsconfig, check-bundle) | ADR-0001; CONVENTIONS |
| F2 | **Giữ nguyên** màn, màu, menu, đường dẫn, câu chữ mgmt-app; **đổi** chỉ phần máy móc: react-router 7 → TanStack Router (cùng URL), `Toaster`/`DialogHost` tự viết → shadcn `sonner`/`Dialog`/`AlertDialog` (bề ngoài như cũ), Vite → Rsbuild, React 19 → 18 | D-02, ADR-0001 |
| F3 | Class Tailwind của mgmt-app chép gần như nguyên (cùng Tailwind v4) — token đặt tên như `ref:index.css:7-45` (`ground`, `panel`, `act`…) nên trang chép không phải viết lại màu | giảm lệch ảnh |
| F4 | Route SPA không trùng route API: API gói dưới `/pack/contracts/*` (đề xuất backend), proxy dev như `chat-web/rsbuild.config.ts` (`/auth` → admin-api, `/pack` → hub-api, cùng origin ⇒ cookie refresh `SameSite=Strict` chạy không CORS) | chat-web |
| F5 | Auth: dùng lại logic phiên của chat-web (token trong bộ nhớ + cookie refresh + khoá refresh + kênh đa tab) — **tách `packages/web-kit`** (§4), không chép | ADR-0018 |

## 1. Khung app
| Phần | Làm | ref |
|---|---|---|
| Route | `/login` · `_authed` (guard `requireSession`) → Shell: `/` → `/contracts`; `/contracts`, `/contracts/new`, `/contracts/$id`, `/partners`, `/prices`, `/cks`, `/cks/$id`, `/settings`, `/settings/scoring`; `*` → `/contracts`. `/feedback` → mở panel góp ý. Mỗi route lazy (autoCodeSplitting). **Bỏ** `/onboarding` và đăng ký (Q-F3) | App.tsx:28-50 |
| Shell | Sidebar 64 px mở 224 px khi hover/focus; header 58 px (tiêu đề mục, chuông, góp ý, menu người dùng ở mobile); thanh dưới 4 mục ở mobile; panel phải 340 px (280–560, kéo, nhớ `assistant:open`/`assistant:width`); nút nổi "Mở trợ lý AI"; sheet 85 dvh ở mobile | Shell.tsx:43-189 |
| Menu | Hợp đồng `/contracts` · Đối tác `/partners` · So sánh giá `/prices` · Sản phẩm `/cks`; tên app "Sổ Hợp Tác" + khẩu hiệu giữ nguyên (`brand.ts:3-4`, qua i18n) | Shell.tsx:13-19 |
| Đăng nhập | Port `LoginPage` + Showcase/AppPreview; gọi admin-api `/auth/login`. Ô "Mã công ty" chỉ hiện khi chưa biết tenant (như `LoginForm` chat-web: `defaultTenant` từ env/`?tenant=`/nhớ lần trước). `next=` giữ như cũ | LoginPage.tsx:10-73,124-214 |
| Phiên/token | Access token trong bộ nhớ; `ensure()` refresh cookie 1 lần khi tải trang; 401 → `/login?next=`; hết hạn giữa chừng → refresh, thất bại → toast + về login; đăng xuất đồng bộ đa tab. `useMe`: tên, tenant; **`write`/`owner`** suy từ `actions` của `GET /pack/contracts/me` (có `write` / có `admin`) | session.ts; client.ts:12-13 |
| Quyền | `viewer` = chỉ xem (ẩn nút ghi như mgmt-app khi `!write`); `editor` = `write`; `owner` = thêm nút xoá. 403 `PACK_FORBIDDEN` / `PACK_DISABLED` → trang trạng thái riêng (§7) | spec PK-FR-05 |
| Theme | Sáng/tối/theo máy (`html[data-theme]`) giữ `theme.ts`; menu "Giao diện" | theme.ts; TopBar.tsx:123 |
| Trạng thái | Đang tải: skeleton/`Loading` (`aria-label="Đang tải"`); rỗng: `Empty`; lỗi: `ErrorLine` + nút "Thử lại"; 409: toast; mất mạng: banner kiểu `ConnectionBanner` chat-web | ui.tsx:78-123 |
| Chuỗi | Mọi chuỗi qua key `contracts.*` trong `packages/i18n` (vi nguyên văn từ mgmt-app, en do FE dịch); `bun run i18n:check` | CONVENTIONS |

## 2. Danh sách màn mgmt-app → contracts-web (phân lát)
| S | Màn (route) | ref | Lát |
|---|---|---|---|
| S01 | Đăng nhập `/login` | LoginPage.tsx:10-214 | **N1** |
| S02 | Onboarding `/onboarding` | LoginPage.tsx:75-122 | **bỏ** (Q-F3) |
| S16 | Chuông thông báo + menu người dùng | TopBar.tsx:53-175 | N1 (khung, rỗng) · HD4 (dữ liệu) |
| S04 | Thêm hợp đồng tay `/contracts/new` | NewContractPage.tsx:36-120 | HD2 |
| S05 | Chi tiết hợp đồng `/contracts/$id` (+ nhật ký) | ContractPage.tsx:27-181 | HD2 (trường/kiểm) · HD3 (thẻ duyệt) · HD4 (nhắc) |
| S03 | Danh sách hợp đồng `/contracts` | ContractsPage.tsx:65-227 | HD5 |
| S14 | Panel góp ý | FeedbackDialog.tsx:1-115 | HD5 (Q-F5) |
| S15 | Panel trợ lý + thẻ đề xuất | Panel.tsx:107-335; cards.tsx; prefill.ts | HD6 |
| S06 | Đối tác `/partners` (điểm, xếp hạng) | PartnersPage.tsx:30-99; PartnerRatings.tsx:13-71 | HD8 |
| S06b | Sổ thanh toán/nghĩa vụ trong đối tác | PartnerLog.tsx:46-208 | HD7 |
| S07 | So sánh giá `/prices` | PricesPage.tsx:27-169 | HD8 |
| S09 | Bảng giá rẻ nhất thị trường | MarketCheapest.tsx:19-132 | HD8 |
| S12 | Cài đặt + điểm đối tác `/settings`, `/settings/scoring` | SettingsPage.tsx:7-34; ScoringPage.tsx:20-227 | HD8 |
| S08 | Giá CKS (tab) | CksPricesTab.tsx:57-197 | HD9 |
| S10 | Sản phẩm CKS `/cks` | CksPage.tsx:26-187 | HD9 |
| S11 | Khách CKS `/cks/$id` + 3 hộp thoại | CksCustomerPage.tsx:17-196; dialogs.tsx:41-153 | HD9 |

**16 mục, 15 giữ.** Component chung (dựng ở N1, các lát dùng lại): `ui.tsx` (PageHead, Panel, Chips, Empty, Loading, ErrorLine, Stat, ScoreBadge, `vnd`/`viDate`) → `components/shared/`; `icons.tsx` → `components/icons.tsx`; `toast.tsx`/`dialog.tsx` → shadcn bọc API cũ (`toast()`, `confirmDialog()`, `promptDialog()`); `table.tsx:98-438` (useTable, lọc cột, ColumnPicker, Pager) → `features/table/` tách ≤ 400 dòng/file, giữ `normalize`/`matches` (bỏ dấu tiếng Việt) và `aria-label` cũ. Bảng > 200 dòng/trang: virtualize bằng TanStack Table (đã có trong ADR-0001).

## 3. Bảng màu chung với admin-web
Token cơ sở **trùng giá trị** với `apps/admin-web/src/styles/globals.css` (ground `#f4f4f9`, act `#4f46e5`, ok `#05603f`…): `ref:index.css:13-41` đã sinh từ kit admin-web. `contracts-web/src/styles/globals.css` khai tên mgmt (`--color-ground`…) trỏ `var(--background)`… cho phần trùng; phần riêng mgmt (soon/late/idle/bubble) giữ giá trị gốc, bản tối `ref:index.css:49-70`. Test đơn vị `theme-parity.test.ts` đọc hai file CSS, báo lỗi nếu token trùng tên khác giá trị. Font: Roboto + Roboto Mono như mgmt-app (`ref:index.css:8-11`) — dòng ADR-0001 (D-14).

## 4. Chia sẻ code với chat-web
| Phần | Cách | Căn cứ |
|---|---|---|
| shadcn `components/ui/*`, `check-bundle.ts`, `globals` | **Chép** (đúng quy ước hiện có: chat-web chép từ admin-web) | primitive đổi hiếm, mỗi app có theme riêng |
| Phiên đăng nhập: `lib/auth/{session,refresh-lock,auth-channel}.ts`, `lib/http.ts`, `lib/sse.ts` + logic thuần `features/answer/lib/*` (blocks, error-map, step-label), reducer luồng `thread-logic.ts` | **Tách `packages/web-kit`** (di chuyển nguyên, kèm test; chat-web import lại; hằng tên kênh/khoá nhận tham số) | lỗi refresh sửa một chỗ (khoá sai = đăng xuất chéo tab) |
| Hiển thị câu trả lời: `Markdown`, `StepList`, `AskCard`, `ErrorCard`, `CodeBlock` | Chép vào `features/assistant/` (phụ thuộc shadcn của từng app), dùng logic từ web-kit | UI theo theme từng app |
| Composer/thread/rooms của chat-web | **Không dùng**; panel trợ lý viết mỏng theo `Panel.tsx` (1 ô nhập, đính kèm, thẻ) | chat-web gắn router/hội thoại riêng |
`web-kit` chỉ dùng dependency sẵn có. Làm ở TF3 (chat-web phải xanh y nguyên) — rủi ro cao vì chạm đăng nhập chat-web; `e2e/chat` chạy lại.

## 5. Khung chat nhúng (làm ở HD6; N1 chỉ chừa chỗ)
- Shell có slot `aside` (§1), nội dung `lazy(() => import("features/assistant"))` — chunk riêng, không vào bundle đầu.
- Panel gọi API chat hub-api sẵn có (hội thoại + SSE) qua web-kit; gửi kèm ngữ cảnh trang `{page,id}` (`ref: assistant/context.ts:14-26`); thẻ đề xuất `cards.tsx` → `AskCard` (cổng xác nhận) ; `prefill.ts` điền form (`open_form`) → hàm của từng màn.
- Lỗi/quota/mất kết nối: `error-map` web-kit; ô nhập `aria-label="Câu hỏi cho trợ lý"`, nút `Gửi`, `Đính kèm ảnh hoặc file`.

## 6. So màn hình với mgmt-app thật (D-02: lệch = lỗi)
**Hiện trạng:** mgmt-app **không chạy trọn được** ở đây (API cần OpenSearch + Neo4j + khoá LLM, máy không có docker). Phần web chạy được: `F:\workspace\mgmt-app\web` (Vite) — chỉ cần API giả. Vì vậy so **UI với dữ liệu giả lập chung**:
1. `e2e/contracts-web/fixtures/dataset.ts`: một bộ dữ liệu chuẩn (hợp đồng, đối tác, giá, CKS) + 2 bộ chuyển: `asMgmt()` (hình `ref:api/*.ts`) và `asHub()` (hình `@ai/contracts`). Mỗi lát thêm dữ liệu cho màn của lát.
2. **Tham chiếu:** `bun run e2e:contracts:ref` dựng `vite` ở `$MGMT_WEB_DIR` (mặc định `F:\workspace\mgmt-app\web`) cổng 5199, `page.route("**/api/**")` trả `asMgmt()`, chụp từng màn → `e2e/contracts-web/baseline/<platform>/*.png` (**commit**, chụp 1 lần/lát khi màn mgmt-app không đổi). Không có `MGMT_WEB_DIR` mà thiếu ảnh ⇒ test **fail ngay**, ghi cách chụp (Luật 4c).
3. **Kiểm:** `bun run e2e` (config `e2e/contracts-web/playwright.config.ts`) mở contracts-web build, route-mock hub-api bằng `asHub()`, chụp cùng màn, so ảnh. Ba lớp, lệch lớp nào cũng đỏ:
 | Lớp | Ngưỡng |
 |---|---|
 | Chữ: `innerText` vùng `main`+nav chuẩn hoá khoảng trắng | khác 0 ký tự |
 | Khung: bounding box sidebar/header/panel/hàng đầu bảng | ±2 px |
 | Điểm ảnh: `toHaveScreenshot` (`threshold` 0.2, `maxDiffPixelRatio`) | ≤ 0.5 % (đăng nhập, danh sách) / ≤ 1 % (có biểu đồ/ảnh) |
4. Cố định nhiễu: Chromium, `deviceScaleFactor` 1, viewport 1440×900 và 390×844 (mobile: S01, S03, S05, S10), `locale vi-VN`, múi giờ `Asia/Ho_Chi_Minh`, `page.clock.setFixedTime(2026-10-18)`, `animations: "disabled"`, `caret: "hide"`, chờ `document.fonts.ready`, che (mask) số build, giờ tương đối, avatar. Mỗi màn chụp cả sáng và tối ở 3 màn chính (S01, S03, S05).
5. ≈ 30 ảnh (15 desktop + 4 mobile + 6 tối), < 100 KB/ảnh. Lệch có chủ ý (bỏ onboarding, ô "Mã công ty") ghi ở `e2e/contracts-web/DEVIATIONS.md`, mask đúng vùng đó.
6. Test hành vi chạy trên stack thật hub-api + admin-api: đăng nhập, quyền viewer/editor/owner, `PACK_DISABLED`.

## 7. Nhãn / role cho e2e (VI, giữ nguyên khi code)
| Vùng | Nhãn |
|---|---|
| Đăng nhập | `heading "Đăng nhập"`, `textbox "Email"`, `textbox "Mật khẩu"`, `button "Hiện mật khẩu"/"Ẩn mật khẩu"`, `button "Đăng nhập"`, `textbox "Mã công ty"` (chỉ khi chưa biết tenant) |
| Shell | `navigation "Điều hướng chính"` (link `Hợp đồng`, `Đối tác`, `So sánh giá`, `Sản phẩm`), `navigation "Điều hướng"` (mobile), `button "Góp ý về app"`, `button "Mở trợ lý AI"`, `complementary "Trợ lý AI"`, `separator "Kéo để chỉnh rộng"`, `button "Thu gọn ›"`, `status "Đang tải…"` |
| Bảng | `textbox "Tìm kiếm"`, `button "Xoá tìm kiếm"`, `button "Cột hiển thị"`, `navigation "Phân trang"`, `combobox "Số dòng mỗi trang"`, `button "Trang trước"/"Trang sau"` |
| Hợp đồng | `button "+ Thêm hợp đồng"` (editor+), `button "Xoá {tiêu đề}"` (owner), `button "+ Loại mới"` |
| Trợ lý | `textbox "Câu hỏi cho trợ lý"`, `button "Gửi"`, `button "Đính kèm ảnh hoặc file"` |
| Trạng thái mới (ngoài mgmt-app) | `heading "Bạn chưa có quyền dùng gói Hợp đồng"` / "You don't have access to the Contracts pack" (403 `PACK_FORBIDDEN`); `heading "Gói Hợp đồng chưa được bật cho công ty bạn"` / "The Contracts pack isn't enabled for your company" (`PACK_DISABLED`); toast 409 "Dữ liệu vừa được người khác cập nhật — tải lại để xem." / "This was just updated by someone else — reload to see it." |
Nhãn từng màn: plan-frontend của lát bổ sung (từ `aria-label` ở ref).

## 8. Hiệu năng & bundle
`scripts/check-bundle.ts` chép từ chat-web: JS đầu ≤ 150 KB gzip, CSS ≤ 25 KB, mỗi chunk async ≤ 50 KB, thêm ngoại lệ có tên cho chunk `assistant` ≤ 90 KB (react-markdown + hljs; đo ở HD6, vượt ⇒ lazy hljs). Lệnh `bun run --filter @ai/contracts-web check:bundle` vào `check`/CI như chat-web. Mobile 4G: FCP ≤ 2 s với danh sách 10.000 HĐ nhờ phân trang/lọc phía server (cần backend). `useMemo`/selector cho lọc bảng; không `fetch` trong component trình bày. A11y: element thật, `aria-label` như ref, tương phản ≥ 4.5:1 (kiểm cả bản tối).

## 9. Cần từ backend (backend-lead)
| API/hợp đồng | Dùng cho |
|---|---|
| Tiền tố `/pack/contracts/*` (không trùng route SPA); `GET /pack/contracts/me` → `{pack, enabled, actions}` (200 cả khi chưa bật/không quyền; write = `actions` có `write`, owner = có `admin`) | guard, ẩn nút |
| Mã lỗi `PACK_FORBIDDEN`, `PACK_DISABLED` (403), `PACK_NOT_FOUND` (404) có `code` ổn định + câu lỗi theo `Accept-Language` | trang trạng thái |
| Danh sách HĐ: `q`, lọc theo cột, sắp xếp, trang + **facet** (giá trị lọc mỗi cột) phía server | S03 với 10.000 HĐ (mgmt-app lọc cả mảng ở client: `table.tsx:52`) |
| `POST /pack/feedback` (**chưa có trong plan backend N1**; cần đường dẫn hoặc route chung); nguồn chuông (N3) | S14, S16 |
| Hội thoại chat nhận `context {page,id}`; thẻ đề xuất qua cổng xác nhận | S15 (HD6) |
| Refresh cookie của admin-api `Path=/auth`, cùng origin qua proxy | F4 |

## 10. Câu hỏi mở (có mặc định)
| # | Câu | Mặc định |
|---|---|---|
| Q-F1 | spec §5 nói "dựng ở HD5", nhưng HD2 đã có màn | Dựng **khung ở N1** (TF1–TF7); HD5 chỉ thêm danh sách. Spec §5 còn "HD5" (ghi nhận) |
| Q-F2 | Font Roboto/Roboto Mono (`@fontsource/*`, OFL) chưa có trong ADR-0001 | **Đã chốt** D-14: ADR-0001 Accepted; không đổi font |
| Q-F3 | Bỏ đăng ký/onboarding (tenant do Admin tạo, ADR-0018) | Bỏ; thêm ô "Mã công ty" khi chưa biết tenant |
| Q-F4 | Dev/CI chụp ảnh ở OS khác nhau (font render) | Baseline theo `<platform>`; CI chụp bộ riêng bằng cùng lệnh `ref` |
| Q-F5 | Góp ý (S14) chưa thuộc lát nào | Gộp HD5, backend nhận tin vào bảng gói |
Ngoài ADR-0001, mgmt-app dùng `react-router` 7 và Vite (đều thay được) và Roboto (Q-F2); không thư viện UI khác ⇒ không điểm dừng.
