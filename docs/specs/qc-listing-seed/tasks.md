---
id: qc-listing-seed
lát: qc-listing-seed
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Seed e2e/script bật «cho tìm thấy» qua PUT /pack/contracts/connect/listing (route admin đã gỡ).

## Làm
Đổi cr127, flows3, smoke-flows; gỡ helper setDirectoryListed.

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: seed theo API mới).

Xoá khối mẫu dưới đây rồi điền thật (kiểm bằng `bun run openspec:check`). Lát không đổi hành vi: thay bằng
một dòng `Không thay đổi hành vi (lý do: …)`.
```
### MODIFIED sht/chung-tu.md
#### Yêu cầu: <tên>
<mô tả hành vi mới>
- Kịch bản: khi … thì … [test: <path test> » <tiêu đề test>]  (hoặc [test: thủ công — <lý do>])
(### ADDED <file mới>; ### REMOVED <file> + dòng "Lý do: …")
```

## Việc còn lại
