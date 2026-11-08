---
id: cr125-try-purchase-flow
lát: cr125-try-purchase-flow
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Thử: engine flow có dựng + chạy được quy trình mua hàng 11 bước không. Chỉ kịch bản demo + báo cáo khoảng trống, không sửa code sản phẩm.

## Làm
- `tools/demo/purchase-flow*.ts` (dữ liệu, bước, dựng công ty/nhóm/người, build UI, chạy lượt bằng API, chụp lượt chạy).
- `docs/specs/CR-125/purchase-flow-trial.md` (bảng ánh xạ + khoảng trống) · ảnh `docs/specs/CR-125/shots/purchase-flow/`.

## Không làm / Chạm
Không đụng code sản phẩm, DLC, migration.

## Test tối thiểu
Không (kịch bản thử tay trên stack UAT local, xem tài liệu).

## Quyết định trong lúc làm
- Dựng 20 bước bằng payload API (trần 20 bước/flow); canvas UI dùng để tạo từ mẫu, Xuất bản, Gán, Sao chép, chụp Ngang/Dọc.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: lát chỉ thêm kịch bản demo trong tools/demo và tài liệu thử nghiệm).

## Việc còn lại
Chụp hòm việc/thẻ theo vai trong app Hợp đồng (chưa dựng trong stack); dựng 20 bước bằng kéo-thả canvas; chạy ca «Từ chối» kết thúc lượt.
