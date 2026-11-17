---
id: s1-sig-db
lát: s1-sig-db
cr: CR-181
làn: nhanh
migration: có (hub 0155, chỉ THÊM)
phụ thuộc:
---
# s1-sig-db — lát DB + repo «Chữ ký nội bộ» (CR-181 đợt 1)

Nguồn: `docs/specs/CR-181/decisions.md` §2 (Q5 Q10 Q11 Q15 Q18) và §3 «hub 0155». Không làm: route HTTP (s2), web, pack-contracts.

## Plan (ngắn)
Ba bảng hub chỉ truy cập qua hàm DEFINER `hub.sig_*` (khuôn 0149): người dùng chỉ đọc/ghi chữ ký của CHÍNH MÌNH; repo mỏng gọi hàm, một câu SQL / thao tác.

## Làm
- [x] `packages/db/migrations-hub/0155_cr181_signatures.sql` + journal (idx 138): `user_signatures` (unique partial «một bản đang dùng»), `signature_settings`, `signature_change_grants` (một hàng mở / người, dùng một lần); RLS bật, policy chỉ `app.scope='system'`; hàm `sig_ctx/get_active/history/create/settings_get/settings_put/change_state/change_request/change_grant/change_consume` + `signature_for_stamp`; CHECK `hub.audit_log` thêm 5 action + entity `signature`.
- [x] `packages/db/src/schema/hub-signature.ts` (+ export `./schema/hub-signature`) và hằng audit `SIGNATURE_AUDIT_ACTIONS/ENTITIES` trải vào `EXT_AUDIT_*` ở `hub-kh.ts` (→ `HUB_AUDIT_*_VALUES`).
- [x] `packages/contracts/src/signature.ts` (+ `./signature`): `SignatureSettingsSchema`, `SIGNATURE_SETTINGS_DEFAULT`, `SIGNATURE_PNG_MAX_BYTES`, `MySignatureViewSchema`; test `signature.test.ts`.
- [x] `apps/hub-api/src/modules/signatures/{public.ts,domain/signature.types.ts,adapters/signatures.repo.ts}`: getActive, getActiveAll, listHistory, create, getSettings, putSettings, getChangeState, requestChange, grantChange, consumeGrant, signatureForStamp.
- [x] `packages/db/src/migrate-hub.int.test.ts`: thêm 3 bảng mới vào `HUB_TABLES`.

## Không làm / Chạm
Không route, không web, không thêm thư viện. Quyền «quản trị công ty» (Q15) kiểm ở route (s2); hàm DB `sig_settings_put`/`sig_change_grant` đòi cờ `app.sig_admin='1'` (route đặt SET LOCAL sau khi kiểm Q15). Audit ghi do s2 (lát này chỉ cho phép giá trị).

## Test tối thiểu
- unit: `bun test packages/contracts/src/signature.test.ts` → 7 pass.
- int (evotest): `apps/hub-api/src/modules/signatures/signatures.int.test.ts` (15 ca) + `packages/db/src/migrate-hub.int.test.ts` → 22 pass, 0 fail.
- `tsc --noEmit`: contracts sạch; db và hub-api chỉ còn lỗi cũ ở `migrate-hub.int.test.ts:223` / `pmsg-db.int.test.ts:412` (không do lát này).

## Quyết định trong lúc làm
- Soát Opus (CHANGES REQUESTED, sửa thẳng 0155 vì chưa lên prod): (1) `sig_settings_put` và `sig_change_grant` đòi `app.sig_admin='1'`, thiếu ⇒ 42501; repo có `putSettingsAsAdmin`/`grantChangeAsAdmin` tự đặt `set_config(...,true)` quanh lệnh gọi rồi gỡ; `sig_change_grant` chặn `p_user = uid` (không tự cấp). (2) CHECK `audit_log` ADD … NOT VALID + VALIDATE ở statement riêng, `SET LOCAL lock_timeout='5s'`. (3) Bỏ `GRANT SELECT` 3 bảng cho hub_rw (mọi đường qua hàm DEFINER). #4 (policy=admin: consume cùng tx với create) để s2.
- Hằng audit mới đặt ở `hub-signature.ts` và trải qua `EXT_AUDIT_*` (`hub-kh.ts`, đã được `hub.ts` trải) thay vì sửa `hub.ts` (399/400 dòng) hay `hub-processes.ts` (400/400).
- Thêm entity `signature` vào CHECK entity của `audit_log` (decisions chỉ nêu action) — audit cần entity hợp lệ; danh sách giữ nguyên 0071 + `signature`.
- `signature_change_grants` có thêm cột `id` (pk) và unique partial `(tenant_id,user_id) WHERE used_at IS NULL`: một hàng mở / người ⇒ xin lặp không nhân đôi chuông (`fresh=false`); dùng xong giữ làm lịch sử.
- Quản trị «cho phép» khi chưa ai xin ⇒ tạo luôn hàng đã cho phép (không bắt buộc xin trước). Người ngoài công ty ⇒ `P0002 SIG_USER_NOT_FOUND`.
- `signature_for_stamp(tenant,user,kind)` bắt buộc tham số KHỚP `app.tenant_id`/`app.user_id` (lệch ⇒ 42501): không đọc hộ người khác; máy chủ in chạy trong scope của chính người ký. Cấp cho `hub_rw` và `contracts_rw` (cùng `sig_get_active`).
- `sig_create` khoá `pg_advisory_xact_lock(tenant:user:kind)` rồi retire + insert trong một hàm ⇒ hai lần tạo đồng thời tuần tự, không đụng unique.
- Ảnh vào DB qua tham số hex `decode(…,'hex')` (không phụ thuộc cách driver mã hoá Buffer); `history` không trả ảnh.
- Thiết lập: không có hàng ⇒ `getSettings()` trả mặc định (`stored=false`), không tự chèn hàng; `digital_provider` thêm vào schema (nullable) theo §3.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/hub/chu-ky.md

#### Yêu cầu: Một chữ ký đang dùng mỗi loại, bản cũ giữ lịch sử (BR-K1)
Mỗi người có tối đa một chữ ký đang dùng cho mỗi loại (`main` chữ ký đầy đủ, `initials` chữ ký tắt). Tạo/đổi = bản cũ được đánh dấu thôi dùng + bản mới thêm vào trong cùng một thao tác; bản cũ không xoá và còn trong lịch sử. Ảnh PNG ≤ 200 KiB (nét đen, nền trong suốt); quá trần, rỗng, loại hoặc cách tạo lạ ⇒ từ chối, không ghi gì.
- Kịch bản: tạo lần đầu rồi đổi ⇒ chỉ một bản đang dùng, bản cũ còn trong lịch sử, bản mới là bản đọc ra [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » tạo lần đầu: không thay ai]
- Kịch bản: `initials` độc lập với `main` [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » loại `initials` độc lập]
- Kịch bản: hai lần tạo đồng thời cùng người vẫn một bản đang dùng [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » hai lần tạo đồng thời]
- Kịch bản: ảnh quá trần / rỗng / loại lạ bị từ chối, đúng trần thì được [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » đầu vào sai]

#### Yêu cầu: Chỉ đọc và ghi chữ ký của chính mình (BR-K2, BR-K3)
Người dùng chỉ đọc/ghi chữ ký của mình: người khác cùng công ty và công ty khác không thấy chữ ký hay lịch sử, không đọc/ghi bảng trực tiếp. Máy chủ in lấy ảnh từ DB theo đúng người ký trong ngữ cảnh (`signature_for_stamp`); hỏi hộ người khác hoặc tenant khác ⇒ bị chặn.
- Kịch bản: người khác cùng công ty (không phải người tạo) và công ty khác không thấy chữ ký của A [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » người B cùng công ty không thấy]
- Kịch bản: B tạo chữ ký thì chỉ vào hàng của B [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » B ghi: chữ ký mới chỉ vào hàng của B]
- Kịch bản: `signature_for_stamp` đúng người ⇒ ảnh; người/tenant khác ⇒ 42501 [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » signature_for_stamp: đúng người]
- Kịch bản: bảng không đọc/ghi trực tiếp ở scope người dùng; thiếu ngữ cảnh ⇒ 42501 [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » bảng không đọc/ghi trực tiếp]

#### Yêu cầu: Xin đổi chữ ký và quản trị cho phép, dùng một lần (Q10)
Người dùng xin đổi ⇒ có một yêu cầu mở (xin lặp không nhân đôi). Quản trị công ty cho phép (kể cả khi chưa ai xin) ⇒ người đó dùng được đúng MỘT lần; dùng xong, muốn đổi nữa phải xin lại. Chưa được cho phép ⇒ không dùng được; người khác không dùng hộ; công ty khác không lẫn. Người ngoài công ty không được cho phép.
- Kịch bản: xin → chờ → quản trị (người khác) cho phép → dùng đúng một lần (kể cả hai lần đồng thời) → xin lần mới [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » xin → chờ → quản trị cho phép]
- Kịch bản: cho phép khi chưa ai xin; người ngoài công ty bị từ chối [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » quản trị cho phép khi chưa ai xin]
- Kịch bản: quyền đổi của công ty khác không lẫn [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » quyền đổi của công ty khác không lẫn]

#### Yêu cầu: Thiết lập chữ ký theo công ty, mặc định khi chưa có (Q5)
Chưa có thiết lập ⇒ mặc định: ký trên tài liệu TẮT, 3 cách tạo (vẽ, tải ảnh, gõ tên), bắt buộc tạo, dòng chữ tên + ngày, mực xanh, chữ ký tắt thu nhỏ, người dùng tự đổi, chữ ký số tắt. Mọi thành viên đọc được; ghi là thao tác quản trị (kiểm ở API). Mỗi công ty một thiết lập; giá trị sai (0 cách tạo, mực lạ) bị chặn.
- Kịch bản: chưa có hàng ⇒ mặc định [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » chưa có hàng ⇒ mặc định]
- Kịch bản: ghi rồi đọc lại; công ty khác vẫn mặc định; ghi lần hai cập nhật cùng hàng [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » ghi rồi đọc lại]
- Kịch bản: người dùng thường gọi ghi thiết lập / cấp quyền đổi (không cờ quản trị) ⇒ 42501, không ghi; quản trị không tự cấp cho mình [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » hàm ghi của quản trị đòi cờ]
- Kịch bản: giá trị sai bị chặn [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » giá trị sai bị CHECK chặn]
- Kịch bản: mặc định và giới hạn của contract [test: packages/contracts/src/signature.test.ts » mặc định hợp lệ]

#### Yêu cầu: Audit chữ ký
Nhật ký audit chấp nhận các hành động `signature_created`, `signature_settings_changed`, `signature_change_requested`, `signature_change_granted`, `document_signed` (đối tượng `signature`); các hành động cũ giữ nguyên, hành động lạ vẫn bị chặn.
- Kịch bản: 5 hành động mới ghi được, hành động cũ còn dùng, hành động lạ bị chặn [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » 5 action chữ ký]

## Việc còn lại
- Lát s2 (API): kiểm quyền quản trị (Q15) rồi gọi `putSettingsAsAdmin`/`grantChangeAsAdmin`; ghi audit 5 action; chuông «Xin đổi chữ ký»; gọi `consumeGrant()` cùng tx với `create()` khi `change_policy = admin` và đã có chữ ký.
- Ngoài phạm vi (không sửa): `packages/db/src/migrate-hub.int.test.ts:223` và `pmsg-db.int.test.ts:412` có lỗi tsc cũ (`never[]` vs `RowList`).
