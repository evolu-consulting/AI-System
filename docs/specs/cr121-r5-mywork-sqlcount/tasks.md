---
id: cr121-r5-mywork-sqlcount
lát: cr121-r5-mywork-sqlcount
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-q4-contract-name, cr121-r1-v2d-perf
---
## Plan (ngắn)
`W1/mywork` › "W1-NFR · số câu SQL cố định" đỏ khi wave nặng (cùng kiểu V2-D/perf). `mywork.repo` là file Q-4 sửa ⇒ phải loại trừ lỗi thật trước.

## Làm
- Loại trừ lỗi thật: vòng 25 s (1800 lượt `GET /my-work`) sau khi lọc câu nền ⇒ luôn đúng 2 câu (phạm vi tx + 1 câu nghiệp vụ), 0 hàng hay 120 hàng như nhau.
- Bắt được câu thừa (vòng lặp chẩn đoán tạm, không commit) — đều là câu NỀN của Hub chung pool, không phải của `my-work`:
  1. vòng nền chạy lượt: `select "id", "tenant_id", … "room_id" from "hub"."runs"`;
  2. job-orphan-sweep: `UPDATE hub.jobs SET status = 'queued'|'failed' …`;
  3. room-post-reconcile: `select r.id from hub.runs r where r.room_id is not null and r.room_posted_at is null …`;
  4. nạp kiểu mảng của postgres.js khi pool mở thêm kết nối (`select b.oid, b.typarray from pg_catalog.pg_type …`) — regex cũ của `TX_CTL` chỉ khớp một khoảng trắng nên không loại được khi câu xuống dòng.
- `tests/acceptance/HD1/_support/hd1.ts`: `captureSql` bỏ đúng 3 mẫu nền (mảng `BACKGROUND`, mỗi mẫu kèm lý do) + sửa regex nạp kiểu bằng `\s+`;
  thêm `expectQueryCounts(caps, expected)` (lệch ⇒ lỗi kèm văn bản mọi câu) dùng ở `W1/mywork` (2 ca) và `W1/sourcing` (3 ca); re-export ở `W1/_support/w1.ts`.

## Không làm / Chạm
Không đổi code sản phẩm, không đổi ngưỡng. Các test dùng `count()` (V2-E, HD9, V2-G, V2-A) vẫn trả số trần: chưa chuyển sang `expectQueryCounts` (tiếp nhận được vì cùng helper); cần thì làm lát sau.

## Test tối thiểu
Int: W1/mywork, W1/sourcing, V2-D/perf, V2-E/sqlcount, HD9/sqlcount, V2-A/perf, V2-G/perf, HD1/patch, HD2/extract xanh trên evotest.

## Quyết định trong lúc làm
Lọc theo mẫu văn bản nền (allowlist có lý do), không đếm-rồi-trừ; ALS không dùng được (R-1). Vòng chẩn đoán dài phải đặt timeout test riêng (mặc định 5 s làm test chồng chéo).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ đổi helper test `captureSql`/`expectQueryCounts`; sản phẩm không đổi).

## Việc còn lại
Chuyển các test dùng `count()` sang `expectQueryCounts` để lệch là thấy ngay câu thừa; thêm mẫu vào `BACKGROUND` khi bắt được vòng nền khác (kèm lý do).
