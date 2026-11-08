---
id: cr122-u2-editor-list
lát: cr122-u2-editor-list
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-e1b, cr122-n1
---
## Plan (ngắn)
Danh sách flow công ty theo `/tenants/:tid/company-flows`, bảng node theo `/process-palette` (ghi `stage.node`), node Duyệt có đích Từ chối/Trả lại, kiểm nối bằng `edgeIssues` + gợi ý cầu nối có xem trước, nút "Chạy lại từ Nếu".

## Làm
- `tenants/flows`: `company-flows-api.ts`, `lib/company-flow-view.ts`, `components/CompanyFlowList.tsx`; `CompanyFlowsTab` thay cho "việc → quy trình → luật". Lỗi 409 FLOW_REQUIRED_LAST / FLOW_PAIR_ACTIVE / FLOW_NOT_PUBLISHED ra câu nghiệp vụ; trạng thái luôn kèm lý do.
- `processes`: `palette-api.ts`, `lib/palette-node.ts` (node bảng → stage, giữ cấu hình thông báo, `edgeProblems`, `bridgePatch`), `NodePalette` đọc bảng node từ API, `StageApprove` (đích Từ chối/Trả lại), `BridgeIssues` (cạnh vàng + Gợi ý cầu nối + Nhận/Bỏ), `RunHeader`/`RunDetailBody` nhãn `facts_changed` + "Chạy lại từ Nếu".
- Artboard: không có artboard riêng cho U2; bám khuôn bảng của tab Công ty cũ (cùng lưới tiêu đề/dòng).

## Không làm / Chạm
- Chưa có: vẽ Bắt đầu khi/Kết thúc thành node trên canvas (còn thẻ phía trên); Nếu theo `fact`/field `event`; ô chọn `next_step`; `wait_event.branches`; gán flow Thư viện cho công ty (POST company-flows) ở UI; gỡ file cũ `SlotRouting`/`RoutingRules`/`DrawerAssign`/`use-slot-routing` (còn được `/apps/$appKey` dùng); chữ "khe" còn ở màn flow cũ.
- `POST /process-defs/bridge-suggest`: N2 chưa công bố hợp đồng; client giả định `{app, from_node, to_node, issues[]} → {suggestion: {rows:[{key, from:{input|const}}]} | null}` (xem `palette-api.ts`).
- Chưa chụp màn hình/soát căn mép: chưa dựng được stack có hub + dữ liệu flow trigger.

## Test tối thiểu
`bun test apps/admin-web/src/features/processes apps/admin-web/src/features/tenants` → 446 xanh (mới: `company-flow-view.test.ts`, `palette-node.test.ts`). e2e viết/đổi (qc): danh sách flow công ty (bật/tắt, kéo thứ tự, Sao chép → Xuất bản → Quay về bản gốc, 3 lỗi 409), chèn node bảng + cạnh vàng, Duyệt đích Từ chối, lượt facts_changed → Chạy lại từ Nếu (bấm 2 lần ra 409); thay các ca e2e dùng tab "Việc/Luật định tuyến".

## Quyết định trong lúc làm
- Order gửi TOÀN BỘ id (mọi app) theo thứ tự mới, chỉ đổi chỗ trong cùng app.
- Đích Duyệt lưu bước 0-based; đổi bước ở canvas có thể làm lệch đích (nợ: hub báo `APPROVE_INVALID` khi lưu).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### ADDED platform/danh-sach-flow-cong-ty.md
#### Yêu cầu: Một danh sách flow của công ty (FLOW2-FR-05, FLOW2-FR-08, FLOW2-FR-20)
Công ty thấy MỘT danh sách flow nhóm theo app: tên, Bắt đầu khi, nguồn, trạng thái kèm lý do; bật/tắt, kéo thứ tự, Sao chép để sửa, Xuất bản, Quay về bản gốc; lỗi 409 nói cách sửa.
- Kịch bản: khi tắt/đổi thứ tự thì danh sách theo nhóm app và trạng thái tắt luôn kèm lý do [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » trạng thái luôn kèm lý do khi tắt]
- Kịch bản: khi kéo đổi chỗ thì chỉ đổi trong cùng app [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » kéo đổi thứ tự chỉ trong cùng app, giữ nguyên app khác]
- Kịch bản: khi Hub trả 409 thì hiện câu nghiệp vụ [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » lỗi 409 ra câu nghiệp vụ]

### ADDED platform/kiem-noi-node.md
#### Yêu cầu: Kiểm nối hai bước và gợi ý cầu nối (FLOW2-FR-25, FLOW2-FR-26)
Node chèn từ bảng ghi khoá node; bước sau thiếu đầu vào bắt buộc so với bước trước ⇒ cạnh vàng kèm câu nói rõ; gợi ý cầu nối cho xem trước, Nhận chèn node Ghi giá trị, Bỏ thì thôi.
- Kịch bản: khi bước sau cần `date` mà bước trước không có thì báo thiếu [test: apps/admin-web/src/features/processes/lib/palette-node.test.ts » cạnh vàng: Chờ tới ngày cần `date` mà bước trước không có]
- Kịch bản: khi nhận gợi ý thì thành node Ghi giá trị [test: apps/admin-web/src/features/processes/lib/palette-node.test.ts]

## Việc còn lại
Xem "Không làm". Chụp + soát căn mép khi có stack; e2e qc.
