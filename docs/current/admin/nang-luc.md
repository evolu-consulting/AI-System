# Admin/Hub · năng lực người dùng và công ty (`/pack/me`, view năng lực)

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-capabilities, cr118-config-consistency, cr118-r1-fixes). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Ảnh năng lực của người dùng (`GET /pack/me`) (nguồn: cr118-capabilities)
Hub trả lát cắt quyền của user đang đăng nhập từ cache cấu hình: gói + mức + việc, add-on bật, flags phẳng, brand, trang chủ, danh sách app; có ETag theo cặp version cấu hình; 0 câu SQL khi cache nóng.
- Kịch bản: khi user nội bộ có vai editor gói thì `packs.<k>` = enabled, level write, actions [read, write] và flags `<k>`=true [test: tests/acceptance/CR118/capabilities.int.test.ts » lát cắt user: gói + mức + flags, beta (chéo tenant) không thấy gói của acme, đối tác 200 nhưng gói không mở cho đối tác ⇒ tắt]
- Kịch bản: khi đối tác gọi thì 200 nhưng gói không thuộc EXTERNAL_PACKS luôn tắt, add-on của gói đó tắt [test: apps/hub-api/src/modules/capabilities/capabilities.rules.test.ts » đối tác: chỉ gói mở cho đối tác, contracts luôn tắt + add-on contracts tắt, home = community]
- Kịch bản: khi gửi lại `If-None-Match` khớp thì 304, 0 câu SQL; cấu hình đổi thì ETag mới [test: tests/acceptance/CR118/capabilities.int.test.ts » ETag/304 + 0 SQL khi nóng, đổi cấu hình ⇒ ETag mới]

#### Yêu cầu: View năng lực theo công ty (`GET /hub-admin/tenants/:id/capabilities`) (nguồn: cr118-capabilities)
Chỉ đọc: thẻ app (mức, add-on, khe + flow gán, agent của app, tool) + Dùng chung (agent dùng chung, Dify chỉ đọc, flow độc lập, model mặc định) + Giới hạn. platform_admin mọi công ty; tenant_admin chỉ công ty mình; còn lại bị chặn.
- Kịch bản: khi platform admin/tenant admin của chính công ty gọi thì 200; tenant admin công ty khác, member, đối tác thì 403; không token 401; công ty lạ 404 [test: tests/acceptance/CR118/capabilities.int.test.ts » platform admin mọi tenant, tenant admin chỉ tenant mình, member/đối tác/không token bị chặn]
- Kịch bản: khi xem công ty khác nhau thì mỗi view chỉ chứa dữ liệu của công ty đó [test: tests/acceptance/CR118/capabilities.int.test.ts » chéo tenant: view acme có gói bật, beta thì tắt, tenant_id đúng tenant hỏi]
- Kịch bản: khi khe đã gán riêng thì thẻ app hiện flow gán, chưa gán thì mặc định; khe DLC không hiện [test: apps/hub-api/src/modules/capabilities/capabilities.rules.test.ts » thẻ app: mức tenant, add-on, khe (gán riêng thắng mặc định, bỏ khe DLC + tenant khác), agent + tool của app]
- Kịch bản: khi cache nóng thì 0 câu SQL; phần Hub nạp lại ≤ 3 câu [test: tests/acceptance/CR118/capabilities.int.test.ts » capabilities: ETag/304, 0 SQL khi nóng, ≤ 3 câu khi phần Hub nạp lại]

#### Yêu cầu: Báo cấu hình đổi qua `/me/stream` (nguồn: cr118-capabilities)
Cache cấu hình nạp xong với version mới ⇒ phiên `/me/stream` của công ty bị chạm nhận `event: config.changed` (data = versions, không id).
- Kịch bản: khi cấu hình công ty A đổi thì phiên của A nhận, phiên công ty B không nhận [test: tests/acceptance/CR118/capabilities.int.test.ts » cấu hình acme đổi ⇒ phiên acme nhận config.changed (kèm versions), phiên beta không nhận]

#### Yêu cầu: Ảnh năng lực của người dùng (`GET /pack/me`) (nguồn: cr118-config-consistency)
Brand công ty và `default_app` là cấu hình: đổi ⇒ `config_version` tăng trong cùng transaction ⇒ ETag mới và `config.changed` tới phiên của đúng công ty trong một vòng LISTEN (không TTL). `home` = `default_app` (user rồi công ty) nếu user đọc được gói đó, không thì theo quyền. Nóng vẫn 0 câu SQL.
- Kịch bản: khi đổi brand công ty A thì phiên A nhận `config.changed`, ETag + brand mới; công ty B không nhận, brand B giữ nguyên; nóng 0 SQL [test: tests/acceptance/CR118/config-consistency.int.test.ts » đổi brand acme ⇒ config.changed tới phiên acme, ETag + brand mới, beta không nhận, brand beta giữ nguyên, nóng 0 SQL]
- Kịch bản: khi đặt default_app công ty là gói user đọc được thì home = gói đó; app không phải gói thì home theo quyền; công ty khác không đổi [test: tests/acceptance/CR118/config-consistency.int.test.ts » đổi default_app công ty ⇒ home theo default_app khi user đọc được gói đó, app không phải gói ⇒ theo quyền, beta không đổi]
- Kịch bản: khi default_app user và công ty cùng đặt thì user thắng; đối tác không mở được gói ⇒ theo quyền [test: apps/hub-api/src/modules/capabilities/capabilities.rules.test.ts » home theo default_app (user trước công ty) khi user đọc được gói đó, app không phải gói/không đọc được ⇒ theo quyền]
- Kịch bản: khi cache báo tenant bị chạm thì chỉ brand tenant đó đọc lại; không rõ tenant thì đọc lại hết [test: apps/hub-api/src/modules/capabilities/capabilities.service.test.ts » nóng: không đọc lại, tenant bị chạm ⇒ đọc lại đúng tenant đó, null ⇒ đọc lại mọi tenant]

#### Yêu cầu: View năng lực theo công ty (`GET /hub-admin/tenants/:id/capabilities`) (nguồn: cr118-config-consistency)
Agent của app đọc từ `packs.pack_agents` (Hub chỉ có quyền SELECT bảng này) qua ảnh cấu hình Hub; nóng 0 câu SQL.
- Kịch bản: khi Hub ghi `packs.pack_agents` thì bị từ chối (chỉ đọc) [test: tests/acceptance/CR118/config-consistency.int.test.ts » hub_api: SELECT được, INSERT/UPDATE/DELETE bị chặn (42501)]
- Kịch bản: khi gói khai agent trong bảng thì thẻ app hiện agent đó, không còn ở Dùng chung; nóng 0 SQL [test: tests/acceptance/CR118/config-consistency.int.test.ts » agent của app đọc từ bảng (thẻ pkdemo có agent vừa khai, không còn ở Dùng chung), nóng 0 SQL]

#### Yêu cầu: Tenant bị chạm không bị rơi giữa hai lần nạp gộp (nguồn: cr118-r1-fixes)
Khi NOTIFY `config_changed`/`profile_changed` của tenant Y tới trong lúc lần nạp trước đang chạy (đã thấy version mới của Y), lần nạp kế vẫn phát `config.changed` cho Y dù version không đổi.
- Kịch bản: khi NOTIFY Y tới sau khi lần nạp 1 đã chụp danh sách {X} nhưng trước `readVersions` thì lần nạp 2 phát tenants={Y} [test: apps/hub-api/src/modules/config/config.race.test.ts » NOTIFY Y xen giữa hai lần nạp gộp ⇒ Y vẫn được phát]

#### Yêu cầu: Đổi default_app/brand chỉ nạp lại lát tenant/user (nguồn: cr118-r1-fixes)
Đổi `default_app` của user/công ty (qua /me) và brand công ty bump `profile_version` + NOTIFY `profile_changed` (kèm tenant_id) cùng transaction; `config_version` không đổi. Hub nạp lại tenants + user đã cache của tenant bị chạm, không nạp catalog; memo `/pack/me` tenant khác giữ nguyên; poll `profile_version` là lưới an toàn khi mất NOTIFY.
- Kịch bản: khi NOTIFY `profile_changed` tenant A thì cache nạp lại tenants/user, không nạp catalog, version Admin giữ nguyên, phát tenants={A} [test: apps/hub-api/src/modules/config/config.profile.test.ts » profile_changed ⇒ chỉ nạp lát tenant/user, phát {A}]
- Kịch bản: khi mất NOTIFY mà `profile_version` đổi thì vòng poll nạp lát profile và phát cho mọi tenant [test: apps/hub-api/src/modules/config/config.profile.test.ts » poll thấy profile_version đổi ⇒ nạp lát profile]
- Kịch bản: khi member PUT /me/default-app thì `config_version` giữ nguyên, `profile_version` +1, NOTIFY `profile_changed` kèm tenant_id [test: apps/admin-api/src/modules/app-catalog/default-app-scope.int.test.ts » PUT /me/default-app bump profile_version, không bump config_version]
- Kịch bản: khi đổi brand công ty thì `profile_version` +1, `config_version` giữ nguyên [test: apps/hub-api/src/modules/config/profile-bump.int.test.ts » đổi brand bump profile_version, không bump config_version]
- Kịch bản: khi một user PUT /me/default-app quá 10 lần/phút thì 429 [test: apps/admin-api/src/modules/app-catalog/default-app-scope.int.test.ts » PUT /me/default-app quá hạn mức ⇒ 429]

#### Yêu cầu: Flow độc lập lọc theo tenant trước giới hạn (nguồn: cr118-r1-fixes)
Danh sách flow độc lập của capabilities lọc `tenant_id = tenant hỏi hoặc null` trong SQL rồi mới `limit`.
- Kịch bản: khi tenant khác có > giới hạn flow độc lập thì flow của tenant hỏi vẫn có [test: apps/hub-api/src/modules/capabilities/capabilities.repo.int.test.ts » tenant khác > giới hạn ⇒ flow của tenant hỏi vẫn có]
