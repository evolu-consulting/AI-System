---
id: cr115-perf-caps
lát: cr115-perf-caps
cr: CR-115
làn: nhanh
migration: không
phụ thuộc: cr115-perf-exclusive (đã merge 26d64fae)
---
## Plan (ngắn)
Khi `-Step perf -Exclusive` máy đã yên nên bỏ cap CPU "nhường prod" của slot thường (PG 1 CPU, runner nice 19, cpu_shares 128) để số perf phản ánh mã. Chế độ thường giữ nguyên cap.

## Làm
- `deploy/evotest/docker-compose.exclusive.yml` (mới, override): pg `cpus: 4`, redis `cpus: 1`, runner `cpus: 4` + `entrypoint: [bash, /in-container.sh]` (bỏ `nice -n 19`), `cpu_shares: 1024` (mặc định Docker).
- `remote.sh`: `DC=(docker compose -p … -f docker-compose.yml)` + `-f docker-compose.exclusive.yml` khi `EVO_EXCLUSIVE`; mọi lệnh compose dùng `DC`; in `exclusive-config <service>: cpus=… cpu_shares=… entrypoint=[…]` (từ `docker compose config`) — chế độ thường in một dòng `caps: slot thường (…)`.
- `run-tests.ps1`: ship override trong kit; `exclusive.txt` gồm cả dòng `exclusive-config`.
- Docs: WORKFLOW (bullet `-Exclusive`) + README evotest: số perf chỉ so ngưỡng khi đo `-Exclusive`.

## Không làm / Chạm
Không đổi cap của int/e2e/py/perf thường. Chạm: deploy/evotest/{docker-compose.exclusive.yml,remote.sh,run-tests.ps1,README.md}, docs/WORKFLOW.md.

## Test tối thiểu
Chạy thật trên evotest: `-Step perf -Exclusive` 3 lần (dưới); `exclusive.txt` có 3 dòng exclusive-config đúng cấu hình. Không thêm unit test (không có logic thuần mới; luật khoá đã có test ở lát trước).

## Quyết định trong lúc làm
- Override là file compose riêng (không sửa file gốc) ⇒ chế độ thường không đổi byte nào.
- 4+1+4 = 9 CPU ≤ 12 lõi; vì `-Exclusive` đã chờ mọi slot rảnh nên không tranh slot khác (prod vẫn chạy, `cpu_shares` mặc định ngang prod).

## Số đo (3 lượt `-Exclusive`, cấu hình bỏ cap: pg 4 CPU, runner 4 CPU không nice, shares 1024; `background.perf.int.test.ts`)
| lượt | load1 đầu→cuối | PD-P13 p50 / p95 | 10.000 task nhắc | PD-P14 p50 / p95 | 20.000 run hết hạn |
|---|---|---|---|---|---|
| 1 | 2,64 → 2,29 | 51 / 83 ms | 6141 ms | 36 / 72 ms | 11833 ms |
| 2 | 2,71 → 2,31 | 45 / 55 ms | 6232 ms | 34 / 76 ms | 11203 ms |
| 3 | 1,22 → 1,74 | 54 / 90 ms | 5941 ms | 37 / 69 ms | 11714 ms |
Trước đó (cap, lát cr115-perf-exclusive): PD-P13 p50 47, p95 75–76, 10k 6128–6289 ms; PD-P14 p50 36–38, p95 61–72, 20k 11272–11864 ms.
Kết luận: bỏ cap CPU KHÔNG đổi số đo (p50 ±5 ms, p95 nhiễu 55–90 ms, tổng 10k/20k y nguyên) ⇒ nút thắt không phải CPU của PG/runner. Cả 2 test vẫn đỏ ngưỡng p95 ≤ 50 ms
(PD-P13 cũng 10k > 6 s ở 2/3 lượt). Cần điều tra ở mã/SQL của `remindOnce`/`sweepOnce` (độ trễ mỗi lô ~35–50 ms ổn định = chi phí câu lệnh/round-trip, không phải thiếu CPU), không phải hạ tầng.
Tải nền máy chủ lúc đo 1,2–2,7; hai lượt đã phải chờ lượt `-Exclusive` của agent khác (khoá xếp hàng hoạt động đúng).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ cấu hình tài nguyên của công cụ chạy test evotest ở chế độ -Exclusive; không đổi mã sản phẩm).

## Việc còn lại
- Điều tra vì sao lô 100 ổn định ~35–50 ms (profile `remindOnce`/`sweepOnce`, EXPLAIN, số round-trip) — hạ tầng không phải nguyên nhân.