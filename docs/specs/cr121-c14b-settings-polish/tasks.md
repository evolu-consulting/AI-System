---
id: cr121-c14b-settings-polish
lát: cr121-c14b-settings-polish
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c14
---
## Plan (ngắn)
Chỉnh nhỏ sau c14: khoá i18n `{{…}}`, tab Cài đặt theo `Tpl-Settings` (chép mã, thanh lưu chung, banner khoá), sửa bảng URL cũ trong spec.

## Làm
- i18n: locale gốc admin-web chỉ nội suy `{x}` ⇒ đổi nốt 3 chuỗi `appcfg.flow.*` (`{{addon}}`, `{{trigger}}`, `{{def}}`) sang `{x}`; test khoá `packages/i18n/src/placeholders.test.ts » không dùng cú pháp {{x}} trong locale gốc của admin-web`. Các file `process/*`, `chat/*`, `community/*`, `contracts/*` là của app/engine khác, dùng `{{x}}` và được đổi cú pháp lúc nạp — không đụng.
- Cài đặt: nút "Chép" mã công ty (+ "Đã chép" hoặc hướng dẫn chép tay khi bị chặn); MỘT thanh lưu chung "Có thay đổi chưa lưu · Huỷ · Lưu" cho form Thông tin và form Quota (`settings/save-order.ts`: MỘT lần bấm Lưu lưu Thông tin rồi Quota tuần tự, Quota chỉ gửi khi Thông tin đã xong và `version` mới đã về; máy trạng thái `flow`); banner khi công ty đang khoá (trạng thái + ai mở khoá được + người thao tác gần nhất).
- Spec `docs/specs/cr121-c/spec.md`: bảng URL cũ khớp quyết định c14 (`info→settings`, `at=quota`, `mode`).

## Không làm / Chạm
Không: "Gói + Đổi gói" (chưa có gói thương mại; giữ ô hạn mức ở Quota), không đổi API.

## Test tối thiểu
- unit: `tenants/settings/save-order.test.ts`, `packages/i18n/src/placeholders.test.ts`.

## Quyết định trong lúc làm
- Báo "Đã lưu" hoặc lỗi dùng toast sẵn có của từng form (lỗi nêu cách khắc phục qua `describeError`); thanh lưu chung chỉ gom nút.
- Cả hai form cùng đổi: một lần bấm Lưu, tuần tự (tránh 409 do `version` dùng chung). Thông tin lỗi/xung đột ⇒ Quota không gửi, báo cả hai chưa lưu + cách sửa; Quota lỗi sau khi Thông tin đã lưu ⇒ báo Thông tin đã lưu, Quota chưa + cách sửa.

## Khác biệt so với artboard
- Chưa có "Gói + Đổi gói" (xem trên). Banner khoá nằm trong tab Cài đặt, chưa ở đầu mọi tab. Chưa có lý do khoá riêng (API không lưu lý do), chỉ ghi người thao tác gần nhất.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cong-ty-cai-dat.md
#### Yêu cầu: Tab Cài đặt có thanh lưu chung, chép mã và banner khoá
Tab Cài đặt có một thanh lưu chung cho Thông tin và Quota, nút chép mã công ty, và banner nêu rõ khi công ty đang khoá.
- Kịch bản: Thông tin trước Quota khi lưu cùng lúc, chỉ form đang đổi [test: apps/admin-web/src/features/tenants/settings/save-order.test.ts » saveOrder]
- Kịch bản: một lần bấm Lưu gửi hai lời gọi nối tiếp theo version mới, lỗi ở lần 1 hoặc lần 2 báo rõ phần đã lưu [test: apps/admin-web/src/features/tenants/settings/save-order.test.ts » flow (một lần bấm Lưu)]
- Kịch bản: locale gốc admin-web không dùng cú pháp `{{x}}` [test: packages/i18n/src/placeholders.test.ts » không dùng cú pháp {{x}} trong locale gốc của admin-web]

## Việc còn lại
- Gói + Đổi gói khi có khái niệm gói thương mại; e2e thanh lưu chung và banner khoá (qc).
