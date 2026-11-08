---
id: tool-test-select
lát: tool-test-select
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa ba lỗi công cụ test/merge làm agent tốn lượt (2026-11-05): (1) `-Filter` nêu đường dẫn/việc đóng băng chạy 0 file im lặng;
(2) `test:affected`/`verify:slice` mở rộng gần hết bộ test khi chỉ đổi file gốc kiểu cấu hình; (3) `slice:merge` để lọt vi phạm
ranh giới module sau rebase (rebase không chạy hook).

## Làm
- `test-int-par.rules.ts`: `resolveIntFiles` + `namesFrozen` — filter nêu tường minh (file, hoặc thư mục trong cây đóng băng) luôn chạy; tiền tố rộng không kéo module đóng băng; 0 file ⇒ lỗi "Filter không khớp file nào: …" (exit 2), filter lẻ ⇒ cảnh báo. `test-int-par.ts` dùng nó, thêm `--check-only`.
- `run-tests.ps1`: kiểm filter int tại máy (`--check-only`, ≈1 s) trước khi upload; ghi chú hành vi mới.
- e2e: `explicitlyNamed` + `selectE2eConfigs(…, named)` — việc đóng băng được `--only` nêu tên (tên việc / đường dẫn cấu hình / tiền tố có `/`) vẫn chạy không cần `-All`.
- `test-affected.scope.ts`: `isNoRuntime` (docs/**, *.md, tests/.lock, biome.json, lefthook.yml, .dependency-cruiser*, package.json chỉ đổi scripts) bỏ qua khi chọn test; `Scope.expand`/`ignored`; mở rộng thật (tsconfig, bun.lock/bunfig/turbo/package.json deps, schema db không kèm migration chỉ-thêm, barrel packages/contracts, migration rộng) in lý do trong `--explain` (`⇱ mở rộng`, `∅ bỏ qua`) và JSON `--explain`.
- `test-affected.rules.ts`: danh sách unit+int > 150 (`TOO_MANY`) ⇒ ghi chú gợi ý chạy cuối đợt; `tests/.lock` không kéo `typecheck:tests`.
- `slice-rebase.ts` + `slice.ts`: `postRebaseGates` chạy `check:boundaries` sau rebase (trước test:affected); vi phạm MỚI ⇒ dừng merge, in file vi phạm.

## Không làm / Chạm
Không đổi `in-container.sh`/`remote.sh` (sửa ở `test-int-par`/`test-e2e-par` nên cả chạy local lẫn evotest đều đúng). Không đụng DLC. `openspec:check` đã chạy trước rebase — giữ nguyên.

## Test tối thiểu
Unit: `test-filter-frozen.test.ts`, `test-affected.select.test.ts`, `test-affected.scope.test.ts` (cập nhật), `slice-rebase.test.ts`. Một lượt evotest int xác nhận mục 1 (filter đóng băng không -All).

## Quyết định trong lúc làm
- Tiền tố rộng (`tests/acceptance`) vẫn không kéo suite đóng băng; chỉ đường dẫn nêu đúng file/thư mục đóng băng mới được chạy.
- `package.json` chỉ đổi scripts không còn kéo test của `tools/` (theo yêu cầu); test tools đọc package.json scripts nếu có phải chạy tay.
- `docs/**` im lặng như cũ (không vào danh sách `ignored`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED docs/current/tools/test-select.md
#### Yêu cầu: Filter nêu tường minh đường dẫn đóng băng luôn chạy, không khớp thì báo ngay
`test:int:par` (và `run-tests.ps1 -Filter`) chạy file int/việc e2e thuộc suite đóng băng khi được nêu tường minh, không cần `-All`; filter không khớp file nào thì dừng với lỗi rõ thay vì chạy 0 file.
- Kịch bản: khi filter nêu thư mục đóng băng mà không có `-All` thì file đó vẫn chạy [test: tools/scripts/src/test-filter-frozen.test.ts » filter nêu thư mục đóng băng (P-a) không có -All ⇒ vẫn chạy file đó]
- Kịch bản: khi tiền tố filter quá rộng thì không kéo module đóng băng [test: tools/scripts/src/test-filter-frozen.test.ts » tiền tố RỘNG (tests/acceptance) không kéo file đóng băng vào]
- Kịch bản: khi filter không khớp file nào thì báo "Filter không khớp file nào" [test: tools/scripts/src/test-filter-frozen.test.ts » 0 file ⇒ error 'Filter không khớp file nào: …' (không chạy im lặng)]
- Kịch bản: khi `--only` e2e nêu tên việc đóng băng thì việc đó chạy [test: tools/scripts/src/test-filter-frozen.test.ts » nêu tên việc (P-a) ⇒ chạy P-a không cần -All, không kéo P-b]

#### Yêu cầu: Chọn test bỏ qua file gốc không ảnh hưởng runtime và nói rõ lý do mở rộng
`test:affected`/`verify:slice` không mở rộng danh sách vì docs, `*.md`, `tests/.lock`, biome, lefthook, depcruise, package.json chỉ đổi scripts; file gốc thật sự ảnh hưởng vẫn mở rộng và `--explain` in lý do; danh sách quá 150 file thì cảnh báo.
- Kịch bản: khi chỉ đổi file cấu hình/tài liệu thì không chọn thêm unit/int/typecheck [test: tools/scripts/src/test-affected.select.test.ts » chỉ đổi cấu hình/tài liệu/khoá ⇒ không unit-tất-cả, không typecheck, không typecheck:tests]
- Kịch bản: khi đổi tsconfig hoặc bun.lock thì vẫn mở rộng kèm lý do [test: tools/scripts/src/test-affected.select.test.ts » tsconfig đổi ⇒ vẫn mở rộng typecheck, kèm lý do]
- Kịch bản: khi danh sách quá 150 file thì có cảnh báo chạy cuối đợt [test: tools/scripts/src/test-affected.select.test.ts » nhiều hơn mức ⇒ có ghi chú gợi ý chạy cuối đợt]

#### Yêu cầu: slice:merge dừng khi rebase làm lọt vi phạm ranh giới module
Sau rebase lên `platform/gd0`, `slice:merge` chạy `check:boundaries`; có vi phạm mới thì dừng merge và in file vi phạm.
- Kịch bản: khi `check:boundaries` đỏ sau rebase thì dừng, báo cổng và file vi phạm, không chạy bước sau [test: tools/scripts/src/slice-rebase.test.ts » vi phạm MỚI ⇒ dừng ở cổng đỏ, trả tên cổng + file vi phạm (đuôi ≤ 40 dòng), không chạy cổng sau]

## Việc còn lại
Một lượt evotest xác nhận mục 1 (xem báo cáo lát).
