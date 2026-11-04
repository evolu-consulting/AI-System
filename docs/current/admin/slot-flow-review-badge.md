# Admin · huy hiệu loại bước trong sơ đồ khe

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-fg-home). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Sơ đồ khe `/apps` hiện huy hiệu loại bước duyệt (nguồn: cr118-fg-home)
Mỗi bước duyệt trong sơ đồ quy trình mặc định của khe có huy hiệu "Duyệt"; bước e-sign/Dify giữ huy hiệu riêng.
- Kịch bản: khi host bật showReviewBadge thì bước duyệt có huy hiệu review [test: packages/flow-canvas/src/layout/vertical.test.ts » mặc định bước duyệt không có huy hiệu, bật cờ thì có review]
