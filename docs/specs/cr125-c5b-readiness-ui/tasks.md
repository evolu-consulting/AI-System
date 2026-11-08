---
id: cr125-c5b-readiness-ui
lát: cr125-c5b-readiness-ui
cr: CR-125
làn: đầy đủ (route quyền mới — Opus soát)
migration: không
phụ thuộc: cr125-c5-template-readiness
---
## Plan (ngắn)
Hoàn tất c5: platform thấy mẫu thiếu gì ngay lúc Gán và sửa một chạm; công ty thấy trước khi Sao chép; mẫu khe cũ Community không còn gây nhầm.

## Làm
- admin-api `POST /admin/tenants/:tenant_id/template-fixes/enable-feature {feature_key}` và `.../create-group {group_key}`: chỉ platform_admin; gọi đúng `grantEntitlement` (features) và `createGroup` (groups) — cùng khoá/audit/NOTIFY; tên nhóm gợi ý = `suggestGroup` (contracts, một nguồn với web).
- admin-web: `ReadinessPanel` (một component cho Gán và Sao chép) đọc `GET company-flows/readiness/:flowId`; nút "Bật tính năng cho công ty" / "Tạo nhóm theo gợi ý"; Gán khoá tới khi dùng được (thiếu nhóm chỉ lưu ý); `CopyDialog` thay nút sao chép chạy thẳng. Luật hiển thị thuần `lib/readiness-view.ts`.
- Thư viện: mẫu khe `community.*` cũ — ẩn khi không công ty nào dùng và không là mặc định, còn lại gắn "Mẫu cũ — không sao chép được" (`library-view.ts`).

## Không làm / Chạm
- Không đụng canvas/*, "+" menu, công tắc flow, DLC. Không migration. "Gửi yêu cầu cho quản trị nền tảng": vẫn chưa có cơ chế yêu cầu ⇒ chỉ câu hướng dẫn.
- Mẫu khe cũ KHÔNG bị xoá trong DB (còn là mặc định của khe `community.*` ở prod); chỉ ẩn/gắn nhãn ở UI.

## Test tối thiểu
unit `readiness-view.test.ts`, `library-view.test.ts`, contracts `template-readiness.test.ts`; int `template-fixes.int.test.ts` (quyền + cách ly công ty + audit); e2e `community-web/template-readiness.cs.ts`.

## Quyết định trong lúc làm
- Công ty khác tenant_admin gọi route sửa ⇒ 403 hoặc 404 (không lộ tồn tại) — cả hai đều không ghi.
- Ẩn mẫu cũ chỉ ở UI vì "không công ty nào dùng" cần số liệu prod.

## Checklist deploy (SQL kiểm prod trước khi gỡ hẳn mẫu khe cũ Community)
```sql
-- công ty đang dùng mẫu khe cũ (gán, luật định tuyến, bản riêng)
select 'assigned' as via, cf.tenant_id from hub.company_flows cf join hub.process_defs d on d.id = cf.flow_id where d.slot like 'community.%' and d.tenant_id is null
union all select 'routing', r.tenant_id from hub.process_routing_rules r where r.slot like 'community.%'
union all select 'tenant_defs', t.tenant_id from hub.process_tenant_defs t where t.slot like 'community.%'
union all select 'copy', c.tenant_id from hub.process_defs c join hub.process_defs s on s.id = c.source_template_id where s.slot like 'community.%' and c.tenant_id is not null;
-- mẫu mặc định của khe (không gỡ khi còn là mặc định)
select slot, default_def_id from hub.process_slots where slot like 'community.%';
```

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/company-flows.md
#### Yêu cầu: Platform thấy và sửa một chạm điều kiện của mẫu trước khi gán
Chọn mẫu để gán hiện thiếu gì (tính năng, chức năng, nhóm); nút "Bật tính năng cho công ty" và "Tạo nhóm theo gợi ý" chỉ platform_admin, ghi audit; Gán khoá tới khi dùng được. Công ty thấy cùng thông tin trước khi sao chép.
- Kịch bản: khi platform bấm sửa một chạm cho đúng công ty thì công ty khác không đổi và có dòng audit [test: apps/admin-api/src/modules/template-fixes/template-fixes.int.test.ts » enable-feature]
- Kịch bản: khi tenant_admin gọi route sửa thì bị từ chối và không ghi gì [test: apps/admin-api/src/modules/template-fixes/template-fixes.int.test.ts » vai khác platform_admin]
- Kịch bản: khi mẫu chưa dùng được thì Gán khoá, bấm sửa xong gán được, công ty sao chép và áp dụng được [test: e2e/community-web/template-readiness.cs.ts » platform: mẫu chưa dùng được]

## Việc còn lại
- Cơ chế "Gửi yêu cầu cho quản trị nền tảng"; gỡ hẳn mẫu khe cũ sau khi chạy checklist SQL ở prod.