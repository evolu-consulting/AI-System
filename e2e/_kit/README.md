# e2e/_kit — helper dùng chung cho e2e hành trình

Dùng thay vì viết lại trong từng lát. Dựng dữ liệu bằng API (`api.ts`), thao tác người dùng bằng UI (`ui.ts`). Dữ liệu riêng của spec: luôn có hậu tố duy nhất, không sửa/ẩn dữ liệu mẫu dùng chung.

## `api.ts` (fetch, không cần trình duyệt)
- `apiLogin({ base, tenantKey, username, password, app? })` → `Session` (token + header Bearer). `const s = await apiLogin({ base: ADMIN, tenantKey: "platform", username, password });`
- `assignProcess(hub, s, tenantId, slot, defId)` — platform admin gán quy trình thư viện cho tenant × khe. `await assignProcess(HUB, s, tid, "contracts.approval", defId);`
- `setRoutingRules(hub, s, tenantId, slot, rules)` — tenant/platform admin đặt luật chọn quy trình (tự lấy `version`). `await setRoutingRules(HUB, s, tid, slot, [{ condition: { contractKinds: ["buy"] }, def_id: defId, is_default: false }]);`
- `grantFeature(admin, s, featureId, tenantId)` / `revokeFeature(...)` — bật/tắt tính năng cho tenant. `await grantFeature(ADMIN, s, featId, tid);`
- `createIsolatedTenant(admin, s, "prefix")` — tenant + admin đầu tiên, khoá/tên có hậu tố duy nhất. `const t = await createIsolatedTenant(ADMIN, s, "flows");`
- `createIsolatedUser(admin, s, "prefix", role?)` — user riêng của spec. `const u = await createIsolatedUser(ADMIN, tenantSession, "nv");`
- `createIsolatedDept(admin, s, "prefix")` — phòng ban/nhóm riêng. `const d = await createIsolatedDept(ADMIN, tenantSession, "kd");`

## `ui.ts` (Playwright)
- `loginPlatformAdminUi(page, adminUrl, user, pw)` — đăng nhập ai-admin. `await loginPlatformAdminUi(page, ADMIN, u, p);`
- `openTenantAppsTab(page, tenantName)` — mở công ty › "Ứng dụng & Gói". `await openTenantAppsTab(page, "Demo Sổ Hợp Tác");`
- `openCompanyFlows(page)` / `flowRows(box)` / `flowRow(box, name)` — công ty › tab "Quy trình" = MỘT danh sách flow (CR-122). `const box = await openCompanyFlows(page);`
- `createFlowUi(page, adminUrl, {company,name})` / `openFlowEditor` — tạo quy trình trống bằng UI / mở màn soạn. (CR-127 Z7: không còn «Gán» mẫu dùng chung; dựng bằng API: `createCompanyFlow` trong `flows.ts` = tạo trống → PUT bước → áp dụng.)
- `loginTenantAdminUi(page, adminUrl, tenantKey, user, pw)` — quản trị công ty đăng nhập ai-admin.
- `flows.ts` — dựng flow riêng: `createCompanyFlow` (API: sơ đồ trống → bước → áp dụng), `seedLibraryFlow` (SQL, đã xuất bản v1), `enableFlowTriggers(tenantKey)`, bước `approve/ifFact/notifyCreator/finish/esignNode/bridgeSet`.
- `optionValue(select, text)` — value của `<option>` theo chữ. `await sel.selectOption(await optionValue(sel, "E2E Mua"));`
- `safeReload(page, { boot?, ready? })` — tải lại chờ `/auth/refresh` đang bay + app khởi động (tránh 401 do huỷ xoay token). `await safeReload(page, { ready: card });`
- `trackRefresh(page)` — bắt đầu theo dõi refresh sớm (tuỳ chọn).

## `unique.ts` (thuần, có `bun test`)
- `uniqueSuffix()` — hậu tố duy nhất. `const run = uniqueSuffix();`
- `uniqueKey(prefix, suffix?)` — `e2e-<prefix>-<suffix>`. `uniqueKey("flows")`

Ghi chú: `createIsolated*`/`grantFeature` bám contract admin-api hiện có; chạy lần đầu ở slice mới nên kiểm quyền vai gọi (platform vs tenant admin).
