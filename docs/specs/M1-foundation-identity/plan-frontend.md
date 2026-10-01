# Plan · M1-foundation-identity · Frontend (frontend-lead)

Chế độ PLAN · 2026-10-01 · Bổ sung cho `spec.md` §5 (bảng tóm tắt) và `plan.md` (backend-lead, mục 3–4, 6). File này **không** sửa contract.
Nguồn: `spec.md` §1–2, §8 · `design/admin/ui-admin.md` §4, 7.1, 9 · `specs/_design/admin-missing-screens.md` §4, 5, 9.1–9.2, 11, 12 (câu chữ + nhãn e2e gốc) · canvas `Login`, `ChangePassword`, `Sidebar`, `Main`, `TenantCreate`, `Users`, `States` · `readiness/2026-10-01-admin-m1-m4.md` · `M0-bootstrap/plan-frontend.md` (token, bundle, tooling) · `CONVENTIONS.md` §2, §6.
Quy ước: mọi chuỗi VI/EN trích từ `admin-missing-screens.md` ghi "§n"; chuỗi **mới** của file này nằm ở §7. Trùng key giữa hai nguồn thì `admin-missing-screens` thắng.

## 0. Quyết định chốt (Luật 2, ghi vào spec "Quyết định trong lúc làm" khi BUILD)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **C1** Menu M1: nhóm không tiêu đề `Tổng quan`; nhóm `TRUY CẬP`: `Tenants` (chỉ `platform_admin`), `Users`. Không có số đếm cạnh mục, không nút "⇄ Agent Studio". Tab Feature/Agent/Quota của Tenant hiện card "Chưa khả dụng" | Khớp spec §1; các nhóm CHỨC NĂNG/BẢO MẬT/HỆ THỐNG của artboard `Sidebar` thêm dần theo mốc |
| D2 | **C2** Ẩn badge `config vN`, banner quota, mục 2FA, ô tìm/Command palette (`Ctrl K`), theme/bảng gọn trong menu avatar | Không thuộc M1 (FR-53/41/08, M2+) |
| D3 | **C3** Tenants danh sách/chi tiết dùng mẫu A/B, **không** cần artboard mới. Khối mật khẩu tạm trong drawer Users dùng lại component của dialog TenantCreate (không vẽ lại) | Đủ mẫu |
| D4 | **B4** Chống đua refresh nhiều tab: single-flight trong tab + **Web Locks API** liên tab + `BroadcastChannel` chia sẻ access token mới (§3.3). Không đổi luật reuse của backend (M1-R07) | Refresh xoay vòng + reuse → thu hồi cả chuỗi; hai tab cùng gửi cookie cũ sẽ tự đăng xuất nhau |
| D5 | Access token **chỉ trong bộ nhớ** (module `session`), không localStorage/sessionStorage. Tải lại trang → `POST /auth/refresh` bằng cookie httpOnly. Chỉ `localStorage`: `ai.tenantKey` (mã công ty nhớ), `ai.locale`, `ai.sidebarCollapsed` | NFR-01 (token), UI 7.1 (nhớ mã công ty) |
| D6 | FE gọi đường dẫn tương đối `/auth/*`, `/admin/*`; Rsbuild `server.proxy` đẩy tới `ADMIN_API_URL` (dev **và** preview của e2e). Cùng origin → không CORS/credentials; cookie `Path=/auth` khớp. Route SPA **không** dùng tiền tố `/auth` hay `/admin` | Tránh cấu hình CORS credentials; cookie `SameSite=Strict` chạy ổn |
| D7 | Đổi mật khẩu: route `/change-password` = chế độ **bắt buộc** (ngoài khung, công khai, cần `change_token` trong bộ nhớ); `/account/password` = **tự đổi** (trong khung với admin, ngoài khung mẫu D với `member`). Hai route thay vì một route hai chế độ | Hai luồng khác API/guard; tránh nhầm lẫn `change_token` với phiên đăng nhập. Lệch nhẹ với `missing-screens` §9.2 ("cùng route" cho member) |
| D8 | `member` đăng nhập thành công → `/member` (ngoài khung): "Tài khoản của bạn dùng Chat App" + nút "Mở Chat App" (chỉ hiện khi build có `PUBLIC_CHAT_APP_URL`) + "Đổi mật khẩu" + "Đăng xuất". Mọi route khác của member → redirect `/member`. **Artboard thiếu**: `ui-admin.md` 7.1 nói "đã có trong artboard Đăng nhập" nhưng `Login.dc.html` không có màn này → dùng mẫu D (card 400px) — đề xuất vẽ bổ sung (không chặn) | |
| D9 | Bảng M1 = `Table` shadcn + cột tự viết, phân trang server (`limit=50`, `?q&offset`), **không** TanStack Table và **không** virtualize (≤ 50 dòng/trang; CONVENTIONS §6 chỉ yêu cầu khi > 200). Đề xuất TanStack Table lại ở M2 | Giảm bundle/rủi ro API v9; xem ADR-0004 |
| D10 | Mật khẩu tạm hiển thị **nguyên 16 ký tự, không chèn dấu `-`** (artboard vẽ `Xk7p-2mQa-…` chỉ là minh hoạ; dấu `-` không thuộc mật khẩu, copy ra sẽ sai). Hiển thị bằng **4 `<span>` mỗi span 4 ký tự** (`aria-hidden`, font mono), cách nhau bằng CSS `margin` (không ký tự phân cách trong DOM). Bên cạnh có `<input readOnly>` (nhãn "Mật khẩu tạm", `sr-only`, giá trị = chuỗi gốc 16 ký tự) để đọc bằng trình đọc màn hình và e2e; nội dung "Sao chép tất cả" cũng dùng chuỗi gốc. Không có hàm `formatTempPassword` (bỏ): chia nhóm là việc của JSX (`chunk(password, 4)`). Mật khẩu tạm chỉ nằm trong state của dialog/drawer: không URL, không cache TanStack Query (`gcTime: 0`), không log, xoá khi đóng | M1-R17 |
| D11 | Chip lọc có số (`Tất cả 120 / Đang hoạt động 118 / Đã khoá 2`): Tenants tính phía client (lấy `limit=200`); Users dùng `counts` từ API (contract đã có, §9 mục 8) | Tránh đổi contract một mình |
| D12 | Hàng "(bạn)" ở Users: menu `⋯` chỉ còn **Sửa** (không Khoá/Reset/Đăng xuất mọi thiết bị; tự đổi mật khẩu ở menu avatar) | BR-08, tránh tự vô hiệu phiên |
| D13 | `PATCH` lệch `version` → 409 `VERSION_CONFLICT`: M1 hiện toast lỗi "Có người vừa lưu bản mới hơn. Tải lại để xem bản mới nhất." + nút `Tải lại` (refetch, bỏ thay đổi). Modal diff đầy đủ = M3 (A3) | Spec A3 |
| D14 | Test FE: `bun test` chỉ cho hàm thuần (không DOM giả lập, theo M0 #10). Hành vi giao diện kiểm bằng e2e của qc | Nhất quán M0 |
| D16 | `/` nay nằm sau guard (chưa đăng nhập → `/login`), nên FE1b **xoá** `features/home/**` (trang tạm M0), các key `home.*` và `app.meta.title` khỏi `vi.json`/`en.json` (HomePage mới của shell dùng `overview.*`). `e2e/smoke.spec.ts` của M0 do qc sửa theo | Readiness #1 |
| D17 | Toast lưu ở M1 = `tenants.toast.saved` "Đã lưu {key}" / `users.toast.saved` "Đã lưu {username}" (không dùng `toast.saved` "Đã lưu và áp dụng · v{n}" của §0.5 vì chưa có `config vN`, FR-53 = M3) | Readiness #21 |
| D18 | Sidebar rộng **248px** theo artboard `Sidebar` (thay 240px của `ui-admin.md` §4; `--sidebar-width` M0) | Readiness #22 |
| D15 | Mọi tên route/query-key/key i18n mới ghi ở file này; không đổi tên sau Gate để qc khoá test | |

## 1. Màn, route, bố cục

Mẫu A/B/C/D: `admin-missing-screens.md` §0.2. Mọi trang trong khung dùng `<main id="main">`, H1 nhận focus sau điều hướng (`tabIndex=-1`), `document.title = "<H1> · Admin"`.

| Route (file) | Màn | Bố cục | Role | Artboard |
|---|---|---|---|---|
| `/login` (`routes/login.tsx`) | Đăng nhập | Canvas `Login`: 2 cột (trái nền `brand-strong` + 3 gạch đầu dòng; phải form 380px). < 1024px: ẩn cột trái. Search `?tenant=&next=` | công khai (đã đăng nhập → `/`) | Login |
| `/change-password` | Đặt mật khẩu mới (bắt buộc) | Mẫu D, card 400px. Không có `change_token` trong bộ nhớ (tải lại trang, vào thẳng URL) → redirect `/login` | công khai + token | ChangePassword |
| `/member` (`_authed/member.tsx`) | Tài khoản dùng Chat App | Mẫu D | `member` | thiếu → D8 |
| `/` (`_authed/index.tsx`) | Tổng quan (tạm) | H1 + Card chào + 2 link nhanh (Tenants nếu platform; Users). Không KPI | admin | Main (chỉ khung) |
| `/account/password` | Đổi mật khẩu (tự đổi) | Card 480px trong khung (member: mẫu D) | mọi role | §9.2 |
| `/tenants` | Danh sách Tenants | Mẫu A: header + `+ Tạo tenant` (link) + chip trạng thái + ô tìm + bảng + phân trang. Cột: Mã công ty (mono; `platform` kèm badge info "Nền tảng") · Tên · Users · Slot subscription · Trạng thái · `⋯`. **Bỏ** cột "Quota tháng này" (M4) và chip "Sắp/đã vượt quota". `⋯`: Mở · Khoá/Mở khoá (không có Khoá cho `platform`) | platform_admin | §4.1 |
| `/tenants/new` | Tạo tenant | Canvas `TenantCreate`: 2 card + dialog mật khẩu tạm | platform_admin | TenantCreate |
| `/tenants/$tenantId` | Chi tiết Tenant | Mẫu B: breadcrumb, header (tên, `key` mono, badge, nút `Khoá tenant`/`Mở khoá tenant`, ẩn với `platform`), tab: Thông tin (form + thanh lưu dính đáy) · Feature · Agent · Quota (card "Chưa khả dụng") · Users (tóm tắt + link) | platform_admin | §4.3 |
| `/users` | Danh sách Users + drawer | Canvas `Users`. Cột: Tên đăng nhập (mono, "(bạn)") · [Tenant (mono) — chỉ khi platform xem "Tất cả tenant"] · Tên hiển thị · Role · Đăng nhập gần nhất · Trạng thái · `⋯`. **Ẩn** cột Groups, ô lọc Group, tab "Quyền hiệu lực". Drawer 520px: tạo/sửa, khối mật khẩu tạm. Search: `?tenant=&q=&status=&role=&login=never&page=&drawer=new\|edit&user=<id>` | platform_admin, tenant_admin | Users |
| `*` | 404 chung | Trạng thái 404 §12.4 trong khung (hoặc mẫu D nếu chưa đăng nhập) | — | States |

**Guard (`beforeLoad`):** `_authed` gọi `session.ensure()` (chưa có phiên → thử refresh → thất bại thì `redirect /login?next=<url>`); `member` chỉ được `/member`, `/account/password`. `/tenants*` với `tenant_admin` → render trạng thái **403** trong khung (không redirect, §12.4: "Trang này chỉ dành cho quản trị nền tảng…"). Thực thể lạ/tenant khác → **404** (BR-09; không phân biệt).

### 1.1 Trạng thái từng màn

Dùng chung bộ §12 (`components/shared/states`): tải = skeleton đúng hình + `aria-busy` + `status "Đang tải"`, >10 s thêm "Vẫn đang tải…" + `Thử lại`; rỗng; rỗng do lọc; lỗi tải (`alert` "Không tải được dữ liệu" + "{message} (mã {code})" + `Thử lại`); 403; 404; mất kết nối (banner `status`, nút Lưu khoá); phiên hết hạn (dialog).

| Màn | Tải | Rỗng | Lỗi | Không quyền / 404 |
|---|---|---|---|---|
| Login | nút `Đang đăng nhập…` + `disabled`/`aria-disabled`, form giữ nguyên | — | `alert` trên nút (§7.1), không nói rõ trường nào sai, **không** "Còn N lần thử" | đã đăng nhập → `/` |
| Đổi MK (cả hai) | nút loading | — | lỗi theo trường + `alert` token hết hạn (forced) | forced không có token → `/login` |
| Tenants danh sách | skeleton bảng 8 hàng | `tenants.empty` + `+ Tạo tenant`; lọc: `state.empty.noResults` + `Xoá bộ lọc` | `ErrorState` trong vùng nội dung | 403 nếu tenant_admin |
| Tenant tạo | nút `Tạo tenant` loading; form khoá | — | 409 `KEY_TAKEN`/`USERNAME_TAKEN`/`EMAIL_TAKEN` → lỗi dưới trường; khác → toast lỗi bền | 403 |
| Tenant chi tiết | skeleton header + form | — | `ErrorState`; lưu lỗi → toast bền `Không lưu được: {reason}`; 409 `VERSION_CONFLICT` → D13 | 404 nếu id lạ |
| Users | skeleton bảng; đổi trang giữ dữ liệu cũ mờ (`keepPreviousData`) | `users.empty` (không có từ khoá/chip) + `+ Tạo user` | `ErrorState`; hành động lỗi → toast bền | 403 cho member (đã redirect); `?tenant=` không tồn tại → 404; `tenant_admin` mở `?user=<id tenant khác>` → drawer hiện 404 "Không tìm thấy" |
| Drawer user | skeleton form khi mở theo `?user=` | — | như trên; 409 `LAST_ADMIN` → lỗi inline dưới Role | — |

Platform đang ở "Tất cả tenant": nút `+ Tạo user` `aria-disabled` + tooltip "Chọn một tenant trước" (M1-R14); API trả 400 `TENANT_REQUIRED` vẫn xử lý bằng toast cùng câu chữ.

### 1.2 Thành phần shadcn dùng (cài bằng `bunx shadcn@4.21.0 add …`)

`button input label card badge table dialog alert-dialog sheet dropdown-menu select tabs radio-group checkbox tooltip skeleton alert separator breadcrumb sonner`. Thêm biến thể `Badge`: `ok|off|warn|info|err` (token `--status-*` đã có ở M0 §4.2). Không dùng `form` của shadcn (lệ thuộc `Controller`): tự viết `FormField` mỏng (label + control + mô tả + lỗi, `aria-describedby`, `aria-invalid`) trong `components/shared`.

### 1.3 Component dùng chung (`components/shared/`, ≥ 2 feature dùng)

| Component | Việc | Ghi chú |
|---|---|---|
| `PageHeader` | H1 + mô tả + vùng nút phải | |
| `DataTable` | bảng + `caption` ẩn (nhãn bảng) + skeleton + rỗng + lỗi | cột = `{ id, header, cell, className }`; không sort |
| `FilterChips` | ToggleGroup single → `radio`; chip có số tuỳ chọn | |
| `SearchBox` | `searchbox` + debounce 300 ms + `Esc` xoá | |
| `Pagination` | "1–50 / 120" + `Trước`/`Sau` | `nav aria-label="Phân trang"` |
| `StatusBadge` | ok/off/warn/info/err + tooltip tuỳ chọn | |
| `ConfirmDialog` | `alertdialog`; `level="medium"` ([Huỷ][Xác nhận]) hoặc `"heavy"` (gõ lại key; nút xác nhận `disabled` tới khi khớp) | focus mặc định vào nút an toàn (Huỷ) / ô gõ |
| `TempPasswordPanel` | khối mã công ty + tên đăng nhập + mật khẩu tạm (`textbox readOnly "Mật khẩu tạm"`) + `Sao chép tất cả` + checkbox/cảnh báo | dùng trong `Dialog` (tenant) và `Sheet` (user), D10 |
| `PasswordField` | ô password + nút Hiện/Ẩn (`aria-pressed`) | dùng ở auth ×3 |
| `states/*` | `LoadingState` `EmptyState` `ErrorState` `ForbiddenState` `NotFoundState` | §12 |
| `ConnectionBanner` | `onlineManager` + `navigator.onLine` | trong `AppShell` |
| `UnsavedGuard` | `useBlocker` + `beforeunload` + dialog "Bỏ thay đổi?" | form Tenant, drawer User |
| `TenantPicker` | `Select` "Tenant" (mục đầu "Tất cả tenant") | chỉ platform; dùng ở Users (và sau này Groups…) |

## 2. Cấu trúc file (feature-first, mỗi file ≤ 400 dòng, component ≤ 200)

```
apps/admin-web/src/
├─ app/                 providers.tsx (QueryClient + Toaster lười), router.ts (context: session), query-client.ts
├─ routes/              __root, login, change-password, _authed (layout+guard), _authed/{index,member,account.password,users}, _authed/tenants/{index,new,$tenantId}   # file mỏng chỉ import page
├─ lib/
│  ├─ http.ts           fetch wrapper: base '', JSON, ApiError{status,code,message,details}, gắn Bearer, gặp 401 UNAUTHORIZED → session.refresh() rồi thử lại 1 lần
│  ├─ session.ts        store {status:'unknown'|'anon'|'authed', accessToken, me}; ensure(), login(), logout(), refresh(); useSyncExternalStore + selector
│  ├─ refresh-lock.ts   single-flight + navigator.locks ('ai-admin-refresh') + fallback
│  ├─ auth-channel.ts   BroadcastChannel('ai-admin-auth'): 'token' | 'logout'
│  ├─ errors.ts         mã lỗi → key i18n (§6)
│  ├─ format.ts         formatLastLogin, formatClock(HH:MM)
│  ├─ normalize.ts      normalizeCompanyKey (trim, lowercase, bỏ dấu, đ→d), normalizeUsername
│  └─ clipboard.ts      copyText (navigator.clipboard + fallback)
├─ components/ui/       shadcn sinh ra (không sửa logic)
├─ components/shared/   §1.3
└─ features/
   ├─ shell/            components/{AppShell,Sidebar,Topbar,Breadcrumbs,AccountMenu,BareLayout,SessionExpiredDialog} · pages/HomePage.tsx · lib/nav.ts (mục menu theo role)
   ├─ auth/             api.ts (login, changePassword, me, patchMe) · pages/{LoginPage,ForcedPasswordPage,SelfPasswordPage,MemberPage} · components/{LoginForm,PasswordStrength,LanguageSwitch} · lib/{schemas,strength}.ts
   ├─ tenants/          api.ts · pages/{TenantsPage,TenantCreatePage,TenantDetailPage} · components/{TenantTable,TenantCreateForm,TenantInfoForm,TenantStatusButton,TenantUsersTab,UnavailableTab} · lib/schemas.ts
   └─ users/            api.ts · pages/UsersPage.tsx · components/{UserTable,UserRowMenu,UserDrawer,UserForm,UserFilters} · lib/{schemas,status}.ts
```
`SessionExpiredDialog` đặt ở `shell` nhưng nhận callback từ `session` (feature `auth` không import `shell`; dep-cruiser T-DEP giữ). Gọi API **chỉ** trong `features/<f>/api.ts` và `lib/http.ts`/`lib/session.ts` (hạ tầng auth). Mỗi feature có `README.md` ≤ 30 dòng (mã FR). Mỗi file đầu có comment mã `ADM-FR-xx`.

## 3. Phiên đăng nhập, refresh, phiên hết hạn

### 3.1 Luồng
1. App mở → `session.status="unknown"` → `_authed.beforeLoad` hoặc `/login.beforeLoad` gọi `session.ensure()`: `POST /auth/refresh` (cookie `ai_rt`) → `TokenGrant` (đã có `user: Me`, **không** gọi thêm `GET /auth/me`). Thành công = `authed`; 401 = `anon`. Trong lúc `unknown` hiển thị skeleton toàn trang (không trắng).
2. `POST /auth/login {tenant_key, username, password}` → (a) `status:"authenticated"` → lưu `access_token` + `me`, `i18n.changeLanguage(me.locale)`, chuyển tới `next` (chỉ nhận đường dẫn tương đối bắt đầu bằng `/`, chống open redirect) hoặc `/`; `member` → `/member`. (b) `status:"password_change_required"` → giữ `{change_token, tenantKey, username}` trong bộ nhớ → `/change-password`.
3. Mọi request có Bearer. Gặp 401 `UNAUTHORIZED` → `refresh()` 1 lần rồi gửi lại; refresh thất bại → `session.status="expired"` → hiện `SessionExpiredDialog` **tại chỗ** (không điều hướng, form đang nhập giữ nguyên, ui-admin 7.1). Nhập lại mật khẩu → `POST /auth/login` cùng mã công ty/username (chỉ đọc) → `authed` → `queryClient.invalidateQueries()` + đóng dialog. Nút phụ `Đăng xuất` → `/login`.
4. Đăng xuất: `POST /auth/logout` (bỏ qua lỗi) → xoá session + `queryClient.clear()` + phát `logout` qua channel → `/login`.
5. Chỉ request **đã xác thực** mới kích hoạt refresh; `/auth/login`, `/auth/change-password` (dùng `change_token`), `/auth/refresh` không bao giờ vòng refresh (tránh lặp) — vì vậy "mật khẩu hiện tại sai" phải **không** là 401 (§9 mục 4).

### 3.2 Đa ngôn ngữ phiên
`me.locale` quyết định ngôn ngữ sau đăng nhập; đổi ở menu avatar → `i18n.changeLanguage` + `PATCH /auth/me {locale}` (lỗi → toast, hoàn lại). Trước đăng nhập: `ai.locale` → `navigator.language` (vi*) → `vi`. Công tắc VI/EN ở trang login chỉ đổi cục bộ.

### 3.3 B4 — đua refresh nhiều tab (D4)
- `refresh()` = một `Promise` dùng chung trong tab (single-flight): nhiều request cùng 401 chỉ gọi một lần.
- Trong tab: `navigator.locks.request("ai-admin-refresh", async () => {...})`. Trong khoá: nếu đã nhận qua `BroadcastChannel` một access token **mới hơn** token vừa bị 401 (trong 10 giây) → dùng luôn, **không** gọi API; ngược lại gọi `POST /auth/refresh` (cookie hiện tại do trình duyệt giữ, đã được tab kia xoay) rồi phát `{type:"token", accessToken, at}`.
- Không có `navigator.locks` (trình duyệt cũ/insecure context) → chỉ single-flight trong tab; ghi nhận rủi ro đăng xuất khi hai tab refresh cùng lúc.
- Tab nhận `{type:"logout"}` → xoá session → `/login`.
- **`REFRESH_SUPERSEDED`** (401, backend ân hạn 10 s cho token vừa xoay): khi refresh nhận mã này → **thử lại đúng một lần** (cookie lúc này đã là bản mới do tab/request kia xoay; chờ 100 ms, ưu tiên token từ `BroadcastChannel` nếu đã nhận). Lần thử lại vẫn lỗi → coi như hết phiên. Khác `INVALID_REFRESH_TOKEN` (hết phiên ngay, không thử lại).
- Lỗi mạng giữa chừng sau khi server đã xoay (mất response) → lần refresh kế bị coi là reuse → đăng xuất: chấp nhận (M1-R07), dialog phiên hết hạn xử lý.
- Test đơn vị (hàm thuần với `fetch`/`locks` giả): 5 request đồng thời → 1 lần refresh; hai "tab" giả lập tuần tự qua lock → 1 refresh thật + 1 dùng token broadcast; không có `locks` → vẫn 1 lần/tab.

## 4. Validate phía client (khớp contract; câu lỗi VI/EN nguyên văn)

Schema form nằm ở `features/<f>/lib/schemas.ts`, **dùng hằng số xuất từ contract** (§9 mục 1) để không lệch; thông điệp lỗi là **key i18n** (resolve bằng `t()` khi render). Có unit test đối chiếu: cùng bộ fixture, schema FE và schema contract cho cùng kết quả hợp lệ/không hợp lệ. Hiện lỗi khi rời ô và khi gửi; lỗi đầu tiên nhận focus khi gửi.

| Trường | Luật | VI | EN |
|---|---|---|---|
| Mã công ty (login) | bắt buộc; `trim().toLowerCase()` khi gửi | Nhập mã công ty | Enter your company code |
| Tên đăng nhập (login) | bắt buộc; `trim().toLowerCase()` | Nhập tên đăng nhập | Enter your username |
| Mật khẩu (login, phiên hết hạn) | bắt buộc, không trim, không kiểm độ dài | Nhập mật khẩu | Enter your password |
| Mã công ty (tạo tenant) | `^[a-z0-9-]{2,32}$`; ô tự chuyển thường + bỏ dấu khi gõ (không xoá ký tự lạ) | `tenants.error.keyFormat` (§4) | idem |
| Tên công ty | bắt buộc, `trim`, ≤ 128 (hằng contract `NAME_MAX = 128`) | Nhập tên công ty | Enter the company name |
| Giới hạn slot | trống = `null`; số nguyên ≥ 1 | `quota.error.positive` (§4: "Nhập số lớn hơn 0 hoặc để trống") | idem |
| Tên đăng nhập (user/first admin) | `^[a-z0-9._-]{2,32}$` | `users.error.usernameFormat` (§5) | idem |
| Tên hiển thị | bắt buộc, `trim`, ≤ 64 (hằng contract `DISPLAY_NAME_MAX`) | `users.error.displayNameRequired` / "Tối đa 64 ký tự" | / "At most 64 characters" |
| Email | bắt buộc nếu role = `tenant_admin` (first admin luôn bắt buộc); định dạng email; ≤ 254 | `users.error.emailRequired` / `users.error.emailFormat` | idem |
| Role | `member` \| `tenant_admin` (tenant `platform`: `platform_admin`, khoá) | — | — |
| Ngôn ngữ | `vi` \| `en` | — | — |
| Mật khẩu mới | ≥ 10 · ≤ 128 | `password.error.min` · `password.error.max` (§9) | idem |
| Nhập lại | khớp mật khẩu mới | `password.error.mismatch` | idem |
| Mật khẩu mới ≠ hiện tại (chỉ tự đổi, so cục bộ; server vẫn là chuẩn) | khác | `password.error.same` | idem |
| Mật khẩu hiện tại (tự đổi) | bắt buộc | Nhập mật khẩu hiện tại | Enter your current password |
| Gõ lại key (khoá tenant) | trùng đúng `tenant.key` | (nút `Khoá tenant` disabled tới khi khớp) | — |

Lỗi server theo trường: 409 `KEY_TAKEN` → `tenants.error.keyTaken` dưới ô Mã công ty; `USERNAME_TAKEN` → `users.error.usernameTaken`; `EMAIL_TAKEN` → `users.error.emailTaken`; 400 `VALIDATION_ERROR` có `details` → gán vào field theo đường dẫn nếu có key i18n tương ứng, nếu không → toast `Không lưu được: {message}`.

Độ mạnh mật khẩu (`strength.ts`, hàm thuần, chỉ gợi ý): điểm = số loại ký tự (thường, HOA, số, ký hiệu) + 1 nếu dài ≥ 14; `< 10 ký tự` hoặc điểm ≤ 2 → Yếu; điểm 3 → Trung bình; ≥ 4 → Mạnh. Hiển thị `status` (`aria-live="polite"`) "Độ mạnh: {level}".

## 5. Chi tiết từng màn

### 5.1 Đăng nhập
Trường: Mã công ty (mono, `autocomplete="organization"`, điền sẵn từ `?tenant=` rồi `ai.tenantKey`, ghi chú "Được nhớ cho lần đăng nhập sau"), Tên đăng nhập (`username`), Mật khẩu (`current-password`). Enter gửi; nút khoá khi gửi (chống gửi đôi). Sau thành công lưu `ai.tenantKey`. Công tắc ngôn ngữ `VI`/`EN` góc phải trên (`group "Ngôn ngữ"`, hai `button` `aria-pressed`, `aria-label` "Tiếng Việt"/"English").
Lỗi (vùng `role="alert"`, nền warn, đặt trên nút, giữ nguyên giá trị): 401 `INVALID_CREDENTIALS` → `auth.error.invalid`; 423 `TEMP_LOCKED {until}` → `auth.error.tempLocked` với `{time}` = `HH:MM` giờ trình duyệt (24h, `Intl.DateTimeFormat`); 403 `ACCOUNT_LOCKED` → `auth.error.accountLocked`; lỗi mạng → `auth.error.network`; 5xx → `auth.error.server`. Sau lỗi, focus về ô Mật khẩu và chọn toàn bộ.

### 5.2 Đổi mật khẩu bắt buộc (`/change-password`)
Đúng canvas `ChangePassword` và §9.1: dòng mono `acme · lan.tran`; `Mật khẩu mới` (+ Hiện/Ẩn, thanh độ mạnh) · `Nhập lại mật khẩu mới` · nút `Đặt mật khẩu và tiếp tục` · link `Đăng xuất` (chỉ xoá `change_token` rồi `/login`). Không có `Bỏ qua`. Gửi `POST /auth/change-password {change_token, new_password}` → như đăng nhập thành công (§3.1.2a) + toast `password.toast.changed`. Token hết hạn/không hợp lệ (401 `INVALID_CHANGE_TOKEN`) → thay form bằng `alert` "Phiên đổi mật khẩu đã hết hạn. Hãy đăng nhập lại." + nút `Đăng nhập lại`. `password.error.same` khi server trả `PASSWORD_UNCHANGED`.

### 5.3 Đổi mật khẩu tự đổi (`/account/password`)
§9.2: card 480px; `Mật khẩu hiện tại` · `Mật khẩu mới` (+ độ mạnh) · `Nhập lại mật khẩu mới` · `Huỷ` (về trang trước) · `Đổi mật khẩu`. Thành công → toast `password.toast.changedOthers` → quay lại trang trước (hoặc `/`). Sai mật khẩu hiện tại (400 `INVALID_CURRENT_PASSWORD`) → `password.error.currentWrong` dưới ô.
Một nút Hiện/Ẩn điều khiển cả hai ô mới (trạng thái chung) để nhãn e2e `button "Hiện mật khẩu"` là duy nhất.

### 5.4 Tenants
- **Danh sách**: `GET /admin/tenants?limit=200&q=` (lọc trạng thái và đếm chip phía client; `total > 200` → chuyển sang tìm phía server, bỏ số chip). Hàng bấm vào = mở chi tiết (link ở ô Mã công ty). `⋯` → `Mở`, `Khoá` (dialog nặng, như chi tiết), `Mở khoá`.
- **Tạo** (`/tenants/new`): 2 card, một nút `Tạo tenant` (cuối trang) + `Huỷ` (về danh sách, qua `UnsavedGuard`). Gửi `POST /admin/tenants {key,name,max_concurrent_sub,first_admin:{username,display_name,email,locale}}` → `{tenant, first_admin, temp_password}` → `Dialog` "Đã tạo tenant {key}" **không** đóng bằng click nền/Esc/nút X; nút `Đi tới tenant` `disabled` cho tới khi tick `Tôi đã lưu mật khẩu tạm`; `beforeunload` bật khi dialog mở. Sau khi đóng → `/tenants/<id>` + toast `tenants.toast.created`. Ghi chú gợi ý mật khẩu tạm: sau lần đăng nhập đầu phải đổi (dùng câu của `users.create.passwordNote`).
- **Chi tiết**: `GET /admin/tenants/:id` (kèm `stats`, §9 mục 7). Tab Thông tin: `Mã công ty` (readOnly + gợi ý `tenants.field.keyHint`), `Tên công ty`, `Giới hạn slot subscription`, trạng thái (badge chỉ đọc), "Tạo lúc {ngày}", "Số user". Thanh lưu dính đáy: "Chưa lưu thay đổi" / `Huỷ` `Lưu`; `Ctrl+S` lưu. Tab Feature/Agent/Quota: card `common.unavailable` + một câu mô tả (Agent dùng `tenants.agents.unavailable`; Feature/Quota: `tenants.tab.unavailableBody`). Tab Users: `tenants.users.summary` + link `Mở danh sách Users` → `/users?tenant=<key>`.
- **Khoá** (`POST /admin/tenants/:id/lock`): `ConfirmDialog` nặng (gõ lại `key`). **Mở khoá**: dialog vừa. Thành công → toast, refetch. Tenant `platform`: không có nút (và nếu API vẫn trả 409 `PLATFORM_TENANT_LOCKED` → toast `errors.platformTenantLocked`).

### 5.5 Users
- **Danh sách**: platform_admin: `TenantPicker` (đồng bộ `?tenant=<key>`; ánh xạ key→id từ `GET /admin/tenants?limit=200`) → `GET /admin/users?tenant_id=&q=&status=&role=&login=never&limit=50&offset=`. tenant_admin: không có ô Tenant, bỏ `?tenant`. Chip: `Tất cả` `Đang hoạt động` `Đã khoá` (+ số, D11) · `Select` "Role" (Tất cả role / tenant_admin / member / platform_admin chỉ khi xem tenant `platform`) · chip phụ `Chưa đăng nhập`. Tìm phía server (debounce 300 ms). Mọi bộ lọc nằm trên URL; đổi bộ lọc → `page=1`.
- **Trạng thái hàng** (hàm thuần `lib/status.ts`): `Đã khoá` nếu `!active || locked_by_tenant` (tooltip `users.lockedByTenant` khi `locked_by_tenant`); `Tạm khoá đến {HH:MM}` (warn) nếu `locked_until` > hiện tại; còn lại `Đang hoạt động`. "Đăng nhập gần nhất": `formatLastLogin` ("Vừa xong" / "{n} phút trước" / "Hôm nay HH:MM" / "Hôm qua HH:MM" / `dd/MM/yyyy`); `null` → badge warn `users.neverLoggedIn`.
- **Menu `⋯`**: Sửa · Reset mật khẩu · Khoá / Mở khoá · Đăng xuất mọi thiết bị. Hàng "(bạn)": chỉ Sửa (D12). `Mở khoá` `aria-disabled` + tooltip khi `locked_by_tenant`. Hộp thoại: Reset (vừa) → hiện `TempPasswordPanel` trong drawer/dialog; Khoá (vừa); Đăng xuất mọi thiết bị (vừa); Mở khoá (không hộp thoại, toast ngay).
- **Drawer** (`Sheet` 520px, 100% < 1024px, URL `?drawer=new` hoặc `?drawer=edit&user=<id>`): tạo: Tên đăng nhập, Tên hiển thị, Email, Role (radio), Ngôn ngữ + dòng tenant (`Tenant: acme`, chỉ đọc; bắt buộc đã chọn tenant) + `users.create.passwordNote`; sửa: Tên đăng nhập readOnly, Role (hàng của mình: disabled + `users.field.selfRole`), các trường còn lại. Chân: `Huỷ` · `Tạo user`/`Lưu`. Thành công tạo/reset → thay form bằng `TempPasswordPanel`: Mã công ty, Tên đăng nhập, Mật khẩu tạm, `Sao chép tất cả`, cảnh báo `tempPassword.closeWarning`, nút `Đóng`; đóng khi chưa sao chép → `alertdialog` `tempPassword.closeUncopied.title` [Quay lại][Đóng]. Đóng drawer có thay đổi chưa lưu → `UnsavedGuard`.
- **Quyền hiệu lực** và cột/lọc **Groups**: không có ở M1 (D1; M3).

### 5.6 Shell
- `AppShell`: `Sidebar` 248px (thu gọn 64px bằng nút `aria-label` "Thu gọn thanh bên" hoặc phím `[`, nhớ `ai.sidebarCollapsed`; < 1024px: ẩn, mở bằng nút ≡ trong `Sheet` trái) · `Topbar` 56px: breadcrumb, badge ("Nền tảng" cho platform; tên tenant cho tenant_admin), `AccountMenu` · vùng nội dung `max-w` 1280, padding 24 · `ConnectionBanner` · `Toaster`. Chân sidebar: avatar chữ cái đầu + `display_name` + `{role} · {tenant}` (như artboard).
- `AccountMenu` (`button "Tài khoản của bạn"`, `DropdownMenu`): tiêu đề (tên + role, không phải item) · `Đổi mật khẩu` · nhóm "Ngôn ngữ": `menuitemradio` "Tiếng Việt"/"English" · `Đăng xuất`.
- Skip-link "Bỏ qua điều hướng" đầu trang. Mục menu hiện tại có `aria-current="page"`.

## 6. Lỗi API → giao diện (`lib/errors.ts`)

| HTTP · code | Hiển thị |
|---|---|
| mạng đứt / `NETWORK_ERROR` | form: toast bền `toast.saveFailed` + `auth.error.network`; tải trang: `ErrorState` (mã `NETWORK_ERROR`) |
| 401 `INVALID_CREDENTIALS` | `auth.error.invalid` |
| 423 `TEMP_LOCKED` | `auth.error.tempLocked` |
| 403 `ACCOUNT_LOCKED` | `auth.error.accountLocked` |
| 401 `UNAUTHORIZED` (token) | refresh → thất bại = dialog phiên hết hạn |
| 401 `INVALID_REFRESH_TOKEN` | dialog phiên hết hạn |
| 401 `REFRESH_SUPERSEDED` | (nội bộ `refresh()`) thử lại 1 lần; vẫn lỗi → dialog phiên hết hạn |
| 401 `INVALID_CHANGE_TOKEN` | `alert` token hết hạn (forced) |
| 400 `INVALID_CURRENT_PASSWORD` | `password.error.currentWrong` |
| 400 `PASSWORD_UNCHANGED` | `password.error.same` |
| 403 `FORBIDDEN` | toast `state.forbiddenAction` + `session.reload()` (tải lại `me`; nếu role đổi → định tuyến lại); khi tải trang: `ForbiddenState` |
| 404 `NOT_FOUND` | `NotFoundState` (trang/drawer); trong hành động: toast `state.notFound.body` + refetch danh sách |
| 403 `SELF_ACTION_FORBIDDEN` | toast bền `errors.selfAction` |
| 409 `LAST_ADMIN` | lỗi inline dưới Role (`users.error.lastAdmin`; `details.scope="platform"` → `users.error.lastPlatformAdmin`); khoá → toast bền cùng câu |
| 409 `KEY_TAKEN` / `USERNAME_TAKEN` / `EMAIL_TAKEN` | lỗi dưới ô tương ứng |
| 400 `TENANT_REQUIRED` | toast `common.tenantPicker.required` |
| 409 `PLATFORM_TENANT_LOCKED` | toast bền `errors.platformTenantLocked` |
| 409 `VERSION_CONFLICT` | toast bền `errors.versionConflict` + nút `Tải lại` (D13) |
| 400 `VALIDATION_ERROR` | theo trường nếu map được, ngược lại toast `toast.saveFailed` |
| 5xx / mã lạ | `toast.saveFailed` với `message` server (toast bền) hoặc `ErrorState` "{message} (mã {code})" |

Toast (sonner, góc dưới phải): thành công tự ẩn 4 giây; lỗi `duration: Infinity` + nút đóng. Vùng `role="status"` (thành công), `role="alert"` (lỗi).

## 7. Câu chữ VI / EN — chuỗi **mới** (ngoài `admin-missing-screens.md`)

Chép vào `packages/i18n/locales/{vi,en}.json`; `bun run i18n:check` bắt buộc. Quy tắc key: `<feature>.<màn>.<phần>`; tham số `{x}`.

| Key | VI | EN |
|---|---|---|
| auth.login.title | Đăng nhập | Sign in |
| auth.login.subtitle | Dùng mã công ty và tài khoản do quản trị viên cấp. | Use your company code and the account your administrator gave you. |
| auth.login.field.tenant | Mã công ty | Company code |
| auth.login.field.tenantHint | Được nhớ cho lần đăng nhập sau | Remembered for next time |
| auth.login.field.username | Tên đăng nhập | Username |
| auth.login.field.password | Mật khẩu | Password |
| auth.login.submit | Đăng nhập | Sign in |
| auth.login.submitting | Đang đăng nhập… | Signing in… |
| auth.login.forgot | Quên mật khẩu? Liên hệ quản trị viên công ty bạn để được đặt lại. | Forgot your password? Contact your company administrator to reset it. |
| auth.login.hero.title | Một nơi quản lý người dùng, quyền và chức năng AI của công ty bạn. | One place to manage your company's users, access and AI features. |
| auth.login.hero.b1 | Cấp lệnh /dich, /tom theo từng phòng ban | Grant commands like /dich, /tom by department |
| auth.login.hero.b2 | Theo dõi mức dùng và quota trong tháng | Track monthly usage and quota |
| auth.login.hero.b3 | Biết ngay vì sao một người không thấy một lệnh | See at once why someone can't see a command |
| auth.login.hero.footer | EvoluConsulting · Intelligent automation | EvoluConsulting · Intelligent automation |
| auth.lang.group | Ngôn ngữ | Language |
| auth.lang.vi / auth.lang.en | Tiếng Việt / English | Tiếng Việt / English |
| auth.error.invalid | Sai mã công ty, tên đăng nhập hoặc mật khẩu. | Wrong company code, username or password. |
| auth.error.tempLocked | Tạm khoá đến {time} | Temporarily locked until {time} |
| auth.error.accountLocked | Tài khoản đã bị khoá. Liên hệ quản trị viên công ty bạn. | This account is locked. Contact your company administrator. |
| auth.error.network | Không kết nối được máy chủ. Hãy thử lại. | Couldn't reach the server. Please try again. |
| auth.error.server | Có lỗi xảy ra, hãy thử lại sau (mã {code}). | Something went wrong, please try again later (code {code}). |
| auth.error.required.tenant | Nhập mã công ty | Enter your company code |
| auth.error.required.username | Nhập tên đăng nhập | Enter your username |
| auth.error.required.password | Nhập mật khẩu | Enter your password |
| password.error.required.current | Nhập mật khẩu hiện tại | Enter your current password |
| session.expired.title | Phiên đăng nhập đã hết hạn | Your session expired |
| session.expired.body | Đăng nhập lại để tiếp tục. Dữ liệu đang nhập được giữ nguyên. | Sign in again to continue. Your unsaved input is kept. |
| member.title | Tài khoản của bạn dùng Chat App | Your account uses Chat App |
| member.body | Trang quản trị chỉ dành cho quản trị viên. Hãy mở Chat App để làm việc. | The admin console is for administrators. Open Chat App to get started. |
| member.open | Mở Chat App | Open Chat App |
| nav.main | Điều hướng chính | Main navigation |
| nav.overview | Tổng quan | Overview |
| nav.group.access | TRUY CẬP | ACCESS |
| nav.tenants | Tenants | Tenants |
| nav.users | Users | Users |
| nav.collapse / nav.expand | Thu gọn thanh bên / Mở rộng thanh bên | Collapse sidebar / Expand sidebar |
| nav.openMenu | Mở menu | Open menu |
| nav.skip | Bỏ qua điều hướng | Skip to content |
| topbar.platform | Nền tảng | Platform |
| account.menu | Tài khoản của bạn | Your account |
| account.changePassword | Đổi mật khẩu | Change password |
| account.language | Ngôn ngữ | Language |
| overview.welcome | Xin chào, {name} | Hello, {name} |
| overview.platform.body | Quản lý tenant và người dùng của nền tảng. | Manage the platform's tenants and users. |
| overview.tenant.body | Quản lý người dùng của {tenant}. | Manage the users of {tenant}. |
| overview.soon | Thống kê và cảnh báo sẽ có ở các bản sau. | Statistics and alerts will arrive in later releases. |
| tenants.badge.platform | Nền tảng | Platform |
| tenants.tab.unavailableBody | Mục này sẽ khả dụng ở bản sau. | This section will be available in a later release. |
| tenants.detail.createdAt | Tạo lúc {date} | Created {date} |
| tenants.detail.userCount | {users} user | {users} users |
| tenants.toast.saved | Đã lưu {key} | Saved {key} |
| tenants.error.nameRequired | Nhập tên công ty | Enter the company name |
| users.col.tenant | Tenant | Tenant |
| users.filter.role.all | Tất cả role | All roles |
| users.status.tempLocked | Tạm khoá đến {time} | Temporarily locked until {time} |
| users.error.lastPlatformAdmin | Hệ thống phải còn ít nhất một platform_admin đang hoạt động | The system must keep at least one active platform admin |
| users.error.displayNameMax | Tối đa 64 ký tự | At most 64 characters |
| users.logoutAll.submit | Đăng xuất | Sign out |
| users.drawer.tenantLine | Tenant: {key} | Tenant: {key} |
| users.drawer.copyAll.text | Mã công ty: {tenant}\nTên đăng nhập: {username}\nMật khẩu tạm: {password} | Company code: {tenant}\nUsername: {username}\nTemporary password: {password} |
| format.lastLogin.now | Vừa xong | Just now |
| format.lastLogin.minutes | {n} phút trước | {n} min ago |
| format.lastLogin.today | Hôm nay {time} | Today {time} |
| format.lastLogin.yesterday | Hôm qua {time} | Yesterday {time} |
| common.pagination.range | {from}–{to} / {total} | {from}–{to} of {total} |
| common.pagination.prev / next | Trước / Sau | Previous / Next |
| common.pagination.aria | Phân trang | Pagination |
| common.loading | Đang tải | Loading |
| common.stillLoading | Vẫn đang tải… | Still loading… |
| common.saved | Đã lưu | Saved |
| common.reload | Tải lại | Reload |
| state.error.title | Không tải được dữ liệu | Couldn't load data |
| state.error.body | {message} (mã {code}) | {message} (code {code}) |
| state.forbidden.title | Bạn không có quyền xem trang này | You don't have access to this page |
| state.forbidden.platformOnly | Trang này chỉ dành cho quản trị nền tảng. Nếu cần, hãy liên hệ người quản trị của bạn. | This page is for platform admins only. Contact your administrator if you need access. |
| state.forbidden.cta | Về Tổng quan | Back to Overview |
| state.forbiddenAction | Bạn không còn quyền thực hiện thao tác này | You no longer have permission to do this |
| state.notFound.title | Không tìm thấy | Not found |
| state.notFound.body | Mục này không tồn tại hoặc đã bị xoá. | This item doesn't exist or was deleted. |
| state.notFound.cta | Về danh sách | Back to list |
| state.empty.noResults | Không có kết quả cho '{q}' | No results for '{q}' |
| state.empty.noMatch | Không có mục nào khớp bộ lọc | Nothing matches these filters |
| state.offline.banner | Mất kết nối, thay đổi chưa được lưu | Connection lost — changes aren't saved |
| state.offline.saveTip | Đang chờ kết nối lại | Waiting for connection |
| state.online | Đã kết nối lại | Back online |
| unsaved.title | Bỏ thay đổi? | Discard changes? |
| unsaved.body | Các thay đổi chưa lưu sẽ mất. | Unsaved changes will be lost. |
| unsaved.stay / unsaved.discard | Ở lại / Bỏ thay đổi | Stay / Discard |
| errors.selfAction | Bạn không thể tự khoá hoặc hạ role của chính mình. | You can't lock or demote yourself. |
| errors.platformTenantLocked | Không thể khoá tenant nền tảng. | The platform tenant can't be locked. |
| errors.versionConflict | Có người vừa lưu bản mới hơn. Tải lại để xem bản mới nhất. | Someone just saved a newer version. Reload to see the latest. |

Đã có sẵn ở `admin-missing-screens.md` (chép nguyên văn): §0.5 `common.*` (`save cancel close confirm retry search clearFilters all actions moreActions you unlimited unavailable tenantPicker.*`), §4 `tenants.*`/`tempPassword.*`/`quota.error.positive`, §5 `users.*` (bỏ `users.filter.group`, `users.tab.access`, `users.access.*` — không dùng ở M1), §9 `password.*`/`auth.logout`, §12 các chuỗi phiên hết hạn/xung đột (xung đột modal = M3, chỉ chép khi dùng). `toast.saveFailed` = §0.5.

## 8. Role + nhãn cho e2e (frontend giữ nguyên các nhãn này)

Nhãn tiếng Việt (ngôn ngữ mặc định `vi`). Nhãn không có trong `missing-screens` chỉ định rõ ở đây. `getByRole(name)` mặc định so khớp **chứa chuỗi, không phân biệt hoa thường** → nhãn phải duy nhất trong phạm vi trang hoặc qc dùng `exact: true`; nơi có nguy cơ trùng đã ghi.

| Màn | Phần tử |
|---|---|
| Login | `heading "Đăng nhập"` (level 1) · `textbox "Mã công ty"` · `textbox "Tên đăng nhập"` · `getByLabel("Mật khẩu")` (ô password) · `button "Đăng nhập"` · `alert` chứa "Sai mã công ty, tên đăng nhập hoặc mật khẩu." / "Tạm khoá đến 14:45" · `group "Ngôn ngữ"` > `button "Tiếng Việt"`/`"English"` (`aria-pressed`) · `heading "Một nơi quản lý…"` level 2 (trang trí) |
| Đổi MK bắt buộc | theo §9 gốc: `heading "Đặt mật khẩu mới"` · `getByLabel("Mật khẩu mới")` · `getByLabel("Nhập lại mật khẩu mới")` · `button "Hiện mật khẩu"` (1 nút duy nhất) · `status` "Độ mạnh: Mạnh" · `button "Đặt mật khẩu và tiếp tục"` · `button "Đăng xuất"` · `alert` "Phiên đổi mật khẩu đã hết hạn" + `button "Đăng nhập lại"` · không có `button "Bỏ qua"`. Lỗi trường: `alert`/`text` theo `aria-describedby` chứa "Mật khẩu cần tối thiểu 10 ký tự" |
| Đổi MK tự đổi | `heading "Đổi mật khẩu"` · `getByLabel("Mật khẩu hiện tại")` · `getByLabel("Mật khẩu mới")` · `getByLabel("Nhập lại mật khẩu mới")` · `button "Đổi mật khẩu"` · `button "Huỷ"` · toast `status` "Đã đổi mật khẩu · các thiết bị khác đã được đăng xuất" |
| Member | `heading "Tài khoản của bạn dùng Chat App"` · `link "Mở Chat App"` (nếu có URL) · `button "Đăng xuất"` · `link "Đổi mật khẩu"` |
| Shell | `navigation "Điều hướng chính"` > `link "Tổng quan"` / `link "Tenants"` (chỉ platform) / `link "Users"`; mục hiện tại `aria-current="page"` · `button "Tài khoản của bạn"` → `menuitem "Đổi mật khẩu"` · `menuitemradio "Tiếng Việt"`/`"English"` · `menuitem "Đăng xuất"` · badge topbar `text "Nền tảng"` / tên tenant · `main` · `link "Bỏ qua điều hướng"` · `button "Thu gọn thanh bên"` |
| Tổng quan | `heading "Tổng quan"` · `text` "Xin chào, {name}" |
| Tenants list | theo §4 gốc: `heading "Tenants"` · `link "+ Tạo tenant"` · `table "Tenants"` · hàng chứa mã `acme` · `searchbox "Tìm…"`; chip `radio "Tất cả"`/`"Đang hoạt động"`/`"Đã khoá"` (nếu có số: tên chứa số, vd `"Tất cả 4"` → dùng regex) · `button "Thao tác khác"` trong hàng → `menuitem "Mở"`/`"Khoá"`/`"Mở khoá"` |
| Tenant tạo | theo §4 gốc: `textbox "Mã công ty"` · `textbox "Tên công ty"` · `spinbutton "Giới hạn slot subscription"` · `textbox "Tên đăng nhập"` · `textbox "Tên hiển thị"` · `textbox "Email"` · `combobox "Ngôn ngữ"` · `button "Tạo tenant"` · `dialog "Đã tạo tenant acme"` · `textbox "Mật khẩu tạm"` (readonly, value = chuỗi 16 ký tự gốc) · `button "Sao chép tất cả"` · `checkbox "Tôi đã lưu mật khẩu tạm"` · `button "Đi tới tenant"` (disabled tới khi tick). Lỗi: text "Mã công ty đã được dùng" |
| Tenant chi tiết | `tab "Thông tin"`/`"Feature"`/`"Agent"`/`"Quota"`/`"Users"` · `textbox "Mã công ty"` (readonly) · `textbox "Tên công ty"` · `spinbutton "Giới hạn slot subscription"` · `button "Lưu"` · `button "Khoá tenant"` → `alertdialog "Khoá tenant acme?"` > `textbox "Gõ acme để xác nhận"` + `button "Khoá tenant"` (trong dialog; trùng tên nút ngoài dialog → qc scope vào `alertdialog`) · `button "Mở khoá tenant"` → `alertdialog "Mở khoá acme?"` > `button "Mở khoá"` · tab Users: `link "Mở danh sách Users"` · tab Feature/Agent/Quota: `text "Chưa khả dụng"` · toast `status` "Đã khoá acme"/"Đã mở khoá acme" |
| Users list | `heading "Users"` · `button "+ Tạo user"` (aria-disabled khi "Tất cả tenant") · `combobox "Tenant"` (platform) · `searchbox "Tìm theo tên đăng nhập, tên, email…"` · `combobox "Role"` · chip `radio` "Tất cả"/"Đang hoạt động"/"Đã khoá" · chip `radio "Chưa đăng nhập"` · `table "Users"` · hàng chứa "thu.ha (bạn)" · `button "Thao tác khác"` (trong hàng) → `menuitem "Sửa"`/`"Reset mật khẩu"`/`"Khoá"`/`"Mở khoá"`/`"Đăng xuất mọi thiết bị"` · `alertdialog "Khoá cuong.le?"` > `button "Khoá"` · `alertdialog "Reset mật khẩu của lan.tran?"` > `button "Reset mật khẩu"` · `alertdialog "Đăng xuất lan.tran khỏi mọi thiết bị?"` > `button "Đăng xuất"` (`users.logoutAll.submit`, xem ghi chú) · nút Trước/Sau: `button "Trước"`/`"Sau"` · `text` "Chưa đăng nhập" (badge) · `text` "Đã khoá" |
| Users drawer | `dialog "Tạo user"` · `textbox "Tên đăng nhập"` · `textbox "Tên hiển thị"` · `textbox "Email"` · `radio "member"`/`"tenant_admin"` (platform: `radio "platform_admin"` disabled) · `combobox "Ngôn ngữ"` · `button "Tạo user"` (trong dialog) · `button "Huỷ"` · khối mật khẩu tạm: `textbox "Mật khẩu tạm"` · `button "Sao chép tất cả"` · `button "Đóng"` · `alertdialog "Đóng mà chưa sao chép mật khẩu tạm?"` > `button "Quay lại"`/`"Đóng"` · sửa: `dialog "lan.tran · Trần Lan"` > `button "Lưu"`; lỗi inline text "Tenant phải còn ít nhất một tenant_admin đang hoạt động" · toast `status` "Đã tạo lan.tran" |
| Trạng thái chung | theo §12 gốc: `status "Đang tải"` · `alert` "Không tải được dữ liệu" + `button "Thử lại"` · `heading "Bạn không có quyền xem trang này"` + `link "Về Tổng quan"` · `heading "Không tìm thấy"` + `link "Về danh sách"` · `status` "Mất kết nối, thay đổi chưa được lưu" · `dialog "Phiên đăng nhập đã hết hạn"` (có `getByLabel("Mật khẩu")`, `button "Đăng nhập"`, `button "Đăng xuất"`) · `alertdialog "Bỏ thay đổi?"` > `button "Bỏ thay đổi"`/`"Ở lại"` · `button "Xoá bộ lọc"` |

Ghi chú nhãn mới/lệch (qc nhận, frontend giữ):
- `users.logoutAll.submit` = "Đăng xuất" | "Sign out" (nút xác nhận của `alertdialog "Đăng xuất {username} khỏi mọi thiết bị?"`; `missing-screens` §5 chưa nêu nút). Key này đã có ở bảng §7.
- `users.unlock` không có dialog; toast "Đã mở khoá cuong.le".
- Nút `Khoá` trong dialog Users dùng `users.lock.submit` "Khoá" (§5); `button "Khoá"` có thể khớp cả `button "Khoá tenant"` bằng substring → qc dùng `exact: true` hoặc scope `alertdialog`.
- Mật khẩu tạm là `textbox` readonly → `toHaveValue(/^[A-Za-z0-9]{16}$/)`.

## 9. Yêu cầu contract (gửi backend-lead; FE không tự đổi)

1. **Hằng số + schema dùng được ở trình duyệt** từ `@ai/contracts` (không import I/O Node): `COMPANY_KEY_RE`, `USERNAME_RE`, `PASSWORD_MIN_LEN=10`, `PASSWORD_MAX_LEN=128`, `DISPLAY_NAME_MAX=64`, `NAME_MAX`, `EMAIL_MAX`, enum `Role`, `Locale`, `ErrorCode` (union các mã ở §6), các schema request/response (`LoginRequest/Response`, `ChangePassword*`, `Me`, `Tenant*`, `User*`, `ListResponse<T>`). `apps/admin-web` thêm `@ai/contracts` + `zod` vào dependencies.
2. **Login** `POST /auth/login {tenant_key, username, password}` → union theo `status`: `TokenGrant = {status:"authenticated", access_token, token_type:"Bearer", expires_in, user: Me}` (+ `Set-Cookie` refresh khi web) | `{status:"password_change_required", change_token}`. Web **không** gửi `X-Client` (cookie). Lỗi: 401 `INVALID_CREDENTIALS`, 423 `TEMP_LOCKED {until}` (ISO UTC, trong `error.details.until`), 403 `ACCOUNT_LOCKED`.
3. **Refresh** `POST /auth/refresh` (cookie, không body) → `TokenGrant` (có `user: Me`; cookie `ai_rt`); lỗi 401 `INVALID_REFRESH_TOKEN` (hết phiên) hoặc 401 `REFRESH_SUPERSEDED` (thử lại 1 lần, §3.3). **Logout** `POST /auth/logout` 204.
4. **Đổi mật khẩu**: tự đổi `POST /auth/change-password {current_password,new_password}` (Bearer) → 204; chế độ bắt buộc `{change_token,new_password}` → **cùng body với login thành công** (`TokenGrant` + cookie). Mã lỗi **không phải 401** cho mật khẩu hiện tại sai: 400 `INVALID_CURRENT_PASSWORD`; mới trùng cũ: 400 `PASSWORD_UNCHANGED`; `change_token` hết hạn/đã dùng: 401 `INVALID_CHANGE_TOKEN` (dùng mã riêng để FE không vòng refresh). Access token sai/hết hạn trên route bảo vệ: 401 `UNAUTHORIZED` (mã cố định, FE chỉ refresh khi gặp mã này).
5. **Cookie dev**: `Secure` chỉ bật khi `APP_ENV=production` (dev chạy `http://localhost`); `SameSite=Strict; HttpOnly; Path=/auth`. Preview của e2e đi qua proxy cùng origin (D6).
6. `GET /auth/me` → `{id, username, display_name, role, locale, tenant:{id,key,name}, must_change_password:false}`; `PATCH /auth/me {locale}`.
7. **Tenants**: list `{items,total}` với mỗi item `{id,key,name,active,max_concurrent_sub,user_count,created_at,version}`; `?q&limit(≤200)&offset&status=active|locked`. `GET /:id` kèm `stats:{user_count, tenant_admin_count, locked_user_count}`. `POST /admin/tenants` nhận `first_admin:{username,display_name,email,locale}` → `{tenant, first_admin, temp_password}`. `PATCH /admin/tenants/:id {name,max_concurrent_sub,version}` → tenant mới. `lock/unlock` trả tenant mới. Lỗi: `KEY_TAKEN`, `USERNAME_TAKEN`, `EMAIL_TAKEN` (first admin), `PLATFORM_TENANT_LOCKED`, `VERSION_CONFLICT`.
8. **Users**: list item `{id,tenant_id,tenant_key,username,display_name,email,role,locale,active,locked_by_tenant,locked_until,last_login_at,version}`; filter `?tenant_id&q&status=active|locked&role&login=never&limit&offset`. `counts:{all,active,locked}` (tính trên tập đã lọc `q`/`tenant_id`/`role`, bỏ qua `status`) — dùng cho số trên chip (D11). `POST /admin/users` → `{user, temp_password}`; `reset-password` → `{temp_password}`; `lock/unlock/logout-all` → user mới hoặc 204 (FE refetch). Lỗi `LAST_ADMIN` có `details.scope: "platform"|"tenant"`; `SELF_ACTION_FORBIDDEN`; `TENANT_REQUIRED`; `EMAIL_TAKEN`; `NOT_FOUND` (cùng body với id không tồn tại).
9. `unlock` của user có `locked_until` còn hiệu lực → xoá luôn `failed_logins` và `locked_until` (admin mở khoá tạm khoá).
10. Mã lỗi theo `ErrorResponseSchema` M0: `{error:{code,message,details?}}`; `message` tiếng Anh ngắn (FE không hiển thị nguyên văn nếu đã có key i18n).
11. Nhờ backend-lead / điều phối (hạ tầng): `rsbuild.config.ts` thêm `server.proxy` (`/auth`, `/admin` → `ADMIN_API_URL`, mặc định `http://localhost:3001`, backend đã chốt) — **frontend tự làm** trong FE0; `playwright.config.ts` do **frontend-lead** sửa (task FE0b, §9.12); `.env.example` thêm `PUBLIC_CHAT_APP_URL` (tuỳ chọn) và `ADMIN_API_URL`.

12. **E2E hạ tầng (G1 của test-plan, FE0b):** `playwright.config.ts` — `workers: 1`, `fullyParallel: false`; `webServer` là **mảng 2 phần tử**: (1) admin-api: `bun e2e/support/prepare-db.ts && bun apps/admin-api/src/server.ts` (qc viết `prepare-db.ts`), env `ADMIN_API_DATABASE_URL=$TEST_ADMIN_API_DATABASE_URL` (DB `ai_system_test`, không dùng DB dev), `PORT=3001`, `APP_ENV=test`, `url`/`port` = `http://localhost:3001` (health), `reuseExistingServer: false` (DB test phải được chuẩn bị lại); (2) web: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview` với `ADMIN_API_URL=http://localhost:3001`, `url: http://localhost:3000`. Playwright chờ cả hai sẵn sàng. **Nạp env (readiness #3):** `playwright.config.ts` chạy bằng Node nên không tự đọc `.env.local`; đầu file: nếu `.env.local` tồn tại thì `process.loadEnvFile(".env.local")` (không ghi đè biến đã có sẵn trong môi trường), rồi truyền **tường minh** `TEST_ADMIN_API_DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_*`, `SEED_ADMIN_*` vào `webServer[0].env` (admin-api e2e phải trỏ DB `ai_system_test`, **không bao giờ** DB dev: `ADMIN_API_DATABASE_URL` của tiến trình con = `TEST_ADMIN_API_DATABASE_URL`; thiếu biến → config `throw` nêu tên biến). **Cổng 3001:** vì `reuseExistingServer: false`, phải tắt `bun run dev` của admin-api (cổng 3001) trước khi chạy e2e, nếu không Playwright báo cổng đã dùng; ghi câu này vào `apps/admin-web/README.md` và comment đầu `playwright.config.ts`. Giữ `use` của M0 (`locale vi-VN`, `Asia/Ho_Chi_Minh`, chromium). Biến `TEST_ADMIN_API_DATABASE_URL` và `JWT_*` lấy từ `.env.example`/CI do backend-lead cấp.

## 10. Hiệu năng (CONVENTIONS §6; ngân sách M0 §6 giữ nguyên)

| Chỉ số | Cách đạt |
|---|---|
| JS ban đầu ≤ 150 KB gzip (`check:bundle`) | Root chỉ có router + query + i18n + `session`/`http`. Mọi trang và shell nằm trong chunk route (autoCodeSplitting); `react-hook-form`, `sonner`, `radix-ui` chỉ vào chunk route. Locale `en` nạp cùng bundle trừ khi `en.json` > 20 KB gzip |
| Chunk route ≤ 50 KB gzip (kiểm tay ở BUILD) | Ước chunk `_authed` (shell + radix dropdown/sheet) + chunk login (RHF ≈ 15 KB + zod + resolver); vượt → tách vendor (ADR-0004). Ghi số đo vào "Quyết định trong lúc làm" |
| Bảng > 200 dòng → virtualize | Không áp dụng: phân trang server 50 dòng (D9) |
| Re-render | Session qua `useSyncExternalStore` + selector (`useSession(s => s.me?.role)`); hàng bảng bọc `React.memo` với callback ổn định (`useCallback`); tìm kiếm debounce 300 ms; `placeholderData: keepPreviousData` khi đổi trang; không lưu object lớn vào context |
| Lọc phía client ≤ 200 tenant | Lọc trạng thái + đếm chip bằng `useMemo` theo `data` |
| Mạng | `staleTime` 30 s (mặc định M0); mutation `invalidateQueries(["users"])`/`(["tenants"])`; hover link menu preload route (`defaultPreload: "intent"`) |
| LCP trang danh sách < 2 s | Skeleton có kích thước cố định, font đã tự host (M0), ảnh logo có `width/height` |

## 11. A11y (checklist BUILD)
- Phần tử thật: `button`, `a`, `label` gắn `htmlFor`; nút chỉ có icon có `aria-label` ("Thao tác khác", "Thu gọn thanh bên", "Hiện mật khẩu").
- Bàn phím đầy đủ: Tab theo thứ tự thị giác; `Esc` đóng drawer/menu (drawer có thay đổi chưa lưu hỏi lại); mở drawer/dialog trả focus về nút gọi; dialog mật khẩu tạm chặn Esc/click nền (cố ý, D10) nhưng vẫn focus trap.
- Lỗi form: `aria-invalid`, `aria-describedby`, tóm tắt `alert` ở login; không chỉ dùng màu (icon + chữ).
- Tương phản ≥ 4.5:1: dùng token M0 (`--subtle-foreground` `#736C89`, FE-R1); badge `--status-*` đo lại bằng công cụ đo tương phản ở BUILD, ghi kết quả.
- `prefers-reduced-motion`: tắt chuyển động drawer/dialog (token `--duration-overlay`).
- Landmark: `nav`, `main`, skip-link; `<html lang>` theo ngôn ngữ đang dùng (M0 `i18n.ts`).
- Tooltip cho nút `aria-disabled` phải đọc được bằng bàn phím (focus được, không dùng thuộc tính `disabled` thật khi cần tooltip).

## 12. Artboard / ADR đề xuất
- **ADR-0004 (Accepted)**: `sonner` 2.0.8 + `@hookform/resolvers` 5.9.1 — `docs/adr/0004-m1-web-form-and-toast-libs.md`. Đã duyệt ở Gate M1.
- **Artboard bổ sung (không chặn Gate)**: (1) Màn `member` "Tài khoản của bạn dùng Chat App" (mẫu D) — D8; (2) khối mật khẩu tạm trong drawer Users (dùng lại hình dialog TenantCreate). Tenants danh sách/chi tiết dùng mẫu A/B (C3). Canvas: `#7A7390` → `#736C89` đã áp ở token (`tokens-map.md`); nên đồng bộ file `.dc.html` khi chạm lại canvas.
- Phiên bản dependency mới ghi vào bảng ADR-0001 khi Accepted; `react-hook-form` 7.89.0.

## 13. Việc frontend (đưa vào `tasks.md`)
Xem bảng FE trong `tasks.md` (đã cập nhật). Thứ tự: FE0 (deps, shadcn, proxy) → FE1a (lib) → FE1b (shell + shared) → FE2 (i18n) → FE3 (auth) → FE4 (tenants) → FE5 (users) → FE6 (rà soát). Mỗi task một commit `[ADM-FR-xx]`, diff ≈ ≤ 400 dòng.

Unit test FE (hàm thuần, `bun test`): `normalize` (key/username/bỏ dấu `đ`), `format` (`formatLastLogin` các mốc, `formatClock`), `strength`, `schemas` (đối chiếu fixture với contract), `errors` (mã → key đều tồn tại trong `vi.json`), `refresh-lock` (§3.3), `status` (user), `next` redirect an toàn (chặn `//evil.com`, `https://…`).

## 14. Rủi ro
- **Contract chưa có** lúc FE0–FE2 → các task này không phụ thuộc type API; FE3+ chờ T1 (contract) + T4/T6/T7.
- **`Rsbuild preview` có áp `server.proxy`?** Đã xác minh (2026-10-01): `@rsbuild/core@2.2.11` `dist/types/config.d.ts` ghi `server.proxy`: "Configure proxy rules for the dev server or preview server"; `dist/m.js` có `createProxyMiddleware` dùng chung. → **có**. FE0 vẫn chạy thử một request qua preview để chắc (nếu không áp, dự phòng: e2e chạy `rsbuild dev --port 3000` với cùng `server.proxy`, hoặc `ADMIN_API_URL` được `rsbuild.config.ts` đọc lúc build).
- **Radix `Select` + `getByRole('combobox')`**: trigger là `button role="combobox"` → khớp nhãn e2e; popup `role="listbox"` (option `role="option"`). `Select` rỗng không có `value=""` hợp lệ → dùng giá trị sentinel `"all"`.
- **Web Locks** không có trong Safari < 15.4: ngoài browserslist (M0: safari ≥ 16.4) nhưng vẫn có fallback.
- **`tanstack-router` + search `zod`**: dùng `validateSearch` với schema `zod` (standard schema); xác minh chữ ký ở FE1b trước khi dùng (Grep `.d.ts`).
- **shadcn sinh `import … from "radix-ui"`** → tree-shake theo route; đo chunk, nếu kéo cả gói thì chuyển sang import subpath `@radix-ui/react-*` (đã nằm trong cây `radix-ui`) và ghi quyết định.
- **Tooltip trên nút `aria-disabled`**: Radix `Tooltip` cần `asChild` + phần tử focus được.
