---
id: cr121-c
cr: CR-121 (phần C — Thiết kế lại giao diện ADMIN PLATFORM, 11 artboard đã duyệt)
trạng thái: spec 2026-11-06 (sửa theo readiness lần 1); 13 lát c9…c21 chờ làm (xem tasks.md)
nguồn quyết định: Intake Đầy đủ 2026-11-06, người dùng chốt Q1–Q7 (docs/CHANGE-REQUESTS.md dòng CR-121)
artboard: cr121-design/project/{Main,Company,CompanyFlows,Tpl-Detail,Tpl-Settings,Library,AiTools,Tpl-Editor,Tpl-Run}.dc.html (+ Tpl-List, Tpl-Dashboard đã làm ở c3b/c3c)
---
# CR-121 C · Admin platform theo thiết kế đã duyệt

## Mục tiêu
Trang công ty, Thư viện, Công cụ AI, trình sửa, nav của admin-web khớp artboard; **một khái niệm một nguồn, một tên, một màn** (Luật GỐC 1–3). Phần CÒN THIẾU sau c1…c8. Phạm vi: admin-web + API hub-api/admin-api.
Migration: admin **0037** (c18), pack-contracts **0076** (c20), hub **0103** chỉ c9 nếu cần (`source_template_id`/`rel_version` đã có ⇒ dự kiến KHÔNG cần). Không đụng engine D, DLC.

## Quyết định đã chốt (nguồn: người dùng 2026-11-06)
| # | Quyết định | Mục |
|---|---|---|
| Q1 | Từ Công ty › Quy trình: quy trình THƯ VIỆN mở CHỈ XEM + "Sao chép cho công ty này" ⇒ bản riêng sửa thẳng ("Sao từ … · vN") | R4, R8 |
| Q2 | Bật/tắt Dify theo công ty chuyển sang Công cụ AI ("Công ty dùng"); bỏ khỏi trang công ty | R6 |
| Q3 | Tắt·Xem·Sửa·Quản trị giữ nhãn; không tràn (cắt + tooltip); ⓘ giải nghĩa | R3 |
| Q4 | Mã/Múi giờ/Chạy cùng lúc/Gói chỉ sửa ở tab Cài đặt; 4 ô số chỉ xem | R2, R3 |
| Q5 | Dải "Cần xử lý": nút mở ngăn "Gán", không bật tại dải | R3 |
| Q6 | 5 tab cho CẢ platform_admin VÀ tenant_admin | R2 |
| Q7 | Làm HẾT trước deploy: Thư viện, Công cụ AI, Trình sửa | R5–R8 |
| Q8 | tenant_admin: Xem (chỉ đọc) + Sao chép + Gán/Đổi cho công ty MÌNH qua đường đọc chỉ-xem theo tenant; KHÔNG sửa def thư viện; tenant khác ⇒ 404; member ⇒ 403; kiểm vai ở service | R4, R8, R9 |
| Q9 | "Sao chép cho công ty này" TỰ GÁN thay bản cũ (một thao tác, audit, idempotent) | R8, R9 |
| Q11 | Chế độ CANVAS (sơ đồ) là MẶC ĐỊNH mọi chỗ xem/sửa quy trình (trình sửa gồm chỉ-xem, chi tiết ở Thư viện, ngăn ở Công ty › Quy trình); danh sách bước dọc là chế độ phụ, nút icon có nhãn khi rê chuột; nhớ theo người dùng (localStorage, lỗi ⇒ canvas) | R4, R5, R8 |
| Q10 | Vai hub = `admin.users.role`; tên công ty = `admin.tenants.name`; nguồn mail = kho secret Hub (env chỉ seed lần đầu); c16 chọn lát trước c11 (D6) | D2–D4, tasks |

## Một nguồn (Luật GỐC 1–2, D6)
| Khái niệm | Nguồn DUY NHẤT | Bị gỡ |
|---|---|---|
| Gán quy trình cho công ty (+ luật định tuyến + Mặc định) | Công ty › Quy trình (R4) | thẻ app trong tab Ứng dụng (`TenantProcessSlots`, `SlotRouting`/`RoutingRules` ở đó); tab "Quy trình" + ngăn "Công ty" của `/apps/$appKey`; `flowsMode` của `/processes?tenant=` |
| Bật/tắt Dify theo công ty | Công cụ AI › ngăn chi tiết "Công ty dùng" (R6) | tab `workflow-tools` trang công ty |
| Mã, múi giờ, chạy cùng lúc, gói, quota, khoá | tab Cài đặt của công ty (R2) | khối trùng ở Công ty › Ứng dụng; tab Quota riêng |
| Sửa các bước quy trình | Trình sửa (R8), vào từ Thư viện hoặc Công ty › Quy trình | — |
| Danh sách công cụ AI (agent/lệnh/hook/workflow) | trang Công cụ AI (R6) | 3 mục nav /workflows /commands /agents |
| Nhãn mức truy cập | một component `LevelControl` + ⓘ dùng ở mọi nơi | — |

Từ vựng: **Quy trình** = chuỗi bước của một **việc**; **Công cụ AI** = agent/lệnh/hook/Dify; trạng thái "Đang bật/Đang tắt/Cần xử lý/Lỗi" + lý do; không lộ khe, add-on, def, khoá thô.

## Một nguồn dữ liệu (Luật GỐC 1) — lát c18…c21
Kiểm code 2026-11-06. Mỗi mục: nguồn duy nhất · gỡ/backfill · check tự động. Quyết định người dùng: D2–D4 (Q10).
| # | Khái niệm | Hiện trạng đã kiểm | Nguồn duy nhất | Gỡ / backfill | Check phát hiện lệch |
|---|---|---|---|---|---|
| D1 | Công tắc duyệt bằng engine | `contracts-approval-engine` còn trong `admin.features` (`0026_engine_feature.sql`) và ở: `admin-web/features/features/lib/feature-meta.ts`, `admin-api/modules/tenants/tenants.repo.ts:33-37` (lọc ẩn), `hub-api/modules/seed/seed.tenant-fixtures.ts`, `packs/kit/adapters/pack-guard.middleware.ts:100` (mô tả), `capabilities.rules.test.ts`, `feature-assign.test.ts`, `e2e/{app-config.spec.ts,journey-approval/*}`, i18n vi/en | **Gán quy trình cho khe** (D-4) | Migration admin **0037**: xoá `feature_entitlements` mồ côi rồi hàng `admin.features` key này (set-based, audit); gỡ mọi chỗ trên | int: sau migrate không còn feature/entitlement key này; ops: không feature "engine" tồn tại (`flow-coverage.check.ts`) |
| D2 | Vai theo ứng dụng | `admin.app_roles` (`admin-api/modules/app-roles/*`) tách khỏi vai hub | Vai hub = `admin.users.role` (`platform_admin`/`tenant_admin`/`member`, người dùng chốt); vai theo app = `admin.app_roles` biên dịch ra groups/entitlements (`app-roles.compile.ts`) — hai tầng khác nghĩa | Không backfill; quy tắc nhất quán thành check | ops check mới (c19): (1) `tenant_admin` có mức Quản trị ở MỌI app đang bật — **lỗi**; (2) `member` không vượt trần mức của app ở công ty — **cảnh báo** cho đến khi c19 xác minh bằng dữ liệu thật rồi mới nâng lỗi; (3) `app_roles.key` không trùng tên vai hub — lỗi; (4) thành viên vai app thuộc đúng tenant của nhóm — lỗi; (5) không có `app_roles` cho app công ty không bật — lỗi (rút từ `app-roles.compile.ts`/`backfill.ts`) |
| D3 | Hồ sơ công ty | `admin.tenants` là nguồn (cột `timezone` + hồ sơ migration 0035/0036). `processes/adapters/timers/tenant-tz.repo.ts` ĐÃ đọc thẳng `admin.tenants.timezone` (không chép) | Tên công ty = `admin.tenants.name`. Brand app (`app_name`, `logo`, `accent`) không chứa tên công ty: giữ là cấu hình riêng của gói contracts | **Bản trùng:** `contracts.company_settings.company_name` (`migrations-pack-contracts/0034_v2l_company_settings.sql`; trigger `brand_config_bump` ở 0072/0073). Đọc ở: `hub-api/modules/packs/contracts/{brand.mount.ts:24, adapters/company.repo.ts:18-24, adapters/extraction.repo.ts:233, application/extraction.ports.ts:115}`, `seed.tenant-fixtures.ts:142`, `tools/scripts/src/{seed-demo-v2,demo-ai-fix}.ts`, DTO `packages/contracts/src/pack-contracts/company.ts`. Migration **0076**: backfill (lệch ⇒ ghi báo cáo, lấy `admin.tenants.name`), chuyển mọi chỗ đọc, gỡ cột, trigger chỉ bump `app_name, logo, accent`. `/pack/me` đọc tên qua tenant của phiên (RLS giữ; grant cross-schema cần kiểm). Rủi ro: `own-side.rules.ts` (đoán Mua/Bán) dùng tên pháp nhân + MST — c20 xác nhận `admin.tenants.name` đủ cho nó hoặc giữ `own_names` | ops check c20: không còn cột `company_name`; `/pack/me` tên = `admin.tenants.name`; int backfill + đổi tên ở admin ⇒ ETag đổi + chặn đọc chéo tenant. Múi giờ: `tenant-tz.repo.ts` đã đọc thẳng `admin.tenants.timezone` |
| D4 | Cấu hình gửi mail | `HUB_SMTP_HOST/PORT/SECURE/USER/FROM` (env, `hub-api/src/config/env.ts:119-126`) + mật khẩu qua kho secret Hub `smtp_password`; schema pack `n3_notify` (packs migration 0004) | **Kho secret của Hub (Admin › Secrets)** — người dùng chốt | Env `HUB_SMTP_*` (`hub-api/src/config/env.ts:119-126`, `env-deps.ts:43-47`) chỉ KHỞI TẠO lần đầu: secret mail trống ⇒ seed từ env, sau đó bỏ đọc env (`notify/notify.mount.ts` đọc secret). Gỡ `n3_notify` nếu trùng (packs 0004 chưa thấy cấu hình mail). Sửa `.env.example`, `deploy/prod-sohoptac2/README.md` | ops check c21: secret mail trống ⇒ cảnh báo "chưa cấu hình mail" (không chặn khởi động); int: seed một lần, idempotent, không ghi đè |
| D5 | Feature → ứng dụng | Suy ra từ **tiền tố khoá** (`tenants.repo.ts:33` `APP_LIST`; `feature-meta.ts` `APP_IDS`/`groupByApp`); `han-muc-duyet` sót | Cột `admin.features.app` (NOT NULL, theo `TENANT_APP_IDS`) | **0037** (cùng D1): thêm cột, backfill theo tiền tố + `han-muc-duyet → contracts`; mọi chỗ đọc (lọc "Ứng dụng" Q-1, bảng R3, `tenants.repo.ts`, `feature-meta.ts`) đọc cột, gỡ suy luận tiền tố | int: mọi feature có `app` hợp lệ; grep: không còn suy app từ tiền tố |
D1+D5 → c18 (0037); D2 → c19; D3 → c20; D4 → c21. Check thêm vào `ops/adapters/checks/registry.ts` tuần tự c18→c21 (cùng file).

## Yêu cầu

### R1 · Thanh điều hướng 6 mục phẳng — artboard `Main` (lát c10)
Sidebar: **Tổng quan · Công ty · Ứng dụng · Quy trình · Công cụ AI · Hệ thống**; không nhóm NỀN TẢNG/Tự động hoá, không "Workflow Dify (tool AI)",
không mục Features/Commands/Agents riêng. Badge số. Nhãn: `nav.overview|companies|apps|processes|aiTools|system`; mục chọn nền `sidebar-accent`; thu gọn ⇒ icon + tooltip.
- Gỡ: nav `/workflows` `/commands` `/agents` ⇒ chuyển hướng `/ai-tools?kind=workflow|command|agent` (c10 tạm → /workflows đến khi c16 thay).
- Kịch bản: mở admin ⇒ đúng 6 mục, không tiêu đề nhóm; vào `/commands` ⇒ `/ai-tools` chip "Lệnh". e2e/unit đổi: `nav.test.ts`, `workspace-tabs.test.ts`.

### R2 · Khung trang Công ty: 5 tab — artboard `Tpl-Settings` (lát c14; áp platform_admin VÀ tenant_admin — Q6)
Tab (key URL): **Hồ sơ `profile` · Ứng dụng `apps` · Quy trình `processes` · Thành viên `members` · Cài đặt `settings`**. Đầu trang: tên + "Đang hoạt động" + dòng tóm tắt
"6 người dùng · 2 ứng dụng · 4/5 việc có quy trình" (liên kết sang tab Quy trình khi còn việc chưa có quy trình) + nút "Khoá công ty…" (chuyển xuống tab Cài đặt).
| Tab | Nội dung |
|---|---|
| Hồ sơ | Thông tin công ty, Liên hệ và lãnh đạo (sửa tại chỗ, "Đã lưu"), **Phòng ban** (tên · trưởng phòng · số người) |
| Ứng dụng | R3 |
| Quy trình | R4 |
| Thành viên | người dùng + bộ lọc/mục con **Nhóm · Đối tác · Phân quyền · Agents** (các tab cũ gộp vào đây) |
| Cài đặt | Mã công ty (chỉ đọc, chép được), Múi giờ, Chạy cùng lúc tối đa, Gói + "Đổi gói", **Quota**, Khoá công ty; một thanh "Có thay đổi chưa lưu · Huỷ · Lưu" |
- Gỡ: tab Nhóm/Đối tác/Phân quyền/Agents/Quota/`workflow-tools` (chuyển hướng bảng dưới). `TenantDetailPage` dùng chung ⇒ tenant_admin cùng 5 tab; quyền ghi theo vai như hiện tại.
- Trạng thái: công ty khoá ⇒ banner "Công ty đang bị khoá — người dùng không đăng nhập được" + "Mở khoá".
- Kịch bản: `?tab=quota` ⇒ `?tab=settings#quota`; tenant_admin mở công ty mình ⇒ 5 tab đúng thứ tự (e2e MỚI).

| URL cũ | Chuyển tới |
|---|---|
| `?tab=info` | `?tab=profile` |
| `?tab=features` | `?tab=apps` |
| `?tab=groups\|partners\|access\|agents` | `?tab=members&view=groups\|partners\|access\|agents` |
| `?tab=quota` | `?tab=settings#quota` |
| `?tab=workflow-tools` | `/ai-tools` (kèm thông báo "Bật/tắt Dify theo công ty nằm ở Công cụ AI") |
| `/apps/$appKey?tab=companies\|processes` | `/tenants/<id>?tab=processes` (nếu có công ty) hoặc trang app chỉ còn link |
| `/processes?tenant=<id>` | `/tenants/<id>?tab=processes` |
Key tab mới `processes`, không tái dùng `workflow-tools`.

### R3 · Công ty › Ứng dụng — artboard `Company` (lát c12)
Bảng mỗi hàng một ứng dụng: **Ứng dụng · Quyền truy cập · Trạng thái · Thành viên · Quy trình**. Quyền = `LevelControl` **Tắt·Xem·Sửa·Quản trị** (Q3); "Quy trình" = "2 bật · 1 tắt" là liên kết sang tab Quy trình (lọc theo app). App nền: "Cơ bản · luôn bật".
Dải **Cần xử lý** (ẩn khi 0): dòng "Duyệt bài đang tắt — Community" + nút **Gán** ⇒ mở ngăn "Gán" ở Công ty › Quy trình (Q5); gán xong dòng biến mất.
Dưới bảng: 4 ô số **chỉ xem** — Người dùng · Ứng dụng đang bật (x / y) · Chạy cùng lúc · Gói — và link "Mở Quy trình" (Q4).
- ⓘ giải nghĩa mức (Q3): Xem = chỉ đọc · Sửa = tạo và sửa · Quản trị = thêm cài đặt app và người dùng. Nhãn `tenants.apps.level.off|view|edit|admin`, `…levelHelp`.
- Không tràn: nhãn mức/tên app cắt (`truncate`) + tooltip đầy đủ khi thu gọn sidebar hoặc bảng hẹp.
- Gỡ: lưới `AppCard`, `TenantProcessSlots` (chuyển ở c11), khối "Khác" in khoá thô, khối Mã/Múi giờ/Chạy cùng lúc/Gói.
- Kịch bản: thu gọn sidebar ⇒ không chữ tràn, rê nhãn cắt ⇒ tooltip; Community chưa gán ⇒ dải Cần xử lý 1 dòng, bấm Gán ⇒ ngăn Gán ở tab Quy trình.

### R4 · Công ty › Quy trình — artboard `CompanyFlows` + `Tpl-Detail` (lát c11)
**Nơi duy nhất gán quy trình cho công ty.** Câu dẫn: "Mỗi việc dùng một quy trình lấy từ Thư viện." Cấu trúc theo ứng dụng → việc → quy trình:
cột **Việc · Quy trình · Trạng thái · Luật**; dưới tên quy trình: chip bước (số), "· N bước"; trạng thái "Đang bật" hoặc "Đang tắt · chưa gán quy trình" (lý do bắt buộc); "N luật"; nút **Đổi** (đã gán) / **Gán** (chưa).
Chip ứng dụng có đếm "2 việc". Khối **Đang chạy** (theo việc): các lượt đang chờ, mã HĐ, bước hiện tại, "đang chờ"; dữ liệu từ API lượt chạy lọc theo slot (R9).
**Ngăn chi tiết** (bấm hàng): tóm tắt (loại, công ty đang dùng vN), các bước, **Luật định tuyến** ("Xét từ trên xuống, dùng luật khớp đầu tiên. Không luật nào khớp thì dùng quy trình mặc định."), hàng **Mặc định**, "Thêm luật"; danh sách đổi chỉ gồm "quy trình cùng loại: <loại>"; nút **Mở trình sửa** (Q1, R8; xem sơ đồ ở chế độ canvas mặc định — Q11); "Mở trang chi tiết". tenant_admin: xem + Sao chép + Gán/Đổi cho công ty mình (Q8), đọc def thư viện qua `GET /tenants/:tid/process-library/:id` (R9).
- Chuyển vào đây (D6, cùng lát): `SlotRouting`/`RoutingRules` + `useSlotRoutingActions`; gỡ `TenantProcessSlots` khỏi thẻ app. Chỗ gán 3, 4 gỡ ở R7 (c13).
- Kịch bản: việc chưa gán ⇒ "Đang tắt · chưa gán quy trình" + Gán; gán xong ⇒ "Đang bật" ngay. Ngăn "Duyệt hợp đồng" chỉ liệt kê quy trình cùng loại; thêm luật ⇒ hiện ở số luật. Tenant A gán không đổi tenant B.

### R5 · Thư viện quy trình — artboard `Library` (lát c15)
`/processes` "Thư viện quy trình — Mẫu dùng chung cho mọi công ty.": **Tạo quy trình**, **Tìm kiếm**, **Lọc**, chip app có đếm. Bảng nhóm theo app:
**Quy trình · Các bước (chip) · Dùng bởi (số công ty) · Trạng thái · Cập nhật**; tên kèm `vN` và nhãn điều kiện ("≥ 500 triệu"); bấm hàng ⇒ mở trình sửa (R8, sửa đầy đủ; chi tiết hiển thị ở chế độ canvas mặc định — Q11).
- Gỡ: `flowsMode` của `/processes?tenant=` (chỗ gán thứ 3) — xem R7.
- "Dùng bởi 0" ghi "Chưa công ty nào dùng"; quy trình tắt ghi lý do.
- Kịch bản: bảng có đủ 5 cột, bấm một dòng ⇒ vào trình sửa của quy trình đó.
- Kịch bản: `/processes?tenant=<id>` ⇒ chuyển tới tab Quy trình của công ty (R2).

### R6 · Công cụ AI — artboard `AiTools` (lát c16)
Một danh sách gộp **agent · lệnh · hook · quy trình/workflow Dify**. Chip: **Tất cả · Đang bật · Chưa dùng** + loại; ô **Tìm công cụ**; cột **Công cụ · Trạng thái · Dùng bởi · Thao tác** ("Dùng bởi" = số + loại: "23 agent"); "6 trong 26 · Xem thêm"; rỗng ⇒ "Mọi công cụ đều đang được dùng."
Bấm hàng ⇒ ngăn chi tiết: mô tả, "Dùng bởi", và (workflow Dify) **Công ty dùng** với công tắc bật/tắt (Q2) — nguồn duy nhất. Chỉ platform_admin. Route `/workflows|/commands|/agents/...` giữ làm chi tiết; nav riêng gỡ (R1). D6: chuyển công tắc từ tab `workflow-tools` (`features/tenants/{components/tools,hooks/use-tenant-tools.ts}`, `lib/workspace-tabs.ts`) và gỡ tab đó **cùng lát c16**.
- Kịch bản: bật workflow cho công ty X ở ngăn chi tiết ⇒ việc dùng workflow đó chạy được; chip "Chưa dùng" ⇒ chỉ công cụ "Dùng bởi 0".

### R7 · Gỡ chỗ gán thứ 3, 4 + `/apps/$appKey` (lát c13)
`/apps/$appKey` chỉ còn thông tin app + link "Xem ở Công ty › Quy trình". Gỡ tab "Quy trình" gán, ngăn "Công ty" gán, `flowsMode` + `RulesPanel` theo công ty ở `/processes`. Chuyển hướng theo bảng R2.
- Kịch bản: `/apps/community?tab=processes` ⇒ trang app không điều khiển gán; grep không còn `useSlotRoutingActions` ngoài tab Quy trình.

### R8 · Trình sửa quy trình — artboard `Tpl-Editor` (lát c17; Tpl-Run đã làm ở r3/r4, chỉ đối chiếu)
Đầu trang: tên + "Loại: …" + **"Sao từ thư viện: <bản gốc> · vN"** + "<Công ty> đang dùng vN"; nút **Xuất bản vN+1** ("Sẵn sàng xuất bản" / lỗi + cách sửa). Tab **Các bước** (bộ đếm "n/20"): tên, người, nhãn "Có điều kiện", vùng **Chỉ chạy khi** (Giá trị HĐ, Loại HĐ, Phòng ban người tạo, Đối tác mới; và/hoặc; "Luôn chạy"); "Thêm bước" chỉ loại ứng dụng hỗ trợ; **Xem trước bằng HĐ mẫu** (bước "khớp/bỏ qua"). Tab **Lượt chạy**: lượt của đúng quy trình này (lọc `def_id`, R9); bấm lượt ⇒ sơ đồ giai đoạn.
**Chỉ xem** (Q1): mở từ Công ty › Quy trình một quy trình THƯ VIỆN ⇒ không sửa/không Xuất bản; hiện "Quy trình dùng chung — chỉ xem" + nút **Sao chép cho công ty này** ⇒ tạo bản riêng (ghi "Sao từ … · vN") và **TỰ GÁN thay bản cũ** (Q9): chỉ luật (Mặc định + điều kiện) đang trỏ ĐÚNG def thư viện nguồn được đổi sang bản riêng; luật trỏ quy trình khác (khác loại/bản riêng khác) giữ nguyên; lượt đang chạy giữ bản cũ. Một transaction (sao + gán + đổi luật), khoá `FOR UPDATE` trên hàng gán của việc, audit; hai admin cùng bấm hoặc bấm hai lần ⇒ lần sau trả bản đã có (`created:false`); việc không còn khe ⇒ 422 `SLOT_GONE`. Bản riêng sửa thẳng.
Chuỗi: **"Đã sao chép và gán cho công ty này"** · **"Không sao chép được: <lý do>. <cách sửa>"** · **"Quy trình dùng chung — chỉ xem"**. tenant_admin: cùng màn chỉ-xem + Sao chép/Đổi (Q8), không Xuất bản/sửa.
- Kịch bản: mở từ Thư viện ⇒ sửa được; Xuất bản v2 ⇒ lượt đang chạy giữ v1.
- Kịch bản: mở từ tab Quy trình bản thư viện ⇒ chỉ xem; bấm Sao chép ⇒ có bản riêng "Sao từ … · v1", đã là quy trình đang dùng của việc đó (Mặc định + luật điều kiện), sửa được; bấm lần hai ⇒ không tạo bản thứ hai.
- Kịch bản: 21 bước ⇒ không thêm được, hiện "Tối đa 20 bước".
**Chế độ xem (Q11):** mặc định **Canvas** (`ProcessCanvas`/`packages/flow-canvas`) ở R8, R5 (chi tiết Thư viện), R4 (ngăn "Mở trình sửa"/xem); chế độ **Danh sách bước** (dọc) là phụ, chuyển bằng nút icon, nhãn "Sơ đồ"/"Danh sách bước" hiện khi rê chuột/focus (aria-label). Lưu lựa chọn theo người dùng ở `localStorage` (khoá `processView`); đọc lỗi/không có ⇒ canvas. Áp cả chỉ-xem.
- Kịch bản: mở quy trình lần đầu ⇒ thấy canvas; chuyển "Danh sách bước", tải lại ⇒ vẫn danh sách [test: unit `apps/admin-web/src/features/processes/lib/view-mode.test.ts » mặc định canvas, nhớ lựa chọn, lỗi storage về canvas`].
- Kịch bản: mở bản thư viện chỉ-xem từ Công ty › Quy trình ⇒ canvas, không có nút Xuất bản [test: e2e `e2e/cr121-c-flows.spec.ts » bản thư viện mở chỉ xem ở chế độ canvas`].

### R9 · API cần (hub-api)
| Nhu cầu | Hiện trạng đã kiểm | Việc |
|---|---|---|
| Lượt chạy lọc theo việc/quy trình | `GET /process-runs` (`ProcessRunListQuerySchema`, `packages/contracts/src/chat/processes-api.ts:94`) có `process_key, room_id, conversation_id, status, tenant_id` — **chưa có `slot`, `def_id`** | c9: thêm `slot?`, `def_id?` vào `ProcessRunListQuerySchema` → `runs.routes.ts:55` → `listRuns` (`runs/runs.repo.ts:220`); lọc trong cùng câu SQL, index (tenant, slot); int chặn đọc chéo tenant (tenant_admin chỉ thấy lượt tenant mình) |
| Sao chép quy trình thư viện cho công ty | `POST /process-defs/:id/clone` (`library.routes.ts:73`) chỉ nhân bản **trong thư viện**; `POST /process-defs/:id/copy?tenant_id=` (`defs.routes.ts:68`) sao **mẫu** sang công ty và **từ chối** def có `slot` (`defs.service.ts:284`) ⇒ **CHƯA có** đường thư viện → bản riêng công ty | c9: **`POST /tenants/:tid/process-defs/:id/clone-for-company`** (body `{}`; res `{def_id, source_template_id, rel_version, created:boolean}`): tạo mới ⇒ **201** `created:true`; đã có bản riêng từ nguồn này ⇒ **200** `created:false`; `:id` không phải def thư viện/có khe ⇒ **422** `NOT_LIBRARY_DEF`; việc không còn khe ⇒ 422 `SLOT_GONE`. Vai (kiểm ở service, mẫu `library.service.ts` `withConfigWrite`): platform_admin mọi tenant · tenant_admin chỉ `:tid` = tenant mình (khác ⇒ **404**) · member **403**. Hàm mới trong `library/` (`library.service.ts` `cloneForCompany`, `library.repo.ts`, `routing.service.ts` đổi luật). Ghi `source_template_id`+`rel_version` (cột đã có), audit; quy tắc đổi luật xem R8. Đường GHI dữ liệu khách ⇒ **Opus low soát**; int: cách ly tenant (tenant lạ 404, member 403) + idempotent 200 |
| Đọc chỉ-xem def thư viện theo tenant (Q8) | `defs.routes.ts:26-51` chỉ cho platform_admin thấy def có khe; tenant_admin không đọc được | c9: **`GET /tenants/:tid/process-library/:id`** (def + bước + lượt chạy của tenant `:tid`; chỉ đọc, không trả quyền sửa). Vai: platform_admin · tenant_admin của `:tid` · khác tenant 404 · member 403; kiểm ở service; int chặn chéo tenant |
| "Dùng bởi" của Công cụ AI | chưa thấy API tổng hợp trong admin; cần kiểm khi làm c16 | c16: endpoint đọc gộp (đếm theo loại) trong `apps/admin-api/src/modules/workflow-tools/` (mở rộng `workflow-tools.routes.ts`, `workflow-tools.repo.ts`) hoặc module tương đương; **platform_admin only, role khác 403**; tenant_admin không dùng trang này nên không lộ tên công ty; một câu SQL theo tập (Luật 4c) |
| Bật/tắt Dify theo công ty | `GET /:id/workflow-tools`, `PUT|DELETE /:id/workflow-tools/:workflow_id` (`workflow-tools.routes.ts:41-49`, giữ nguyên, platform_admin) | c16 chỉ đổi chỗ gọi (`features/tenants/hooks/use-tenant-tools.ts` → ngăn Công cụ AI) |
Perf: đọc theo tập, số câu SQL cố định; chi tiết từng lát ở `tasks.md`.

## e2e phải đổi (khoá `tests/.lock` — qc sửa trước deploy; deployed/stg chạy trên prod/staging)
`app-config.spec.ts:108/163` · `feature-ui.spec.ts:69` · `P-a/pf4/tenant-routing.pa.ts:90` · `stg/smoke.stg.ts:164` · `deployed/20-flows-visible.ro.deployed.ts:52-58` ·
`groups-*.spec` (14 dòng) · `journey-approval/_journey.ts:57` · `community-web/flows.cs.ts:32` (+ unit nav/workspace-tabs). e2e MỚI (D5, qc): **c11** gán quy trình qua Công ty › Quy trình (platform_admin, không seed bật sẵn) + tenant_admin Sao chép/Gán · **c14** tenant_admin 5 tab (Q6) · **c16** bật/tắt Dify theo công ty. e2e chạy MỘT lần cuối đợt (D4).

## Không làm
Engine/Tpl-Run logic, DLC, Community/Sổ Hợp Tác (workspace-web). Đổi tên URL ngoài bảng R2. Migration ngoài 0037/0076(/0103) ở đầu trang.
