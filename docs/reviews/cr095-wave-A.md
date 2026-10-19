# CR-095 · Review cuối đợt + security, phần A: danh tính, cách ly, xác thực

- Nhánh `platform/gd0`, phạm vi `05ccd514..88f70a73` (54 commit). Chỉ đọc code; review gộp theo Luật 0b, lỗi trả về đúng lát.
- Lát: M1 + M1b (phòng ban, closure quản lý, RLS luật thấy, chế độ tenant|org, `/admin/org`, `/visibility`) · M2 (tool MCP đọc, `hub_tool_token` Dify) · L1 + L1b (giới hạn đăng nhập) · R1 (`knowledge.search_idf`, role `knowledge_api`/`knowledge_search`, allowlist KH) · N5 (`manager_email`) · I1 (importer mgmt-app).
- Test chạy trên evotest (`run-tests.ps1 -Step int -Ref HEAD`, 8 file: M1D/M1b visibility, M1b org-setup, L1 limit, M2 chat-token, R1 search-definer/federation/pool-role): **53 pass, 1 fail**. Test đỏ là test lỗi chứ không phải lỗ hổng (xem T-10). Log: `.data/evotest/20261020-061328-int`.

## Kết luận: **SAFE**

Không có đường đọc/ghi chéo tenant, leo thang quyền, vượt xác thực, dùng lại token hay SQL injection. Mức Chặn: 0 · Cao: 0 · Trung: 5 · Thấp: 16.

Các lỗi Trung đều nằm **trong một tenant**: luật thấy ở chế độ `org` bị hở, hoặc giới hạn đăng nhập yếu hơn thiết kế. Nên sửa trước khi mở chế độ `org` cho khách đã chuyển từ mgmt-app.

## Phát hiện

| # | Mức | Lát | Vị trí | Vấn đề | Sửa |
|---|---|---|---|---|---|
| A-1 | Trung | M1b | `apps/hub-api/src/modules/packs/contracts/cks/adapters/cks-read.repo.ts:167-185`, `cks/application/read.usecase.ts:66-69`, `cks/adapters/cks.routes.ts:95`; bảng `contracts.cks_signed_docs` (`migrations-pack-contracts/0004_cks.sql`) | `GET /cks/signed-docs?customer_id=` trả số, tiêu đề, loại và ngày ký văn bản của **mọi** khách trong tenant. `cks_signed_docs` không có policy RESTRICTIVE của M1/M1b, và use case không kiểm khách có thấy được không (khác `followups`, có gọi `customerExists`). Ở chế độ `org`, user thường đọc được văn bản ký của khách thuộc HĐ mình không thấy. Cần biết uuid của khách nên khó khai thác, nhưng vẫn là lỗ luật thấy. | Thêm `cks_signed_docs_visible` AS RESTRICTIVE FOR SELECT: `sees_all()` OR EXISTS khách (`cks_customers`, RLS áp bên trong) OR EXISTS chữ ký (`cks_certificates`). Thêm cả `if (!customerExists) not_found` trong use case. Rà luôn các bảng con chưa có policy luật thấy: `contract_reminders`, `cks_followups`, `partner_event_voids` (hiện chỉ lọc theo user/khoá ở tầng app). Test RLS: u5 không thấy văn bản ký của khách u3. |
| A-2 | Trung | M1b | `packages/db/migrations-pack-contracts/0010_m1b_visibility.sql:90-97, 122-137` | Khoá bên giả được. `visible_party_keys()` lấy `buyer_/supplier_tax_id` từ trường của **mọi** HĐ người gọi thấy, kể cả HĐ nháp do chính họ tạo. Editor tạo một HĐ với MST của đối tác bất kỳ là thấy `cks_customers` và cả sổ `partner_events` (công nợ, thanh toán) của đối tác đó trên HĐ người khác. | Chỉ lấy khoá bên từ HĐ đã duyệt hoặc đã giao (ví dụ `owner_user_id IS NOT NULL` và trạng thái `approved`), hoặc lọc `partner_events` theo `contract_id` thấy được thay vì `party_key`. Nếu mgmt-app cũng cố ý như vậy (access.View.company) thì ghi quyết định vào `docs/specs/M1b-visibility/tasks.md` kèm test khẳng định. |
| A-3 | Trung | L1 | `apps/admin-api/src/modules/auth/limit/limit.redis.ts:25-33` (PRE), `auth/auth.service.ts:98-119` | TOCTOU khi khoá tài khoản. PRE chỉ kiểm khoá đã có, chưa đếm lượt đang chạy. Một đợt song song từ nhiều IP (mỗi IP ≤ 30) qua PRE trước khi lần sai thứ 5 ghi khoá, nên một chu kỳ khoá cho tới khoảng `hashSlots + 100` (hàng đợi semaphore) lần đoán thay vì 5. | Giữ chỗ lượt ngay trong PRE: `HINCRBY f_pending`, từ chối khi `f + pending ≥ accountMaxFails`, rồi FAIL/SUCCESS trừ `pending` (cùng script Lua). Hoặc tính lượt sai ngay ở PRE và hoàn lại khi đúng. Test int: 20 request song song sai mật khẩu thì tối đa 5 lần chạy verify. |
| A-4 | Trung | I1 | `apps/admin-api/src/modules/mgmt-import/adapters/identity.adapter.ts:37-46`, `mgmt-import/application/import.usecase.ts:78` | Importer ghi HĐ, tri thức và `legacy_records` vào cả tenant mà N5 cố ý bỏ qua: tenant đã tắt (`active=false`) hoặc đã thu hồi gói (`import.rules.ts:113-114`). Vẫn đúng tenant, nhưng chạy lại thì hoàn tác việc admin đã thu hồi (trái L2). | Trong `tenants()` thêm `and t.active` và `not exists` entitlement đã thu hồi (như `identity-import/adapters/import.repo.ts:45-49`). Tốt hơn: lấy `tenantOf` từ báo cáo N5 (reused/created). Test int: tenant tắt hoặc đã thu hồi nhận 0 hàng. |
| A-5 | Trung | M2 | `apps/hub-api/src/modules/dify/agent/dify-agent-runner.ts:140-153` | Mỗi lượt chat cấp token mới qua `inputs`, nhưng app chat của Dify thường giữ `inputs` của lượt đầu khi có `conversation_id`. Từ lượt 2, Dify có thể gọi `/mcp` bằng token đã thu hồi, nên nhận 401 và tool hỏng. Đây là lỗi chức năng, không lộ dữ liệu (đóng an toàn). Chưa kiểm trên bản Dify đang chạy. | Thêm test int 2 lượt `dify-agent` gọi tool ở lượt 2. Nếu đúng như trên thì truyền token qua conversation variable hoặc header của tool provider, hoặc mở hội thoại mới cho mỗi token. |
| A-6 | Thấp | L1 | `apps/admin-api/src/lib/client-ip.ts:18` | Khi XFF có ít phần tử hơn `hops`, `Math.max(0, …)` lấy phần tử trái nhất, tức phần do client tự ghi. Đặt `TRUST_PROXY_HOPS` cao hơn số proxy thật là giả được IP để né trần IP. | `if (parts.length < hops) return null` (rơi vào xô `unknown`). Có thể gộp IPv6 theo /64 trong `ipId` (`limit.rules.ts:83-86`) để không xoay địa chỉ IPv6 né trần. Test unit cho cả hai. |
| A-7 | Thấp | L1 | `limit.redis.ts:35-54` | Ai cũng khoá được tài khoản bất kỳ (5 lần sai, backoff tới 4 giờ, đúng mật khẩu vẫn 423). Đây là đánh đổi đã biết. | Ghi rõ trong spec/runbook. Cân nhắc cho admin gỡ khoá hàng loạt, hoặc không tăng bậc backoff khi lượt sai đến từ IP đã bị 429. |
| A-8 | Thấp | M1b | `0010_m1b_visibility.sql:31-42` | Trigger lan phụ lục xoá tạm `app.user_id` trong lệnh UPDATE lồng. Mọi trigger khác chạy trong lệnh đó thấy ngữ cảnh "việc nền" (`sees_all()` đúng, người ghi rỗng). Hiện chưa có trigger nào như vậy, nhưng đây là bẫy cho lát sau. | Dùng GUC riêng (ví dụ `app.vis_cascade = '1'`) và cho `sees_all()` nhận cờ đó chỉ trên `contracts.contracts`, hoặc viết hàm cascade SECURITY DEFINER chỉ cập nhật cột `visibility_owner_id`. |
| A-9 | Thấp | M1 | `0009_m1_visibility.sql:15-17` | `contracts_rw` (mọi editor ở tầng DB) INSERT/UPDATE được `visibility_settings`. Chỉ `packGuard(..., "admin")` ở route chặn. | Thêm policy WITH CHECK `contracts.org_is_owner()` cho INSERT/UPDATE của `contracts_rw` (vẫn để role chủ migration và importer ghi). |
| A-10 | Thấp | M1 | `apps/admin-api/src/modules/org/org.service.ts:88-96`, `:133-142` | Audit đổi quản lý và trưởng phòng ghi `before: null`, không biết quản lý cũ là ai. | Đọc `manager_id` / `head_user_id` cũ trong cùng tx (`FOR UPDATE`) rồi ghi vào `summary.before`. |
| A-11 | Thấp | M1 | `packages/db/migrations/0014_m1_org.sql:81-85` | Policy `hub_ro` `USING (true)` trên `user_managers` / `user_reports` / `departments` cho hub đọc cơ cấu của mọi tenant. Khớp mẫu sẵn có (`users_hub_ro`, `groups_hub_ro`), nên chỉ ghi nhận. | Giữ nguyên. Khi rà mẫu `hub_ro` chung, lọc theo `app.tenant_id` nếu được. |
| A-12 | Thấp | N5 | `apps/admin-api/src/modules/identity-import/adapters/import.repo.ts:58-59` | Tenant do N5 tạo không có `settings.visibility = 'org'` (khác `createTenant`). Chỉ chạy N5 thì tenant từ mgmt-app ở chế độ `tenant` (thấy hết) tới khi I1 ghi `visibility_settings`. | Thêm `'visibility', 'org'` vào `jsonb_build_object`. Test org-setup cho đường N5. |
| A-13 | Thấp | N5 | `identity-import/application/managers.phase.ts:27, 41`; `adapters/import.mapper.ts:48` | `manager_email` không kiểm định dạng email, nên `#<uuid>` (khoá nội bộ của user không có email) đặt được quản lý cho user đó. Vẫn trong cùng tenant. | Bỏ dòng khi `!validEmail(m)` hoặc email của user không hợp lệ. Bỏ user không có email khỏi `known` (vẫn giữ trong `parent` để kiểm vòng). |
| A-14 | Thấp | N5 | `identity-import/domain/managers.rules.ts:21, 28` | Đặt quản lý cho cả user có sẵn mà lượt này không tạo, kể cả dòng USER_CONFLICT. Chỉ áp khi user chưa có quản lý. | Giới hạn theo email mà pha user báo là created/reused, hoặc ghi quyết định vào spec. |
| A-15 | Thấp | I1 | `mgmt-import/application/import.usecase.ts:99` | `fallbackUser = owner ?? o.actorId` ghi id platform_admin (tenant khác) vào `created_by` / `started_by` của dữ liệu khách. | Để null khi cột cho phép, hoặc ghi rõ trong `tasks.md`. |
| A-16 | Thấp | I1 | `mgmt-import/adapters/target.sql.ts:208` | Nhập void nối `partner_events` chỉ theo `data->>'mgmt_id'`, không theo `mgmt_source` (đường chèn ở dòng 200 có kiểm). Có thể khớp nhầm sự kiện của nguồn khác trong cùng tenant. | Thêm `and e.data->>'mgmt_source' = x.source`. |
| A-17 | Thấp | I1, N5 | `mgmt-import.cli.ts:37`, `identity-import.cli.ts:40`, `identity-import/adapters/import.repo.ts:21-23` | `--actor` chỉ cần là một platform_admin đang hoạt động; quyền thật nằm ở credential DB. Audit chỉ đáng tin bằng người vận hành. | Ghi vào runbook. Tuỳ chọn: so `--actor` với operator đã cấu hình. |
| A-18 | Thấp | M2 | `apps/hub-api/src/modules/mcp/chat-token.ts:55-56, 96-101` | TTL tối đa 900 s, nên agent có `timeout_s` lớn hơn bị mất tool giữa chừng. Process hub chết giữa run thì `finally` không thu hồi, token sống tới 15 phút (vẫn chỉ đọc, cùng user và tenant). | `resolve` kiểm run còn `running` (một câu theo PK), hoặc lấy TTL theo hạn run và chặn `timeout_s > 900` cho agent Dify có `pack_tools`. |
| A-19 | Thấp | M2 | `apps/hub-api/src/modules/studio/agents/agents.service.ts:126-130` | `runtime_options.pack_tools` lưu nguyên, không kiểm. Chỉ platform_admin ghi được, và `/mcp` vẫn kiểm lại theo registry, `canUse` và RLS, nên không leo thang được, chỉ tạo cấu hình rác. | Kiểm bằng `packToolKeys` + `registry.has` khi lưu. |
| A-20 | Thấp | R1 | `apps/hub-api/src/modules/knowledge/adapters/kh.source.ts:3, 24-26, 50-54`; `config/env.ts` | Nguồn federation tự lấy origin của `KNOWLEDGE_KH_URL` làm allowlist, nên `HUB_KH_ALLOWED_ORIGINS` không áp. `KNOWLEDGE_KH_*` không nằm trong schema zod. Comment "chỉ đọc lúc gọi" sai (key được giữ trong closure từ lúc khởi động). | Đưa `KNOWLEDGE_KH_*` vào `env.ts`. Ở production bắt origin nằm trong `HUB_KH_ALLOWED_ORIGINS`. Sửa comment. |
| A-21 | Thấp | R1 | `kh.source.ts:29-30, 61-63` | `KNOWLEDGE_KH_TENANTS=*` mở một project KH dùng chung cho mọi tenant: câu hỏi của mọi tenant đi tới KH, và mọi tenant đọc cùng một kho. | Từ chối `*` khi `APP_ENV=production`, hoặc cảnh báo lúc khởi động + ADR ghi quyết định. |

### Test đỏ (không phải lỗ hổng)

- **T-10 · L1 · test chập chờn.** `apps/admin-api/src/modules/auth/limit/limit.int.test.ts:117` sắp xếp `audit_log` theo `order by id`, mà `id` là `gen_random_uuid()`. Thứ tự giữa `login_lockout` và `login_lockout_clear` vì thế ngẫu nhiên, khoảng 50% đỏ (đỏ ở lượt này, test dòng 267).
- **Sửa (qc, tệp khoá):** dùng `order by seq` (cột identity của `audit_log`).

## Đã kiểm, ổn

- **M1, closure quản lý.**
  - Trigger SECURITY DEFINER có `search_path` cố định, REVOKE PUBLIC.
  - Khoá advisory theo tenant tuần tự hoá việc đổi chuỗi quản lý, nên không lọt vòng khi ghi đồng thời.
  - FK kép `(tenant_id, id)` chặn quản lý chéo tenant; `admin_rw` không ghi được closure.
- **M1, luật thấy.**
  - `org_owner_ids` / `org_is_owner` / `org_default_mode` không nhận tham số và chỉ đọc theo GUC của tx. `sees_all` là INVOKER.
  - Policy RESTRICTIVE nên AND với policy tenant.
  - Phụ lục: cột `visibility_owner_id` do trigger tính lại dưới RLS của người ghi, nên không giả được và không lộ owner (test M1b xanh).
- **`/admin/org` và `/visibility`.**
  - `/admin/org`: `requireRole(platform_admin, tenant_admin)`, rồi `resolveTenantScope`; user và quản lý phải thuộc tenant `t`.
  - `/visibility`: PUT cần `packGuard admin`, GET cần `read`.
  - SQL tham số hoá hết.
- **`app.user_id` rỗng.** `sees_all()` đúng khi `app.user_id` rỗng, nhưng `withPackScope(userId: null)` chỉ đi qua `PackSystemUow`, và chỉ vòng nền dùng nó (`packTenantOnly` chặn route). `sourcing.usecase` dùng system tx nhưng lọc theo `visibleIds()` của tx người dùng.
- **L1, thứ tự và đóng an toàn.**
  - IP và khoá được kiểm trước mọi phép băm.
  - Tài khoản lạ và tài khoản có thật cho cùng status, body và `until`; timing cùng lớp (test xanh, median 48.7 / 38.6 ms).
  - Redis lỗi thì 503 AUTH_UNAVAILABLE, và production thiếu `REDIS_URL` thì không khởi động.
- **L1, khoá và XFF.**
  - Khoá tài khoản là sha256 của `(tenant_key, username)` đã chuẩn hoá (khớp CHECK chữ thường của DB).
  - Admin gỡ khoá xoá cả Redis lẫn DB và ghi audit.
  - Semaphore trao slot trực tiếp, hàng đợi có trần.
  - XFF chỉ tin khi `TRUST_PROXY_HOPS > 0` và lấy phần tử thứ `hops` tính từ phải.
- **M2, tool chạy theo quyền người gọi.**
  - Tool chạy qua `withPackScope` (`contracts_rw` + tenant/user lấy từ claim server), nên RLS và luật thấy M1 áp đủ.
- **M2, token.**
  - 256 bit, Redis chỉ giữ sha256, `exp` được kiểm lại.
  - Chỉ đọc được lọc ba lớp: lúc cấp, lúc resolve và `usable`. KH và catalog workflow bị từ chối.
  - Bị thu hồi trong `finally`; chỉ `/mcp` nhận token; không ghi log token.
- **R1, `search_idf`.**
  - Hàm có `search_path` cố định, owner `knowledge_search` (NOLOGIN, NOBYPASSRLS, chỉ SELECT 3 bảng).
  - EXECUTE chỉ cấp cho `knowledge_rw`.
  - Tenant lấy từ GUC (NULL thì 42501).
  - SQL động là văn bản cố định chạy `EXECUTE … USING`; `enable_seqscan` chỉ có hiệu lực trong hàm.
- **R1, role và đồ thị.**
  - `knowledge_api` NOINHERIT, chỉ được `SET` sang `knowledge_rw`.
  - Allowlist KH đóng an toàn (rỗng thì không tenant nào).
  - Bảng đồ thị có RLS FORCE + FK kép.
- **N5 và I1, đường chạy.**
  - Chỉ có CLI, không route nào, và actor phải là platform_admin.
  - `hub_api` NOBYPASSRLS chuyển sang `<pack>_rw` theo lô.
  - SQL dùng `jsonb_to_recordset` + `sql.identifier` cố định, không ghép chuỗi.
- **N5 và I1, dữ liệu.**
  - uuid v5 trùng chéo tenant thì `DO NOTHING` (không ghi sang tenant khác; reconcile phát hiện).
  - Hash scrypt cũ được kiểm bằng regex và không vào audit/log.
  - `legacy_records` có ENABLE + FORCE RLS, không có UPDATE/DELETE.
