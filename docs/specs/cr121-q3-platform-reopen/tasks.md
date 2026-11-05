---
id: cr121-q3-platform-reopen
lát: cr121-q3-platform-reopen
cr: CR-121 Q-3
làn: nhanh (phần quyền/ghi: Opus low soát diff)
migration: không
phụ thuộc:
---
## Plan (ngắn)
platform_admin mở lại HĐ và lượt duyệt engine của MỘT công ty qua đúng route tenant admin đang dùng, thêm `?tenant_id` + lý do.
- Guard `packGuardOrPlatform` (kit): vai platform_admin (JWT) ⇒ bắt buộc `?tenant_id` uuid (400), gói phải bật cho công ty đó (403 `PACK_DISABLED`), đặt `platformTenant`; vai khác = `packGuard` cũ (`tenant_id` bị bỏ qua).
- `PackWho.platform` ⇒ `createPackUow.tenant` mở tx tenant đích KHÔNG gắn người (như vòng nền) để luật thấy theo người (chế độ `org`) không chặn; actor vẫn là `userId`.
- Use case `reopenContract` kiểm vai ở đây (`o.role` + `who.platform`), lý do 1..500 (`reopenReasonOk`), `canReopen({platform})`; repo ghi event `reopened` thêm `by_platform`/`actor_role`; người bắt đầu lượt duyệt mới = người phụ trách/người tạo HĐ (platform không thuộc công ty).
- Route engine `approval/{reopen,retry,cancel-reopen}`: platform_admin cùng route + body `{reason}`; audit `platform_approval_op` (contract_events) SAU khi thao tác thành công; thiếu `audit` ⇒ 403.
- Idempotent: khoá hàng `FOR UPDATE` + điều kiện `locked` trong một câu ⇒ bấm 2 lần/đua chỉ 1×200, còn lại 409 `CONTRACT_NOT_LOCKED`, đúng 1 event.
- UI admin-web: `canReopenUi` cho platform_admin; thẻ `ControlDialog` có ô lý do tự nhập (bắt buộc, ≤ 500) cho platform_admin; gửi `?tenant_id` = công ty của lượt.

## Làm
- hub-api: `kit/adapters/pack-guard.middleware.ts`, `pack-uow.ts`, `ports.ts`; `contracts/domain/lock.rules.ts`, `application/reopen-contract.usecase.ts` (+ `recordPlatformOp`), `adapters/{manage.routes,approval.routes,reopen.repo,platform-audit.repo}.ts`, `extraction.mount.ts`.
- admin-web: `run-detail-view.ts`, `run-detail-api.ts`, `RunDetailBody.tsx`, `ControlDialog.tsx`; i18n vi+en `process/admin.*.json`.

## Không làm / Chạm
Không đổi quyền nào khác của platform_admin (đọc/ghi HĐ, duyệt…), không migration, không engine core, không DLC, không lọc công ty. Perf: không chạm đường nóng (chỉ route mở lại; 1 câu SQL như cũ + 1 câu audit khi platform dùng route engine).

## Test tối thiểu
- unit `lock.rules.test.ts` (canReopen/reopenReasonOk), `run-detail-view.test.ts` (canReopenUi).
- int `tests/acceptance/CR-121/platform-reopen.int.test.ts`: platform mở HĐ công ty A + audit · thiếu lý do 400 · member 403 · tenant_admin công ty khác 403 · mở 2 lần/đua 1 kết quả.
- e2e (chỉ viết) `e2e/K1/admin/cr121-run.k1.ts`: platform_admin thấy nút + thẻ bắt buộc lý do.

## Quyết định trong lúc làm
- Audit HĐ = `contract_events` (actor, tenant, HĐ, lý do) vì `hub.audit_log` có CHECK enum entity/action (cần migration).
- Chưa có int cho 3 route engine của platform (ngoài danh sách XONG KHI); route dùng cùng guard/`requestWho` đã test ở route HĐ.
- Compare-and-set theo trạng thái khoá (không thêm `expected_version` vào schema để không đổi contract).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/mo-lai-platform-admin.md
#### Yêu cầu: Platform admin mở lại hợp đồng của một công ty
Quản trị nền tảng (platform_admin) mở lại hợp đồng đã khoá của bất kỳ công ty nào có bật gói Hợp đồng, qua đúng chức năng "Mở lại" của quản trị công ty; bắt buộc chỉ rõ công ty và nhập lý do (1–500 ký tự). Lịch sử hợp đồng ghi người mở, công ty, hợp đồng và lý do. Quản trị công ty khác và thành viên không mở được.
- Kịch bản: khi platform_admin mở lại HĐ của công ty A kèm lý do thì HĐ về "Chờ duyệt", mở khoá và có sự kiện `reopened` ghi người mở + lý do [test: tests/acceptance/CR-121/platform-reopen.int.test.ts » platform_admin mở lại HĐ công ty A ⇒ 200 needs_review, mở khoá, event ghi actor + tenant + HĐ + lý do]
- Kịch bản: khi thiếu lý do, lý do quá 500 ký tự hoặc thiếu công ty đích thì trả 400 và HĐ vẫn khoá [test: tests/acceptance/CR-121/platform-reopen.int.test.ts » thiếu lý do / lý do rỗng / > 500 ký tự / thiếu tenant_id ⇒ 400, HĐ vẫn khoá, không event]
- Kịch bản: khi thành viên hoặc quản trị công ty khác gọi thì bị chặn 403 và HĐ vẫn khoá [test: tests/acceptance/CR-121/platform-reopen.int.test.ts » member (không vai ghi ở gói) ⇒ 403, tenant_admin công ty khác (beta) kèm tenant_id=acme ⇒ 403 PACK_DISABLED, HĐ vẫn khoá]
- Kịch bản: khi bấm mở lại hai lần (kể cả đồng thời) thì chỉ một lần thành công, lần còn lại 409 và chỉ có một sự kiện [test: tests/acceptance/CR-121/platform-reopen.int.test.ts » mở 2 lần (đua + lần sau) chỉ ra 1 kết quả: 1×200, còn lại 409 CONTRACT_NOT_LOCKED, đúng 1 event]
- Kịch bản: khi quyền được xét theo vai thì platform_admin được mở lại, vai không có cờ platform thì không [test: apps/hub-api/src/modules/packs/contracts/domain/lock.rules.test.ts » CR-121 Q-3 · platform_admin mở lại được dù không phụ trách / không owner gói, cờ false/vắng không cấp quyền]

#### Yêu cầu: Nút "Mở lại quy trình" cho platform admin trên trang chi tiết lượt chạy
Trang chi tiết lượt chạy hiện nút "Mở lại quy trình" cho platform_admin với lượt gắn hợp đồng của mọi công ty; thẻ xác nhận có ô lý do bắt buộc (tối đa 500 ký tự).
- Kịch bản: khi platform_admin mở lượt gắn hợp đồng thì thấy nút và chỉ xác nhận được khi đã nhập lý do hợp lệ [test: e2e/K1/admin/cr121-run.k1.ts » CR-121 Q-3 · platform_admin mở lượt chạy gắn hợp đồng của công ty acme ⇒ thấy nút 'Mở lại quy trình', thẻ bắt buộc nhập lý do (≤ 500) mới cho xác nhận]
- Kịch bản: khi xét hiện nút theo vai thì platform_admin thấy với mọi công ty, tenant_admin chỉ công ty mình [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » R-4 · Q-3 · Mở lại quy trình: tenant_admin của đúng công ty HOẶC platform_admin (mọi công ty), lượt gắn hợp đồng]

## Việc còn lại
- Chạy e2e cuối đợt (spec chỉ viết, chưa chạy). Int cho 3 route engine của platform_admin (reopen/retry/cancel-reopen) chưa có.
