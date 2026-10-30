---
id: openspec-delta
lát: openspec-delta
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chuẩn hoá Delta theo kiểu OpenSpec và thêm bộ kiểm (ADR-0032): `openspec.rules.ts` (parser + validator thuần), `openspec.ts` (check/pending/archive), hook `slice:merge`, khuôn `tasks.md` trong `slice:new`.

## Làm
Xong: parser/validator, CLI, hook, khuôn, test unit (13), docs (README current, WORKFLOW, CLAUDE.md, ADR-0032, STATE).

## Không làm / Chạm
Không tự sửa `docs/current`; không kiểm lại lát đã "đã gộp" dạng cũ; không dùng CLI OpenSpec.

## Test tối thiểu
`bun test tools/scripts/src/openspec`; `tsc -p tools/scripts`; biome.

## Quyết định trong lúc làm
- `slice:new` trước đây không sinh `tasks.md` nên khuôn nằm trong `slice.ts` (`TASKS_TEMPLATE`); ví dụ trong khuôn đặt trong khối ``` để parser bỏ qua, khuôn chưa điền báo "Delta rỗng".
- `openspec:check` không tham số: lát có thư mục `docs/specs/<lát>/` đổi so với merge-base `platform/gd0` + lát của nhánh `slice/<tên>` hiện tại.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

### MODIFIED README.md
#### Yêu cầu: Định dạng Delta
Mục Delta của tasks.md dùng khối ADDED/MODIFIED/REMOVED + Yêu cầu + Kịch bản.
- Kịch bản: khi lát không đổi hành vi thì ghi một dòng `Không thay đổi hành vi (lý do: …)`

## Việc còn lại
Docs-architect cuối đợt: chạy `bun run openspec:pending`.
