---
id: cr125-seed
lát: cr125-seed
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Yêu cầu người dùng 2026-11-08: seed/onboard phải khớp mọi thứ đã ship ở CR-122..125 để môi trường staging mới chạy từ đầu đến cuối, không công tắc tay (rule D7).

**Seed/onboard hiện có** (chỉ ghi nhận, không đổi): `apps/hub-api/src/modules/seed` (`hub:seed` + `hub:seed:fixtures`: locale vi, Group Kế toán/Pháp chế, owner/editor ∈ Group gói, brand, URL catalog dev, quy trình mẫu CR-113 cho evolu) · `deploy/stg-sohoptac2/stg-seed.ts` (tenant demo + gói contracts/community + đối tác + bài mẫu + flow Community) · `tools/scripts/src/seed-community-demo*.ts` · `apps/admin-api/src/modules/tenant-onboard` (production, yaml `deploy/tenants/*.yaml`) · `seed-niti` (DLC/khách thật, không đụng).

**Thiếu so với CR-122..125** (trước lát này): cờ `flow_triggers` không được bật cho công ty có `company_flows` (flow_flag cảnh báo); feature `contracts-partner-confirm` và các feature app khác chưa cấp; "Ký thử" chưa bật cho công ty; mẫu Thư viện duyệt HĐ (CR-122 B) chỉ có khi chạy tay `seed-flow-templates`; công ty không có flow duyệt HĐ mặc định / nhận HĐ đối tác; nhóm duyệt mà mẫu trỏ tới (truong-phong, giam-doc, phong-kinh-doanh) không có.

## Làm
- `seed.cr125-config.ts` (mở rộng `writeTenantFixtures`, không seed song song; MỘT câu SQL theo tập mỗi bước, idempotent):
  1. cấp mọi feature (không `off`) của app contracts/community cho công ty đã có `<app>-read` (gồm `contracts-partner-confirm`; trừ `han-muc-duyet`, `contracts-approval-engine`);
  2. "Ký thử": `approval_settings.esign_enabled` + `esign_default_provider='selfsign'` (KHÔNG secret DocuSign);
  3. nhóm duyệt của mẫu + thành viên mẫu theo username;
  4. mẫu Thư viện: Duyệt 2 cấp / theo giá trị / theo phòng ban + "Quản trị duyệt bài" (id cố định, do nothing); mẫu nhận HĐ đối tác đã có ở hub 0121;
  5. `company_flows` Bật: Duyệt 2 cấp (khi có `contracts-write`), Nhận HĐ thường (khi có `contracts-partner-confirm`), Quản trị duyệt bài (khi có `community-read`); không thêm flow thứ hai tranh cùng sự kiện;
  6. `tenant_flow_settings.flow_triggers` BẬT cho công ty có flow Bật (như hub 0126).
- `deploy/stg-sohoptac2/up.sh`: chạy fixtures sau `stg-seed`; `gen-env.sh`: `ESIGN_PROVIDERS=selfsign` (khai báo, không secret).

**Lệnh seed** (sau khi tenant + gói đã có; chạy lại an toàn; chỉ dev/test, production bị chặn):
`HUB_SEED_FIXTURES=1 APP_ENV=development bun run hub:seed:fixtures`
Staging sohoptac2: `bash deploy/stg-sohoptac2/up.sh` đã gọi sẵn (bước cuối sau `stg-seed.ts`).

## Không làm / Chạm
- Không đụng phần DLC; không email thật (người dùng mẫu giữ nguyên như seed cũ; test dùng @demo.local); không secret.
- `tenant-onboard` (production) không đổi: gán quy trình/bật tính năng ở production vẫn là thao tác có chủ đích của platform admin.
- Mẫu CR-113 của evolu (khe cũ) giữ cho đường khe cũ; evolu cũng có flow mặc định mới (cờ BẬT ⇒ đường mới). Hợp nhất khi gỡ đường khe cũ.
- `notify_config` (SMTP) là secret hạ tầng, không nằm trong seed.

## Test tối thiểu
`tools/scripts/src/seed-cr125-config.int.test.ts`: DB mới + tenant/người dùng giả + `enablePack` (như stg-seed) → chạy fixtures → mọi mẫu được gán `templateReadiness` ready, nhóm đủ; ops flow_flag 0 + tenant_profile + cấu hình duyệt HĐ + danh mục feature ok; lần hai đổi 0 hàng.

## Quyết định trong lúc làm
- Gắn vào `writeTenantFixtures` (một cơ chế, cùng cổng `libSampleEnabled`) thay vì script mới; staging gọi CLI sẵn có.
- Tool khả dụng trong test = stub theo luật `PackToolRegistry.enabled` (gói bật ⇒ tool gói dùng được); không dựng cả registry.
- Nhóm mẫu dùng mã của mẫu (truong-phong, giam-doc, phong-kinh-doanh), tách khỏi `pb-ke-toan` hiện có: mẫu CR-122 B trỏ mã cố định; gộp mã nhóm là việc của lát mẫu sau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/seed-cau-hinh-cong-ty.md
#### Yêu cầu: Công ty mẫu (dev/staging) có cấu hình đủ trọn
Seed fixture công ty (evolu, demo) bật mọi tính năng của app đã cài, "Ký thử", nhóm duyệt của mẫu, mẫu Thư viện và flow mặc định (duyệt HĐ, nhận HĐ đối tác, duyệt bài Community) cùng cờ dùng quy trình mới; môi trường mới chạy được từ đầu đến cuối không phải bật công tắc nào. Chạy lại không đổi hàng nào. Production không bao giờ chạy.
- Kịch bản: khi seed chạy trên công ty đã bật gói thì mọi mẫu được gán đều dùng được (tính năng, tool, nhóm đủ) [test: tools/scripts/src/seed-cr125-config.int.test.ts » mọi mẫu được gán cho công ty đều templateReadiness ready]
- Kịch bản: khi seed xong thì ops-watch không cảnh báo cờ quy trình công ty [test: tools/scripts/src/seed-cr125-config.int.test.ts » ops-watch: flow_flag 0 công ty lệch]
- Kịch bản: khi chạy seed lần hai thì không hàng nào đổi [test: tools/scripts/src/seed-cr125-config.int.test.ts » chạy lần hai: 0 hàng đổi]

## Việc còn lại
- Chạy trên staging thật (`up.sh`) khi triển khai; gộp mã nhóm `pb-ke-toan` với `ke-toan` của mẫu nếu muốn một nhóm.
