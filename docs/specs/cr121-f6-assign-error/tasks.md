---
id: cr121-f6-assign-error
lát: cr121-f6-assign-error
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Gán quy trình cho công ty chưa dùng ứng dụng (vd Sổ Hợp Tác) trả 422 mà UI chỉ nói "Không thực hiện được. Thử lại sau." — vi phạm Luật GỐC 3.

## Làm
- Nguyên nhân việc vẫn hiện: `GET /hub-admin/tenants/:id/capabilities` liệt kê MỌI gói kèm khe (mức `off` cho app công ty chưa dùng), tab Quy trình trước đây không xét mức.
- Phòng trước: `FlowJob.appOff` (mức app = `off`) ⇒ dòng việc hiện "Chưa dùng ứng dụng" + lý do + link "Bật ở tab Ứng dụng" (`AppOffNote`), nút Gán/Đổi khoá, ngăn việc thay phần Gán bằng ghi chú; việc của app chưa dùng không tính vào tóm tắt "x/y".
- Lỗi gán: `lib/assign-error.ts` đọc mã thật của hub — `SLOT_GROUPS_MISSING` (nêu mã nhóm, dẫn Thành viên › Nhóm), `PROCESS_NOT_PUBLISHED`/`PROCESS_PUBLISH_INVALID` (dẫn Thư viện), `PROCESS_REF_INVALID` (dẫn Nhóm), mọi 422 khác ⇒ "Có thể công ty chưa dùng {app} hoặc quy trình chưa sẵn sàng" + link tab Ứng dụng; `ROUTING_*`/`VERSION_CONFLICT` vẫn dùng câu riêng của bộ sửa luật. Áp ở ngăn platform (`SlotRouting` hiện câu + link) và đường tenant/Sao chép (`useFlowAssign` toast câu + hướng dẫn). `useSlotRoutingActions` trả thêm lỗi gốc.
- i18n `tenants.flows.err.*`, `appOffStatus`, `reason.appOff` (vi+en).

## Không làm / Chạm
Không đổi hub (mã lỗi đã đủ). Không sửa e2e.

## Test tối thiểu
- unit: `tenants/flows/lib/assign-error.test.ts` (map lỗi), `flow-rows.test.ts » CR-121 f6 · việc của ứng dụng công ty chưa dùng` (trạng thái hàng, tóm tắt, đọc mức app).

## Ca e2e cần đổi (qc, không chạy)
- `e2e/cr121-c-flows.spec.ts` / `journey-approval/*`: công ty mới CHƯA bật Sổ Hợp Tác ⇒ hàng việc hiện "Chưa dùng ứng dụng" và không có nút `flows-assign-<việc>`; phải bật app ở tab Ứng dụng trước khi gán. Ca gán thật cần công ty đã dùng app.
- Ca đọc chuỗi lỗi chung "Không thực hiện được. Thử lại sau." ở ngăn gán ⇒ nay là câu theo mã (`flows-assign-error`).
- `e2e/cr121-c14-tabs.spec.ts`: "x/y việc có quy trình" không còn tính việc của app chưa dùng.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/cong-ty-gan-quy-trinh-loi.md
#### Yêu cầu: Việc của ứng dụng chưa dùng bị khoá và lỗi gán nói rõ cách sửa
Việc thuộc ứng dụng công ty chưa dùng hiện "Chưa dùng ứng dụng" kèm link bật ở tab Ứng dụng và không gán được; khi gán lỗi, câu thông báo nêu lý do và nơi khắc phục theo mã lỗi (thiếu nhóm, chưa xuất bản, lỗi cấu hình, ứng dụng chưa dùng).
- Kịch bản: app mức Tắt ⇒ hàng việc Chưa dùng ứng dụng, không tính vào tóm tắt [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » CR-121 f6 · việc của ứng dụng công ty chưa dùng]
- Kịch bản: thiếu nhóm, chưa xuất bản, 422 lạ ⇒ câu nghiệp vụ và hành động khắc phục [test: apps/admin-web/src/features/tenants/flows/lib/assign-error.test.ts » CR-121 f6 · assignErrorOf]

## Việc còn lại
- e2e hành trình (qc) cho công ty chưa dùng app.