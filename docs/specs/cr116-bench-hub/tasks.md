---
id: cr116-bench-hub
lát: cr116-bench-hub
cr: CR-116
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Pha 1 = chỉ đo + so sánh trực tiếp (không đoán, không đổi hành vi sản phẩm):
1. Chọn ứng viên bằng số đo: chạy các bộ perf Hub trên evotest với `pg_stat_statements` (bật tạm trong kit evotest, không commit), xếp hạng theo tổng thời gian / số lần gọi / buffers.
2. Top 6 ứng viên ⇒ bench A/B (`tests/acceptance/cr116-bench-hub/`): biến thể hiện tại vs 1–3 biến thể thay thế trên CÙNG dữ liệu seed (bản sao bảng Hub trong schema `bench`), cỡ ~100 và 10k–100k, so kết quả bằng nhau, p50/p95/tổng/số câu SQL; EXPLAIN (ANALYZE, BUFFERS) giải thích bên thắng; tài nguyên (CPU/RSS client, buffers PG); độ tin cậy (2 Hub đồng thời SKIP LOCKED, giết kết nối giữa tx).
3. `report.md`: bảng + kết luận "đã tối ưu" / "đổi được" (thắng ≥ 20% ở cả hai cỡ, kết quả bằng nhau) + công/rủi ro.

## Làm
- [x] `tests/acceptance/cr116-bench-hub/pgss-dump.ts` — reset/dump xếp hạng pg_stat_statements.
- [x] `_ab.ts` (khung A/B xen kẽ + EXPLAIN), `_seed.ts` (bản sao bảng + điền cột NOT NULL theo kiểu).
- [x] `hub-ab.perf.int.test.ts` (B1 isContinuing, B2 activeAndCap, B5 đọc đầu run + driver), `hub-ab2.perf.int.test.ts` (B3 người nhận, B4 bắn hẹn + độ tin cậy, B6 đếm chưa đọc).
- [x] `results/<ứng viên>-<cỡ>.json` (schema baseline lát cr116-probe; `ab-to-json.ts` gom từ log evotest; trung vị 3 lượt, B4/B6w 2 lượt, B6-100 1 lượt).
- [ ] `report.md` — nội dung đã soạn (bàn giao cho phiên điều phối); subagent bị công cụ chặn ghi file report .md.

## Không làm / Chạm
- Không sửa code sản phẩm, migration, kit evotest (bật pg_stat_statements chỉ tạm trên máy dev rồi hoàn lại).
- Không chạm đường DLC (tests/external-owned.json).

## Test tối thiểu
Chỉ file bench (PERF=1): `powershell deploy/evotest/run-tests.ps1 -Step perf -Exclusive -Filter tests/acceptance/cr116-bench-hub/` × 3.

## Quyết định trong lúc làm
- Bench trên bản sao bảng (`create table bench.x (like hub.x including defaults including indexes)`) thay vì bảng thật: seed 100k hàng không cần dựng chuỗi FK; index thật được giữ nên kế hoạch truy vấn tương đương. Hàm definer `hub.process_run_recipients` được sao từ `pg_get_functiondef` (đổi tên bảng) để so đúng thân hàm.
- PG evotest/prod = 16.15 ⇒ JSON_TABLE (PG17) không thử được; MERGE có nhưng không ứng viên nào là upsert nóng ⇒ không thử.
- pgmq / pg_cron / partition: không áp vào top 6 đo được (xem report.md §4) ⇒ không bench, ghi lý do.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đo)

## Việc còn lại
- Pha 2 (lát riêng, cần duyệt): áp các mục "đổi được" trong report.md (B1 index, B3 hàm theo tập, B4 bắn theo tập, B5 gộp đọc đầu run, B2 index).
