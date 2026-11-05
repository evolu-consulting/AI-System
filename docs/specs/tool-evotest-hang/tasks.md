---
id: tool-evotest-hang
lát: tool-evotest-hang
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Vấn đề (4 lần trong 2026-11-05): trên evotest một test int vượt timeout 30 s, rồi `bun test` (1.3.14) không thoát, quay 100% CPU, không còn kết nối DB ⇒ cả lượt treo, phía local chỉ thấy "slot bận …" rồi im.
1. Container: `test:int:par` giám sát từng tiến trình `bun test` con (đọc stream sẵn có, không thêm việc): không có output mới quá `idleS` (120) HOẶC một file chạy quá `fileS` (300) ⇒ in `TREO: <file> · test cuối: <tên> · lý do`, SIGKILL, đánh dấu file đỏ `(treo)`, file chưa chạy của lô quay lại đầu hàng đợi và CHẠY TIẾP; tóm tắt cuối liệt kê file treo.
2. Local: `run-tests.ps1 -QuietMin K` (8): K phút không dòng nào từ máy chủ ⇒ cảnh báo + lệnh xem log slot; không tự dọn slot.
3. Bun: chỉ đề xuất (mục "Việc còn lại"), không đổi.

## Làm
- `tools/scripts/src/test-int-par.watchdog.ts` (thuần, đồng hồ truyền vào): `parseHangCfg` (`--hang-idle=`, `--hang-file=`, env `INT_HANG_IDLE_S`/`INT_HANG_FILE_S`, 0 = tắt), `HangWatch` (nhận mảnh stdout/stderr, nhận header `file:` + dòng `(pass|fail)`), `hangLine`.
- `tools/scripts/src/test-int-par.run.ts`: `runChunk` đọc stream + timer 1 s, `drain` (đưa file chưa chạy quay lại hàng đợi; mỗi vòng ít nhất bỏ file treo ⇒ luôn dừng). `test-int-par.ts` dùng `drain` cho cả worker lẫn làn tuần tự, thêm `(treo)` vào đỏ mới + dòng tóm tắt.
- `deploy/evotest/run-tests.ps1`: `-QuietMin` + timer .NET (`EvoQuiet`, vì vòng ssh chặn luồng chính).

## Không làm / Chạm
Không đổi bun, không đổi timeout 30 s của test, không đụng test:e2e:par, không tự dọn slot. Perf: watchdog chỉ đọc stream đã có (+1 timer/lô) — lượt bình thường không đổi.

## Test tối thiểu
- Unit đồng hồ giả: `tools/scripts/src/test-int-par.watchdog.test.ts`.
- Tích hợp nhẹ (bun test thật, không DB): `tools/scripts/src/test-int-par.hang.test.ts` — file vòng lặp bận bị kill ≤ idle+5 s, file còn lại vẫn chạy xanh.

## Quyết định trong lúc làm
- Xác định file treo bằng header `file:` cuối thấy được trong output (bun 1.3.x in header + `(pass)` cả khi pipe). Chưa thấy header ⇒ coi file đầu lô là file treo (file kế tiếp được chạy lại nên không mất file nào). Bun 1.4.3 (local) không in dòng pass khi pipe ⇒ chỉ idle/total, không biết "test cuối".
- Một file treo = một đỏ MỚI mang tên `(treo) …` (không khớp known-red).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ hạ tầng test/evotest — watchdog cho `test:int:par` + cảnh báo im lặng ở `run-tests.ps1`; không đổi mã sản phẩm nào).

## Việc còn lại
- Đề xuất (quyết định riêng, KHÔNG làm trong lát này): thử nâng bun lên bản 1.3.x/1.4.x mới hơn để tránh lỗi "không thoát sau timeout" (hiện `packageManager: bun@1.3.14`; máy local đã là 1.4.3). Cần: chạy bộ int đầy đủ trên evotest với bản mới, so sánh đỏ mới, rồi đổi `packageManager` + Dockerfile evotest cùng lúc.
- Chưa có bằng chứng thật trên evotest ngoài tích hợp local; lượt đầu có treo thật sẽ cho thấy dòng `TREO:` (kiểm bằng log `.data/int-s*.log`).
