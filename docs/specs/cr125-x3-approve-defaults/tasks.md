---
id: cr125-x3-approve-defaults
lát: cr125-x3-approve-defaults
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: u15 (đã gộp)
---
## Plan (ngắn)
Soát CEO (docs/specs/CR-125/demo-assessment.md) sửa 4 và 5 ở trình sửa flow của công ty: (4) node Duyệt mới có "Nếu từ chối" mặc định là "Bước tiếp theo" ⇒ HĐ bị từ chối vẫn đi tiếp mà không ai báo; (5) ô "Ai duyệt" / "Người ký" lẫn nhóm kỹ thuật ("Beta testers", nhóm vai của gói).

## Làm
1. `lib/approve-rules.ts` (MỘT nơi, thuần): `approveDefaults` — node Duyệt mới: Từ chối ⇒ node Kết thúc · Từ chối (nếu đứng sau), Trả lại ⇒ về bước duyệt đứng ngay trước (`backTo`, đặt khi node được NỐI vì vị trí lúc đó mới chốt); `approveWarnings` — Từ chối / Trả lại trỏ tới bước sau KHÔNG có node Kết thúc ⇒ cảnh báo.
2. Áp mặc định: thả node (`dropNodes`, chỉ Từ chối), nối node vừa thả (`applyConnect`, chỉ node đứng riêng — không đè lựa chọn đã có), chèn trên cạnh (`insertOnEdge`).
3. Ô chọn: nhãn "Mặc định" thành nhãn thật — Từ chối: "Kết thúc · Từ chối"; Trả lại: "Quay về bước duyệt trước"; cảnh báo hiện ngay dưới ô ("Từ chối đang đi tiếp tới bước sau — chắc chưa?") và khi Lưu (toast, không chặn).
4. Nhóm chọn làm người duyệt: `isApproverGroup` (contracts `groups.ts`, MỘT nguồn: bỏ Group thử nghiệm `is_beta` và Group vai của gói `<gói>-owner|editor|viewer` theo `PACK_ROLES`, không viết tên cứng) dùng cho "Ai duyệt" (`StageApproveBasics`, `StageGate`) và "Người ký phía công ty" (`esign/Panel`). Nhóm đang chọn nhưng thuộc nhóm kỹ thuật vẫn hiện (không mất lựa chọn cũ).

## Không làm / Chạm
- Không engine / hub-api / migration. Ô "Ai duyệt" của node Duyệt chỉ chọn được nhóm (mô hình bước hiện tại); chọn NGƯỜI theo tên đã có ở "Người ký phía công ty" (danh sách thành viên).

## Test tối thiểu
Unit `lib/x3-approve-rules.test.ts` (mặc định, cảnh báo, nhóm chọn được); e2e `cr123-arrow-drag.spec.ts` (mặc định Từ chối/Trả lại, danh sách Ai duyệt không có Beta testers) xanh trên evotest; tsc admin-web + contracts.

## Quyết định trong lúc làm
- Trả lại "quay về bước duyệt trước" dùng cơ chế sẵn có `backTo` (đích `return_step` của Hub chỉ cho bước SAU).
- Cảnh báo khi Lưu là toast không chặn (người dùng đã bấm Lưu có chủ ý), kèm cảnh báo cố định ngay dưới ô chọn.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Node Duyệt: Từ chối / Trả lại có mặc định an toàn và người duyệt chỉ chọn được nhóm nghiệp vụ (nguồn: CR-125 x3)
Node Duyệt mới có Từ chối ⇒ Kết thúc · Từ chối và Trả lại ⇒ về bước duyệt trước; Từ chối / Trả lại trỏ tới bước sau không phải Kết thúc thì cảnh báo ("chắc chưa?"). Ô chọn người duyệt / người ký chỉ liệt kê phòng ban, chức danh, không liệt kê nhóm kỹ thuật (nguồn quy tắc duy nhất ở contracts).
- Kịch bản: khi thả node Duyệt mới thì Từ chối mặc định là bước Kết thúc · Từ chối [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » node Duyệt mới: reject = bước của Kết thúc · Từ chối, không phải Duyệt ⇒ không đổi]
- Kịch bản: khi nối node Duyệt vừa thả thì Trả lại về bước duyệt trước và không đè lựa chọn tay [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » thả Duyệt rồi nối vào flow: mặc định áp ĐÚNG lúc nối (đúng vị trí), nối lại không đè lựa chọn]
- Kịch bản: khi Từ chối trỏ tới bước sau không phải Kết thúc thì cảnh báo [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » trỏ tới bước KHÔNG phải Kết thúc ⇒ cảnh báo, trỏ tới Kết thúc / để trống ⇒ không]
- Kịch bản: khi chọn người duyệt thì không có nhóm Beta và nhóm vai của gói [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » phòng ban / chức danh do công ty tạo chọn được, Beta và Group vai của gói thì không]
- Kịch bản: khi mở node Duyệt vừa nối trên flow thật thì Từ chối mặc định là Kết thúc · Từ chối và Ai duyệt không có Beta testers [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

## Việc còn lại
- Không.