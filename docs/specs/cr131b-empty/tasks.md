---
id: cr131b-empty
lát: cr131b-empty
cr: CR-131
làn: nhanh
migration: không
phụ thuộc: cr131-empty
---
## Plan (ngắn)
Phần (b) CR-131: admin-web + studio-web dùng `EmptyState`/`NotFoundPage` chung của web-kit (phần a).
- admin-web: `states/EmptyState` thành lớp mỏng (thêm `kind`, bỏ `icon`/`className`); các Empty lọc không ra (Users/Groups/Sources/AiTools/Secrets/Partners/Audit) ⇒ `search`; `ListEmpty` ⇒ `search`; `NotFoundState` (kèm 404 gốc, `WorkflowEditorPage`) ⇒ `notFound` + nút về.
- studio-web: `shared/EmptyState` lớp mỏng; `NotFoundPage` ⇒ `notFound` + nút về Agents.

## Quyết định trong lúc làm
- Lớp mỏng: có `title` ⇒ tiêu đề + hint = message; không có ⇒ message là tiêu đề đậm. Giữ nguyên câu chữ, i18n không đổi.
- `NotFoundState` dùng `full` ⇒ `h1` (e2e `cr112-nav` khoá heading «Không tìm thấy»).
- `check:bundle` admin-web đỏ sẵn (chunk 65.0 KB > 50 KB trước thay đổi, 63.6 KB sau) — không thuộc lát.

## Test tối thiểu
Unit của admin-web (1201) + studio-web (126) xanh; component web-kit đã test ở phần (a).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/trang-thai-trong-admin-studio.md
#### Yêu cầu: Trạng thái trống và không tìm thấy dùng một hình chung ở mọi app (nguồn: CR-131)
Admin và Studio dùng cùng khối hình + câu + nút như Hợp đồng và Chat; danh sách lọc không ra dùng hình «không có kết quả» kèm «Xoá bộ lọc».
- Kịch bản: khối trống/không tìm thấy hiển thị hình riêng theo loại cùng tiêu đề và nút hành động [test: packages/web-kit/src/ui/EmptyState.test.tsx » EmptyState]

## Việc còn lại
Không.
