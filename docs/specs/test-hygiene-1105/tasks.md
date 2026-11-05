---
id: test-hygiene-1105
lát: test-hygiene-1105
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Gom 4 việc vệ sinh test/kit, không đổi hành vi.

## Làm
1. T03b: request gửi `Connection: close` (Bun 1.3.14 tái dùng kết nối sau 401 sớm ⇒ 431); gỡ known-red; int ×3 xanh trên evotest.
2. V2-G perf: arrange/TRUNCATE + seed 15 HĐ ra ngoài vòng đo; ngưỡng 250 ms giữ nguyên. perf (-Step perf, không Exclusive): p50 174 ms / p95 202 ms (lần khác 185/275 — nhiễu 12 mẫu; bản cũ 180/210).
3. Sửa kiểu `@ai/scripts` typecheck (evotest-lock.int.test.ts, perf-probe.rules.ts).
4. `deploy/stg-sohoptac2` (kit CR-102 cũ): không dùng nữa (thay bằng `deploy/stg-cr118`; còn S2_PORT_COMMUNITY/8085, service + seed community đã bỏ từ CR-119) ⇒ ghi chú ở đây và GIỮ NGUYÊN, không sửa.

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa test/kiểu/ghi chú kit staging cũ; server giữ 401 trước khi đọc body).

## Việc còn lại
