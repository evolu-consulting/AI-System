---
id: cr112-docs
lát: cr112-docs
cr: CR-112
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chỉ tài liệu: chốt 17 câu intake, spec master CR-112, ADR-0033, nhập Phần A vào `docs/current/admin`, dòng CR-112.

## Làm
- Intake mục "Chốt (2026-11-03)"; `docs/specs/cr112-admin-config/README.md`; `docs/adr/0033-app-roles-source-of-truth.md`; `docs/current/admin/*` (5 file); `docs/INDEX.md`; `docs/CHANGE-REQUESTS.md`.

## Không làm / Chạm
Không code, không migration, không sửa `ba-admin.md`/`feature-ui/tasks.md` (để lát sau).

## Test tối thiểu
`bun run openspec:check`.

## Quyết định trong lúc làm
- `current/admin` tách 5 file nhỏ theo mảng thay vì một file lớn.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ tài liệu)

## Việc còn lại
Ghi chú `ba-admin.md` "lỗi thời, xem current/admin" và sửa `feature-ui/tasks.md` khi làm S4.
