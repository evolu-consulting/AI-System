---
id: tool-case-check
lát: tool-case-check
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Windows (không phân biệt hoa/thường) gộp `tests/acceptance/cr118` và `tests/acceptance/CR118` thành một thư mục, còn CI/evotest/prod (Linux) tách hai — collision im lặng. Thêm `check:case`: đọc tracked (`git ls-files`) + staged (`git diff --cached --name-only --diff-filter=ACR`), báo mọi cặp đường dẫn (file hoặc tiền tố thư mục) chỉ khác chữ hoa/thường, exit 1. Gắn vào lefthook pre-commit cạnh check-size.

## Làm
- [x] `tools/scripts/src/check-case.rules.ts`: luật thuần `caseCollisions` (gom theo lowercase trên mọi tiền tố thư mục + file) và `formatCollisions`.
- [x] `tools/scripts/src/check-case.ts`: đọc index + staged qua `lib/git.ts`, in cặp, exit 1.
- [x] `package.json` `check:case`; `lefthook.yml` job `check-case` (chạy toàn repo, không cần `{staged_files}`).
- [x] `docs/WORKFLOW.md` một đoạn mô tả hook.

## Không làm / Chạm
- Không đổi tên `tests/acceptance/CR118` hay các thư mục khác; không đổi `check` tổng.
- Không chạm code sản phẩm.

## Test tối thiểu
- unit `tools/scripts/src/check-case.test.ts`: va chạm file, va chạm tiền tố thư mục, không báo trùng cho đường dẫn giống hệt, không báo khi chỉ có tiền tố chung.
- Chạy `bun run check:case` trên cây hiện tại (phải OK).

## Quyết định trong lúc làm
- Gom tiền tố thư mục vào cùng bảng với file: một path không thể vừa là file vừa là thư mục, nên không sinh cặp giả.
- Chạy toàn repo thay vì chỉ file staged: `ls-files` nhanh, và collision có thể nằm ở thư mục cha đã tracked.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ)

(Chỉ thêm kiểm tra dev-time: script + hook pre-commit; không đổi hành vi sản phẩm hay API.)

## Việc còn lại
- Không còn.
