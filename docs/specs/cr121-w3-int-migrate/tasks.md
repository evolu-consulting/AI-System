---
id: cr121-w3-int-migrate
lát: cr121-w3-int-migrate
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
verify:wave có 4 ca int đỏ mới; tìm nguyên nhân gốc, sửa test/seed (không sửa migration).

## Làm
- hub-h2c/h3a/h3b "áp lại migration sau nó": gỡ journal về trước 0068 rồi áp lại ⇒ 0068 dựng lại bảng `hub.process_slot_assignments` (vì 0099 đã gỡ view)
  nhưng bảng `process_slot_assignments_legacy` (0091 đổi tên) còn PK `process_slot_assignments_pkey` ⇒ "relation already exists". Migration 0096–0102 đều
  idempotent, không đổi. Sửa helper test `rollbackJournalFrom` (packages/db/src/test-db.ts): gỡ journal qua 0068 ⇒ drop `_legacy` (đúng trạng thái "trước 0068").
- seed-niti "chạy lại = không đổi gì": hồi quy do hub F-1 (assign đặt luật MẶC ĐỊNH của khe, f89d14af); seed so luật gồm cả mặc định và gán lại mỗi lần.
  Sửa `ensureRouting`: chỉ gán quy trình chưa trong tập, so/ghi phần luật theo phòng ban × loại HĐ, giữ luật mặc định. Base d4985a56 xanh, HEAD đỏ ⇒ không vào known-red.

## Không làm / Chạm
Không sửa migration; không đụng dữ liệu NitiGroup (chỉ SeedSpec giả trong test).

## Test tối thiểu
hub-h2c/h3a/h3b + seed-niti int trên evotest.

## Quyết định trong lúc làm
Sửa test helper + seed, không sửa migration cũ 0068 (đã trên prod, checksum journal).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa test helper và script seed-niti idempotent; không đổi hành vi sản phẩm/migration).

## Việc còn lại