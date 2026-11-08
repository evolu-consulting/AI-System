---
id: cr121-r2-empty-shard
lát: cr121-r2-empty-shard
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

Lượt `verify:wave` 2: `contracts-web.8of9` (3,6 s) và `contracts-web.9of9` (1,3 s) đỏ, 0 fail, "không rút được tên ca".
Nguyên nhân thật (đọc `out.log`): KHÔNG phải mảnh rỗng mà là `Error: Process from config.webServer was not able to start. Exit code: 1` — cổng 3310 (build + preview contracts-web) đã bị mảnh `contracts-web.3of9` / `2of9` chiếm: chia 9 mảnh cho 7 thùng ⇒ `pickBin` buộc phải xếp hai mảnh cùng cấu hình vào một thùng (cùng slot chạy 2 việc cùng lúc, cùng cổng).

## Làm

- `wave-plan.rules.ts` `jobPieces`: số mảnh `--shard` ≤ số thùng (mỗi thùng tối đa một mảnh của một cấu hình) và ≤ số file spec đã đo của việc (`specFileCount`) ⇒ không còn mảnh rỗng/đụng cổng.
- `test-e2e-par.rules.ts`: mảnh `--shard` thêm `--pass-with-no-tests` (lưới an toàn khi danh sách test đổi và có mảnh rỗng thật ⇒ xanh, không đỏ vô danh).
- `wave-plan.test.ts`: 2 test mới (mảnh ≤ thùng và ≤ file; kế hoạch giống lượt hỏng 46 file/≈ 900 s/7 thùng không có thùng nào hai mảnh cùng cấu hình) + cập nhật test `--shard` có `--pass-with-no-tests`.

## Không làm / Chạm

Không chạy `verify:wave` thật. Chỉ `tools/scripts/src/wave-plan.rules.ts`, `test-e2e-par.rules.ts`, `wave-plan.test.ts`.

## Test tối thiểu

`bun test tools/scripts/src/wave-plan.test.ts tools/scripts/src/test-e2e-par.test.ts` (39 pass). Dry-run `bun tools/scripts/src/verify-wave.ts --plan --slots=N` với cache hiện tại (contracts-web 46 file ≈ 1000 s): N=5 → 5 mảnh, N=7 → 7, N=9 → 9; mỗi thùng tối đa 1 mảnh contracts-web (trước: 9 mảnh trên 7 thùng).

## Quyết định trong lúc làm

- Giả thuyết "mảnh rỗng" của điều phối không đúng; vẫn thêm `--pass-with-no-tests` làm lưới an toàn (rẻ, không đổi kết quả khi có test).
- Số mảnh bị chặn bởi số thùng làm mỗi mảnh dài hơn trần 150 s khi ít slot; chấp nhận (đụng cổng là lỗi cứng, dài hơn chỉ là chậm).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: hạ tầng chạy test của cổng đợt; sửa cách chia mảnh e2e, không đổi hành vi sản phẩm)

## Việc còn lại

- Xác nhận ở lượt `verify:wave` kế: không còn việc `contracts-web.*` đỏ mã 1 trong vài giây.
