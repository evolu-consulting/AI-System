---
id: cr124-q6-journey
lát: cr124-q6-journey
cr: CR-124
làn: qc (e2e + sửa lỗi sản phẩm tìm được)
migration: không
phụ thuộc: q1–q5
---
## Plan (ngắn)
Hành trình e2e gửi hợp đồng cho đối tác trên stack thật (`journey-approval`): hai công ty mới A (gửi) và B (nhận), chuẩn bị đi đường thật (D5) — hồ sơ công ty, danh bạ, tính năng `contracts-partner-confirm` qua entitlement, nhóm duyệt của B, flow mẫu «Nhận HĐ thường» gán cho B.

## Làm
- `_ja-stack.ts`: dựng hai công ty `e2e-q6a-<hậu tố>` / `e2e-q6b-<hậu tố>` (hub đã chạy `HUB_PARTNER_MAILBOX=on` từ q5). Config: `cr124-q6*.spec.ts`.
- `_kit`: `featureIdByKey`, `setCompanyProfile`, `setDirectoryListed`, `createGroupWith`, `partnerSendNode`, `createLibraryFlow(inputs)`.
- Spec `cr124-q6-partner-journey.spec.ts`: (1) gửi lần đầu → giữ chờ kết nối → B nhận lời mời → thả → B duyệt → A «Đã xác nhận»; (2) «Trả lại sửa» có lý do; (3) màn Cài đặt nhận.
- LỖI SẢN PHẨM TÌM ĐƯỢC + SỬA: `packages/i18n/src/contracts-locales.ts` gộp tệp `partner.*.json` NÔNG ⇒ ghi đè cả nhánh `contracts.nav` và làm lệch thứ tự `esignflow` ⇒ toàn menu / nút của Sổ Hợp Tác hiện khoá thô (`contracts.nav.overview`, `contracts.approval.confirmSave`…). Nay gộp SÂU cùng `rep3`; test chặn hồi quy.

## Không làm / Chạm
Không đổi engine, không migration.

## Test tối thiểu
unit: `contracts-locales.test.ts` (gộp sâu). e2e: `cr124-q6-partner-journey.spec.ts` (đã chạy 3 lượt trên evotest — XEM «Việc còn lại»).

## Quyết định trong lúc làm
- Flow phía A dựng bằng API Thư viện (UI thêm node đã có spec editor riêng); phần còn lại đi đường thật (profile/entitlement/directory/nhóm/gán flow).
- Ảnh chụp ghi vào thư mục kết quả của ca (`test.info().outputPath`) để evotest kéo về.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/gui-doi-tac-giao-dien.md
#### Yêu cầu: Chuỗi giao diện của app Hợp đồng không mất khi thêm mục «Hợp đồng đối tác gửi»
Tệp bản dịch `partner` gộp sâu vào nhánh `nav` có sẵn, không ghi đè; menu và nút của Sổ Hợp Tác vẫn hiện chữ.
- Kịch bản: khi nạp bản dịch thì `nav.partner-inbox` có và `nav.overview`, `approval.confirmSave` vẫn còn [test: packages/i18n/src/contracts-locales.test.ts » tệp `partner` gộp SÂU]

## Việc còn lại
- Hành trình đỏ ở bước 1: sau khi nhân viên A «Gửi duyệt» và quy trình mở bước «Giám đốc duyệt», trang HĐ của Giám đốc A KHÔNG có nút Đạt/Duyệt (`[data-approval=pass|approve]`) dù chuông báo 1 việc chờ — dừng sau 3 lượt theo quy tắc. Chưa rõ nguyên nhân (nghi: thẻ duyệt của flow có bước thật «Gửi đối tác» chưa gắn run vào thẻ, hoặc `pass` bị ẩn khi người xem cũng là quản trị xác nhận). Bước 2–3 + ảnh chụp các màn đối tác CHƯA chạy tới.