---
id: cr118-fg-home
lát: cr118-fg-home
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-feature-gate-web (dae4497f)
---
## Plan (ngắn)
1) `homeFor` theo `/pack/me.home` (server đã chọn default_app user → công ty, chỉ gói đọc được): `capsOf(user, apps, home)`, `setHomeSource` nối động như `setAppsSource` (bundle đầu không đổi). Rơi về cách cũ khi thiếu/không mở được.
2) Khôi phục huy hiệu loại "Duyệt" ở sơ đồ khe `/apps` (admin-web): `VerticalStep.showReviewBadge` + `StepBadge "review"` + nhãn `labels.review`; chỉ thẻ khe bật (sơ đồ tenant không đổi).

## Làm
- `platform/auth` (`login-machine`, `lib/access`, `port`, `index`), `platform/features` (`featureHomeSource`), `features/auth/lib/guard.ts`.
- `packages/flow-canvas` (`layout/vertical`, `theme`, `nodes/VerticalNodes`), `admin-web SlotFlowDiagram`.

## Không làm / Chạm
Không sửa server, community-web, DLC.

## Test tối thiểu
- unit `platform/auth/domain/login-machine.test.ts`, `packages/flow-canvas/src/layout/vertical.test.ts`.
- e2e contracts-web một lần.

## Quyết định trong lúc làm
- Huy hiệu `review` là cờ theo bước (không đổi registry): tenant view vẫn không hiện vì gần như mọi bước là duyệt.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/home-default-app.md
#### Yêu cầu: Trang chủ web gộp theo default_app
`/` và đích sau đăng nhập theo `home` của `/pack/me` (default_app của user, rồi của công ty, chỉ khi user mở được); không có hoặc không mở được thì SHT trước, rồi Community.
- Kịch bản: khi default_app là community và user mở được cả hai thì home là /community [test: apps/sohoptac-web/src/platform/auth/domain/login-machine.test.ts » home theo default_app của /pack/me: chỉ khi module đó mở được, không thì home cũ]

### ADDED admin/slot-flow-review-badge.md
#### Yêu cầu: Sơ đồ khe `/apps` hiện huy hiệu loại bước duyệt
Mỗi bước duyệt trong sơ đồ quy trình mặc định của khe có huy hiệu "Duyệt"; bước e-sign/Dify giữ huy hiệu riêng.
- Kịch bản: khi host bật showReviewBadge thì bước duyệt có huy hiệu review [test: packages/flow-canvas/src/layout/vertical.test.ts » mặc định bước duyệt không có huy hiệu, bật cờ thì có review]