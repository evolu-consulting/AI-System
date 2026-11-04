---
id: cr118-capabilities
lát: cr118-capabilities
cr: CR-118
làn: đầy đủ (quyền + đường nóng có ngưỡng perf)
migration: không
phụ thuộc:
---
## Plan (ngắn)
Read-model năng lực trong hub-api từ ConfigCache (intake CR-118 PHẦN A §FeatureGate + PHẦN D; câu 22–26 mặc định):
1. `GET /pack/me` — lát cắt (tenant, user): gói + mức + actions, add-on, flags phẳng (OpenFeature), brand, home, apps.
2. `GET /hub-admin/tenants/:id/capabilities` — thẻ app (mức, add-on, khe + flow gán, agent của app, tool) + Dùng chung
   (agent không thuộc gói, Dify chỉ đọc + agent dùng, flow độc lập, model mặc định) + Giới hạn.
3. N3 — ConfigCache nạp xong & version đổi ⇒ `event: config.changed` tới phiên `/me/stream` của tenant bị chạm.

## Làm
- [x] contract `packages/contracts/src/capabilities.ts` (ShellMeResponseSchema, TenantCapabilitiesResponseSchema, ME_STREAM_CONFIG_CHANGED)
- [x] `modules/capabilities/` rules (thuần) · repo (2 câu: khe + flow độc lập, scope system) · service (memo theo tem) · routes · mount · config-push
- [x] ConfigCache `versions()` + `onChange()` (tenant theo `tenant_id` NOTIFY) · MeStreamConns `broadcast()` + session `notify()`
- [x] tường lửa đối tác: mở đúng `/pack/me`; PackToolRegistry `listByPack`
- [x] test: unit rules / config-push / ConfigCache.onChange; int `tests/acceptance/CR118/capabilities.int.test.ts`; perf `tests/acceptance/CR118/perf/capabilities.perf.int.test.ts`

## Không làm / Chạm
- Không migration, không bảng mới. Không đụng DLC (gói `dlc`, khe `dlc.*` bị loại khỏi view). Không sửa admin-api workflows/commands (Dify chỉ đọc từ catalog cache).
- Chạm: `app.ts` (gọi mountCapabilities trước mountProtected, truyền meConns), `app.deps.ts`, `app.x2a.ts`, `packs.mount.ts` (re-export), `packs/contracts/shell.mount.ts` (mới).

## Test tối thiểu
- unit: `apps/hub-api/src/modules/capabilities/*.test.ts`, `apps/hub-api/src/modules/config/config.onchange.test.ts`
- int (evotest -Filter): `tests/acceptance/CR118/capabilities.int.test.ts`
- perf (evotest -Step perf -Filter): `tests/acceptance/CR118/perf/capabilities.perf.int.test.ts`

## Quyết định trong lúc làm
- Gói = có đủ feature `<k>-read|write|admin` trong catalog (0 SQL); bỏ `dlc`. Add-on = feature tiền tố `<k>-`/`<k>.` trừ 3 mức, bật theo tenant (`tenantFeatureOn`) và chỉ khi user đọc được gói.
- ETag = `"a<config_version>.h<hub_config_version>.<fnv1a(thân)>"` — băm thân thay cho "hash user/role" để nguồn không bump version (brand) vẫn đổi ETag; thân nhớ theo tem (version + brand + role + kind) ⇒ 304 không dựng lại.
- Brand (`contracts.company_settings`) không bump version ⇒ cache TTL 60 s/tenant (1 câu khi hết hạn). `default_app` của admin-api không bump version ⇒ `home` theo quyền (contracts → community), chưa theo default_app.
- Khe ghi qua `withConfigWrite` (bump hub_config_version) ⇒ khe + flow độc lập cache theo version Hub, 2 câu cố định khi nạp lại.
- Agent của app: hub_api chưa có SELECT `packs.pack_agents` ⇒ hằng `PACK_AGENTS` (contracts: assistant, price-scout) ở `packs/contracts/shell.mount.ts`.
- `/pack/me` và `/hub-admin/*`: module tự gắn `requireAuth` + `externalFirewall` (mount trước `mountProtected`) để `app.ts` ≤ 400 dòng; 401 trước 404 giữ nguyên.
- tenant_admin tenant khác ⇒ 403 FORBIDDEN; tenant không có trong cache / id sai dạng ⇒ 404. Đối tác bị tường lửa chặn `/hub-admin` (403); `/pack/me` mở nhưng chỉ gói `EXTERNAL_PACKS`.
- N3: đẩy trực tiếp tới phiên trên instance (mỗi instance tự LISTEN), không XADD Redis, không id SSE ⇒ không chiếm `Last-Event-ID`; gộp trong một microtask; trần 50.000 phiên/lần.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-04 (đợt cr118-r1)

### ADDED docs/current/admin/nang-luc.md
#### Yêu cầu: Ảnh năng lực của người dùng (`GET /pack/me`)
Hub trả lát cắt quyền của user đang đăng nhập từ cache cấu hình: gói + mức + việc, add-on bật, flags phẳng, brand, trang chủ, danh sách app; có ETag theo cặp version cấu hình; 0 câu SQL khi cache nóng.
- Kịch bản: khi user nội bộ có vai editor gói thì `packs.<k>` = enabled, level write, actions [read, write] và flags `<k>`=true [test: tests/acceptance/CR118/capabilities.int.test.ts » lát cắt user: gói + mức + flags, beta (chéo tenant) không thấy gói của acme, đối tác 200 nhưng gói không mở cho đối tác ⇒ tắt]
- Kịch bản: khi đối tác gọi thì 200 nhưng gói không thuộc EXTERNAL_PACKS luôn tắt, add-on của gói đó tắt [test: apps/hub-api/src/modules/capabilities/capabilities.rules.test.ts » đối tác: chỉ gói mở cho đối tác, contracts luôn tắt + add-on contracts tắt, home = community]
- Kịch bản: khi gửi lại `If-None-Match` khớp thì 304, 0 câu SQL; cấu hình đổi thì ETag mới [test: tests/acceptance/CR118/capabilities.int.test.ts » ETag/304 + 0 SQL khi nóng, đổi cấu hình ⇒ ETag mới]

#### Yêu cầu: View năng lực theo công ty (`GET /hub-admin/tenants/:id/capabilities`)
Chỉ đọc: thẻ app (mức, add-on, khe + flow gán, agent của app, tool) + Dùng chung (agent dùng chung, Dify chỉ đọc, flow độc lập, model mặc định) + Giới hạn. platform_admin mọi công ty; tenant_admin chỉ công ty mình; còn lại bị chặn.
- Kịch bản: khi platform admin/tenant admin của chính công ty gọi thì 200; tenant admin công ty khác, member, đối tác thì 403; không token 401; công ty lạ 404 [test: tests/acceptance/CR118/capabilities.int.test.ts » platform admin mọi tenant, tenant admin chỉ tenant mình, member/đối tác/không token bị chặn]
- Kịch bản: khi xem công ty khác nhau thì mỗi view chỉ chứa dữ liệu của công ty đó [test: tests/acceptance/CR118/capabilities.int.test.ts » chéo tenant: view acme có gói bật, beta thì tắt, tenant_id đúng tenant hỏi]
- Kịch bản: khi khe đã gán riêng thì thẻ app hiện flow gán, chưa gán thì mặc định; khe DLC không hiện [test: apps/hub-api/src/modules/capabilities/capabilities.rules.test.ts » thẻ app: mức tenant, add-on, khe (gán riêng thắng mặc định, bỏ khe DLC + tenant khác), agent + tool của app]
- Kịch bản: khi cache nóng thì 0 câu SQL; phần Hub nạp lại ≤ 3 câu [test: tests/acceptance/CR118/capabilities.int.test.ts » capabilities: ETag/304, 0 SQL khi nóng, ≤ 3 câu khi phần Hub nạp lại]

#### Yêu cầu: Báo cấu hình đổi qua `/me/stream`
Cache cấu hình nạp xong với version mới ⇒ phiên `/me/stream` của công ty bị chạm nhận `event: config.changed` (data = versions, không id).
- Kịch bản: khi cấu hình công ty A đổi thì phiên của A nhận, phiên công ty B không nhận [test: tests/acceptance/CR118/capabilities.int.test.ts » cấu hình acme đổi ⇒ phiên acme nhận config.changed (kèm versions), phiên beta không nhận]

## Việc còn lại
- Migration GRANT SELECT `packs.pack_agents` cho hub_api ⇒ thay hằng `PACK_AGENTS` (lát có số migration packs).
- admin-api `default_app.set` + brand công ty nên bump `config_version` ⇒ `home` theo default_app, bỏ TTL brand.
- Web (lát FeatureGate): provider OpenFeature đọc `/pack/me`, nghe `config.changed`.
- qc ghi lock cho `tests/acceptance/CR118/**`.
