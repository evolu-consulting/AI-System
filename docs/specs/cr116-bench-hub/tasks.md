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
- [x] Bảng đo + kết luận: mục `## Số đo` dưới đây (thay cho report.md — công cụ chặn subagent ghi file report .md).

## Không làm / Chạm
- Không sửa code sản phẩm, migration, kit evotest (bật pg_stat_statements chỉ tạm trên máy dev rồi hoàn lại).
- Không chạm đường DLC (tests/external-owned.json).

## Test tối thiểu
Chỉ file bench (PERF=1): `powershell deploy/evotest/run-tests.ps1 -Step perf -Exclusive -Filter tests/acceptance/cr116-bench-hub/` × 3.

## Quyết định trong lúc làm
- Bench trên bản sao bảng (`create table bench.x (like hub.x including defaults including indexes)`) thay vì bảng thật: seed 100k hàng không cần dựng chuỗi FK; index thật được giữ nên kế hoạch truy vấn tương đương. Hàm definer `hub.process_run_recipients` được sao từ `pg_get_functiondef` (đổi tên bảng) để so đúng thân hàm.
- PG evotest/prod = 16.15 ⇒ JSON_TABLE (PG17) không thử được; MERGE có nhưng không ứng viên nào là upsert nóng ⇒ không thử.
- pgmq / pg_cron / partition: không áp vào top 6 đo được (xem report.md §4) ⇒ không bench, ghi lý do.

## Số đo
Evotest `-Step perf -Exclusive` (PG 16.15, pg 4 CPU, runner 4 CPU, Bun 1.3.14, postgres.js 3.4.9). Đo xen kẽ trên cùng dữ liệu seed
(bản sao bảng Hub trong schema `bench`). Bảng dưới lấy từ lượt abrun1 (20261103-181515); các lượt khác lệch ≤ 15% và giữ nguyên thứ hạng.
Trung vị các lượt: `results/*.json`. SQL = số câu đi qua pool được tap đếm; số trong ( ) là client khác, đếm theo cấu trúc code. Cột =: kết quả bằng biến thể hiện tại.

### 1. Chọn ứng viên (pg_stat_statements, bộ perf Hub; đã bỏ câu của fixture)
| # | Câu (nơi gọi) | lần gọi | tổng ms | ms/lần | buffers/lần | ghi chú |
|---|---|---|---|---|---|---|
| 1 | chèn notice + đếm chưa đọc (`notify/batch.repo.ts`) | 390 | 5.495 | 14,1 | 2.701 | phần đếm unread tăng theo số notice |
| 2 | quét hết hạn run | 282 | 5.413 | 19,2 | 10.041 | đã theo tập, PD-P14 p50 35 ms |
| 3 | tìm my-chat-history | 300 | 4.573 | 15,2 | 3.262 | 100k tin/người, p95 đạt ngưỡng |
| 4 | `isContinuing` (`runs/launcher-session.ts`) | 2.317 | 2.770 | 1,20 | 1.487 | Seq Scan review_tasks + runs |
| 5 | `activeAndCap` (`runs/runs.repo.ts`) | 207 | 1.537 | 7,4 | 6.567 | đếm run đang chạy |
| 6 | `hub.process_run_recipients` (`core/core.repo.ts`) | 3.424 | 1.691 | 0,49 | 14 | N+1: một lần mỗi run |
| 7 | bắn hẹn: 4 câu/hẹn | 4×2.000 | 1.315 | 0,2–0,4 | — | per-row trong tx lô |
| 8 | đọc đầu run theo PK, 3 dạng câu | 4.634+3.634+2.738 | 408 | 0,03–0,04 | — | cùng hàng đọc 3 lần/bước |

Số câu mỗi luồng (tap pool, bộ P-d): lưu def 22–23 · bước tool 64 · nhánh 42–46 · danh sách run 2 · bắn hẹn ~8 câu/hẹn + 1 câu người nhận/hẹn.
Gửi tin (chat-fast): dispatch p50 33 ms; tổng p50 62 ms (fast) / 89 ms (orchestrator).
Quét hết hạn và my-chat-history đã theo tập và đạt ngưỡng ⇒ không bench.

### 2. A/B (ms)
| ứng viên | biến thể | hàng | p50 | p95 | SQL | = |
|---|---|---|---|---|---|---|
| B1 isContinuing | hiện tại (Seq Scan) | 100 | 0,58 | 0,72 | 1 | ✓ |
| B1 | + index (stage_run_id, tenant_id) trên cả 2 bảng | 100 | 0,61 | 0,77 | 1 | ✓ |
| B1 | + index một phần ask/answer + runs(stage, started_at) | 100 | 0,61 | 0,84 | 1 | ✓ |
| B1 | hiện tại | 100.000 | 26,00 | 31,55 | 1 | ✓ |
| B1 | + index | 100.000 | 0,79 | 1,90 | 1 | ✓ |
| B1 | + index một phần | 100.000 | 0,72 | 0,86 | 1 | ✓ |
| B2 activeAndCap | hiện tại | 100 | 0,49 | 0,86 | 1 | ✓ |
| B2 | + index một phần thêm pack_key is null | 100 | 0,49 | 0,57 | 1 | ✓ |
| B2 | hiện tại | 50.000 | 11,35 | 13,31 | 1 | ✓ |
| B2 | + index một phần pack_key | 50.000 | 7,01 | 9,13 | 1 | ✓ |
| B3 người nhận, lô 100 run | hiện tại: hàm × 100 tuần tự | 100 | 44,44 | 60,54 | 101 | ✓ |
| B3 | hàm × 100, pipeline postgres.js | 100 | 42,52 | 54,41 | 101 | ✓ |
| B3 | hàm × 100 qua Bun.sql | 100 | 30,77 | 60,66 | (100) | ✓ |
| B3 | 1 câu theo tập (lateral, `= any`) | 100 | 8,34 | 12,95 | 2 | ✓ |
| B3 | hiện tại | 10.000 | 45,33 | 91,87 | 101 | ✓ |
| B3 | pipeline | 10.000 | 44,07 | 86,55 | 101 | ✓ |
| B3 | Bun.sql | 10.000 | 36,24 | 62,18 | (100) | ✓ |
| B3 | 1 câu theo tập | 10.000 | 6,67 | 11,06 | 2 | ✓ |
| B4 bắn lô 100 hẹn | hiện tại: 4 câu/hẹn tuần tự trong 1 tx | 100 | 122,44 | 141,95 | 400 | ✓ |
| B4 | 4 câu/hẹn, pipeline | 100 | 116,24 | 161,07 | 400 | ✓ |
| B4 | 1 câu CTE (jsonb_to_recordset) | 100 | 5,65 | 7,70 | 1 | ✓ |
| B4 | hiện tại | 10.000 | 114,46 | 139,08 | 400 | ✓ |
| B4 | pipeline | 10.000 | 110,15 | 121,78 | 400 | ✓ |
| B4 | 1 câu CTE | 10.000 | 6,15 | 7,61 | 1 | ✓ |
| B5 đọc đầu run | hiện tại: 3 câu PK (prepared) | 100 | 0,96 | 1,64 | 3 | ✓ |
| B5 | 3 câu, prepare:false | 100 | 1,04 | 1,65 | (3) | ✓ |
| B5 | 1 câu gộp | 100 | 0,41 | 0,62 | 1 | ✓ |
| B5 | 3 câu qua Bun.sql | 100 | 0,46 | 0,72 | (3) | ✓ |
| B5 | hiện tại | 10.000 | 0,93 | 1,50 | 3 | ✓ |
| B5 | prepare:false | 10.000 | 1,03 | 1,68 | (3) | ✓ |
| B5 | 1 câu gộp | 10.000 | 0,40 | 0,59 | 1 | ✓ |
| B5 | Bun.sql | 10.000 | 0,44 | 1,01 | (3) | ✓ |
| B6 đếm chưa đọc | hiện tại: count(*) trên index một phần | 100 | 0,59 | 1,11 | 1 | ✓ |
| B6 | bảng đếm (tenant, user)→n | 100 | 0,49 | 1,05 | 1 | ✓ |
| B6 | hiện tại | 20.000 | 6,66 | 13,63 | 1 | ✓ |
| B6 | bảng đếm | 20.000 | 0,38 | 0,84 | 1 | ✓ |
| B6w ghi 100 notice | chèn (hiện tại) | 20.000 | 1,45 | 2,07 | 1 | ✓ |
| B6w | chèn + upsert bảng đếm | 20.000 | 1,84 | 3,50 | 2 | ✓ |

EXPLAIN (ANALYZE, BUFFERS):
- B1 ở 100k: hiện tại là Seq Scan, tổng 7.258 buffers, 25,8 ms; có index chỉ còn 15 buffers, 0,11 ms.
- B2 ở 50k: Index Scan 12,3 ms chuyển thành Index Only Scan 7,8 ms; buffers như nhau (3.153).
- B6 ở 20k: Index Only Scan, 631 buffers, 10,4 ms.

Tài nguyên client (B5, 500 lượt): 3 câu tốn 473 ms wall / 234 ms CPU; 1 câu tốn 201 ms wall / 95 ms CPU.

Độ tin cậy (B4, cả hai cách ghi):
- 2 Hub cùng chọn hẹn với SKIP LOCKED: bắn 200, trùng 0.
- Giết kết nối giữa tx, trước COMMIT: 0 hẹn bắn, 0 stage đổi.

**Phạm vi của B4:**
- Base c618e76d đã có CR-115: `fireBatch` qua `sysUow.systemEach`, 4 tx song song mỗi tx 25 hẹn, rồi `kickMany` sau COMMIT.
- Bench B4 chỉ đo phần lõi của `fireTimer` (4 câu: khoá timer, khoá stage, update timer, update stage) trên bản sao bảng. Không đi qua `fireTimer` thật.
- Phần này đo được 114–122 ms cho 100 hẹn khi chạy tuần tự trong 1 tx. Prod chia 4 tx song song, nên đóng góp thật vào PD-P01 nằm trong khoảng ≈ 29–31 ms (song song hoàn hảo) đến 122 ms (tuần tự).
- So với PD-P01 hiện tại 548/664 ms (p50/p95), phần này chiếm khoảng 5–22% của p50.
- Đổi sang CTE theo tập: lõi còn ≈ 6 ms. Lợi ở mức kịch bản: PD-P01 p50 giảm ≈ 23–116 ms (548 thành ≈ 525–432 ms, tức −4% đến −21%), chưa đo trực tiếp.
- Nếu đổi thêm người nhận theo tập (B3: 44→7 ms cho mỗi 100 run, chia 4 tx ≈ 9 ms) thì lợi thêm ≈ 9–37 ms.
- Phần còn lại của PD-P01 (≈ 400+ ms) là kick launcher sau COMMIT và các câu khác của `fireTimer`; các phần này chưa bench.
- Muốn biết lợi thật thì phải đo PD-P01 với `fireTimer` bản lô (Pha 2).

### 3. Kết luận
| ứng viên | kết luận | p50 nhỏ / lớn | công | rủi ro |
|---|---|---|---|---|
| B1 isContinuing | đổi được (có điều kiện: hoà ở 100 hàng; prod `hub.runs` lớn) | 0% / −97% | 1 migration (CONCURRENTLY) | thấp |
| B2 activeAndCap | đã tối ưu ở cỡ prod | 0% / −38% | — | — |
| B3 người nhận | đổi được | −81% / −85% | ½ ngày | TB (hàm definer/RLS ⇒ làn đầy đủ) |
| B4 bắn hẹn | đổi được (phần lõi; mức kịch bản ≈ −4…−21% PD-P01) | −95% / −95% | 1–2 ngày | cao (máy trạng thái, Opus) |
| B5 đọc đầu run | đổi được (gộp câu) | −57% / −57% | 2–4 h | thấp |
| B6 đếm chưa đọc | đã tối ưu ở cỡ prod (cỡ nhỏ −17% < 20%; ghi +27%) | −17% / −94% | — | — |

Cơ chế hiện đại:
- **Bun.sql native:** nhanh ≈ 2× mỗi round trip so với postgres.js. Đề xuất spike riêng vì phải đổi driver `@ai/db`.
- **Pipelining postgres.js:** không giúp.
- **Prepared statement:** đang dùng và thắng không prepared 8–11%.
- **Không áp dụng:**
  - JSON_TABLE: cần PG17.
  - MERGE: không có upsert nóng.
  - pgmq / Redis consumer group: nút thắt là số câu, không phải cơ chế hàng đợi.
  - LISTEN/NOTIFY: cache cấu hình đã dùng.
  - partition / BRIN / pg_cron: không có trong top.
- **Chưa đo:** Redis down, PG restart toàn cụm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đo)

## Việc còn lại
- Pha 2 (lát riêng, cần duyệt): áp các mục "đổi được" trong report.md (B1 index, B3 hàm theo tập, B4 bắn theo tập, B5 gộp đọc đầu run, B2 index).
