---
id: cr110-ports
lát: cr110-ports
cr: CR-110
fr: [COM-FR-43, COM-FR-45]
làn: đầy đủ (tenant + cách ly đối tác)
migration: không
phụ thuộc: —
---
## API (UI slice dựng từ đây)

`@ai/contracts/community` (strict zod):

```ts
// GET /pack/community/viewer  — thêm 2 trường (luôn có)
CommunityViewer = {
  userId, name, role: "host_admin"|"host_member"|"partner", orgId, orgName, labels, cats,   // như cũ
  caps: { contracts: boolean },   // CommunityCapsSchema — true CHỈ khi chủ quản có quyền `read` gói contracts; đối tác luôn false
  contractsUrl: string | null,    // gốc contracts-web (CONTRACTS_WEB_URL, vắng ⇒ "/") khi caps.contracts; còn lại null
}
// GET /pack/community/brand  — mọi account trong tenant (kể cả đối tác), brand công ty CHỦ QUẢN, đúng 4 trường
CommunityBrand = {                // CommunityBrandSchema
  name: string,                   // /company.name; chưa đặt ⇒ tên tenant
  appName: string | null,         // /company.app_name
  logo: string | null,            // data URL ảnh (≤ 1 MB); null ⇒ UI vẽ chữ cái đầu của name
  accent: "indigo"|"blue"|"teal"|"green"|"orange"|"rose",   // COMMUNITY_BRAND_ACCENTS; chưa có ⇒ "indigo"
}
```
`Profile.shtUrl` giữ nguyên (client cũ). Lỗi: 403 `PACK_DISABLED`/`PACK_FORBIDDEN` như mọi route community.

## Plan (ngắn)
- Cổng (ADR-0031, `community/application/pack-ports.ts`): `CompanyBrandReader.brand(tenantId)` → `CompanyBrandRow | null`;
  `ContractsCapReader.contracts(who)` → boolean.
- Cung cấp ở `community-wire.mount.ts`: brand = `contracts/brand.mount.ts` (MỘT câu, 4 cột `contracts.company_settings`);
  caps = `packActionsFor(packAccessInput(view, "contracts", who)).includes("read")` (cache, 0 SQL), user ngoài ⇒ false.
- Luật thuần `community/domain/brand.rules.ts`: `toCommunityBrand` (mặc định tên tenant + indigo), `viewerCaps`.
- Route: `GET /viewer` thêm caps/contractsUrl (đối tác không gọi cổng); `GET /brand` mới.

## Làm
- [x] Contract `pack-community/brand.ts` (`CommunityBrandSchema`, `CommunityCapsSchema`) + `viewer.ts` thêm `caps`, `contractsUrl`
- [x] Cổng + adapter + wire + route
- [x] Int `apps/hub-api/src/modules/packs/community-ports.int.test.ts` (viết trước code) + unit `brand.rules.test.ts`
- [x] community-web: chỉ thêm `caps`/`contractsUrl` vào persona mock (`api/seed.ts`) + `lib/logic.test.ts` để typecheck

## Không làm / Chạm
Không UI, không bảng/migration (Q9), không đổi `/pack/contracts/company`. Client `getBrand()` + dùng caps = lát cr110-shell.

## Test tối thiểu
Int: admin chủ quản caps true + url; thành viên không quyền contracts false/null; đối tác false/null; brand chủ quản; đối tác
đúng 4 trường (không MST/pháp nhân/theme); chéo tenant (B thấy brand B; user A mang tenant B ⇒ 403); chưa có brand ⇒ mặc định.

## Quyết định trong lúc làm
- `caps.contracts` là boolean (brief điều phối: "có quyền gói contracts") thay cho enum none/read/write/admin của PDF P5; cần
  mức chi tiết hơn (vd nhóm Công ty chỉ admin) ⇒ thêm trường mới trong `caps`, không đổi kiểu.
- `contractsUrl` null cả với chủ quản không quyền contracts (I3: ẩn nhóm SHT), không chỉ đối tác.
- Brand đọc bằng tx HỆ THỐNG của gói contracts (`userId` null): RLS tenant vẫn áp theo `app.tenant_id` (từ token), nhưng `ext_deny`
  không chặn — cần để đối tác đọc brand chủ quản (Q5). Câu chỉ chọn 4 cột; mapper chỉ chép 4 trường.
- Brand theo D5 ⇒ theo Q5 mặc định: mọi account hiện brand chủ quản.
- Màu brand có 6 giá trị (thêm rose) trong `COMMUNITY_BRAND_ACCENTS`; `COMMUNITY_ACCENTS` (màu cá nhân) để lát cr110-settings bỏ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Quyền gói contracts của người xem (caps) và link Sổ Hợp Tác
`GET /pack/community/viewer` trả `caps.contracts` (true chỉ khi chủ quản có quyền đọc gói contracts) và `contractsUrl` (gốc contracts-web khi `caps.contracts`, còn lại null). Đối tác luôn `caps.contracts = false`, `contractsUrl = null`.
- Kịch bản: admin chủ quản có quyền contracts ⇒ caps true + contractsUrl [test: apps/hub-api/src/modules/packs/community-ports.int.test.ts » [COM-FR-43] admin chủ quản có quyền contracts ⇒ caps.contracts true + contractsUrl]
- Kịch bản: thành viên chủ quản không có quyền contracts ⇒ false + null [test: apps/hub-api/src/modules/packs/community-ports.int.test.ts » [COM-FR-43] thành viên chủ quản không có quyền contracts ⇒ caps false, contractsUrl null]
- Kịch bản: đối tác ⇒ false + null [test: apps/hub-api/src/modules/packs/community-ports.int.test.ts » [COM-FR-43] đối tác ⇒ caps false, contractsUrl null (I1)]

#### Yêu cầu: Brand công ty chủ quản dùng chung
`GET /pack/community/brand` trả brand công ty chủ quản của tenant trong token cho mọi account (cả đối tác), đúng 4 trường `{name, appName, logo, accent}` từ `/company`; chưa có ⇒ tên tenant + indigo.
- Kịch bản: chủ quản đọc brand từ /company [test: apps/hub-api/src/modules/packs/community-ports.int.test.ts » [COM-FR-45] chủ quản đọc brand công ty mình từ /company]
- Kịch bản: đối tác đọc brand chủ quản, đúng 4 trường [test: apps/hub-api/src/modules/packs/community-ports.int.test.ts » [COM-FR-45] đối tác đọc brand CHỦ QUẢN, đúng 4 trường (không pháp nhân/MST/giao diện/cờ)]
- Kịch bản: tenant khác không đọc được brand của nhau [test: apps/hub-api/src/modules/packs/community-ports.int.test.ts » [COM-FR-45] chặn chéo tenant: B chỉ thấy brand B; user A mang tenant B ⇒ 403]
- Kịch bản: chưa có brand ⇒ mặc định [test: apps/hub-api/src/modules/packs/community/domain/brand.rules.test.ts » chưa có brand ⇒ tên tenant + indigo, logo/app null (P5-AC07)]

## Việc còn lại
- Cuối đợt: gộp Delta vào `docs/current/community/hien-thi.md`; `pack-boundary.md` + ADR-0031 liệt kê 2 cổng mới.
- cr110-shell: `client.getBrand()` + mock; dùng `viewer.caps.contracts`/`contractsUrl`.
