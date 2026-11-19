---
id: fix-cr189-orgchart-click
lát: fix-cr189-orgchart-click
cr: CR-189
làn: nhanh
migration: không
phụ thuộc: cr189-admin-org-ui
---
## Plan (ngắn)
Sửa 2 lỗi lộ ở e2e cuối đợt: (1) sơ đồ tổ chức không bấm được hàng avatar/thẻ/«+»/«⋯»/tên vì xyflow đặt `pointer-events: none` cho thẻ khi chart không chọn/kéo (pane nuốt chuột); (2) chuỗi `orgEdit.*` viết `{{name}}` nhưng admin-web nội suy một ngoặc `{name}` nên nhãn «+» hiện nguyên `{{name}}`.

## Làm
- [x] `org-flow-props.ts` (mới): `ORG_FLOW_PROPS` thêm `onNodeClick` rỗng để thẻ nhận chuột, vẫn không chọn/kéo/nối thẻ, vẫn kéo nền + phóng to. `OrgChart.tsx` dùng chung cho chế độ xem và sửa.
- [x] i18n vi/en: `orgEdit.*` đổi `{{x}}` thành `{x}`.
- [x] test: `org-flow-props.test.ts`, `org-i18n.test.ts` (đỏ trước khi sửa).

## Không làm / Chạm
Không đổi hành vi nghiệp vụ. Chạm: `packages/flow-canvas/src/org-chart/*`, `packages/i18n/locales/{vi,en}.json`, `apps/admin-web/src/features/org/lib/org-i18n.test.ts`.

## Test tối thiểu
unit `bun test packages/flow-canvas/src/org-chart apps/admin-web/src/features/org`. e2e đỏ `cr189-avatar-list.cw.ts`, `cr189-admin-org-ui.spec.ts` do điều phối chạy lại.

## Quyết định trong lúc làm
- Bật `pointer-events` bằng `onNodeClick` rỗng (xyflow: node nhận chuột khi chọn/kéo được hoặc chart có `onNodeClick`) thay vì cho chọn/kéo thẻ, để không đổi hành vi chọn/kéo.
- Nội suy đúng một ngoặc theo `apps/admin-web/src/app/i18n.ts`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/admin/to-chuc-so-do-bam-duoc.md
#### Yêu cầu: Phần tử trong thẻ phòng nhận chuột
Nút tên, hàng avatar, «+», «⋯» trong thẻ phòng bấm được ở cả chế độ xem và sửa; kéo nền và phóng to vẫn hoạt động; thẻ không bị chọn/kéo.
- Kịch bản: khi bấm trong thẻ thì thẻ nhận chuột và không chọn/kéo/nối thẻ [test: packages/flow-canvas/src/org-chart/org-flow-props.test.ts » thẻ nhận chuột (có onNodeClick) nhưng không chọn/kéo/nối thẻ]
- Kịch bản: khi kéo nền hoặc phóng to thì vẫn hoạt động [test: packages/flow-canvas/src/org-chart/org-flow-props.test.ts » vẫn kéo nền và phóng to bằng lăn chuột/chụm]

#### Yêu cầu: Nhãn sơ đồ sửa không lộ ký tự nội suy
- Kịch bản: khi hiển thị nhãn tiếng Việt thì không còn {{name}} nguyên văn [test: apps/admin-web/src/features/org/lib/org-i18n.test.ts » vi: không có nội suy hai ngoặc {{x}}]
- Kịch bản: khi hiển thị nhãn tiếng Anh thì không còn {{name}} nguyên văn [test: apps/admin-web/src/features/org/lib/org-i18n.test.ts » en: không có nội suy hai ngoặc {{x}}]

## Việc còn lại
Chạy lại e2e `cr189-avatar-list.cw.ts` và `cr189-admin-org-ui.spec.ts` (điều phối). `org-chart-data.test.ts` đỏ sẵn trên staging (jobTitle) — ngoài phạm vi.
