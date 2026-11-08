---
id: tool-evotest-scope-guard
lát: tool-evotest-scope-guard
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chặn bằng code: evotest-scope.ts (gọi từ run-tests.ps1 trước upload) + hàm thuần decideScope; -Wave/EVOTEST_WAVE bỏ chốt, verify:wave truyền -Wave qua runBins/evotestArgs.

## Làm
- [x] evotest-scope.rules.ts + test; evotest-scope.ts; run-tests.ps1 -Wave; verify-wave; test-int-par --check-only đếm sau lọc; e2e --list thêm config/nfiles; WORKFLOW 1 dòng

## Không làm / Chạm

## Test tối thiểu
bun test tools/scripts/src/evotest-scope.test.ts; chạy thật run-tests.ps1 -Step e2e (không filter) => exit 6 ngay.

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ dev evotest, không đổi hành vi sản phẩm; test: tools/scripts/src/evotest-scope.test.ts)

## Việc còn lại
