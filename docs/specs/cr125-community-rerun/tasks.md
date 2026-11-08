---
id: cr125-community-rerun
lát: cr125-community-rerun
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chạy lại cơ học bộ community-web sau khi thêm mục «Tạo yêu cầu» vào nav; sửa test cũ lệch số thứ tự.

## Làm
- `apps/workspace-web/src/shell/use-flow-caps.test.ts`: vị trí «Chờ tôi duyệt» trong nav Sổ Hợp Tác 2 → 3 (sau khi «Tạo yêu cầu» được thêm vào nav).

## Không làm / Chạm
- Không đổi code sản phẩm. Chỉ chạm file test trên.

## Test tối thiểu
- `bun test apps/workspace-web/src/shell/use-flow-caps.test.ts`: 6 pass, 0 fail.
- `deploy/evotest/run-tests.ps1 -Step e2e -Filter community-web -Dirty`: XANH, 50 pass, 0 fail (2 job: community-web-stack, community-web).

## Quyết định trong lúc làm
- Không có ca đỏ ngoài expectation nên không chạy `test:lock:write` / `test:lock:verify`.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: sửa test cũ, chỉ cập nhật chỉ số mục nav trong test; sản phẩm không đổi)

Trạng thái gộp: chưa gộp

## Việc còn lại
- Không có. Chưa gộp (slice:merge không chạy trong lát này).
