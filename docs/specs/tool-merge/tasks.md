---
id: tool-merge
lát: tool-merge
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Giảm conflict rebase của `slice:merge`: merge driver JSON theo key cho locale i18n + tự giải conflict `tests/.lock`.

## Làm
- `json-merge.rules.ts` (gộp 3 chiều thuần), `json-merge-driver.ts` (CLI git driver), `setup-merge-driver.ts` (git config idempotent, gọi từ postinstall/slice:new/slice:merge), `.gitattributes`.
- `slice-rebase.ts`: rebase tự giải conflict chỉ ở `tests/.lock` rồi relock + commit; nối vào `slice.ts`.

## Không làm / Chạm
- Không đổi `test-lock.ts`, `package.json`.

## Test tối thiểu
- `json-merge.rules.test.ts`, `slice-rebase.test.ts` (thuần), `json-merge-driver.git.test.ts` (git thật trong repo tạm).

## Quyết định trong lúc làm
- Conflict thật: driver chạy `git merge-file` để có dấu conflict chuẩn + in key xung đột, exit 1.
- Relock sau rebase là commit riêng (không amend) để không viết lại commit của lát.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ dev)

## Việc còn lại
