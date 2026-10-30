---
id: fix-test-types
lát: fix-test-types
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Đưa `bun run typecheck` (gồm `tsc -p tsconfig.tests.json`) và `bun run check` (depcruise) về xanh.

## Làm
- Sửa kiểu trong test (qc, chỉ kiểu, không đổi logic/assert): ép kiểu `as unknown as`, thêm 3 trường filter, `fv(value: string)`, tách dòng import bị nuốt vào comment ở `esign-flow-fix.int.test.ts`.
- `tools/scripts/src/seed-demo-v2.ts`: body `Uint8Array` ép kiểu cho fetch.
- Gỡ vòng import seed-community-demo: `MapRow` chuyển sang leaf `seed-community-demo.data.ts`.
- `kit/application/context.ports.ts`: bỏ import `@ai/contracts/chat`, dùng `kit/domain/context-kind.rules.ts` (ADR-0023).

## Không làm / Chạm
Không đổi hành vi runtime, không đổi luật depcruise. Test khoá dưới `tests/**` chỉ sửa kiểu, khoá lại sau.

## Test tối thiểu
Chạy lại từng file test đã chạm (int + unit) vẫn xanh.

## Quyết định trong lúc làm
`ContextEntityKind` ở domain khai báo lại union `"contract" | "partner"`; adapter dùng kiểu contracts nên lệch sẽ lỗi biên dịch.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

Không thay đổi hành vi (lý do: sửa kiểu trong test + gỡ vòng import)

## Việc còn lại
Không.