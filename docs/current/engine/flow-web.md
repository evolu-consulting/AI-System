# Engine · renderer flow phía web gộp

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-flow-web). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Renderer theo loại bước, thiếu loại là lỗi biên dịch (nguồn: cr118-flow-web)
Web gộp có registry renderer theo `FlowStepKind` (review, dify, esign, form, wait, system); thêm loại bước vào contract mà thiếu renderer là
lỗi typecheck. Mỗi loại là một chunk lazy riêng. Loại không có trong registry (snapshot cũ) vẽ bằng renderer chung từ các trường nền, không vỡ trang.
- Kịch bản: khi liệt kê registry thì có đủ mọi loại bước của contract và không thừa [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » RENDERERS có đủ mọi loại bước của contract, không thừa]
- Kịch bản: khi gặp loại bước lạ (kể cả tên trùng thuộc tính Object) thì dùng renderer chung [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » loại lạ (snapshot cũ) ⇒ GenericStep, kể cả tên trùng thuộc tính Object]
- Kịch bản: khi khe của gói đặt renderer riêng cho một loại thì nó thắng registry [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » loại đã biết ⇒ renderer của registry · override của khe thắng]
- Kịch bản: khi FlowPanel ở các trạng thái đang tải, lỗi, không có lượt, có bước thì vẽ đúng [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » có bước ⇒ danh sách theo thứ tự qua renderer của loại · loại lạ ⇒ Generic]

#### Yêu cầu: Bước form hiển thị và gửi qua đường review-tasks sẵn có (nguồn: cr118-flow-web)
Người có task đang mở ở bước `form` thấy form theo định nghĩa trong snapshot (≤ 20 trường; nhãn/gợi ý là text thuần) và gửi bằng
`POST /review-tasks/:id/form`; client báo lỗi sớm theo đúng giới hạn của Hub (cùng `flowFormValuesSchema`), Hub vẫn kiểm lại. Người khác
chỉ thấy dòng bước. Không thay đổi server.
- Kịch bản: khi có task mở thì form có ô theo loại trường, nhãn bị escape, nút Gửi [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » có task đang mở ⇒ form với ô theo loại trường, nhãn là TEXT (thẻ bị escape), dấu * cho trường bắt buộc, nút Gửi]
- Kịch bản: khi không có task của người xem hoặc bước không mở thì không có form [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » không có task của người xem (hoặc bước không mở) ⇒ chỉ hiển thị dòng bước, không form]
- Kịch bản: khi giá trị vượt giới hạn trường thì báo lỗi từng trường như Hub [test: apps/workspace-web/src/platform/flow/lib/form-values.test.ts » giới hạn: text > max_len ⇒ tooLong · số ngoài khoảng ⇒ range · không nguyên ⇒ integer · chữ ⇒ invalid]
- Kịch bản: khi gửi form thì gọi `POST /review-tasks/:id/form` với `{values}` [test: apps/workspace-web/src/platform/flow/adapters/http.test.ts » submitForm ⇒ POST /review-tasks/:id/form {values} (đường sẵn có, không đổi server)]

#### Yêu cầu: Huy hiệu danh sách HĐ từ tóm tắt flow, một yêu cầu cho cả trang (nguồn: cr118-flow-web)
Cột Giai đoạn của danh sách HĐ hiện huy hiệu "Cần xử lý" cho HĐ có `attention` theo `POST /pack/contracts/flow/contracts.approval/summary`
(một yêu cầu cho cả trang, chia lô ≤ 100, không gọi từng HĐ). Runtime chưa bật (404) ⇒ không huy hiệu, không lặp lại yêu cầu trong phiên.
- Kịch bản: khi tải trang danh sách thì summary là MỘT yêu cầu cho cả lô; khi 404 thì null và không gọi lại [test: apps/workspace-web/src/platform/flow/adapters/http.test.ts » summary ⇒ một POST cho cả lô · 404 (runtime tắt) ⇒ null và KHÔNG gọi lại ở lần sau]
- Kịch bản: khi danh sách dài hơn trần lô thì chia theo trần của contract [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » trần lô của web = trần của contract (FLOW_REF_MAX_BATCH)]

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Panel cấu hình node theo sổ (nguồn: cr125-m6a-panel)
Node có panel riêng đăng ký theo khoá (Ký số) dùng panel đó; node khác có cổng cấu hình hiện panel chung dựng từ schema (người, phòng ban, số ngày/giờ, Có/Không, danh sách chọn) với nhãn nghiệp vụ.
- Kịch bản: khi node không có panel riêng thì ô nhập suy từ schema cổng cấu hình, nhãn lấy từ khai báo [test: apps/admin-web/src/features/processes/modules/panel-registry.test.ts » widget thành loại ô, nhãn từ decl, kiểu lồng bị bỏ]
- Kịch bản: khi chọn node Ký số thì dùng panel riêng đã đăng ký [test: apps/admin-web/src/features/processes/modules/panel-registry.test.ts » Ký số đăng ký panel riêng, node khác không có]

#### Yêu cầu: Node Duyệt: Từ chối / Trả lại có mặc định an toàn và người duyệt chỉ chọn được nhóm nghiệp vụ (nguồn: cr125-x3-approve-defaults)
Node Duyệt mới có Từ chối ⇒ Kết thúc · Từ chối và Trả lại ⇒ về bước duyệt trước; Từ chối / Trả lại trỏ tới bước sau không phải Kết thúc thì cảnh báo ("chắc chưa?"). Ô chọn người duyệt / người ký chỉ liệt kê phòng ban, chức danh, không liệt kê nhóm kỹ thuật (nguồn quy tắc duy nhất ở contracts).
- Kịch bản: khi thả node Duyệt mới thì Từ chối mặc định là bước Kết thúc · Từ chối [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » node Duyệt mới: reject = bước của Kết thúc · Từ chối, không phải Duyệt ⇒ không đổi]
- Kịch bản: khi nối node Duyệt vừa thả thì Trả lại về bước duyệt trước và không đè lựa chọn tay [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » thả Duyệt rồi nối vào flow: mặc định áp ĐÚNG lúc nối (đúng vị trí), nối lại không đè lựa chọn]
- Kịch bản: khi Từ chối trỏ tới bước sau không phải Kết thúc thì cảnh báo [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » trỏ tới bước KHÔNG phải Kết thúc ⇒ cảnh báo, trỏ tới Kết thúc / để trống ⇒ không]
- Kịch bản: khi chọn người duyệt thì không có nhóm Beta và nhóm vai của gói [test: apps/admin-web/src/features/processes/lib/x3-approve-rules.test.ts » phòng ban / chức danh do công ty tạo chọn được, Beta và Group vai của gói thì không]
- Kịch bản: khi mở node Duyệt vừa nối trên flow thật thì Từ chối mặc định là Kết thúc · Từ chối và Ai duyệt không có Beta testers [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

#### Yêu cầu: Sơ đồ không bao giờ có hai node chồng nhau, ngăn chi tiết không che node đang sửa (nguồn: cr125-x4-no-overlap)
Sau mọi thao tác sửa / bố cục lại không có hai hộp node nào giao nhau: vị trí kéo tay chỉ được giữ khi không đè node nào, đè ⇒ bố cục lại theo ELK. Khoảng cách tầng đủ rộng cho node Ký số với ba đầu ra. Khi ngăn chi tiết mở, node đang chọn và node kề nằm trọn trong phần canvas còn thấy. Câu của bước Nếu chỉ nêu tên bước đích.
- Kịch bản: khi bố cục lại flow demo thì không có hai node nào giao nhau [test: packages/flow-canvas/src/layout/settle.test.ts » flow demo (có Ký số 3 đầu ra)]
- Kịch bản: khi thêm Kế toán duyệt chi sau Ký xong thì không có hai node nào giao nhau [test: packages/flow-canvas/src/layout/settle.test.ts » flow demo + một bước thêm sau Ký xong (Kế toán duyệt chi)]
- Kịch bản: khi thả tay một bước đè lên node khác thì bước đó quay về toạ độ ELK [test: packages/flow-canvas/src/layout/settle.test.ts » bước thả tay đè lên node khác ⇒ quay về toạ độ ELK, thả chỗ trống thì giữ]
- Kịch bản: khi thêm bước trên flow thật và mở ngăn chi tiết thì không node nào chồng nhau và node chọn cùng node kề thấy trọn bên trái ngăn [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]
- Kịch bản: khi nhóm node chọn cùng node kề không vừa vùng thấy bên trái ngăn thì bỏ dần node kề xa nhất và vẫn giữ node chọn [test: packages/flow-canvas/src/view-focus.test.ts » không vừa ⇒ bỏ dần node xa nhất, luôn giữ node chính (đầu danh sách)]
- Kịch bản: khi bước Nếu đi tới một bước thì câu chỉ nêu tên bước, không kèm Bước N [test: apps/admin-web/src/features/processes/lib/x4-if-sentence.test.ts » đích = tên bước (nhiều giai đoạn nối ' / '), không có 'Bước N ·']

#### Yêu cầu: Bước Duyệt mới chưa có người duyệt và buộc chọn trước khi Lưu (nguồn: cr125-x5-approver-default)
Bước Duyệt vừa thả không có người duyệt mặc định (ô nhắc "Chọn người duyệt"); Lưu để áp dụng bị chặn tới khi chọn; danh sách chỉ có phòng ban / chức danh, không có nhóm kỹ thuật.
- Kịch bản: khi thả bước Duyệt mới thì chưa có nhóm nào được chọn và Lưu bị chặn [test: apps/admin-web/src/features/processes/lib/x5-approver-default.test.ts » Lưu để áp dụng bị chặn tới khi chọn người duyệt, chọn rồi thì hết lỗi]
- Kịch bản: khi mở ô Ai duyệt của bước Duyệt mới trên flow thật thì hiện Chọn người duyệt, không phải Beta testers [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

#### Yêu cầu: Menu "+", palette và panel đọc node từ một nguồn khai báo (nguồn: cr125-m6b-canvas-registry)
Nhóm (nghiệp vụ / Nâng cao) và thứ tự của node trên menu "+" do chính node khai; thêm node mới bằng `module:new` thì có mặt ở menu với panel chung, không sửa file nào khác ở web.
- Kịch bản: khi có node mới chỉ khai báo ở module thì nó hiện ở menu "+" của công ty và panel chung dựng từ cổng cấu hình [test: apps/admin-web/src/features/processes/lib/m6b-registry.test.ts » menu '+' của công ty có node mới (nhóm nghiệp vụ), nhóm Nâng cao chỉ cho quản trị nền tảng]
- Kịch bản: khi node mới không có panel riêng thì dùng panel chung [test: apps/admin-web/src/features/processes/lib/m6b-registry.test.ts » panel chung dựng từ cổng cấu hình, không cần đăng ký panel riêng]
- Kịch bản: khi mở menu "+" của công ty thì thứ tự Duyệt, Nếu, Ký số, Thông báo, Kết thúc như cũ [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng]
- Kịch bản: khi thả node từ palette và kéo mũi tên trên flow thật thì hành vi như cũ [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]

#### Yêu cầu: Sơ đồ có hướng Ngang / Dọc, cạnh bắt đầu ở chấm đầu ra và không đi dưới node (nguồn: cr125-x9-layout-direction)
Người dùng chọn hướng sơ đồ Ngang (ELK RIGHT, cổng ra mép phải) hoặc Dọc (ELK DOWN, cổng ra mép dưới); lựa chọn lưu theo flow trong `ui`, mặc định Ngang (Dọc khi màn dưới 1100 px), đổi hướng hoàn tác được. Mọi cạnh rời ô Ký số bắt đầu đúng ở chấm của đầu ra (Ký xong / Từ chối / Hết hạn), không cạnh nào cắt node khác, nút "+" nằm giữa đường đã định tuyến. "Gửi đối tác xác nhận" nằm ở nhóm nghiệp vụ của menu "+".
- Kịch bản: khi chọn Dọc thì ELK dùng hướng DOWN và cổng ra ở mép dưới [test: packages/flow-canvas/src/layout/direction.test.ts » cổng ra: Ngang ở mép phải (EAST), Dọc ở mép dưới (SOUTH)]
- Kịch bản: khi chưa lưu hướng thì mặc định Ngang, màn hẹp thì Dọc, đã lưu thì theo lưu [test: apps/admin-web/src/features/processes/lib/x9-layout-dir.test.ts » đã lưu thắng mặc định (kể cả màn hẹp), đọc từ giai đoạn đầu có giá trị]
- Kịch bản: khi đổi hướng thì mọi giai đoạn mang hướng mới và mất vị trí tay [test: apps/admin-web/src/features/processes/lib/x9-layout-dir.test.ts » mọi giai đoạn mang hướng mới, vị trí tay (x, y) mất]
- Kịch bản: khi Ký xong nối tới bước kế thì cạnh dùng chấm Ký xong chứ không phải cổng ẩn ở mép trên [test: apps/admin-web/src/features/processes/components/canvas/x9-exit-edges.test.ts » Ký xong → Kế toán dùng chấm 'Ký xong' (không phải cổng ẩn ở mép trên)]
- Kịch bản: khi Từ chối và Hết hạn có đích thì mỗi đầu ra có cạnh riêng tới Kết thúc · Từ chối [test: apps/admin-web/src/features/processes/components/canvas/x9-exit-edges.test.ts » Từ chối và Hết hạn đều có cạnh tới Kết thúc · Từ chối, mỗi cạnh ở chấm riêng]
- Kịch bản: khi vẽ flow demo cộng một bước thêm ở cả Ngang và Dọc thì không cạnh nào cắt hộp node [test: packages/flow-canvas/src/routing/orthogonal.test.ts » mọi cạnh bắt đầu ở chấm và không cắt hộp node nào]
- Kịch bản: khi mở flow thật, thêm Kế toán duyệt chi rồi đổi sang Dọc thì cạnh bắt đầu ở chấm, không đi dưới node, lưu và mở lại giữ hướng Dọc [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]
- Kịch bản: khi công ty mở menu "+" thì "Gửi đối tác xác nhận" ở nhóm nghiệp vụ sau Ký số [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng]

#### Yêu cầu: Sơ đồ đọc được như văn bản: bước sau nằm sau bước trước, Kết thúc gom cuối, ít cắt nhau (nguồn: cr125-x10-layout-clean)
Bố cục theo đúng thứ tự flow ở cả Ngang và Dọc (không gập hàng, không chữ U ngược chiều); mọi node Kết thúc nằm ở tầng cuối; cạnh cắt nhau tối đa một lần ở flow demo; nhãn đầu ra không đè nhau hay đè node.
- Kịch bản: khi vẽ flow demo cộng Kế toán duyệt chi thì mọi bước đích nằm sau bước nguồn theo chiều flow [test: packages/flow-canvas/src/layout/clean-layout.test.ts » bước sau nằm sau bước trước theo chiều flow (mọi cạnh tiến)]
- Kịch bản: khi có node Kết thúc kể cả node không cạnh nào thì chúng cùng nằm ở tầng cuối [test: packages/flow-canvas/src/layout/clean-layout.test.ts » các node Kết thúc gom ở tầng cuối, Bắt đầu khi ở tầng đầu, không node mồ côi ở đầu sơ đồ]
- Kịch bản: khi định tuyến cạnh của flow demo thì số cạnh cắt nhau không quá một [test: packages/flow-canvas/src/layout/clean-layout.test.ts » số cạnh cắt nhau ≤ 1]
- Kịch bản: khi Từ chối và Hết hạn cùng đi tới một đích thì hai nhãn không đè nhau và không đè node [test: packages/flow-canvas/src/layout/clean-layout.test.ts » nhãn Từ chối / Hết hạn không đè nhau và không đè node]
- Kịch bản: khi đi theo đường chính của flow demo thì không quay đầu ngược chiều flow [test: packages/flow-canvas/src/layout/clean-layout.test.ts » đường chính (Bắt đầu khi → … → Kế toán duyệt chi → Kết thúc) không quay đầu ngược chiều flow]
- Kịch bản: khi mở flow thật rồi thêm Kế toán duyệt chi và đổi hướng thì không chồng nhau, cạnh không đi dưới node [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]

#### Yêu cầu: "Vừa khung" luôn đưa cả flow vào khung, ở mọi trình sửa (nguồn: cr125-x11-fit-all)
Khi mở flow lần đầu, bấm nút vừa khung, "Sắp xếp" hoặc khung đổi cỡ thì mọi node của sơ đồ — kể cả cột Kết thúc cuối cùng — nằm trọn trong vùng thấy được; một luật duy nhất cho mọi canvas.
- Kịch bản: khi flow demo rộng hơn khung thì fit thu nhỏ để mọi node nằm trong khung [test: packages/flow-canvas/src/fit.test.ts » flow demo rộng hơn khung: thu nhỏ tới mức cần, TOÀN BỘ node (kể cả cột cuối) nằm trong khung]
- Kịch bản: khi ngăn chi tiết mở thì fit vào phần còn lại bên trái ngăn [test: packages/flow-canvas/src/fit.test.ts » ngăn chi tiết mở: fit vào phần còn lại bên trái ngăn]
- Kịch bản: khi mở flow thật và bấm vừa khung ở cả Ngang và Dọc thì hộp mọi node nằm trọn trong khung canvas [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]
