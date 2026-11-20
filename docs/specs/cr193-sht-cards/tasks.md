---
id: cr193-sht-cards
lát: cr193-sht-cards
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
BR-193-8 + luật thẻ L2/L3 cho trang Sổ Hợp Tác (CR-193). Chỉ giao diện.

## Làm
- Chi tiết HĐ: lưới [thông tin 360px | khung PDF còn lại]; PDF 100% = vừa bề rộng khung (`PdfPane`); DetailGrid xếp một cột khi hẹp.
- Trang đổi: chi tiết hợp đồng (HĐ nhập tay), danh sách HĐ (UploadPanel bỏ cuộn riêng), Chữ ký của tôi (SignedDocsPanel dòng kẻ), Cài đặt (FlowList, RepPane, FlowAssignMembers).

## Không làm / Chạm
`features/partners/**`, Community, hộp thoại, router, token web-kit, API/DB.

## Test tối thiểu
e2e `e2e/contracts-web/cr157-manual-fallback.cw.ts` cập nhật (không chạy); tsc workspace-web.

## Quyết định trong lúc làm
- Khung PDF chỉ nằm ở cột «tệp gốc» của HĐ nhập tay nháp; dùng chung `PdfPane` nên hộp thoại cũng vừa bề rộng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/chi-tiet-hop-dong-bo-cuc.md
#### Yêu cầu: Bố cục chi tiết hợp đồng
Cột thông tin rộng cố định ~360px cạnh khung PDF; PDF vừa bề rộng khung, không cuộn ngang; dưới 1024px xếp dọc.
- Kịch bản: khi mở HĐ nhập tay ở màn 1400px thì cột thông tin ~360px, tệp gốc chiếm phần còn lại [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · màn nhập tay: form và tệp gốc 2 cột full chiều rộng]

## Việc còn lại
Ảnh baseline chụp lại (điều phối). Chưa soát hết Panel lồng Panel ở Nội bộ (OrgPage chỉ có bảng/dải, không lồng rõ).
