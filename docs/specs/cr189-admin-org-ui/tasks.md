---
id: cr189-admin-org-ui
lát: cr189-admin-org-ui
cr: CR-189
làn: nhanh
migration: không
phụ thuộc: cr189-admin-org-api
---
## Plan (ngắn)
Admin › Công ty › Thành viên › Cơ cấu sửa trực tiếp trên sơ đồ dùng chung (`flow-canvas` thêm chế độ sửa): bỏ form «Thêm phòng» + `DeptCard`; «+» dưới thẻ thêm phòng con gõ tên tại chỗ, bấm tên đổi tên, «⋯» (đổi trưởng phòng, thêm/bớt thành viên, chuyển phòng cha, xoá), kéo thả trên máy tính (điện thoại chỉ «⋯»), mọi thay đổi có toast «Hoàn tác» 6 giây.

## Làm
- [x] `flow-canvas/org-chart`: prop `edit?: OrgChartEdit` (callback, không gọi API); `OrgEditCard` (thẻ sửa, cỡ y thẻ xem), `OrgEditParts` (đổi tên tại chỗ, «+» ô nhập đè dưới thẻ, kéo thả HTML5 + chặn `canMove`).
- [x] admin-web `features/org`: `OrgDiagram` (thay `OrgPreview`), `DeptMenu` («⋯»), `OrgDialogs` (trưởng phòng, thành viên, chuyển, xoá/chặn), `use-org-ops` (thao tác + Hoàn tác), `use-is-touch`, `api.ts` dùng API mới (`POST /admin/org/departments`, `PUT …/name`, `POST/DELETE …/members`); xoá `DeptCard`.
- [x] `lib/org-edit.ts`: `canMoveDept`, `deptLoad`, `orgErrorSpec`, `accessNote`; bỏ `deptKey`/`OrgActions` (key do máy chủ sinh).
- [x] i18n vi/en `orgEdit.*` (câu nghiệp vụ cho DEPT_NOT_EMPTY / MEMBER_IS_HEAD / DEPT_IN_USE / NAME_TAKEN / dept_cycle).
- [x] e2e viết: `e2e/cr189-admin-org-ui.spec.ts`; sửa `cr139d-org-tree.spec.ts` (thêm phòng bằng «+», danh sách chuyển không có con), mock `DELETE` ở `org-visibility.cw.ts`.

## Không làm / Chạm
Không API/migration (đã có ở lát cr189-admin-org-api), không đổi Sổ Hợp Tác (sơ đồ xem). Chạm: `packages/flow-canvas/src/org-chart/*`, `apps/admin-web/src/features/org/*`, `packages/i18n/locales/{vi,en}.json`, e2e.

## Test tối thiểu
- unit: `apps/admin-web/src/features/org/lib/org-edit.test.ts` (bun test).
- e2e (điều phối chạy cuối đợt): `e2e/cr189-admin-org-ui.spec.ts`, `e2e/journey-approval/cr139d-org-tree.spec.ts`, `e2e/contracts-web/org-visibility.cw.ts`.

## Quyết định trong lúc làm
- Chart không biết API: host truyền `OrgChartEdit` (onAdd/onRename/onMove/canMove/renderMenu/touch); host trả chuỗi lỗi nghiệp vụ hoặc null, chart hiện tại ô nhập.
- Ô «+» và ô nhập tên nằm ĐÈ (absolute) dưới thẻ, không đổi cỡ thẻ/bố cục ⇒ không nháy khi mở/đóng; bố cục chỉ tính lại khi dữ liệu đổi.
- Kéo thả dùng HTML5 DnD gắn trên thẻ (class `nopan`), thẻ «Công ty» chỉ nhận thả (về cấp cao nhất). Cảm ứng/điện thoại (`pointer: coarse` hoặc ≤ 767px) không kéo, không hiện gợi ý.
- Chặn vào con cháu ở UI bằng `canMoveDept` (API vẫn chặn `dept_cycle`); hộp «Chuyển phòng cha» dùng `parentChoices` nên không liệt kê con cháu.
- Hoàn tác = thao tác ngược từ dữ liệu API trả: đổi tên (`before`), chuyển/đổi trưởng phòng (giá trị cũ client giữ), thêm người (`moved[].from_group_ids`; người vốn chưa có phòng ⇒ gỡ lần lượt về công ty), bỏ người (thêm lại), thêm phòng (xoá), xoá phòng (tạo lại cùng tên/cha; phòng trống nên đủ).
- Toast thành công của thêm/bớt thành viên kèm câu «Quyền theo phòng đổi: được thêm N, mất M» khi `access` ≠ 0 (gồm agent + quy trình).
- Xoá: client biết trước số người/phòng con (`deptLoad`) ⇒ hộp «Chưa xoá được» nêu số; vẫn map 409 từ máy chủ (đua).
- Đổi trưởng phòng không tự chuyển người (API không làm); người đang là trưởng phòng khác bị khoá trong ô chọn.
- Phòng gốc: thẻ «Công ty» ảo không có «⋯»/đổi tên/xoá; chỉ «+» (thêm phòng cấp cao nhất) và nhận thả.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/admin/to-chuc-so-do-giao-dien.md
#### Yêu cầu: Thêm phòng con tại chỗ bằng «+»
Dưới mỗi thẻ phòng (và thẻ Công ty) có «+» ⇒ ô gõ tên phòng con ngay dưới thẻ; tên trùng cùng cấp báo lỗi tại ô; không còn form «Thêm phòng».
- Kịch bản: khi bấm «+» và gõ tên thì thẻ mới hiện, tên trùng báo lỗi tại ô và Hoàn tác xoá phòng vừa thêm [test: e2e/cr189-admin-org-ui.spec.ts » «+» dưới thẻ ⇒ gõ tên phòng con tại chỗ ⇒ thẻ mới hiện, tên trùng cùng cấp báo lỗi ngay ô, Hoàn tác xoá phòng vừa thêm]
- Kịch bản: khi quản trị thêm phòng con từ sơ đồ thì Sổ Hợp Tác hiện phòng mới [test: e2e/journey-approval/cr139d-org-tree.spec.ts » quản trị chỉnh sơ đồ ở admin ⇒ cây ở Sổ Hợp Tác đổi theo, vòng cha–con bị chặn]

#### Yêu cầu: Đổi tên tại chỗ
Bấm tên phòng ⇒ ô nhập tại chỗ; Enter lưu, Esc bỏ; Hoàn tác trả tên cũ.
- Kịch bản: khi bấm tên và gõ tên mới thì đổi tên, Hoàn tác trả tên cũ [test: e2e/cr189-admin-org-ui.spec.ts » bấm tên ⇒ đổi tên tại chỗ (Enter lưu, Esc bỏ), Hoàn tác trả tên cũ]

#### Yêu cầu: Menu «⋯» thao tác phòng
«⋯» trên thẻ phòng: Đổi trưởng phòng (ô chọn avatar), Thêm/bớt thành viên (hộp chọn, người ở phòng khác được chuyển sang, báo quyền đổi), Chuyển sang phòng cha khác, Xoá phòng.
- Kịch bản: khi mở «⋯» thì đủ 4 thao tác và đổi trưởng phòng, chuyển thành viên chạy đúng, Hoàn tác trả lại [test: e2e/cr189-admin-org-ui.spec.ts » «⋯» có đủ 4 thao tác, Đổi trưởng phòng (ô chọn avatar) và Thêm/bớt thành viên (hộp chọn, chuyển người từ phòng khác)]
- Kịch bản: khi chuyển phòng cha bằng menu thì không liệt kê con của chính nó và Hoàn tác trả phòng cha cũ [test: e2e/cr189-admin-org-ui.spec.ts » Chuyển phòng cha bằng menu (không chọn được con của chính nó), Hoàn tác trả phòng cha cũ]
- Kịch bản: khi chọn chuyển phòng cha thì không vào chính nó, con cháu hay phòng cha hiện tại [test: apps/admin-web/src/features/org/lib/org-edit.test.ts » không vào chính nó, không vào con cháu, không vào phòng cha hiện tại]

#### Yêu cầu: Kéo thả chuyển phòng cha (máy tính)
Kéo thẻ phòng thả lên phòng cha mới để chuyển; thả vào con của chính nó bị chặn; điện thoại không kéo thả, chỉ «⋯».
- Kịch bản: khi kéo thẻ thả lên phòng cha mới thì chuyển, thả vào con của chính nó bị chặn và Hoàn tác trả lại [test: e2e/cr189-admin-org-ui.spec.ts » máy tính: kéo thẻ thả lên phòng cha mới ⇒ chuyển, thả vào con của chính nó bị chặn (viền đỏ, không đổi), Hoàn tác]
- Kịch bản: khi dùng điện thoại thì không có gợi ý kéo thả, thẻ không kéo được, vẫn có «⋯» [test: e2e/cr189-admin-org-ui.spec.ts » điện thoại: không có gợi ý kéo thả, thẻ không kéo được, vẫn có «⋯» đủ thao tác]

#### Yêu cầu: Xoá phòng báo rõ khi còn người, phòng con hoặc việc duyệt
Phòng còn người hoặc phòng con ⇒ hộp «Chưa xoá được» nêu số và việc cần làm; việc duyệt đang mở giao cho nhóm ⇒ câu riêng; phòng trống ⇒ xác nhận rồi xoá, Hoàn tác tạo lại.
- Kịch bản: khi xoá phòng còn phòng con thì báo, phòng trống thì xoá và Hoàn tác tạo lại [test: e2e/cr189-admin-org-ui.spec.ts » Xoá: phòng còn người/phòng con ⇒ câu nghiệp vụ, không xoá, phòng trống ⇒ xác nhận rồi xoá, Hoàn tác tạo lại]
- Kịch bản: khi API trả lỗi nghiệp vụ thì câu hiển thị đúng theo mã [test: apps/admin-web/src/features/org/lib/org-edit.test.ts » DEPT_NOT_EMPTY chọn câu theo người/phòng con, các mã khác có key riêng, mã lạ ⇒ null]
- Kịch bản: khi đếm trước khi xoá thì người = thành viên và trưởng phòng không trùng cộng phòng con [test: apps/admin-web/src/features/org/lib/org-edit.test.ts » người = thành viên ∪ trưởng phòng (không đếm trùng), cộng số phòng con]

#### Yêu cầu: Báo quyền theo phòng đổi khi chuyển người
Thêm/bớt thành viên có đổi quyền theo nhóm (tính năng, agent, quy trình) thì toast nói được/mất bao nhiêu.
- Kịch bản: khi access có đổi thì trả số được/mất, không đổi thì không báo [test: apps/admin-web/src/features/org/lib/org-edit.test.ts » 0/0 hoặc vắng ⇒ không báo, có đổi ⇒ trả số được/mất]

#### Yêu cầu: Dựng cây và chặn vòng ở màn Cơ cấu
- Kịch bản: khi dựng cây thì cha trước con, cha vắng ⇒ gốc [test: apps/admin-web/src/features/org/lib/org-edit.test.ts » cha trước con, thụt theo độ sâu, cha vắng mặt ⇒ gốc]
- Kịch bản: khi chọn phòng cha thì loại chính nó và con cháu [test: apps/admin-web/src/features/org/lib/org-edit.test.ts » loại chính nó và mọi con cháu, còn lại giữ thứ tự cây]

## Việc còn lại
- Chưa chạy e2e (điều phối chạy cuối đợt); chưa soát UI bằng mắt trên trình duyệt thật (G4): kiểm kéo thả trong xyflow (class `nopan`) và vị trí ô «+» khi cây rộng.
- `org-chart-data.test.ts` đỏ sẵn trên staging (`jobTitle: null` thừa ở `members`) — ngoài phạm vi lát.
- `MemberTitles` (chức vụ) giữ nguyên dạng danh sách cuối trang.
