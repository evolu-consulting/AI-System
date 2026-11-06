---
id: cr121-f1-flows-state
lát: cr121-f1-flows-state
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Lỗi từ e2e ở Công ty › Quy trình: sau khi gán quy trình thư viện, dòng việc/tóm tắt không đổi; ngăn mở lại mất công tắc Sơ đồ/Danh sách.

## Làm
- Nguồn một: luật định tuyến của công ty. Hub `currentOf` đã ưu tiên luật mặc định của công ty trước mẫu khe (int `routing-backfill.int.test.ts` đã phủ: gán ⇒ `current_def_id` = bản vừa gán) ⇒ KHÔNG sửa hub. Lỗi nằm ở web: gán qua `useSlotRoutingActions` (ngăn của platform_admin) chỉ làm tươi luật của một việc, không làm tươi năng lực/tóm tắt/thân quy trình/bản thư viện.
- `useSlotRoutingActions`: sau mọi lần gán/bỏ gán/lưu luật làm tươi luật mọi việc của công ty, năng lực (`process/assigned/caps`), thân quy trình, bản thư viện, lượt chạy.
- `flow-rows.ts`: thêm `FlowJob.source` = `company` (có luật mặc định của công ty) | `system` (công ty chưa có luật, chạy mặc định hệ thống) | `none`; tóm tắt "x/y việc có quy trình" chỉ tính việc đã có quy trình của công ty ⇒ gán xong số tăng ngay. Dòng việc `system` hiện nhãn "Đang dùng mặc định hệ thống (công ty chưa gán quy trình riêng)".
- Ngăn việc: `DrawerSteps` luôn dựng tiêu đề + công tắc Sơ đồ/Danh sách (`flows-view-canvas|list`), không còn phụ thuộc `job.defId` đã tải lại hay chưa (trước đây `FlowDrawer` chỉ dựng khi có `defId`); chưa có quy trình ⇒ nói "Chưa chọn quy trình".

## Không làm / Chạm
Không sửa e2e (qc giữ). Không sửa hub (không phải nguyên nhân).

## Test tối thiểu
- unit: `tenants/flows/lib/flow-rows.test.ts » CR-121 f1 · nguồn quy trình đang dùng` (system vs company, gán ⇒ dòng đổi sang bản mới và tóm tắt 0 → 1).

## Quyết định trong lúc làm
- Mặc định hệ thống vẫn "Đang bật" (nó chạy thật) nhưng không tính vào "x/y việc có quy trình".
- Không tái hiện được lỗi bằng trình duyệt trong lát (chỉ unit); nguyên nhân suy ra từ code: tóm tắt/dòng việc đọc từ cache chưa được làm tươi sau gán ở ngăn platform.

## Ca e2e cần đổi (qc)
- `e2e/journey-approval/cr121-c-flows.spec.ts`: sau Gán kiểm dòng việc đổi tên quy trình + `flows-system-default-<việc>` biến mất + tóm tắt tăng; mở lại ngăn sau Esc vẫn thấy `flows-view-canvas`. Ca đọc "x/y việc có quy trình" (cr121-c14-tabs) nay không tính mặc định hệ thống.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cong-ty-quy-trinh-nguon.md
#### Yêu cầu: Dòng việc phản ánh quy trình đang dùng theo luật của công ty
Dòng việc và tóm tắt đọc từ luật định tuyến của công ty; công ty chưa có luật thì hiện rõ "Đang dùng mặc định hệ thống" và không tính là đã có quy trình; gán xong thì dòng việc và tóm tắt đổi ngay; công tắc Sơ đồ/Danh sách luôn có trong ngăn việc.
- Kịch bản: công ty chưa có luật mặc định ⇒ nguồn là mặc định hệ thống, không tính vào tóm tắt [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » CR-121 f1 · nguồn quy trình đang dùng (luật công ty thắng mặc định hệ thống)]
- Kịch bản: sau khi gán, dòng việc đổi sang bản vừa gán và tóm tắt tăng [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » CR-121 f1 · nguồn quy trình đang dùng (luật công ty thắng mặc định hệ thống)]

## Việc còn lại
- Xác nhận bằng e2e hành trình (qc) vì lát này chỉ chạy unit.