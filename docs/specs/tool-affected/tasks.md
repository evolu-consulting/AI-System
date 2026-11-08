---
id: tool-affected
lát: tool-affected
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Mở rộng `test:affected` sẵn có (TS1) thay vì viết lại: in kế hoạch (người + `--json`), `--run local|server|all`; thêm `tests/known-red.json` (đỏ đã biết có hạn) để `test:e2e:par`, `test:int:par` và tóm tắt evotest in đỏ MỚI riêng với đỏ cũ.

## Làm
- `test-affected.rules.ts`: `--base <ref>`, `--json`, `--run`, `--frozen`; việc e2e (`jobs`), gói typecheck; owner thêm community-web, chat*, thư viện quy trình → P-a.
- `test-affected.server*.ts`: chia int/e2e vào các thùng theo slot trống (`res:check --server --json`), chạy `run-tests.ps1` song song.
- `known-red*.ts`, `tests/known-red.json` (hạn 2026-11-17), nối vào `test-e2e-par.ts` / `test-int-par.ts`; `in-container.sh` bật `TEST_QUARANTINE=1`.
- `tests/external-owned.json` + `external-owned*.ts`: `test:affected` bỏ test DLC của rowan (`--include-external` để chạy); token `dlc`/`aidlc` (không khớp `sdlc`).
- `slice.ts`: `slice:merge` gọi `test:affected --run=all` (giữ hành vi chạy đủ như trước).

## Không làm / Chạm
Không sửa `run-tests.ps1`, `remote.sh`, hook, merge driver. Không đổi `test:all` (vẫn nghiêm).

## Test tối thiểu
`known-red.test.ts`, `test-affected.jobs.test.ts`, `test-affected.server.test.ts`, `test-affected.test.ts` (unit, không cần DB).

## Quyết định trong lúc làm
- Không `--run` ⇒ chỉ lập kế hoạch (trước đây chạy hết); `slice:merge` đổi sang `--run=all`.
- Quarantine khớp theo ranh giới tên (file hoặc tiêu đề ca), hết ngày `expires` ⇒ coi như đỏ mới; chạy đỏ không rút được tên ca ⇒ đỏ mới.
- evotest luôn quarantine (container đặt `TEST_QUARANTINE=1`); `test:all` cục bộ vẫn nghiêm trừ khi truyền `--quarantine`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ dev, không đổi hành vi sản phẩm)

## Việc còn lại
- Gia hạn/xoá các mục `tests/known-red.json` trước 2026-11-17.
