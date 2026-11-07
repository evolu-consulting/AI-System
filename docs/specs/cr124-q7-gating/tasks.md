---
id: cr124-q7-gating
lát: cr124-q7-gating
cr: CR-124
làn: nhanh
migration: không
phụ thuộc: cr124-q6-journey
---
## Plan (ngắn)
Hai Medium của soát cuối đợt (docs/specs/CR-125/wave-review.md): (1) tính năng `contracts-partner-confirm` chưa được kiểm ở `/pack/contracts/partner/*` và tool `contracts-partner-send`; (2) `HUB_PARTNER_MAILBOX=off` (mặc định) vẫn cho tool ghi hàng mailbox không bao giờ giao ⇒ run kẹt.

## Làm
- `partner-routes.mount.ts`: `r.use("/partner/*")` kiểm `tenantFeatureOn(view, PARTNER_FEATURE, tenantId)` (cùng nguồn với cap menu `nav.mount.ts`) ⇒ 403 `PARTNER_FEATURE_OFF` + câu nghiệp vụ.
- `partner-send.tool.ts`: `channelOn` / `featureOn` kiểm TRƯỚC khi chạm DB; lỗi `PARTNER_CHANNEL_OFF` / `PARTNER_FEATURE_OFF`; bọc `withBusinessCodes` ⇒ `PackToolBusinessError` ⇒ run `needs_decision` ngay với `last_error_code`, thẻ hiện lý do (i18n `partner.*.json`, `attention.ts`).
- Đường nối: `PacksMountDeps.partnerMailbox` (từ `AppDeps`) + `view` → `mountContractsContext` → `mountIntake` → `mountPartnerSend`.

## Không làm / Chạm
Không làm: cảnh báo ở editor/validator khi kênh tắt (cần đưa cờ hệ thống vào cấu hình editor — ngoài phạm vi nhỏ; thẻ run đã nói rõ lý do khi chạm). Chạm: gói contracts (hub-api), i18n, `attention.ts`.

## Test tối thiểu
unit `partner-routes.gate.test.ts` (403 cho cả 6 route); int `partner-gating.int.test.ts` (kênh tắt / tính năng tắt ⇒ lỗi có mã, 0 hàng mailbox/sends/links; bật cả hai ⇒ gửi được); journey q6 một lượt.

## Quyết định trong lúc làm
- Tool dựng trực tiếp (test) không truyền `channelOn`/`featureOn` ⇒ coi là bật; ở mount thật `channelOn = partnerMailbox === true` (mặc định TẮT ⇒ từ chối).
- UI ẩn bảng «Vòng gửi đối tác» khi 403 (truy vấn lỗi ⇒ không có vòng); không thêm code web.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/gui-doi-tac-cong-tinh-nang.md
#### Yêu cầu: Các route đối tác chỉ mở khi công ty bật tính năng Gửi đối tác xác nhận
Tắt tính năng ⇒ mọi `/pack/contracts/partner/*` trả 403 với câu «Công ty chưa bật Gửi đối tác xác nhận».
- Kịch bản: khi công ty chưa bật tính năng thì mọi route đối tác trả 403 PARTNER_FEATURE_OFF [test: apps/hub-api/src/modules/packs/contracts/partner-routes.gate.test.ts » công ty chưa bật ⇒ 403 PARTNER_FEATURE_OFF + câu nghiệp vụ cho MỌI route đối tác]
#### Yêu cầu: Tool Gửi đối tác từ chối rõ ràng khi chưa bật tính năng hoặc kênh hệ thống tắt
Run chuyển «cần quyết định» với lý do trên thẻ; không ghi hàng mailbox/lần gửi/lời mời mồ côi.
- Kịch bản: khi kênh hộp thư tắt thì tool ném PARTNER_CHANNEL_OFF và không ghi gì [test: apps/hub-api/src/modules/packs/contracts/partner-gating.int.test.ts » kênh hộp thư TẮT trên hệ thống]
- Kịch bản: khi công ty chưa bật tính năng thì tool ném PARTNER_FEATURE_OFF và không ghi gì [test: apps/hub-api/src/modules/packs/contracts/partner-gating.int.test.ts » công ty chưa bật tính năng]

## Việc còn lại
- Cảnh báo ở editor/validator khi node «Gửi đối tác» dùng lúc kênh hệ thống tắt (chưa làm).
- `partnerMailbox` vào `mountContracts` qua kiểu giao `d: PacksMountDeps & { partnerMailbox? }` (giá trị = `AppDeps.partnerMailbox`, đi theo spread của `deps` ở app.ts) vì packs.mount.ts đã chạm trần 400 dòng.
