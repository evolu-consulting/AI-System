# Quyết định · HD1-contracts-base

Nơi duy nhất ghi quyết định riêng HD1; quyết định khung gói ở [N1 spec-decisions](../N1-pack-frame/spec-decisions.md).

| Mã | Ngày · ai | Quyết định | Hệ quả |
|---|---|---|---|
| D-01 | 2026-10-18 · người dùng | Backend gói hợp đồng là **module trong `hub-api`** (schema `contracts` riêng, Clean Architecture), không app backend mới (= N1 D-01) | HD1 code ở `apps/hub-api/src/modules/contracts/` |
| D-02 | 2026-10-18 · người dùng | UI là app riêng `contracts-web`, port nguyên giao diện mgmt-app; e2e chụp màn hình so với mgmt-app thật theo danh sách màn (lệch = lỗi); thẻ chờ duyệt/nhắc trong màn hợp đồng; trợ lý chung nhúng (= N1 D-02) | HD1 không UI; DTO danh sách phải đủ cột màn mgmt-app (HD-FR-07) cho HD5 |

## Trong lúc làm (Luật 2)
- (chưa có)
