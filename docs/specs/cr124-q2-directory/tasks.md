---
id: cr124-q2-directory
lát: cr124-q2-directory
cr: CR-124
làn: đầy đủ (RLS/cách ly tenant, quyền, migration)
migration: admin 0038_tenant_directory (when 1803500000000) · hub 0118_partner_links_fn (when 1806700000000)
phụ thuộc: cr124-q1-mailbox
---
## Plan (ngắn)
Danh bạ công ty tự nguyện (spec §4, FR-03/04/05, NFR-03/04) + nối đối tác một lần (§5, FR-06). Nguồn duy nhất `admin.tenants`
(CR-121): thêm 3 cột, tìm kiếm là HÀM chỉ đọc; consent nối là 4 hàm DEFINER trên `hub.partner_links` (q1).

## Làm
- [x] admin 0038: `directory_listed` (mặc định false), `directory_verified_at/by` (CHECK cùng có/cùng không), index MST một phần + trigram tên (nếu bật được `pg_trgm`), `admin.directory_search(q)` (DEFINER, 5 cột công khai, ≤ 20, loại công ty người gọi), `admin.directory_set_verified` (DEFINER, chỉ `app.scope = platform`); REVOKE PUBLIC, chỉ `admin_rw`.
- [x] hub 0118: `hub.partner_link_request(to)`, `partner_link_accept(from)`, `partner_link_block(from)`, `partner_links_mine()` (DEFINER, REVOKE PUBLIC, `hub_rw` + `contracts_rw` nếu có).
- [x] admin-api: `GET /admin/directory?q=` (platform/tenant admin), `PUT /admin/tenants/:id/directory` (CHỈ tenant_admin công ty đó), `PUT /admin/tenants/:id/directory-verified` (platform_admin); ghi qua configWrite + audit (chỉ tên cờ); `GET .../profile` thêm `directory_listed`, `directory_verified {at, by_name}`.
- [x] admin-web: thẻ "Danh bạ công ty" ở Công ty › Hồ sơ (công tắc + một dòng giải thích; nền tảng có công tắc "Đã xác minh" + ngày + người).

## Không làm / Chạm
Không UI chọn đối tác khi gửi / cảnh báo chưa xác minh (q3/q4), không workspace-web, contracts pack, DLC, canvas. Không đổi `partner_send` (giữ q1).

## Test tối thiểu
- int: `bun run test:int:par apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts apps/hub-api/src/modules/partners/links.int.test.ts`
- perf: `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test apps/admin-api/src/modules/tenants/tenants.directory.perf.int.test.ts`
- unit: `bun test apps/admin-web/src/features/tenants/lib/directory.test.ts`

## Quyết định trong lúc làm
- Trả `tenant_id` (không mã công khai riêng): `partner_send` cần `to_tenant`; mã khác phải có bảng ánh xạ = nguồn thứ hai (Luật GỐC 1); uuid không bí mật và hàm chỉ trả cho công ty đã bật. Bộ cột = `tenant_id, legal_name, tax_code, address, verified` (khoá bằng `DirectoryEntrySchema` strict + test).
- MST khớp đúng khi truy vấn có dạng 10 số (chi nhánh `-xxx`); còn lại là tên (ILIKE, ≥ 3 ký tự, `% _ \` được thoát). Công ty phải đang hoạt động + có tên pháp lý.
- Bật danh bạ chỉ khi đủ tên pháp lý + MST (422 `DIRECTORY_NEEDS_PROFILE`); tắt luôn được. Chỉ tenant_admin CHÍNH công ty bật/tắt (platform_admin không bật hộ: đây là sự đồng ý của công ty); platform_admin chỉ đặt Đã xác minh (route + service + hàm DB kiểm).
- Tỉnh/thành và logo (spec §4) chưa có cột trong hồ sơ CR-121 ⇒ chưa trả; thêm khi hồ sơ có.
- Consent nối: dòng (A → B) = "A xin gửi cho B". `request` cần B đang bật danh bạ và hoạt động (đọc `admin.tenants` bằng quyền chủ hàm; hub_ro vẫn không có cột mới). B chặn trước được (tạo dòng chặn). Chặn giữ `accepted_at` làm lịch sử; `accept` bỏ chặn. Sai bên / không có lời mời ⇒ 42501.
- Soát Opus: cột `requested_at` (0118) phân biệt "A đã xin rồi bị chặn" với "B chặn trước" — chặn trước thì A không thấy dòng `out` (không lộ tên/MST của B) và `request` vẫn trả `pending`; `mine` chỉ trả `legal_name` (không rơi về tên khoá); `partner_link_block` từ chối id không có trong `admin.tenants`; hàm `directory_set_verified` chỉ là lớp phụ, cổng thật là route + service (audit chỉ ghi `Tenant` công khai + tên cờ).
- B tắt danh bạ SAU khi đã chấp nhận ⇒ liên kết cũ vẫn hiệu lực (B có thể chặn); chỉ lời mời mới bị chặn. Xin duyệt khi review nếu muốn khoá cả gửi.
- Hub chưa gọi hàm admin: kết nối `hub_api` chạy `hub.partner_link_request` đọc `admin.tenants` qua DEFINER (cùng DB).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### ADDED platform/company-directory.md
#### Yêu cầu: Danh bạ công ty tự nguyện (CR-124 FLOW4-FR-03/04/05, NFR-03/04)
Công ty bật "Cho phép công ty khác tìm thấy và gửi hợp đồng cho chúng tôi" (mặc định tắt) thì xuất hiện trong danh bạ; danh bạ đọc thẳng hồ sơ công ty (`admin.tenants`), chỉ trả tên pháp lý, MST, địa chỉ, dấu Đã xác minh và mã công ty để gửi; tìm theo MST đúng hoặc tên (≥ 3 ký tự), tối đa 20, không gồm chính mình. Chỉ quản trị công ty đó bật/tắt (cần có tên pháp lý + MST); chỉ quản trị nền tảng đặt Đã xác minh.
- Kịch bản: khi công ty bật thì tìm theo MST/tên thấy đúng một dòng với đúng 5 cột công khai, tắt thì không thấy, không thấy chính mình [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » chỉ công ty đã bật, không phải chính mình, đúng bộ cột công khai (FR-03/04)]
- Kịch bản: khi người thường, quản trị nền tảng hay công ty khác bật hộ, hoặc thiếu MST, thì bị chặn (403/404/422) [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » chỉ quản trị chính công ty bật/tắt, thiếu MST ⇒ 422, người thường/nền tảng/công ty khác bị chặn]
- Kịch bản: khi quản trị nền tảng xác minh thì dấu hiện kèm ngày + người, công ty khác không đặt được kể cả gọi thẳng hàm DB [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » chỉ quản trị nền tảng đặt Đã xác minh (API + hàm DB), hiện ngày + người xác minh, công ty vẫn thấy]
- Kịch bản: khi chưa đặt phạm vi hoặc là Hub thì hàm tìm không chạy được [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » hàm tìm chỉ cho admin_rw, Hub/PUBLIC không chạy được, chưa đặt phạm vi ⇒ 42501]
- Kịch bản: khi danh bạ 20.000 công ty thì tìm MST và tên p95 ≤ 20 ms [test: apps/admin-api/src/modules/tenants/tenants.directory.perf.int.test.ts » 20000 công ty: tìm MST đúng p95 ≤ 20 ms]
- Kịch bản: khi quản trị công ty mở Hồ sơ thì công tắc bật được chỉ khi đủ tên pháp lý + MST; quản trị nền tảng thấy công tắc Đã xác minh [test: apps/admin-web/src/features/tenants/lib/directory.test.ts » quản trị công ty: bật được khi đủ tên pháp lý + MST, không thấy công tắc xác minh]

### ADDED platform/partner-links.md
#### Yêu cầu: Nối đối tác một lần (CR-124 FLOW4-FR-06)
Lần gửi đầu từ A tới B tạo lời mời nối (`hub.partner_link_request`, B phải đang bật danh bạ); chỉ B chấp nhận (`partner_link_accept`) hoặc chặn (`partner_link_block`); sau khi chấp nhận, A gửi qua nền tảng không hỏi lại; B chặn thì A không gửi được và thấy trạng thái bị chặn (`partner_links_mine`).
- Kịch bản: khi A xin nối B chưa bật danh bạ hoặc chưa được chấp nhận thì không gửi được [test: apps/hub-api/src/modules/partners/links.int.test.ts » request: cần B bật danh bạ, gọi lại không đổi, chưa chấp nhận thì chưa gửi được]
- Kịch bản: khi công ty không phải bên nhận chấp nhận hoặc chặn thì lỗi 42501 và không đổi dữ liệu [test: apps/hub-api/src/modules/partners/links.int.test.ts » accept/block CHỈ bên nhận, sai bên hoặc không có lời mời ⇒ 42501 và không đổi gì]
- Kịch bản: khi B chặn A thì A thấy bị chặn và không gửi được, B bỏ chặn thì gửi lại được, mỗi bên chỉ thấy dòng của mình [test: apps/hub-api/src/modules/partners/links.int.test.ts » block: B chặn A ⇒ A không gửi được, request trả blocked, B bỏ chặn bằng accept, mine thấy đúng phía]

## Việc còn lại
- q3/q4: UI chọn đối tác khi gửi (cảnh báo chưa xác minh FR-05, gọi `GET /admin/directory`-tương đương từ workspace/contracts), tạo lời mời nối từ lần gửi đầu, màn B "Nhận HĐ từ công ty A" (chấp nhận/chặn), migration gói cấp `EXECUTE` 4 hàm link + `directory` cho `contracts_rw`.
- Hạn mức gửi + khoá gửi khi B tắt danh bạ sau khi đã nối (xem Quyết định) trong `partner_send`.
- Tỉnh/thành, logo trong danh bạ; xác minh MST tự động.
- Quản trị nền tảng gỡ công ty khỏi danh bạ khi lạm dụng (hiện chỉ công ty tự tắt).
- Đo perf (local, 20.000 công ty đã bật, 300 lần): MST p50 0.5 ms / p95 0.5 ms; tên (trigram) p50 1.3 ms / p95 1.4 ms.
