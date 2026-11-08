# CR-122 · P14 — Node mới tự có trường kỹ thuật

Trạng thái gộp: chưa gộp
Làn: nhanh · perf: không

## Kế hoạch
- `lib/node-defaults.ts`: `withNodeDefaults` (mã duy nhất từ tên, `<mã>.md`, mẫu `# <Tên>`, phần mặc định), `fillDraftDefaults`, `followRename`.
- Áp khi tạo node (`addWith`/`addFresh` ở use-draft, `insertOnEdge`), khi mở flow (`toDraft`) và khi Lưu (`use-def-save`).
- Đổi tên khi `keyAuto` ⇒ mã, tên tệp, mẫu mặc định đi theo (`patchStage`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md


#### Yêu cầu: Node mới tự có trường kỹ thuật
Node mới (palette, nút + trên cạnh, Thêm bước) và flow cũ thiếu trường tự có mã giai đoạn duy nhất, tên tệp kết quả và mẫu kết quả mặc định; lỗi chặn Lưu chỉ nhắc trường nghiệp vụ.
- Kịch bản: khi chèn bước Thông báo vào cạnh rồi kiểm tra thì không còn lỗi mã, tên tệp, mẫu kết quả [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » P14 · chèn Thông báo]
- Kịch bản: khi chèn hai node cùng tên thì mã khác nhau (thong-bao, thong-bao-2) [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » P14 · chèn Thông báo]
- Kịch bản: khi đổi tên mà mã còn tự sinh thì mã đổi theo tên [test: apps/admin-web/src/features/processes/lib/def-form.test.ts » patchStage: còn keyAuto]
