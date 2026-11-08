# Tools · Chọn test và cổng merge

Cập nhật: 2026-11-09 · Gộp từ: tool-test-select (đợt cr125-wave).

## Yêu cầu: Filter nêu tường minh đường dẫn đóng băng luôn chạy, không khớp thì báo ngay (nguồn: tool-test-select)
`test:int:par` (và `run-tests.ps1 -Filter`) chạy file int/việc e2e thuộc suite đóng băng khi được nêu tường minh, không cần `-All`; filter không khớp file nào thì dừng với lỗi rõ thay vì chạy 0 file.
- Kịch bản: khi filter nêu thư mục đóng băng mà không có `-All` thì file đó vẫn chạy [test: tools/scripts/src/test-filter-frozen.test.ts » filter nêu thư mục đóng băng (P-a) không có -All ⇒ vẫn chạy file đó]
- Kịch bản: khi tiền tố filter quá rộng thì không kéo module đóng băng [test: tools/scripts/src/test-filter-frozen.test.ts » tiền tố RỘNG (tests/acceptance) không kéo file đóng băng vào]
- Kịch bản: khi filter không khớp file nào thì báo "Filter không khớp file nào" [test: tools/scripts/src/test-filter-frozen.test.ts » 0 file ⇒ error 'Filter không khớp file nào: …' (không chạy im lặng)]
- Kịch bản: khi `--only` e2e nêu tên việc đóng băng thì việc đó chạy [test: tools/scripts/src/test-filter-frozen.test.ts » nêu tên việc (P-a) ⇒ chạy P-a không cần -All, không kéo P-b]

## Yêu cầu: Chọn test bỏ qua file gốc không ảnh hưởng runtime và nói rõ lý do mở rộng (nguồn: tool-test-select)
`test:affected`/`verify:slice` không mở rộng danh sách vì docs, `*.md`, `tests/.lock`, biome, lefthook, depcruise, package.json chỉ đổi scripts; file gốc thật sự ảnh hưởng vẫn mở rộng và `--explain` in lý do; danh sách quá 150 file thì cảnh báo.
- Kịch bản: khi chỉ đổi file cấu hình/tài liệu thì không chọn thêm unit/int/typecheck [test: tools/scripts/src/test-affected.select.test.ts » chỉ đổi cấu hình/tài liệu/khoá ⇒ không unit-tất-cả, không typecheck, không typecheck:tests]
- Kịch bản: khi đổi tsconfig hoặc bun.lock thì vẫn mở rộng kèm lý do [test: tools/scripts/src/test-affected.select.test.ts » tsconfig đổi ⇒ vẫn mở rộng typecheck, kèm lý do]
- Kịch bản: khi danh sách quá 150 file thì có cảnh báo chạy cuối đợt [test: tools/scripts/src/test-affected.select.test.ts » nhiều hơn mức ⇒ có ghi chú gợi ý chạy cuối đợt]

## Yêu cầu: slice:merge dừng khi rebase làm lọt vi phạm ranh giới module (nguồn: tool-test-select)
Sau rebase lên `platform/gd0`, `slice:merge` chạy `check:boundaries`; có vi phạm mới thì dừng merge và in file vi phạm.
- Kịch bản: khi `check:boundaries` đỏ sau rebase thì dừng, báo cổng và file vi phạm, không chạy bước sau [test: tools/scripts/src/slice-rebase.test.ts » vi phạm MỚI ⇒ dừng ở cổng đỏ, trả tên cổng + file vi phạm (đuôi ≤ 40 dòng), không chạy cổng sau]
