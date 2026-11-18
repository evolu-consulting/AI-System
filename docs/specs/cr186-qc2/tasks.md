---
id: cr186-qc2
lát: cr186-qc2
cr: CR-186
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
qc sửa e2e khoá theo fix-cr186-ui (bài có bình luận mở sẵn), thêm e2e chạm avatar người ký 390px + nhãn «Đã ký» (mock contracts-web), chạy community-web + contracts-web.

## Làm
- [x] Sửa cr147-feed, feed, roles.cs (3 chỗ), cr186-composer, cr129-mention (chỉ bấm khi đang gập).
- [x] Thêm `e2e/contracts-web/cr185-signed-strip.cw.ts`.

## Không làm / Chạm
- Không sửa code sản phẩm. Không chạy job cr181, không sửa journey-dot2 (nhãn «Đã ký» kiểm bằng mock contracts-web).

## Test tối thiểu
- evotest e2e: community-web, contracts-web.

## Quyết định trong lúc làm
- roles.cs / cr129-mention: dùng aria-expanded để bấm «Bình luận» chỉ khi đang gập (không biết chắc seed có bình luận).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ sửa và thêm test e2e).
