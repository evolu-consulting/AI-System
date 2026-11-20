---
id: cr193-sht-uat
lát: cr193-sht-uat
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Xử lý UAT mục 4, 5, 6, 9 (`docs/specs/CR-187/uat/REPORT.md`).

## Làm
- [x] 4 «Thu hồi» lời mời hỏi lại (confirmDialog). «Gửi lời mời» đã có hộp xác nhận + lời nhắn từ trước (ConnectSearchDialog.send, API có `note`) ⇒ không đổi.
- [x] 5 Khung chữ ký (thẻ «Chữ ký của tôi», hộp tạo/preview, SignatureAside, khay ký) nền trắng; ảnh đã lưu không đổi.
- [x] 6 Sơ đồ tổ chức < 640px: `orgFitOptions` zoom ≥ 0.85, bắt đầu ở nút gốc.
- [x] 9 Tin nhắn «⋯»: không lỗi (xem Quyết định).

## Không làm / Chạm
Không đụng ContractBody, Community. Chạm: PendingRequestsCard, i18n partners, 4 file chữ ký, flow-canvas org-chart.

## Test tối thiểu
`bun test packages/flow-canvas/src/org-chart` · e2e cr193-uat-*.cw.ts (viết, chưa chạy).

## Quyết định trong lúc làm
- Mục 4: bản mã nguồn hiện tại đã có hộp xác nhận + ô lời nhắn khi gửi lời mời (CR-191); UAT chạy bản cũ. Chỉ thêm xác nhận cho Thu hồi.
- Mục 9: không lỗi. `RoomRowMenu` render ở MỌI dòng phòng; nút «⋯» `opacity-0` chỉ ẩn trên máy có chuột (hiện khi rê/focus) và `[@media(hover:none)]:opacity-100` luôn hiện trên cảm ứng. Headless UAT chỉ thấy dòng đang hover/focus.
- Mục 5: dùng `bg-white` (giấy) thay token; ảnh không đổi màu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/cr193-uat-ui.md
#### Yêu cầu: Thu hồi lời mời hỏi lại
- Kịch bản: khi bấm «Thu hồi» ở lời mời đã gửi thì hiện hộp xác nhận, «Giữ lời mời» không thu hồi [test: e2e/contracts-web/cr193-uat-partners.cw.ts » Thu hồi lời mời hỏi lại, Giữ lời mời thì không gọi API]
#### Yêu cầu: Khung chữ ký nền trắng
- Kịch bản: khi ở chế độ Tối thì khung hiển thị chữ ký vẫn nền trắng [test: thủ công — lớp CSS bg-white, ảnh lưu không đổi]
#### Yêu cầu: Sơ đồ tổ chức đọc được trên điện thoại
- Kịch bản: khi màn hình hẹp thì zoom tối thiểu 0.85 và bắt đầu ở nút gốc [test: packages/flow-canvas/src/org-chart/org-graph.test.ts » điện thoại: zoom tối thiểu đủ đọc, bắt đầu ở nút gốc]

## Việc còn lại
Điều phối chạy e2e cr193-uat-*.cw.ts cuối đợt.
