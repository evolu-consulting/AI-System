---
id: tool-e2e-fix
lát: tool-e2e-fix
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa hồi quy của `test:e2e:par --only`: nhiều tên cách nhau bằng dấu cách (`"contracts-web P-a"`) không khớp việc nào ⇒ 0 việc ⇒ chết ở `saveTimings` (ENOENT `.data`).

## Làm
- `onlyWants`/`jobMatches`/`unmatchedOnly` (tách theo dấu phẩy HOẶC khoảng trắng); `main` báo lỗi rõ (mã 2) khi tên không khớp hoặc 0 việc, kèm danh sách việc có sẵn.
- `saveTimings`: không ghi khi 0 việc; `mkdir -p .data` trước khi ghi.

## Không làm / Chạm
Chỉ `test-e2e-par.{ts,rules.ts,test.ts}`.

## Test tối thiểu
`test-e2e-par.test.ts` (lọc nhiều tên, tên không khớp).

## Quyết định trong lúc làm
Tên nào trong `--only` không khớp cũng là lỗi (không chỉ khi 0 việc) để gõ sai không âm thầm bỏ mất một việc.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ dev, sửa lỗi script test)

## Việc còn lại
