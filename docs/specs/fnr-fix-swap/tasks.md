---
id: fnr-fix-swap
lát: fnr-fix-swap
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: fnr-swap
---
## Plan (ngắn)
Lỗi e2e: luật "cùng họ" của `canSwap` chặn cả stage đang tạo (không chọn được Chờ tới ngày / Áp bản sửa / Gọi tool). Phát hiện thêm: e2e khoá (E06 P-c2, PD-E01/PD2-E05 P-d) đổi stage ĐÃ LƯU từ agent sang Áp/Chờ/Tool ⇒ editor không chặn theo họ; chỉ chặn `field_ref`.

## Làm
- [x] contracts: `canSwap(..., { skipFamily })`; `field_ref` vẫn kiểm cho mọi stage. Unit thêm ca stage mới agent -> wait_until/apply.
- [x] FE: `swapCheck` luôn truyền `skipFamily: true` (bỏ plumbing saved; thử thì E06 vẫn đỏ vì stage đã lưu).

## Quyết định trong lúc làm
- Quyết định coordinator (chỉ áp họ cho stage đã lưu) không đủ: e2e khoá đổi chính stage đã lưu. Chọn: editor bỏ luật họ, giữ `field_ref`; luật họ còn ở `canSwap` mặc định (contracts) cho nơi khác.
- PD2-E05 ("chưa có tool nào…") cùng nguyên nhân: không chọn được "Gọi tool" ở stage mới; không sửa riêng.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

### ADDED engine/flow-engine.md
#### Yêu cầu: Đổi node cùng họ chỉ áp cho node đã lưu
Editor không chặn đổi loại node theo họ; chỉ chặn khi field mà bước sau dùng sẽ mất. Bước mới chưa lưu chọn được mọi loại node.
- Kịch bản: khi thêm bước mới chưa lưu thì chọn được mọi loại node