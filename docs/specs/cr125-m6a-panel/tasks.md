---
id: cr125-m6a-panel
lát: cr125-m6a-panel
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: m1
---
## Plan (ngắn)
Spec `docs/specs/CR-125/spec.md` §m6a (MOD-FR-07/08). Sổ panel theo khoá node + panel chung dựng từ `configPort`.

## Làm
- `features/processes/modules/panel-registry.ts` (register/get/has, `configPortOf`, `hasNodePanel`), `generic/fields.ts` (schema → ô), `generic/GenericPanel.tsx`.
- Panel Ký số chuyển nguyên sang `modules/contracts/esign/Panel.tsx`, đăng ký ở `register-panels.ts`; `NodeConfigPanel.tsx` chỉ còn cửa vào.

## Không làm / Chạm
- Không nối canvas/menu "+" (m6b). `FlowEsignFields.tsx` GIỮ: là ô của form thư viện cũ (`FlowStepCard`), không phải panel node; gỡ cùng form cũ ở lát khác.
- Người/phòng ban lấy từ `refs` (users/groups); "nhiều người" tạm chọn một.

## Test tối thiểu
- unit `modules/panel-registry.test.ts`.

## Quyết định trong lúc làm
- Nhãn ô = `.describe()` của trường zod trong decl; vắng ⇒ tên trường đọc được. Có/Không/"Theo cài đặt" dùng lại chữ của panel Ký số.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Panel cấu hình node theo sổ
Node có panel riêng đăng ký theo khoá (Ký số) dùng panel đó; node khác có cổng cấu hình hiện panel chung dựng từ schema (người, phòng ban, số ngày/giờ, Có/Không, danh sách chọn) với nhãn nghiệp vụ.
- Kịch bản: khi node không có panel riêng thì ô nhập suy từ schema cổng cấu hình, nhãn lấy từ khai báo [test: apps/admin-web/src/features/processes/modules/panel-registry.test.ts » widget thành loại ô, nhãn từ decl, kiểu lồng bị bỏ]
- Kịch bản: khi chọn node Ký số thì dùng panel riêng đã đăng ký [test: apps/admin-web/src/features/processes/modules/panel-registry.test.ts » Ký số đăng ký panel riêng, node khác không có]

## Việc còn lại
- m6b: nối palette/menu "+" vào MODULES (khi đó node mới mới có `configPort` trong sổ).
