---
id: s2-sig-api
lát: s2-sig-api
cr: CR-181
làn: nhanh
migration: có (hub 0156, chỉ THÊM: 2 hàm đọc)
phụ thuộc: s1-sig-db
---
# s2-sig-api — API «Chữ ký nội bộ» (CR-181 đợt 1)

Nguồn: `docs/specs/CR-181/decisions.md` §2 (Q5 Q10 Q11 Q15 Q18), §5 «Hub»; `nghiep-vu.txt` BR-K1..K5, BR-G1, BR-G3. Không làm: web, gói contracts (lát s8 dùng `public.ts`).

## Plan (ngắn)
Module `apps/hub-api/src/modules/signatures/`: luật thuần (`domain/signature.rules.ts`) → use case (`application/signature.service.ts`, MỘT tx scope người dùng mỗi route) → route (`adapters/signature.routes.ts`) → mount (`signatures.mount.ts`, gắn ở `app.ts`). Quyền quản trị (Q15) qua `adapters/company-admin.ts` (tenant_admin ∨ quyền `admin` gói `contracts`, qua cổng `packs/kit/public`).

| Route | Quyền | Mã | Số câu SQL (cố định) |
|---|---|---|---|
| `GET /me/signature` | đăng nhập | 200 | 5 |
| `POST /me/signature` {kind,method,png b64} | đăng nhập, chỉ cho mình | 201; 400 · 403 `SIGNATURE_CHANGE_NOT_ALLOWED` · 413 · 415 · 422 | ≤ 7 |
| `POST /me/signature/change-request` | đăng nhập | 201 mới (chuông) · 200 đã có · 409 không cần | 1 (người nhận) + ≤ 7 |
| `GET /company/signature-settings` | mọi thành viên | 200 (+`can_edit`) | 2 |
| `PUT /company/signature-settings` | quản trị | 200 · 403 `SIGNATURE_FORBIDDEN` · 400 | 5 |
| `GET /company/signature-change-requests?limit=` | quản trị | 200 · 403 | 2 |
| `POST /company/signature-change-grants` {user_id} | quản trị | 201 · 200 đã cho phép · 403 (không phải quản trị / tự cấp) · 404 | ≤ 6 |

## Làm
- [x] `packages/contracts/src/signature.ts`: view `GET /me/signature` (+`history`, `can_change`, `digital`), body/response tạo + xin đổi + thiết lập + danh sách + cho phép, `SIGNATURE_API_ERRORS` (mã + status); test `signature.test.ts` (10 pass).
- [x] `packages/db/migrations-hub/0156_cr181_signature_admin_reads.sql` + journal idx 139: `hub.sig_change_list(limit)` (đòi `app.sig_admin`), `hub.sig_settings_of(tenant)` (system hoặc đúng tenant).
- [x] repo: `listChangeRequestsAsAdmin`, `settingsOfTenant`; kiểu `ChangeRequestRow`.
- [x] `domain/signature.rules.ts` + unit: `needsCreate`, `changeNeedsGrant`, `canChangeNow`, `changeStateOf`, `changeRequestApplies`, `kindAllowed`, `checkPng`, `isCompanyAdmin`.
- [x] service + routes + mount; `app.ts`: mount + `SIGNATURE_PROTECTED_PREFIXES` (`/me/signature`, `/company`) vào JWT.
- [x] `public.ts`: `mountSignatures`, `getSignatureSettings(db, tenantId)`, `signatureForStamp(db, {tenantId,userId}, kind)`, luật thuần.
- [x] int `signatures.routes.int.test.ts` (16 ca) trên evotest.

## Không làm / Chạm
Không web, không gói contracts, không thêm thư viện. Chạm `app.ts` (3 dòng), `packages/db/migrations-hub` (0156), `packages/contracts/src/signature.ts`.

## Test tối thiểu
- unit: `bun test apps/hub-api/src/modules/signatures/domain packages/contracts/src/signature.test.ts` → 24 pass.
- int (evotest, PowerShell): `signatures.routes.int.test.ts` + `signatures.int.test.ts` → 34 pass, 0 fail.
- `tsc --noEmit`: contracts sạch; hub-api chỉ còn lỗi cũ ở `pmsg-db.int.test.ts:412` (không do lát này).

## Quyết định trong lúc làm
- Cần migration 0156 (s1 không có hàm liệt kê yêu cầu của cả công ty và không đọc thiết lập theo `tenant` không có người dùng); bảng vẫn không cấp quyền trực tiếp — chỉ thêm hàm DEFINER.
- `needs_create` KHÔNG phụ thuộc `required` (theo brief: `required` chỉ quyết nút «Làm sau» ở web); thêm: `initials = own` mà thiếu/lỗi thời chữ ký tắt ⇒ cũng `true` (Q11).
- Bản đang dùng có cách tạo đã bị bỏ khỏi `methods` ⇒ tạo lại KHÔNG cần quyền đổi dù policy `admin` (người dùng bị buộc, không phải tự đổi); `can_change` = `true` trong ca đó.
- Tạo chữ ký cho phép cả khi `on_doc_enabled=false` (tắt chỉ tắt màn chặn/ô ký, Q5; không cần chặn tạo).
- PNG kiểm trước khi mở tx: >200 KiB ⇒ 413 (thắng 415), không phải PNG (magic bytes) ⇒ 415; zod chỉ chặn base64 sai (400) và trần 400 000 ký tự.
- Q15 trong lõi: dùng `packAccessInput`+`checkPackAccess` của `packs/kit/public` (như `my-history`), pack `contracts`, việc `admin`; `platform_admin` không tự là quản trị công ty (BR-G1).
- Chuông «Xin đổi chữ ký» gửi cho tenant_admin + thành viên nhóm có quyền `admin` gói (trừ người xin), ≤ 200 người, MỘT `notify.enqueue('hub', lô)`; link `/settings/signature` (lát s5 phải có route này). Thêm chuông «Bạn được đổi chữ ký» cho người được cho phép (fresh).
- Mã lỗi mới `SIGNATURE_*` đặt ở `SIGNATURE_API_ERRORS` (contract) và ném bằng `AppError` trực tiếp — chưa gộp vào `HubErrorCode` toàn cục (khuôn i18n lỗi chưa có cho module này; web dịch theo `code`).
- Audit ghi qua `HubAuditWriter` (tiêm được); `entity_id` của audit thiết lập = null; không ghi ảnh.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/hub/chu-ky.md
#### Yêu cầu: Chữ ký nội bộ của tôi (xem, tạo, đổi) chỉ cho chính mình
`GET /me/signature` trả chữ ký đang dùng, lịch sử, định dạng, `needs_create`, `can_change`, chữ ký số luôn khoá; `POST /me/signature` kiểm PNG thật ≤ 200 KiB và cách tạo theo định dạng công ty, mỗi người một bản đang dùng, bản cũ vào lịch sử, mọi lần ghi nhật ký trước/sau; người khác không thấy chữ ký của mình.
- Kịch bản: khi tạo chữ ký lần hai thì bản cũ vào lịch sử, chỉ một bản đang dùng và nhật ký ghi id trước/sau [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » tạo lần đầu 201, đổi ⇒ bản cũ vào lịch sử, 1 bản đang dùng, audit trước/sau là id]
- Kịch bản: khi ảnh quá 200 KiB, không phải PNG hoặc cách tạo ngoài định dạng thì bị từ chối 413, 415, 422 [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » PNG > 200 KiB ⇒ 413, không phải PNG ⇒ 415, base64 sai ⇒ 400, đúng 200 KiB ⇒ 201, có user_id ⇒ 400] [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » BR-K4: cách tạo ngoài methods ⇒ 422, initials khi shrink ⇒ 422, own ⇒ 201]
- Kịch bản: khi người khác (cùng hoặc khác công ty) xem chữ ký của tôi thì không thấy [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » BR-K2: người B không thấy chữ ký của A (cùng công ty và công ty khác)]
- Kịch bản: khi cần biết có phải tạo chữ ký ngay thì `needs_create` đúng bốn trường hợp (tắt; bật chưa có; bật đã có; cách tạo bị bỏ) [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » (1) tắt ký trên tài liệu ⇒ false] [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » (2) bật + chưa có chữ ký ⇒ true (required=false vẫn true, web dùng «Làm sau»)] [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » (3) bật + có chữ ký theo cách còn cho phép ⇒ false] [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » (4) cách tạo của bản đang dùng bị bỏ khỏi methods ⇒ true, tạo lại KHÔNG cần quyền đổi dù policy admin]
- Kịch bản: khi tính needs_create và quyền đổi thì luật thuần cho kết quả đúng [test: apps/hub-api/src/modules/signatures/domain/signature.rules.test.ts » PNG thật trong hạn ⇒ ok]

#### Yêu cầu: Định dạng chữ ký công ty chỉ quản trị công ty sửa
Mọi thành viên đọc được `GET /company/signature-settings`; `PUT` chỉ tenant admin hoặc người có quyền `admin` gói Sổ Hợp Tác; mỗi lần sửa ghi nhật ký trước/sau.
- Kịch bản: khi người thường sửa định dạng thì 403 và thiết lập không đổi [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » người thường PUT ⇒ 403 SIGNATURE_FORBIDDEN, thiết lập không đổi]
- Kịch bản: khi tenant admin hoặc người được giao quyền admin gói (không phải tenant admin) sửa thì 200 [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » tenant admin ⇒ 200, người được giao quyền admin gói (không phải tenant admin) ⇒ 200]
- Kịch bản: khi body sai, có trường lạ hoặc không đăng nhập thì 400 hoặc 401 [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » body sai ⇒ 400, trường lạ ⇒ 400, không token ⇒ 401]
- Kịch bản: khi quản trị sửa định dạng thì nhật ký có hàng với người làm và trước/sau [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » BR-G3: audit có hàng, người làm, trước/sau (không có ảnh)]

#### Yêu cầu: Đổi chữ ký khi quản trị công ty phải cho phép
Khi định dạng đặt «quản trị cho phép», lần tạo đầu luôn được; đổi cần xin, quản trị nhận chuông và cho phép một lần; không tự cấp cho mình.
- Kịch bản: khi chưa được phép thì 403; xin đổi báo chuông một lần; quản trị khác người xin cho phép thì đổi được đúng một lần [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » không grant ⇒ 403, xin (201 + chuông, 200 lần hai không báo lại), quản trị gói (khác người xin, không phải tenant admin) cho phép ⇒ 201, đổi được đúng một lần]
- Kịch bản: khi ảnh hỏng thì bị chặn trước khi tiêu quyền đổi [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » PNG hỏng bị chặn TRƯỚC khi tiêu quyền đổi (quyền còn nguyên)]
- Kịch bản: khi xin đổi lúc không cần, tự cấp cho mình hoặc cấp cho người công ty khác thì 409, 403, 404 [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » xin đổi khi policy self ⇒ 409, tự cấp cho mình ⇒ 403, cấp cho người công ty khác ⇒ 404, cấp trước khi xin vẫn được]

#### Yêu cầu: Gói khác lấy chữ ký và định dạng qua cửa công khai
`getSignatureSettings(db, tenantId)` và `signatureForStamp(db, {tenantId,userId}, kind)` — máy chủ in lấy ảnh từ DB, đúng người ký (BR-K3).
- Kịch bản: khi lấy thiết lập thì mặc định nếu chưa lưu, đúng công ty khi đã lưu; khi lấy chữ ký để in thì đúng người, null nếu chưa có [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » getSignatureSettings: mặc định khi chưa lưu, theo công ty khi đã lưu, signatureForStamp: đúng người, null khi chưa có]

## Việc còn lại
- Chưa đo p95 (không có ngưỡng ở brief; số câu SQL cố định theo bảng Plan, chưa có test đếm câu).
- Lát s5 cần route web `/settings/signature` (link chuông); lát s8 gọi `signatureForStamp`/`getSignatureSettings` qua cổng kit (hiện chỉ xuất ở `signatures/public.ts`).
