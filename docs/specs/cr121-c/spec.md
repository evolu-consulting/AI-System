---
id: cr121-c
cr: CR-121 (phần C — Thiết kế lại giao diện ADMIN PLATFORM, 11 artboard đã duyệt)
trạng thái: spec 2026-11-06; lát c9…c17 chờ làm (xem tasks.md)
nguồn quyết định: Intake Đầy đủ 2026-11-06, người dùng chốt Q1–Q7 (docs/CHANGE-REQUESTS.md dòng CR-121)
artboard: cr121-design/project/{Main,Company,CompanyFlows,Tpl-Detail,Tpl-Settings,Library,AiTools,Tpl-Editor,Tpl-Run}.dc.html (+ Tpl-List, Tpl-Dashboard đã làm ở c3b/c3c)
---
# CR-121 C · Admin platform theo thiết kế đã duyệt

## Mục tiêu
Trang công ty, Thư viện, Công cụ AI, trình sửa và thanh điều hướng của admin-web khớp artboard; **mỗi khái niệm một nguồn, một tên, một màn**
(Luật GỐC 1–3). Trước đây spec cr121-c1…c8 chỉ làm vỏ/hồ sơ/dashboard/danh sách công ty; phần dưới là phần CÒN THIẾU. Phạm vi: admin-web
(platform_admin; riêng R2 áp cả tenant_admin) + vài API hub-api. Không migration (dự kiến). Không đụng engine D, DLC (chỉ giữ seam `dlc:check`).

## Quyết định đã chốt (nguồn: người dùng 2026-11-06)
| # | Quyết định | Mục |
|---|---|---|
| Q1 | Mở trình sửa từ Công ty › Quy trình: quy trình THƯ VIỆN mở CHỈ XEM (sơ đồ + lượt chạy) + nút "Sao chép cho công ty này" tạo bản riêng; bản riêng sửa thẳng, ghi "Sao từ … · vN" | R4, R8 |
| Q2 | Bật/tắt workflow Dify theo công ty chuyển sang Công cụ AI (ngăn chi tiết, danh sách "Công ty dùng"); bỏ khỏi trang công ty | R6 |
| Q3 | Tắt·Xem·Sửa·Quản trị giữ nhãn; không tràn khi thu gọn (cắt + tooltip); ⓘ giải nghĩa | R3 |
| Q4 | Mã/Múi giờ/Chạy cùng lúc/Gói bỏ khỏi Công ty › Ứng dụng; chỉ sửa ở tab Cài đặt; 4 ô số chỉ xem | R2, R3 |
| Q5 | Dải "Cần xử lý": nút mở ngăn "Gán" của Công ty › Quy trình, không bật tại dải | R3 |
| Q6 | 5 tab (Hồ sơ·Ứng dụng·Quy trình·Thành viên·Cài đặt) cho CẢ platform_admin VÀ tenant_admin | R2 |
| Q7 | Làm HẾT trước deploy: Thư viện, Công cụ AI, Trình sửa (canvas) | R5–R8 |

## Một nguồn (Luật GỐC 1–2, D6)
| Khái niệm | Nguồn DUY NHẤT | Bị gỡ |
|---|---|---|
| Gán quy trình cho công ty (+ luật định tuyến + Mặc định) | Công ty › Quy trình (R4) | thẻ app trong tab Ứng dụng (`TenantProcessSlots`, `SlotRouting`/`RoutingRules` ở đó); tab "Quy trình" + ngăn "Công ty" của `/apps/$appKey`; `flowsMode` của `/processes?tenant=` |
| Bật/tắt Dify theo công ty | Công cụ AI › ngăn chi tiết "Công ty dùng" (R6) | tab `workflow-tools` trang công ty |
| Mã, múi giờ, chạy cùng lúc, gói, quota, khoá | tab Cài đặt của công ty (R2) | khối trùng ở Công ty › Ứng dụng; tab Quota riêng |
| Sửa các bước quy trình | Trình sửa (R8), vào từ Thư viện hoặc Công ty › Quy trình | — |
| Danh sách công cụ AI (agent/lệnh/hook/workflow) | trang Công cụ AI (R6) | 3 mục nav /workflows /commands /agents |
| Nhãn mức truy cập | một component `LevelControl` + ⓘ dùng ở mọi nơi | — |

Từ vựng thống nhất: **Quy trình** = chuỗi bước gán cho một **việc** của ứng dụng; **Công cụ AI** = agent/lệnh/hook/workflow Dify; trạng thái = "Đang bật / Đang tắt / Cần xử lý / Lỗi" + lý do (chuỗi một bộ cho mọi nơi).
Không lộ: khe, add-on, def, key thô `dlc.admin`/`pkdemo.read` (Luật GỐC 3).

## Một nguồn dữ liệu (Luật GỐC 1) — lát c18…c21
Kiểm code 2026-11-06 (worktree cr121-c-spec-admin). Mỗi mục: nguồn duy nhất · gỡ/backfill · check tự động. Mục chưa đủ thông tin ⇒ ghi "Câu hỏi mở", KHÔNG tự quyết.
| # | Khái niệm | Hiện trạng đã kiểm | Nguồn duy nhất | Gỡ / backfill | Check phát hiện lệch |
|---|---|---|---|---|---|
| D1 | Công tắc duyệt bằng engine | `contracts-approval-engine` còn trong `admin.features` (migration `0026_engine_feature.sql`, seed demo + backfill từ `contracts.approvals mode='engine'`), còn ở fixture/test/i18n/`feature-meta.ts`; `tenants.repo.ts` lọc ẩn nó; `pack-guard.middleware.ts` vẫn mô tả cổng theo feature; manifest D-4 đã bỏ add-on | **Gán quy trình cho khe** (CR-121 D-4) | Migration admin **0037**: xoá `feature_entitlements` mồ côi rồi xoá hàng `admin.features` key này (admin-api ghi audit/`config_meta` theo khuôn migration dữ liệu); gỡ khỏi `feature-meta.ts`, `seed.tenant-fixtures`, fixture/test, i18n, lọc ẩn trong `tenants.repo.ts` | int: sau migrate không còn feature/entitlement key này; ops-watch: không feature "engine" nào tồn tại (mở rộng `flow-coverage.check.ts`) |
| D2 | Vai theo ứng dụng | `admin.app_roles` (module `apps/admin-api/src/modules/app-roles/*`, nhóm sinh qua `groups`) tách khỏi vai hub `platform_admin/tenant_admin/member` | Vai hub (đăng nhập, chọn cổng) = `admin.users`; vai ứng dụng = `admin.app_roles` — hai tầng khác nghĩa, KHÔNG được trùng nhau | Chỉ ghi quy tắc "app_roles không mang tên/ý nghĩa vai hub" trong spec; không backfill | int/ops check: không `app_roles.key` trùng `platform_admin|tenant_admin|member`; thành viên app_role luôn thuộc tenant của nhóm. **Câu hỏi mở:** nguồn đúng của "vai hub" (users.kind? bảng riêng?) chưa xác minh — chốt trước khi viết check |
| D3 | Hồ sơ công ty | `admin.tenants` là nguồn (cột `timezone` + hồ sơ migration 0035/0036). `processes/adapters/timers/tenant-tz.repo.ts` ĐÃ đọc thẳng `admin.tenants.timezone` (không chép) | `admin.tenants` | Giữ; không thêm bản chép. Brand ở pack-contracts 0072/0073: **không tìm thấy** trong `migrations-packs`/hub (chỉ có 0004 n3_notify) | ops check: mọi cột hồ sơ trùng tên ở schema pack/hub (nếu có) phải bằng `admin.tenants`. **Câu hỏi mở:** vị trí thật của "brand" (số 0072/0073 không có) — cần người chỉ file |
| D4 | Cấu hình gửi mail | `HUB_SMTP_HOST/PORT/SECURE/USER/FROM` (env, `hub-api/src/config/env.ts:119-126`) + mật khẩu qua kho secret Hub `smtp_password`; schema pack `n3_notify` (packs migration 0004) | **Câu hỏi mở — chưa chốt**: (a) env + kho secret Hub, (b) secret `packs.n3_notify` | Chưa quyết ⇒ không viết cách gỡ | Sau khi chốt: ops check "đúng một nguồn có giá trị; nguồn kia rỗng" |
| D5 | Feature → ứng dụng | Suy ra từ **tiền tố khoá** (`tenants.repo.ts:33` `APP_LIST`; `feature-meta.ts`); `han-muc-duyet` là add-on của contracts nhưng không có tiền tố `contracts` ⇒ sót | Cột tường minh `admin.features.app` (NOT NULL, kiểm theo `TENANT_APP_IDS`) | Migration **0037** (cùng D1): thêm cột, backfill theo tiền tố + ngoại lệ `han-muc-duyet → contracts`; mọi chỗ đọc (lọc "Ứng dụng" Q-1, bảng Công ty › Ứng dụng R3, `tenants.repo.ts`, `feature-meta.ts`) đọc cột, gỡ suy luận tiền tố | int: mọi feature có `app` hợp lệ; ops/unit: không còn hàm suy app từ tiền tố khoá (grep trong test) |
Trình tự: D1+D5 cùng migration 0037 (cùng bảng) — lát c18; D2 → c19; D3 → c20; D4 → c21 (sau khi người dùng chốt). Các check thêm vào `ops/adapters/checks/registry.ts` tuần tự (c18→c19→c20→c21, cùng file).

## Yêu cầu

### R1 · Thanh điều hướng 6 mục phẳng — artboard `Main` (lát c10)
Sidebar: **Tổng quan · Công ty · Ứng dụng · Quy trình · Công cụ AI · Hệ thống**; không nhóm NỀN TẢNG/Tự động hoá, không "Workflow Dify (tool AI)",
không mục Features/Commands/Agents riêng. "Công ty" mở danh sách (bấm công ty ⇒ trang công ty, breadcrumb "Công ty › <tên>"). Badge số (công ty, ứng dụng, quy trình, công cụ).
- Nhãn vi/en: `nav.overview|companies|apps|processes|aiTools|system`.
- Trạng thái: mục đang chọn nền nhấn (token `sidebar-accent`); thu gọn ⇒ icon + tooltip nhãn.
- Gỡ: route/nav cũ `/workflows` `/commands` `/agents` ⇒ chuyển hướng sang `/ai-tools?kind=` (workflow→`workflow`, commands→`command`, agents→`agent`); nav chưa gỡ route con nếu còn làm chi tiết (R6).
- Kịch bản: platform_admin mở admin ⇒ thấy đúng 6 mục theo thứ tự trên, không còn tiêu đề nhóm.
- Kịch bản: vào `/commands` (URL cũ) ⇒ chuyển tới `/ai-tools` với chip "Lệnh" đang chọn.
- e2e đổi: `nav.test.ts` (unit), `workspace-tabs.test.ts`.

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
- Gỡ: tab riêng Nhóm/Đối tác/Phân quyền/Agents/Quota/`workflow-tools`; ba chỗ tab cũ `?tab=` chuyển hướng (bảng dưới). `TenantDetailPage` dùng chung ⇒ tenant_admin thấy cùng 5 tab; quyền ghi vẫn theo vai (tenant_admin không đổi gói/khoá — giữ như hiện tại).
- Trạng thái: công ty bị khoá ⇒ banner "Công ty đang bị khoá — người dùng không đăng nhập được" + nút "Mở khoá"; lỗi lưu nói cách sửa.
- Kịch bản: mở `/tenants/<id>?tab=quota` ⇒ chuyển `?tab=settings` và cuộn tới khối Quota.
- Kịch bản: tenant_admin mở trang công ty của mình ⇒ thấy 5 tab đúng thứ tự (e2e MỚI cho tenant_admin).

| URL cũ | Chuyển tới |
|---|---|
| `?tab=info` | `?tab=profile` |
| `?tab=features` | `?tab=apps` |
| `?tab=groups\|partners\|access\|agents` | `?tab=members&view=groups\|partners\|access\|agents` |
| `?tab=quota` | `?tab=settings#quota` |
| `?tab=workflow-tools` | `/ai-tools` (kèm thông báo "Bật/tắt Dify theo công ty nằm ở Công cụ AI") |
| `/apps/$appKey?tab=companies\|processes` | `/tenants/<id>?tab=processes` (nếu có công ty) hoặc trang app chỉ còn link |
| `/processes?tenant=<id>` | `/tenants/<id>?tab=processes` |
Key tab mới `processes` — KHÔNG tái dùng `workflow-tools`.

### R3 · Công ty › Ứng dụng — artboard `Company` (lát c12)
Bảng, mỗi hàng một ứng dụng: **Ứng dụng · Quyền truy cập · Trạng thái · Thành viên · Quy trình**. Quyền truy cập = `LevelControl` 4 nấc **Tắt·Xem·Sửa·Quản trị** (Q3);
"Quy trình" = "2 bật · 1 tắt" là liên kết sang tab Quy trình (lọc theo app). Ứng dụng nền "Cơ bản · luôn bật".
Dải **Cần xử lý** (trên bảng, ẩn khi 0): mỗi dòng "Duyệt bài đang tắt — Community" + nút **Gán** ⇒ mở ngăn "Gán" của Công ty › Quy trình (Q5, không bật tại dải); sau khi gán xong dòng biến mất, không cần công tắc ở chỗ khác (Luật GỐC 3).
Dưới bảng: 4 ô số **chỉ xem** — Người dùng · Ứng dụng đang bật (x / y) · Chạy cùng lúc (lượt tối đa) · Gói — và link "Mở Quy trình"; không có ô sửa (Q4).
- ⓘ giải nghĩa mức (Q3): Xem = chỉ đọc · Sửa = tạo và sửa · Quản trị = thêm cài đặt app và người dùng. Nhãn `tenants.apps.level.off|view|edit|admin`, `…levelHelp`.
- Không tràn: nhãn mức/tên app cắt (`truncate`) + tooltip đầy đủ khi thu gọn sidebar hoặc bảng hẹp.
- Gỡ: lưới `AppCard`, `TenantProcessSlots` trong thẻ (D6: chuyển ở c11), khối "Khác" in khoá thô `dlc.*`/`pkdemo.*`, khối Mã/Múi giờ/Chạy cùng lúc/Gói sửa tại đây.
- Kịch bản: thu gọn sidebar ⇒ không chữ nào tràn ra ngoài ô; rê vào nhãn bị cắt ⇒ tooltip.
- Kịch bản: Community có việc chưa gán quy trình ⇒ dải Cần xử lý hiện 1 dòng; bấm Gán ⇒ ngăn Gán mở trên tab Quy trình.
- e2e đổi: `app-config.spec.ts:108/163`, `feature-ui.spec.ts:69`.

### R4 · Công ty › Quy trình — artboard `CompanyFlows` + `Tpl-Detail` (lát c11)
**Nơi duy nhất gán quy trình cho công ty.** Câu dẫn: "Mỗi việc dùng một quy trình lấy từ Thư viện." Cấu trúc theo ứng dụng → việc → quy trình:
cột **Việc · Quy trình · Trạng thái · Luật**; dưới tên quy trình: chip bước (số), "· N bước"; trạng thái "Đang bật" hoặc "Đang tắt · chưa gán quy trình" (lý do bắt buộc); "N luật"; nút **Đổi** (đã gán) / **Gán** (chưa).
Chip ứng dụng có đếm "2 việc". Khối **Đang chạy** (theo việc): các lượt đang chờ, mã HĐ, bước hiện tại, "đang chờ"; dữ liệu từ API lượt chạy lọc theo slot (R9).
**Ngăn chi tiết** (bấm hàng): tóm tắt (loại, công ty đang dùng vN), các bước, **Luật định tuyến** ("Xét từ trên xuống, dùng luật khớp đầu tiên. Không luật nào khớp thì dùng quy trình mặc định."), hàng **Mặc định**, "Thêm luật"; danh sách đổi quy trình chỉ gồm "quy trình cùng loại: <loại>"; nút **Mở trình sửa** (Q1, R8); "Mở trang chi tiết".
- Chuyển vào đây (D6, cùng lát): `SlotRouting`/`RoutingRules` + `useSlotRoutingActions`; gỡ nơi cũ là `TenantProcessSlots` trong thẻ app. Chỗ gán thứ 3, 4 gỡ ở R7 (c13).
- Gỡ: bật/tắt Dify ở tab này (đi theo R6).
- Kịch bản: việc "Duyệt bài" chưa gán ⇒ hàng ghi "Đang tắt · chưa gán quy trình" + nút Gán; gán xong ⇒ "Đang bật" ngay, không phải bật chỗ khác.
- Kịch bản: ngăn của "Duyệt hợp đồng" chỉ liệt kê quy trình loại Duyệt hợp đồng; thêm luật "Mua · Phòng Kinh doanh → Duyệt 2 cấp" lưu và hiện ở số luật.
- Kịch bản: tenant A gán không đổi gì ở tenant B (cách ly).
- e2e đổi: `journey-approval/_journey.ts:57`, `community-web/flows.cs.ts:32` (gán qua `tenant-processes-*` ⇒ qua tab Quy trình mới), `P-a/pf4/tenant-routing.pa.ts:90`.

### R5 · Thư viện quy trình — artboard `Library` (lát c15)
Trang `/processes` "Thư viện quy trình — Mẫu dùng chung cho mọi công ty." nút **Tạo quy trình**, ô **Tìm kiếm**, **Lọc**, chip ứng dụng có đếm. Bảng nhóm theo ứng dụng:
**Quy trình · Các bước (chip) · Dùng bởi (số công ty) · Trạng thái · Cập nhật**; tên kèm `vN` và nhãn điều kiện ("≥ 500 triệu"); bấm hàng ⇒ mở trình sửa (R8, quyền sửa đầy đủ vì là thư viện).
- Gỡ: `flowsMode` của `/processes?tenant=` (chỗ gán thứ 3) — xem R7.
- Trạng thái: "Dùng bởi 0" ghi "Chưa công ty nào dùng"; quy trình tắt ghi lý do.
- Kịch bản: bảng có đủ 5 cột, bấm một dòng ⇒ vào trình sửa của quy trình đó.
- Kịch bản: `/processes?tenant=<id>` ⇒ chuyển tới tab Quy trình của công ty (R2).

### R6 · Công cụ AI — artboard `AiTools` (lát c16)
Một danh sách gộp **agent · lệnh · hook · quy trình/workflow Dify** (đếm tổng; nav "Công cụ AI"). Chip lọc: **Tất cả · Đang bật · Chưa dùng** + loại (agent/lệnh/hook/quy trình); ô **Tìm công cụ**; cột **Công cụ · Trạng thái · Dùng bởi · Thao tác**; "Dùng bởi" = số + loại ("23 agent", "1 lệnh · 1 agent"); phân trang "6 trong 26 · Xem thêm"; chip "Chưa dùng" rỗng ⇒ "Mọi công cụ đều đang được dùng."
Bấm hàng ⇒ ngăn chi tiết: mô tả, danh sách "Dùng bởi", và (workflow Dify) **Công ty dùng**: bảng công ty + công tắc bật/tắt theo công ty (Q2) — đây là nguồn duy nhất của việc bật/tắt Dify.
Route `/workflows|/commands|/agents/...` giữ làm trang chi tiết nếu cần; mục nav riêng gỡ (R1). D6: chuyển công tắc từ tab `workflow-tools` của công ty và gỡ tab đó **cùng lát c16** (tab registry do c14 dọn nốt phần còn lại).
- Kịch bản: bật workflow cho công ty X ở ngăn chi tiết ⇒ tab Quy trình của X không đổi; việc dùng workflow đó chạy được.
- Kịch bản: chọn chip "Chưa dùng" ⇒ chỉ công cụ "Dùng bởi 0".

### R7 · Gỡ chỗ gán thứ 3, 4 + `/apps/$appKey` (lát c13)
`/apps/$appKey` chỉ còn thông tin app + link "Xem ở Công ty › Quy trình" (liệt kê công ty đang dùng, bấm ⇒ tab Quy trình của công ty đó). Gỡ tab "Quy trình" gán và ngăn "Công ty" gán; gỡ `flowsMode` + `RulesPanel` theo công ty ở `/processes`. Chuyển hướng theo bảng R2.
- Kịch bản: mở `/apps/community?tab=processes` ⇒ trang app, không có điều khiển gán nào; `grep` không còn `useSlotRoutingActions` ngoài tab Quy trình.

### R8 · Trình sửa quy trình — artboard `Tpl-Editor` (lát c17; Tpl-Run đã làm ở r3/r4, chỉ đối chiếu)
Đầu trang: tên + "Loại: Duyệt hợp đồng" + **"Sao từ thư viện: <bản gốc> · vN"** (bản riêng công ty) + "<Công ty> đang dùng vN"; nút **Xuất bản vN+1** (xanh "Sẵn sàng xuất bản" / lỗi + cách sửa). Câu dẫn: "Sửa ở đây tạo bản nháp. Công ty chỉ dùng bản mới sau khi xuất bản…".
Tab **Các bước** (danh sách dọc, bộ đếm "n/20"): mỗi bước có tên, người (Người duyệt · Chỉ trưởng phòng), nhãn "Có điều kiện"; vùng cấu hình **Chỉ chạy khi** (trường: Giá trị HĐ, Loại HĐ, Phòng ban người tạo, Đối tác mới; và/hoặc; "Luôn chạy"); "Thêm bước" chỉ gồm loại ứng dụng hỗ trợ (Duyệt, Công cụ AI (Dify), Ký số, Gửi thông báo, Chờ tới ngày). **Xem trước bằng HĐ mẫu**: chọn hợp đồng mẫu ⇒ bước nào "khớp/bỏ qua".
Tab **Lượt chạy**: danh sách lượt (mã, vN, HĐ, trạng thái) của đúng quy trình này (lọc theo def, R9); bấm một lượt ⇒ sơ đồ giai đoạn; bấm lại ⇒ về trình sửa.
**Chỉ xem** (Q1): mở từ Công ty › Quy trình một quy trình THƯ VIỆN ⇒ không sửa/không Xuất bản; hiện "Quy trình dùng chung — chỉ xem" + nút **Sao chép cho công ty này** ⇒ tạo bản riêng của công ty (ghi "Sao từ … · vN"). Bản riêng của công ty sửa thẳng. Việc gán bản riêng vào việc làm ở Công ty › Quy trình (Đổi/Gán), không công tắc ẩn.
**Câu hỏi mở (chưa có quyết định):** sau khi sao có tự gán bản riêng vào việc đang xem không? Mặc định spec: KHÔNG tự gán (c17 ghi rõ ràng "Đã sao — bấm Gán để dùng").
- Kịch bản: platform_admin mở từ Thư viện ⇒ sửa được, Xuất bản v2 ⇒ lượt đang chạy giữ v1 (đã có ở D).
- Kịch bản: mở từ tab Quy trình bản thư viện ⇒ chỉ xem; bấm Sao chép ⇒ có bản riêng "Sao từ … · v1" và sửa được.
- Kịch bản: 21 bước ⇒ không thêm được, hiện "Tối đa 20 bước".

### R9 · API cần (hub-api)
| Nhu cầu | Hiện trạng đã kiểm | Việc |
|---|---|---|
| Lượt chạy lọc theo việc/quy trình | `GET /process-runs` (`ProcessRunListQuerySchema`, `packages/contracts/src/chat/processes-api.ts:94`) có `process_key, room_id, conversation_id, status, tenant_id` — **chưa có `slot`, `def_id`** | c9: thêm `slot?`, `def_id?` + int chặn đọc chéo tenant (Opus low soát) |
| Sao chép quy trình thư viện cho công ty | `POST /process-defs/:id/clone` (library.routes.ts:73, CR-118/D) chỉ nhân bản **trong thư viện** (nháp cùng khe, chưa gán, `tenantId=null`). `POST /process-defs/:id/copy?tenant_id=` (defs.routes.ts:68) sao **mẫu** (`tenant_id null` & `slot null`) sang công ty, và **từ chối** def có `slot` (`NOT_FOUND`, defs.service.ts:284). ⇒ **CHƯA có** đường "thư viện (có khe) → bản riêng của công ty" | c9: thêm đường mới (đề xuất mở rộng `copy` hoặc `POST /tenants/:tid/process-defs/:id/clone`), ghi `source_template_id` + `rel_version` để hiện "Sao từ … · vN"; int cách ly tenant |
| "Dùng bởi" của Công cụ AI | chưa thấy API tổng hợp trong admin; cần kiểm khi làm c16 | c16: endpoint đọc gộp (đếm theo loại) nếu chưa có, một câu SQL theo tập (Luật 4c) |
| Bật/tắt Dify theo công ty | API đang dùng ở tab `workflow-tools` giữ nguyên | c16 chỉ đổi chỗ gọi |
Perf: danh sách Công cụ AI và lượt chạy theo slot là đọc theo tập, số câu SQL cố định, có index theo (tenant, slot); không chạm đường nóng engine.

## e2e phải đổi (khoá `tests/.lock` — qc sửa trước deploy; deployed/stg chạy trên prod/staging)
`app-config.spec.ts:108/163` · `feature-ui.spec.ts:69` · `P-a/pf4/tenant-routing.pa.ts:90` · `stg/smoke.stg.ts:164` · `deployed/20-flows-visible.ro.deployed.ts:52-58` ·
`workspace-tabs.test.ts` · `nav.test.ts` · `groups-*.spec` (14 dòng) · `journey-approval/_journey.ts:57` · `community-web/flows.cs.ts:32`. Thêm: e2e hành trình MỚI
(D5) gán quy trình qua Công ty › Quy trình cho platform_admin; e2e tenant_admin 5 tab (Q6). e2e chạy MỘT lần cuối đợt (D4).

## Không làm
Engine/Tpl-Run logic, DLC, Community/Sổ Hợp Tác (workspace-web), migration. Đổi tên URL ngoài bảng R2.
