---
id: cr184-flow
lát: cr184-flow
cr: CR-184
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
CR-184 ý (1) và (2) của dòng CR (phần «Kết nối» gọn, avatar, uỷ quyền do lát khác). Cài đặt › Quy trình duyệt ở Sổ Hợp Tác vẽ CÙNG đồ thị với trang quản trị (chỉ xem), nhãn bước Ký theo «Ký qua», danh sách quy trình là Select của kit.

## Làm
- Backend (chỉ thêm, đọc): `GET /pack/contracts/approval-flow` trả thêm `graph` (MỌI stage: loại, bước, Đúng/Sai, nhánh, nhảy bước, điểm cuối, phòng theo TÊN) và `sign.provider`. `steps` + mọi trường cũ giữ nguyên. File: `domain/event-flow-graph.rules.ts` (mới), `approval-flow.usecase.ts`, contract `pack-contracts/approval-flow.ts`.
- Gói chung `@ai/flow-canvas`: `layout/def-graph.ts` (dựng cạnh bằng `stepEdges` + nhảy bước + node Bắt đầu, đầu vào ELK, node/cạnh xyflow) và `nodes/DefViewNodes.tsx` (Bắt đầu / Bước / Nếu hình thoi Đúng+Sai / Kết thúc). `applyJumps` chuyển vào gói; `admin-web/.../jump-edges.ts` chỉ còn re-export (một nguồn, không chép hai bản).
- Web: `FlowCanvas` dựng bằng gói chung + ELK hướng Dọc; `FlowList` đi theo thứ tự sơ đồ, node Nếu ghi «Đúng ⇒ … / Sai ⇒ …»; `FlowPicker` (Select kit) thay danh sách thẻ; `lib/flow-view.ts` ghép chữ VI/EN; bỏ câu «các bước dưới đây là những bước có thể chạy», bỏ chú giải cũ (Nhánh bỏ qua / Mờ…) và `StepInfoLines`.

## Không làm / Chạm
- Không làm phần giao việc (đợt 2), không sửa trang quản trị ngoài việc `jump-edges.ts` trỏ về gói chung.
- Chạm: `apps/workspace-web/src/features/settings/**`, `packages/flow-canvas/**`, `packages/contracts/src/pack-contracts/approval-flow.ts`, `packages/i18n/locales/contracts/v2l.{vi,en}.json`.

## Test tối thiểu
- unit: `packages/flow-canvas/src/layout/def-graph.test.ts`, `apps/workspace-web/src/features/settings/lib/flow-view.test.ts`, `…/components/FlowPicker.test.tsx`, `apps/hub-api/…/domain/event-flow-graph.rules.test.ts`; int (evotest): `approval-flow-current.int.test.ts`.

## Quyết định trong lúc làm
- Sơ đồ ở Sổ Hợp Tác dùng nút chỉ-xem riêng trong gói chung (nút của admin gắn chặt với bản nháp + thao tác sửa) nhưng ĐỒ THỊ (cạnh, nhảy bước, cổng Đúng/Sai, tầng đầu/cuối) là một nguồn. Hướng Dọc (đọc trên điện thoại 390px).
- Không vẽ cạnh «quay lại» khi có node Bắt đầu — cùng luật trang quản trị.
- Nhà cung cấp ký số: tên hiển thị tra từ bảng nhỏ (`docusign` ⇒ DocuSign), khoá lạ giữ nguyên.
- Server cũ chưa có `graph` ⇒ web dựng chuỗi thẳng từ `steps` (không vỡ khi deploy lệch).
- e2e khoá cần qc sửa: `e2e/contracts-web/approval-current.cw.ts` (legend, «Ghi Đã duyệt», `step-due`), `e2e/journey-approval/cr125-s2-settings-flow.spec.ts` (`flow-list-items`, `flow-item-0`, `flow-when-0` ⇒ `flow-select` / `flow-option-N`), `e2e/contracts-web/esign-flow.cw.ts` (đếm dòng `flow-diagram`: nay có thêm dòng «Bắt đầu»).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Quy trình duyệt vẽ cùng sơ đồ với trang quản trị (CR-184)
Sơ đồ chỉ xem của quy trình đang chọn gồm Bắt đầu → các bước → nút Nếu (nhánh Đúng / Sai) → Gửi đối tác → Kết thúc, theo đúng cạnh của định nghĩa; dùng chung code dựng đồ thị `@ai/flow-canvas` với trang quản trị. `GET /approval-flow` trả thêm `graph` (mọi stage) và `sign.provider`, các trường cũ giữ nguyên. Câu «các bước dưới đây là những bước có thể chạy» bỏ. Công tắc «Sơ đồ | Danh sách» giữ; Danh sách đi theo thứ tự sơ đồ và ghi rõ nhánh.
- Kịch bản: khi nút Nếu có hai nhánh thì sơ đồ vẽ đúng hai cạnh Đúng và Sai tới bước đích [test: packages/flow-canvas/src/layout/def-graph.test.ts » node Nếu có đúng hai cạnh có nhãn Đúng / Sai tới bước đích]
- Kịch bản: khi quy trình có Gửi đối tác và Kết thúc thì Gửi đối tác đi tiếp tới bước sau và Kết thúc là điểm cuối [test: packages/flow-canvas/src/layout/def-graph.test.ts » Gửi đối tác đi tiếp tới Ký, Ký tới Kết thúc, Kết thúc không đi tiếp]
- Kịch bản: khi dựng sơ đồ thì có node Bắt đầu, bước, Nếu hình thoi và Kết thúc [test: packages/flow-canvas/src/layout/def-graph.test.ts » loại node: Bắt đầu / bước / Nếu / Kết thúc, bước thường đánh số]
- Kịch bản: khi chế độ Danh sách thì các dòng theo thứ tự sơ đồ và nút Nếu ghi Đúng ⇒ / Sai ⇒ [test: apps/workspace-web/src/features/settings/lib/flow-view.test.ts » cùng thứ tự theo bước, node Nếu ghi rõ Đúng ⇒ / Sai ⇒, chỉ bước thường được đánh số]
- Kịch bản: khi gọi `GET /approval-flow` thì nhận thêm `graph` đủ mọi stage với phòng theo tên [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » CR-184 · GET trả thêm `graph` = MỌI stage (cả Chờ ký xong, Kết thúc), phòng theo TÊN, `steps` cũ giữ nguyên]
- Kịch bản: khi đọc định nghĩa lưu thì mọi stage (Nếu, Gửi đối tác, Kết thúc, chờ) có loại và trường dựng cạnh [test: apps/hub-api/src/modules/packs/contracts/domain/event-flow-graph.rules.test.ts » giữ MỌI stage theo thứ tự mảng, đúng loại và trường dựng cạnh]

#### Yêu cầu: Nhãn bước Ký theo «Ký qua» (CR-184)
Bước Ký hiện «Ký trên tài liệu» khi `ondoc`, «Tải lên bản đã ký» khi `upload`, «Ký số (<tên>)» khi là nhà cung cấp, «Ký số» khi chưa đặt; áp cho cả sơ đồ lẫn danh sách (VI/EN).
- Kịch bản: khi bước Ký đặt ondoc thì nhãn là Ký trên tài liệu, không còn Ký số [test: apps/workspace-web/src/features/settings/lib/flow-view.test.ts » ondoc ⇒ Ký trên tài liệu, upload ⇒ Tải lên bản đã ký, nhà cung cấp ⇒ Ký số (tên), chưa đặt ⇒ Ký số]
- Kịch bản: khi dựng chữ sơ đồ thì bước Ký mang huy hiệu theo Ký qua [test: apps/workspace-web/src/features/settings/lib/flow-view.test.ts » bước Ký mang huy hiệu theo «Ký qua», Gửi đối tác có huy hiệu, Kết thúc là điểm cuối]

#### Yêu cầu: Danh sách quy trình là ô chọn «Quy trình» (CR-184)
Đầu mục là ô chọn của kit «Quy trình: [Tên ▾]»; mỗi dòng trong ô chọn: tên · số bước · «Bắt đầu khi …», đúng thứ tự xét; sơ đồ / danh sách bên dưới đổi theo quy trình đang chọn; điện thoại 390px: nhãn trên ô chọn, vùng bấm ≥ 44px.
- Kịch bản: khi mở mục thì có ô chọn Quy trình hiện tên quy trình đang chọn và không còn danh sách thẻ [test: apps/workspace-web/src/features/settings/components/FlowPicker.test.tsx » là Select của kit: vùng bấm ≥ 44px trên điện thoại, không còn danh sách thẻ]
- Kịch bản: khi có nhiều quy trình thì nhãn Quy trình gắn với ô chọn [test: apps/workspace-web/src/features/settings/components/FlowPicker.test.tsx » có nhãn «Quy trình» gắn với ô chọn, hiện tên quy trình đang chọn]

## Việc còn lại
- qc sửa e2e khoá (xem «Quyết định trong lúc làm») và thêm e2e hành trình: chọn quy trình khác trong ô chọn ⇒ sơ đồ đổi; sơ đồ có nhánh Đúng/Sai.
- Soát UI thật (sơ đồ ELK Dọc ở 390px, ô chọn mở ra) khi chạy e2e cuối đợt.
