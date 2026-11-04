---
id: cr118-r1-fixes
lát: cr118-r1-fixes
cr: CR-118
làn: đầy đủ (NOTIFY/cache tenant + migration)
migration: admin 0034_profile_version · pack-contracts 0073_brand_bumps_profile (journal `when` 1803100000000)
phụ thuộc: cr118-config-consistency (đã merge)
---
## Plan (ngắn)
Sửa 4 lỗi review trước release 1; mỗi lỗi viết test đỏ trước.
1. ConfigCache: tenant bị chạm từ NOTIFY không bao giờ bị rơi giữa hai lần nạp gộp — lần nạp có tenant chạm vẫn phát dù version không đổi.
2. capabilities.repo: flow độc lập + khe lọc theo tenant trong SQL (`tenant_id = $1 or null`), `limit` áp sau lọc; extras nhớ theo (version Hub, tenant).
3. Đổi `default_app` của user (PUT /me/default-app), của công ty qua `PUT /me/tenant-default-app`, và brand công ty KHÔNG bump `config_version` toàn cục nữa: bump `admin.config_meta.profile_version` + `pg_notify('profile_changed', {v, entity, tenant_id})` trong CÙNG transaction. Hub LISTEN `profile_changed` + poll `profile_version` (lưới an toàn) ⇒ chỉ nạp lại lát tenant/user (tenants + user đã cache của tenant bị chạm), không nạp catalog, không đổi version Admin ⇒ memo `/pack/me` tenant khác giữ nguyên (stamp có thêm default_app). Hạn mức PUT /me/default-app: 10 lần/phút/user (bộ nhớ trong tiến trình).
4. FORM_MONEY_MAX = 1e15 (≤ MAX_SAFE_INTEGER).

## Làm
- [x] Delta + test đỏ trước cho từng lỗi
- [x] 1 config.service (gộp tenant chạm), 2 capabilities.repo/service/mount, 3 migration + portal.service + config.service + capabilities.service, 4 process-form

## Không làm / Chạm
DLC, web UI, `PUT /admin/tenants/:id/default-app` (platform admin, có audit, hiếm) vẫn qua `config_version` toàn cục.

## Test tối thiểu
- apps/hub-api/src/modules/config/config.race.test.ts (unit, nguồn giả, không sleep)
- apps/hub-api/src/modules/config/config.profile.test.ts (unit)
- apps/hub-api/src/modules/capabilities/capabilities.repo.int.test.ts (int)
- apps/admin-api/src/modules/app-catalog/default-app-scope.int.test.ts (int)
- apps/hub-api/src/modules/config/profile-bump.int.test.ts (int, trigger brand)
- packages/contracts/src/hub-admin/process-form-money.test.ts (unit)

## Quyết định trong lúc làm
- Lỗi 1 chọn "phát tenant chạm cả khi version không đổi" (đơn giản, không cần so version giữa hai lần nạp); dữ liệu đã nạp sau NOTIFY nên đúng.
- Lỗi 3: hai loại nạp (đầy đủ / lát profile) chạy trên CÙNG một vòng coalesce ⇒ không ghi đè nhau. Version Admin đổi ⇒ luôn nạp đầy đủ.
- Lỗi 3: brand trigger vẫn trong cùng transaction ghi (trigger 0073 thay hàm 0072), chỉ đổi cột + kênh.
- Rate limit trong tiến trình (mỗi instance), không Redis: rẻ, đủ chặn bấm liên tục; vượt ⇒ 429 RATE_LIMITED.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/ung-dung-quyen.md
#### Yêu cầu: Tenant bị chạm không bị rơi giữa hai lần nạp gộp
Khi NOTIFY `config_changed`/`profile_changed` của tenant Y tới trong lúc lần nạp trước đang chạy (đã thấy version mới của Y), lần nạp kế vẫn phát `config.changed` cho Y dù version không đổi.
- Kịch bản: khi NOTIFY Y tới sau khi lần nạp 1 đã chụp danh sách {X} nhưng trước `readVersions` thì lần nạp 2 phát tenants={Y} [test: apps/hub-api/src/modules/config/config.race.test.ts » NOTIFY Y xen giữa hai lần nạp gộp ⇒ Y vẫn được phát]

#### Yêu cầu: Đổi default_app/brand chỉ nạp lại lát tenant/user
Đổi `default_app` của user/công ty (qua /me) và brand công ty bump `profile_version` + NOTIFY `profile_changed` (kèm tenant_id) cùng transaction; `config_version` không đổi. Hub nạp lại tenants + user đã cache của tenant bị chạm, không nạp catalog; memo `/pack/me` tenant khác giữ nguyên; poll `profile_version` là lưới an toàn khi mất NOTIFY.
- Kịch bản: khi NOTIFY `profile_changed` tenant A thì cache nạp lại tenants/user, không nạp catalog, version Admin giữ nguyên, phát tenants={A} [test: apps/hub-api/src/modules/config/config.profile.test.ts » profile_changed ⇒ chỉ nạp lát tenant/user, phát {A}]
- Kịch bản: khi mất NOTIFY mà `profile_version` đổi thì vòng poll nạp lát profile và phát cho mọi tenant [test: apps/hub-api/src/modules/config/config.profile.test.ts » poll thấy profile_version đổi ⇒ nạp lát profile]
- Kịch bản: khi member PUT /me/default-app thì `config_version` giữ nguyên, `profile_version` +1, NOTIFY `profile_changed` kèm tenant_id [test: apps/admin-api/src/modules/app-catalog/default-app-scope.int.test.ts » PUT /me/default-app bump profile_version, không bump config_version]
- Kịch bản: khi đổi brand công ty thì `profile_version` +1, `config_version` giữ nguyên [test: apps/hub-api/src/modules/config/profile-bump.int.test.ts » đổi brand bump profile_version, không bump config_version]
- Kịch bản: khi một user PUT /me/default-app quá 10 lần/phút thì 429 [test: apps/admin-api/src/modules/app-catalog/default-app-scope.int.test.ts » PUT /me/default-app quá hạn mức ⇒ 429]

#### Yêu cầu: Flow độc lập lọc theo tenant trước giới hạn
Danh sách flow độc lập của capabilities lọc `tenant_id = tenant hỏi hoặc null` trong SQL rồi mới `limit`.
- Kịch bản: khi tenant khác có > giới hạn flow độc lập thì flow của tenant hỏi vẫn có [test: apps/hub-api/src/modules/capabilities/capabilities.repo.int.test.ts » tenant khác > giới hạn ⇒ flow của tenant hỏi vẫn có]

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Trần tiền của form an toàn số nguyên
`FORM_MONEY_MAX` = 1e15 (≤ `Number.MAX_SAFE_INTEGER`).
- Kịch bản: khi trường money có max > 1e15 thì schema từ chối [test: packages/contracts/src/hub-admin/process-form-money.test.ts » FORM_MONEY_MAX an toàn số nguyên]

## Việc còn lại
- `PUT /admin/tenants/:id/default-app` còn bump `config_version` toàn cục (hiếm, platform admin).
