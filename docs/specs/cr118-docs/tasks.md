---
id: cr118-docs
lát: cr118-docs
cr: CR-118
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Gộp Delta 20 lát CR-118 đã merge vào `docs/current` (đợt cr118-r1); cập nhật STATE, CHANGE-REQUESTS, CODEMAP, INDEX.

## Làm
Script gộp tạm (khối Delta nối vào file đích, mục "CR-118" thắng mục cũ), `openspec:archive` từng lát.

## Không làm / Chạm
Chỉ `docs/**`. Không gộp cr118-shell, cr118-deploy-kit (chưa merge). Không đối chiếu code từng mục (không đánh dấu ⚠ Lệch code).

## Test tối thiểu
`bun run openspec:check`, `check:size`.

## Quyết định trong lúc làm
Mục MODIFIED được nối cuối file đích dưới "## CR-118 · Delta gộp" thay vì sửa tại chỗ; chỗ cũ trong community/nghiep-vu.md (đăng nhập/SSO riêng) đánh dấu "Thay bởi CR-118".

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: lát chỉ gộp tài liệu docs/current và cập nhật STATE/CODEMAP/INDEX)