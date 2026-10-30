---
id: pl-editor-ui
lát: pl-editor-ui
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: L1 `pl-slot-core`, L2a `pl-library-api`, L2b `pl-slot-shape` (viết trước theo hợp đồng `docs/specs/process-library/design.md` §4–§5)
---
## Plan (ngắn)
L3 của CR-105 (`docs/specs/process-library/tasks.md` hàng L3): admin-web only. Client Hub gom MỘT file `features/processes/library-api.ts`
(gõ lỏng, đổi sang schema `packages/contracts` khi L2a đặt response). Hợp đồng theo quyết định readiness: KHÔNG tiền tố `/process-library`;
mở rộng `/process-defs…` + `/process-slots` + `/tenants/:tid/process-slots/:slot`; chỉ platform_admin.

## Làm
- Danh sách (platform_admin): tab "Thư viện" (`kind=library`, cột Dùng cho / Tenant đang dùng, nhãn "Mặc định · {khe}", Nhân bản, xoá khoá khi mặc định/đang gán) + tab "Mẫu · chạy thử" (`kind=template`, mẫu không lẫn danh sách chính).
- Editor def có `slot`: thanh công cụ (`components/library/LibraryToolbar`): Canvas | Form, Xuất bản (tác động B5 + lỗi B2), Lịch sử + Quay lại, Nhân bản, Gán cho tenant, Xem trước đường đi (B3), Đặt làm mặc định.
- Form = editor bước tuần tự chuyển từ contracts-web `FlowPane`/`lib/flow-*` (copy, không import chéo app): `lib/flow-form.ts` (reducer + validate + `slot_body`), `lib/flow-when.ts`, `components/library/Flow*.tsx`; phòng ban theo MÃ.
- Canvas khoá nút hệ thống (`contracts-route`/`contracts-finalize`): `lib/system-nodes.ts`, huy hiệu "Hệ thống", không xoá/đổi/kéo, panel chỉ đọc.
- Trang tenant (tab Gói): khối gán `features/tenants/components/slots/TenantProcessSlots` (gán / về mặc định).
- Chuỗi: `process.admin.library.*` (admin.vi/en.json) + `tenants.slots.*` (vi/en.json) — chạm `packages/i18n/locales` (cần cho chuỗi; không đụng loader).

## Không làm / Chạm
Không backend, contracts-web, migration. `useDefSave` thêm `extra` (gửi `slot`); `use-toggle-enabled` giữ `slot`.

## Test tối thiểu
Unit: `lib/flow-form.test.ts`, `lib/library-view.test.ts`, `lib/system-nodes.test.ts`, `features/tenants/lib/slot-candidates.test.ts`. e2e viết, không chạy: `e2e/P-a/pf4/process-library.pa.ts`.

## Quyết định trong lúc làm
- Form lưu `slot_body` (dạng `{steps:[…]}`, `parseSlotBody` nhận cả mảng); Canvas lưu `stages` + `slot`; chuyển Canvas↔Form chỉ khi không có thay đổi chưa lưu (chuyển đổi do Hub).
- Preview gọi Hub (`POST …/preview {deal,total_value}`), không tính phía client.
- Khoá nút hệ thống theo khoá tool, áp mọi quy trình (def tenant `contracts-approval` do máy quản).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-105)

### ADDED engine/thu-vien-quy-trinh-editor.md
#### Yêu cầu: Editor thư viện — Form, nút hệ thống khoá, gán, xuất bản
Platform admin sửa quy trình thư viện ở Canvas hoặc Form (bước tuần tự, phòng ban theo mã), nút hệ thống khoá, xuất bản kiểm trước và gán cho tenant ngay trong quy trình hoặc ở trang tenant.
- Kịch bản: khi nút gọi tool `contracts-route`/`contracts-finalize` thì canvas coi là nút hệ thống khoá [test: apps/admin-web/src/features/processes/lib/system-nodes.test.ts » isSystemStage: chỉ executor tool + khoá hệ thống]
- Kịch bản: khi thêm bước duyệt và Ký số thì Ký số luôn ở cuối và chỉ một [test: apps/admin-web/src/features/processes/lib/flow-form.test.ts » thêm bước duyệt chèn trước bước Ký số, Ký số luôn cuối và chỉ một]
- Kịch bản: khi quy trình mặc định hoặc đang gán thì không xoá được ở danh sách [test: apps/admin-web/src/features/processes/lib/library-view.test.ts » inUseReason: mặc định thắng, rồi tới đang gán]
- Kịch bản: khi bỏ chọn tenant trong hộp gán thì tenant đó về mặc định [test: apps/admin-web/src/features/processes/lib/library-view.test.ts » assignPlan: thêm tenant mới, bỏ tenant bỏ chọn]
- Kịch bản: khi trang tenant chọn quy trình để gán thì chỉ liệt kê quy trình cùng khe đã xuất bản [test: apps/admin-web/src/features/tenants/lib/slot-candidates.test.ts » chỉ cùng khe + đã xuất bản + đang bật, sắp theo nhãn]
- Kịch bản: khi platform admin sửa ở Form, xuất bản, gán tenant thì cột "Tenant đang dùng" tăng và Canvas hiện nút hệ thống khoá [test: e2e/P-a/pf4/process-library.pa.ts » sửa Form, xuất bản, gán tenant, canvas khoá nút hệ thống]

## Việc còn lại
Chạy lại e2e + khớp response thật khi L1/L2a/L2b gộp (xem "Khe hở hợp đồng" trong báo cáo lát).
