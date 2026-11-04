---
id: cr118-config-consistency
lát: cr118-config-consistency
cr: CR-118
làn: đầy đủ (GRANT + version cấu hình + trigger SECURITY DEFINER)
migration: packs 0009 · admin 0033 · pack-contracts 0072
phụ thuộc: cr118-capabilities (đã gộp)
---
## Plan (ngắn)
Đóng 2 việc còn lại của `docs/specs/cr118-capabilities/tasks.md`:
1. hub_api chỉ SELECT `packs.pack_agents` ⇒ ConfigCache nạp bảng trong ảnh Hub (cùng tx REPEATABLE READ) ⇒ capabilities dùng `snap.packAgents`; bỏ hằng `PACK_AGENTS`. Nóng vẫn 0 SQL.
2. Brand công ty + `default_app` (user/công ty) bump `admin.config_meta.config_version` CÙNG transaction ghi + NOTIFY `config_changed` kèm `tenant_id` ⇒ ConfigCache nạp lại phần Admin ⇒ ETag `/pack/me` đổi + `config.changed` tới đúng tenant. Bỏ TTL 60 s của brand (nhớ tới khi `onChange` báo tenant bị chạm). `home` theo default_app khi user đọc được gói đó, không thì theo quyền.

## Làm
- [x] migration packs `0009_hub_reads_pack_agents` (GRANT SELECT đúng một bảng cho hub_api)
- [x] migration admin `0033_hub_reads_user_default_app` (GRANT SELECT cột `default_app` của `admin.users` cho hub_ro)
- [x] migration pack-contracts `0072_brand_bumps_config` (trigger AFTER INSERT/UPDATE trên `contracts.company_settings`, chỉ khi 4 cột brand đổi)
- [x] hub-api: `config.repo` (packAgents, defaultApp tenant/user), `config.rules` (kiểu), `capabilities.service` (brand theo onChange, default_app), `capabilities.rules` (`homeOf`), mount bỏ `PACK_AGENTS`
- [x] admin-api: `PUT /me/default-app`, `PUT /me/tenant-default-app`, `PUT /admin/tenants/:id/default-app` qua `withConfigWrite` + `publishConfigChanged`
- [x] test: unit `capabilities.rules.test.ts` (home), `capabilities.service.test.ts` (brand không TTL); int `tests/acceptance/CR118/config-consistency.int.test.ts`

## Không làm / Chạm
- Không đổi contract `/pack/me` (không thêm trường). Không đụng DLC. Không đổi `packs.grant_agents`.
- Chạm: `apps/hub-api/src/modules/{config,capabilities,packs/packs.mount.ts,packs/contracts/shell.mount.ts}`, `apps/admin-api/src/modules/app-catalog/{portal,tenant-default-app}.service.ts`.

## Test tối thiểu
- unit: `apps/hub-api/src/modules/capabilities/*.test.ts`
- int (evotest -Filter): `tests/acceptance/CR118/config-consistency.int.test.ts` (+ chạy lại `capabilities.int.test.ts`, `app-catalog/{portal,tenant-default-app}.int.test.ts`)

## Quyết định trong lúc làm
- Số migration: `packs` sở hữu `packs.pack_agents` ⇒ 0009 ở `migrations-packs` (thư mục không có số giữ trước; kế tiếp là 0009). Brand ở `contracts.company_settings` ⇒ trigger phải ở `migrations-pack-contracts` (0072, kế 0071). Admin dùng 0033 đã giữ. `when` = 1801230000000 (> max mọi journal).
- Brand bump **admin** `config_version` (không phải `hub_config_version`): NOTIFY `config_changed` có `tenant_id` ⇒ ConfigCache chỉ báo `config.changed` cho tenant bị chạm (Hub NOTIFY không có tenant ⇒ mọi tenant). Ghi brand ở hub-api (gói contracts, role `contracts_rw`) ⇒ dùng trigger SECURITY DEFINER thay vì code: phủ mọi đường ghi, cùng transaction, không cấp `contracts_rw` gì trên `admin`.
- Khoá: trigger AFTER khoá `admin.config_meta` sau ghi hàng (cùng thứ hạng "câu cuối" như `bumpConfigVersion`) ⇒ không vòng chờ với ghi Admin (không ghi Admin nào chạm `company_settings`).
- `default_app`: user trước công ty, chỉ khi user ĐỌC được gói đó (khoá app không phải gói, vd `chat`/`admin` ⇒ theo quyền). Ghi không đổi giá trị ⇒ không bump.
- Agent của gói từ bảng: `contracts` chỉ còn `assistant` (bảng không có `price-scout` — agent gói gọi theo khoá, không phải trợ lý cấp khi bật gói); không thêm hàng để khỏi đổi hành vi `packs.grant_agents`.
- Bảng `pack_agents` đổi qua migration gói không bump version Hub ⇒ thấy ở lần nạp ảnh Hub kế (mọi bump Hub, gồm `packs.grant_agents`).
- Brand đọc lỗi ⇒ không nhớ (thử lại lần sau); đọc xen với invalidation (epoch) ⇒ không nhớ bản có thể cũ.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-04 (đợt cr118-r1)

### MODIFIED admin/ung-dung-quyen.md
#### Yêu cầu: Ảnh năng lực của người dùng (`GET /pack/me`)
Brand công ty và `default_app` là cấu hình: đổi ⇒ `config_version` tăng trong cùng transaction ⇒ ETag mới và `config.changed` tới phiên của đúng công ty trong một vòng LISTEN (không TTL). `home` = `default_app` (user rồi công ty) nếu user đọc được gói đó, không thì theo quyền. Nóng vẫn 0 câu SQL.
- Kịch bản: khi đổi brand công ty A thì phiên A nhận `config.changed`, ETag + brand mới; công ty B không nhận, brand B giữ nguyên; nóng 0 SQL [test: tests/acceptance/CR118/config-consistency.int.test.ts » đổi brand acme ⇒ config.changed tới phiên acme, ETag + brand mới, beta không nhận, brand beta giữ nguyên, nóng 0 SQL]
- Kịch bản: khi đặt default_app công ty là gói user đọc được thì home = gói đó; app không phải gói thì home theo quyền; công ty khác không đổi [test: tests/acceptance/CR118/config-consistency.int.test.ts » đổi default_app công ty ⇒ home theo default_app khi user đọc được gói đó, app không phải gói ⇒ theo quyền, beta không đổi]
- Kịch bản: khi default_app user và công ty cùng đặt thì user thắng; đối tác không mở được gói ⇒ theo quyền [test: apps/hub-api/src/modules/capabilities/capabilities.rules.test.ts » home theo default_app (user trước công ty) khi user đọc được gói đó, app không phải gói/không đọc được ⇒ theo quyền]
- Kịch bản: khi cache báo tenant bị chạm thì chỉ brand tenant đó đọc lại; không rõ tenant thì đọc lại hết [test: apps/hub-api/src/modules/capabilities/capabilities.service.test.ts » nóng: không đọc lại, tenant bị chạm ⇒ đọc lại đúng tenant đó, null ⇒ đọc lại mọi tenant]

#### Yêu cầu: View năng lực theo công ty (`GET /hub-admin/tenants/:id/capabilities`)
Agent của app đọc từ `packs.pack_agents` (Hub chỉ có quyền SELECT bảng này) qua ảnh cấu hình Hub; nóng 0 câu SQL.
- Kịch bản: khi Hub ghi `packs.pack_agents` thì bị từ chối (chỉ đọc) [test: tests/acceptance/CR118/config-consistency.int.test.ts » hub_api: SELECT được, INSERT/UPDATE/DELETE bị chặn (42501)]
- Kịch bản: khi gói khai agent trong bảng thì thẻ app hiện agent đó, không còn ở Dùng chung; nóng 0 SQL [test: tests/acceptance/CR118/config-consistency.int.test.ts » agent của app đọc từ bảng (thẻ pkdemo có agent vừa khai, không còn ở Dùng chung), nóng 0 SQL]

## Việc còn lại
- qc ghi lock cho `tests/acceptance/CR118/config-consistency.int.test.ts`.
- Delta trỏ `admin/ung-dung-quyen.md` vì `admin/nang-luc.md` (ADDED bởi cr118-capabilities) chưa gộp vào docs/current; docs-architect gộp hai yêu cầu này vào `nang-luc.md` cuối đợt (bỏ câu "brand TTL 60 s", "home chưa theo default_app").
