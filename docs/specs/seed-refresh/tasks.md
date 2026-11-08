---
id: seed-refresh
lát: seed-refresh
cr: CR-105..111 (dữ liệu mẫu)
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

Máy dev/test dựng mới (`scripts/dev-up.ps1`, `bun run hub:dev` + `HUB_SEED_FIXTURES=1`, e2e `community-web-stack`) phải thấy đủ tính
năng CR-105..111 chạy sẵn, không SQL/API tay. Một module mới `apps/hub-api/src/modules/seed/seed.tenant-fixtures.ts`
(SQL set-based, idempotent, cùng transaction `hub:seed` và CLI `bun run hub:seed:fixtures`) + chỉnh tooling dev. KHÔNG seed khi
`appEnv=production` hoặc thiếu `HUB_SEED_FIXTURES` (dùng lại cổng `libSampleEnabled`); không đổi migration đã áp dụng.

## Làm

| # | Lỗ hổng | Xử lý |
|---|---|---|
| 1 | Dev thiếu `HUB_PROCESS_ENGINE` / `CONTRACTS_APPROVAL_ENGINE` ⇒ Cài đặt › Quy trình duyệt 404 | `hubApiEnv` (hub-dev) mặc định cả hai `on` (ghi đè được); `dev-up.ps1` đã đặt; `.env.example` giữ `HUB_PROCESS_ENGINE=on` (không bật `CONTRACTS_APPROVAL_ENGINE` trong `.env.example` để test hồi quy không đổi); evotest `in-container.sh` đã sed `HUB_PROCESS_ENGINE=on` |
| 2 | Owner không vào `contracts-owner` / `community-owner` (`enablePack` trả `{role, group_id}` không có `key`) | SQL: `tenant_admin` của evolu + demo (`julian.bui`, `demo-owner`) ∈ `contracts-owner` + `community-owner`; evolu: user thường ∈ `*-editor`. `fixture.ts` `addPackMembers` tra Group theo khoá `<gói>-<vai>` nếu phản hồi thiếu vai. `demo-packs.ts` chạy fixture SQL sau khi bật gói |
| 3 | Feature `contracts-approval-engine` | SQL cấp cho evolu + demo (đã thu hồi ⇒ cấp lại); `han-muc-duyet` KHÔNG seed (test khẳng định) |
| 4 | URL catalog rỗng ⇒ switcher trống, link "Đặt trong Sổ Hợp Tác" của Agents bị tắt | `dev-up.ps1` đặt `APP_URL_*` (admin :3000, chat :3100, studio :3200, contracts :3300, community :3400) + SQL điền `app_catalog.url` còn rỗng khi `appEnv=development` (không đè giá trị đã sửa) |
| 5 | Locale `en` đè UI tiếng Việt | SQL đặt `locale='vi'` cho user của evolu + demo (first_admin tạo qua `POST /admin/tenants` mặc định `en`) |
| 6 | Group `pb-ke-toan` (Phòng Kế toán) | SQL tạo Group (nếu chưa có — demo do `tenant-onboard` đã tạo) + 2 thành viên: evolu `thomas.tran`, `vio.ngo`; demo `demo-viewer`, `demo-editor`. Không gán quy trình nào mặc định (công ty dùng quy trình mặc định) |
| 7 | Community CR-110 | `company_settings` (tên/tên ứng dụng/màu, logo null) cho evolu + demo (chỉ tạo nếu thiếu); `seed-community-demo` thêm đính kèm (chỉ nhãn) cho 2 bài ⇒ tab "Ảnh & tệp" không rỗng; `--dev-fixture` đặt mật khẩu dev đã biết cho 5 user đối tác `doitac-*` (không bắt đổi); `_cs-stack.ts` gọi thêm `seed.tenant-fixtures` |
| 8 | `han-muc-duyet` | Không seed (chỉ cấp tay trên prod) |

## Không làm / Chạm

- Không seed production; không đổi migration; không thêm bảng. Không bật `CONTRACTS_APPROVAL_ENGINE` trong `.env.example`.
- Bài mẫu đã tồn tại trên DB dev cũ không được bổ sung đính kèm (findPost theo tiêu đề) — dựng DB mới (`dev-up -Fresh`) để có.

## Tài khoản fixture (chỉ máy dev/test; không có mật khẩu thật)

| Công ty (mã) | Tài khoản | Vai | Mật khẩu |
|---|---|---|---|
| `platform` | `admin` | platform_admin | `SEED_ADMIN_PASSWORD` trong `.env.local` (sinh bởi `keys:dev`) |
| `evolu` | `julian.bui` | tenant_admin; owner `contracts` + `community` | `1234567890` (`DEMO_PASSWORD`, `tools/hub-dev/src/fixture.ts`) |
| `evolu` | `thomas.tran`, `vio.ngo` | thành viên; editor gói; Phòng Kế toán | như trên |
| `evolu` | `edgar.nguyen`, `rowan.nguyen` | thành viên; editor gói | như trên |
| `demo` (`-SeedDemo`) | `demo-owner` | tenant_admin; owner `contracts` + `community` | `DEMO_OWNER_PW` trong `.env.local` (tự sinh lần đầu) |
| `demo` | `demo-editor`, `demo-viewer` | theo `deploy/tenants/demo.yaml`; Phòng Kế toán | mật khẩu tạm theo onboard (xem `dev-up`) |
| `demo` | `doitac-tanphat`, `doitac-ncca`, `doitac-phuongnam`, `doitac-abc`, `doitac-hungthinh` | đối tác Community (external) | = `DEMO_OWNER_PW` (dev-fixture đặt, không bắt đổi) |
| `acme`/`beta` | `lan`, `hoa`, `an`, `khoa` | contract test (`HUB_DEV_CONTRACT_FIXTURE=1`) | `dev-password-1` |

## Test tối thiểu

- `apps/hub-api/src/modules/seed/seed.tenant-fixtures.int.test.ts`: production/thiếu fixtures ⇒ không đụng gì; `appEnv=test` ⇒ seed
  công ty nhưng không điền URL; `development` ×2 ⇒ owner ∈ Group owner (contracts + community), editor evolu, engine, Kế toán 2 người,
  locale vi, brand, URL catalog; không có `han-muc-duyet`.
- `tools/scripts/src/seed-community-demo.int.test.ts`: bài có đính kèm (đúng số media), mật khẩu dev đối tác idempotent.
- `tools/scripts/src/done-h2b.test.ts`: `hubApiEnv` mặc định bật engine.
- e2e (một lần, evotest): `community-web-stack`, `contracts-web`.

## Quyết định trong lúc làm

- Fixture tenant chạy ở hai chỗ: trong `hub:seed` (tenant đã có lúc đó) và CLI `hub:seed:fixtures` (gọi bởi `demo-packs.ts` sau khi bật
  gói qua admin-api, vì Group gói + tenant `demo` chỉ có sau `hub:seed`). Cả hai cùng cổng `libSampleEnabled`.
- URL catalog chỉ điền khi `appEnv=development` (e2e/test giữ nguyên hành vi rỗng).
- `CONTRACTS_APPROVAL_ENGINE=on` đặt ở tooling dev (hub-dev `hubApiEnv`, `dev-up.ps1`), không ở `.env.example`: `.env.example` là nguồn `.env.local` của evotest, bật sẽ đổi hành vi bộ test hồi quy.
- `demo-viewer` / `demo-editor` theo email `example.invalid` (khớp `deploy/tenants/demo.yaml`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Dữ liệu mẫu dev/test của Community
Máy dev/test dựng mới có sẵn: chủ quản là owner gói, thương hiệu công ty (tên/tên ứng dụng/màu), đối tác + bài mẫu có đính kèm
(tab "Ảnh & tệp" không rỗng). Không seed khi `appEnv=production` hoặc thiếu `HUB_SEED_FIXTURES`.
- Kịch bản: khi `hub:seed` chạy với fixtures ở dev thì chủ quản ∈ Group owner, có `company_settings`, URL catalog được điền [test: apps/hub-api/src/modules/seed/seed.tenant-fixtures.int.test.ts » development + fixtures (chạy 2 lần): owner ∈ Group owner, editor evolu, engine, Kế toán 2 người, locale vi, brand, URL]
- Kịch bản: khi appEnv=production thì không seed gì [test: apps/hub-api/src/modules/seed/seed.tenant-fixtures.int.test.ts » production hoặc không bật fixtures ⇒ không đụng gì (không Group Kế toán, feature, brand, URL, locale)]
- Kịch bản: khi seed cộng đồng demo chạy thì bài mẫu có đính kèm và user đối tác dùng mật khẩu dev [test: tools/scripts/src/seed-community-demo.int.test.ts » --apply hai lần: công ty/user/nhãn/bài/bình luận không trùng, liên hệ bị che, mật khẩu chỉ ở file]

## Việc còn lại

- Chạy e2e evotest (`community-web-stack`, `contracts-web`) và ghi kết quả.
