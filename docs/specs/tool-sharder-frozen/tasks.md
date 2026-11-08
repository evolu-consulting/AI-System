---
id: tool-sharder-frozen
lát: tool-sharder-frozen
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nguyên nhân gốc: `run-tests.ps1` gán `$nf = if ($All) { @() } else { @("--no-frozen") }` rồi splat `@nf`; PowerShell 5.1 mở mảng 1 phần tử thành chuỗi, splat chuỗi ra TỪNG KÝ TỰ ("-","-","n"...) nên `test-e2e-par --list` không nhận `--no-frozen` ⇒ kế hoạch chia ngăn gồm job đóng băng (chat-x2b2, P-*, K1...).

## Làm
- `run-tests.ps1`: dựng `$listArgs` bằng mảng + `+=` `--no-frozen` khi không `-All`, gọi `bun @listArgs`.
- `frozen.rules.ts`: `selectE2eConfigs(configs, all)` là chỗ chọn cấu hình duy nhất (nguồn danh sách `FROZEN_E2E_CONFIGS`), `test-e2e-par.ts` dùng nó (chế độ 1 slot và chia slot cùng đường).

## Không làm / Chạm
Không đổi thuật toán chia/thời lượng, không sửa e2e, không thêm danh sách đóng băng thứ hai.

## Test tối thiểu
`bun test tools/scripts/src/evotest-shard.test.ts` (chọn job + chốt cú pháp truyền cờ trong run-tests.ps1). Kiểm tay: mô phỏng đoạn lập kế hoạch ⇒ không -All không còn job đóng băng; -All vẫn đủ.

## Quyết định trong lúc làm
Không thêm tham số `--all` cho `evotest-shard.ts plan`: nó chỉ nhận danh sách job đã chọn, tên job không ánh xạ ngược sang cấu hình.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: sửa lỗi công cụ test nội bộ evotest đúng hành vi đã tài liệu hóa — không -All thì bỏ module đóng băng khỏi lượt toàn bộ chia slot; không thuộc đặc tả sản phẩm)

## Việc còn lại
Không.
