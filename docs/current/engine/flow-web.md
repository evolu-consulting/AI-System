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

#### Yêu cầu: Chèn bước vào giữa hai bước bằng nút "+" trên cạnh
Mỗi cạnh tiến giữa hai node và mỗi cạnh Đúng/Sai của node Nếu có nút "+" ở giữa (hiện khi rê chuột lên cạnh, luôn hiện trên màn cảm ứng) mở menu "Thêm bước" giống nút "+ Thêm bước"; chọn một node thì node đó được chèn vào giữa hai node, bước sau dời xuống và mọi đích (goto, next_step, từ chối/trả lại, nhánh, nguồn field) được đánh lại số.
- Kịch bản: khi chèn một node vào cạnh giữa hai bước tuần tự thì bước sau dời xuống một và các đích trỏ tới các bước sau vẫn trỏ đúng bước cũ [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » chèn giữa hai bước tuần tự ⇒ bước sau dời xuống, đích cũ đánh lại]
- Kịch bản: khi chèn vào cạnh Đúng của node Nếu thì node mới nằm trên nhánh Đúng, đi tiếp tới đích cũ của nhánh Đúng và nhánh Sai giữ nguyên đích [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » chèn trên nhánh Đúng của Nếu ⇒ bước mới nằm trên nhánh Đúng, nhánh Sai giữ đích]
- Kịch bản: khi bước nguồn có next_step tường minh tới đích của cạnh thì sau khi chèn next_step trỏ node mới và node mới đi tiếp tới đích [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » nguồn có next_step tường minh tới đích ⇒ next_step trỏ bước mới, bước mới đi tiếp tới đích]

#### Yêu cầu: Node mới tự có trường kỹ thuật
Node mới (palette, nút + trên cạnh, Thêm bước) và flow cũ thiếu trường tự có mã giai đoạn duy nhất, tên tệp kết quả và mẫu kết quả mặc định; lỗi chặn Lưu chỉ nhắc trường nghiệp vụ.
- Kịch bản: khi chèn bước Thông báo vào cạnh rồi kiểm tra thì không còn lỗi mã, tên tệp, mẫu kết quả [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » P14 · chèn Thông báo]
- Kịch bản: khi chèn hai node cùng tên thì mã khác nhau (thong-bao, thong-bao-2) [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » P14 · chèn Thông báo]
- Kịch bản: khi đổi tên mà mã còn tự sinh thì mã đổi theo tên [test: apps/admin-web/src/features/processes/lib/def-form.test.ts » patchStage: còn keyAuto]

#### Yêu cầu: Thẻ duyệt sau "Xác nhận và lưu" khi công ty bật flow theo sự kiện
Sau khi người dùng xác nhận, thẻ duyệt tự cập nhật tới khi quy trình mở và hiện bước duyệt đang mở; trang không còn gợi ý "bản nháp"
khi hợp đồng đã gửi đi.
- Kịch bản: vừa xác nhận, quy trình đang mở ⇒ thẻ tiếp tục tải lại [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.flow.test.ts » chưa run, chưa bước, không attention ⇒ vẫn tải lại (đang mở quy trình)]
- Kịch bản: bước duyệt đã mở ⇒ thôi tải lại [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.flow.test.ts » run đã gắn, bước kế đang chờ ⇒ tải lại, bước mở ⇒ thôi]
- Kịch bản: đã gửi ⇒ không còn là bản nháp [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.flow.test.ts » đã gửi (engine, bước soạn không mở) ⇒ hết là bản nháp, bước soạn s0 mở / máy cũ ⇒ còn nháp]

#### Yêu cầu: Thẻ duyệt hiện bước của lượt flow theo sự kiện
Lượt flow theo sự kiện (quy trình dựng bằng node Nếu/Duyệt…) hiện bước Duyệt đang mở cùng nút quyết cho người duyệt, bất kể khoá
node người dựng đặt.
- Kịch bản: quy trình có node khoá tự đặt ⇒ thẻ hiện "Duyệt giá trị lớn" đang mở và người duyệt quyết được [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » stepsView thật (key 'nhanh'/'duyet-lon', idx 0/1) ⇒ bước 'Duyệt giá trị lớn' idx 1 mở, task + can_act]

#### Yêu cầu: Kéo mũi tên trên canvas để đặt đích của bước
Trên canvas sửa được, node có cổng ra hiện ở mép phải: kéo sang node ở bước SAU thì đặt "Sau đó đi tiếp" của bước thường, hoặc "Đúng thì tới bước" / "Sai thì tới bước" của node Nếu (hai cổng có nhãn Đúng / Sai); ngăn chi tiết đổi ngay. Đích không ở bước sau, hoặc nhánh Nếu trỏ tới bước có hành động thật, thì không đổi gì và báo lý do bằng một câu tiếng Việt.
- Kịch bản: khi kéo cổng Sai của node Nếu sang một node ở bước sau thì trường Sai đổi sang bước đó và giữ nguyên Đúng [test: apps/admin-web/src/features/processes/lib/canvas-connect.test.ts » Sai của Nếu ⇒ ifx.no (đếm từ 1), giữ nguyên Đúng]
- Kịch bản: khi kéo về bước đứng trước hoặc nhánh Nếu tới bước có hành động thật thì bị từ chối kèm mã lỗi [test: apps/admin-web/src/features/processes/lib/canvas-connect.test.ts » đích không ở bước sau ⇒ lỗi, không đổi gì]
- Kịch bản: khi kéo cổng Sai trên canvas thật thì ô "Sai thì tới bước" hiện bước vừa nối [test: e2e/fnr-showcase/canvas-ux.fnr.ts » CR-122 · p22 · kéo cổng Sai của node Nếu sang bước sau ⇒ ô 'Sai thì tới bước' đổi ngay, các ô chọn hiện 'Bước N · tên']

#### Yêu cầu: Ô chọn bước hiện tên bước
Mọi ô chọn "tới bước" (Đúng/Sai, "Thì tới bước" của rẽ nhánh, "Sau đó đi tiếp", kết quả chờ) hiện "Bước N · <tên các giai đoạn trong bước>", nhiều giai đoạn nối bằng " / "; bước chưa đặt tên chỉ hiện "Bước N".
- Kịch bản: khi một bước có hai giai đoạn thì nhãn nối tên bằng " / " [test: apps/admin-web/src/features/processes/lib/step-options.test.ts » nhiều giai đoạn ⇒ nối bằng ' / ']

#### Yêu cầu: Số bước tối đa của quy trình là cài đặt nền tảng
Quản trị nền tảng đặt số bước tối đa của một quy trình ở trang Hệ thống (mặc định 22, trần 50). Trình sửa dùng giá trị này cho nút "Thêm bước" (tắt + chú thích) và canvas; Hub từ chối lưu quy trình dài hơn bằng lỗi nêu trần hiện hành; quản trị công ty chỉ đọc.
- Kịch bản: khi trần là 3 thì lưu quy trình 4 bước bị 422 kèm trần, nâng lên 30 thì lưu được 25 bước [test: apps/hub-api/src/modules/processes/defs/defs-limits.int.test.ts » lưu quy trình vượt cài đặt ⇒ 422 kèm trần, nâng lên 30 thì lưu được 25 bước (DB nới CHECK)]
- Kịch bản: khi giá trị thiếu hoặc sai thì dùng mặc định 22 và luôn kẹp ≤ 50 [test: packages/contracts/src/hub-admin/process-limits.test.ts » thiếu/sai ⇒ mặc định 22]

#### Yêu cầu: Công tắc "Dùng quy trình mới" (FLOW3-FR-09)
Chỉ quản trị nền tảng và quản trị của chính công ty đó thấy và đổi được; người dùng khác của công ty không thấy, API trả 403.
- Kịch bản: khi người dùng thường hoặc quản trị công ty khác gọi flow-settings thì bị từ chối 403 [test: apps/hub-api/src/modules/processes/library/flow-settings.int.test.ts » CR-123 FR-09: member và quản trị công ty khác 403, quản trị công ty mình đọc/đổi được]
- Kịch bản: khi vai là member thì không hiện công tắc [test: apps/admin-web/src/features/tenants/flows/lib/flow-switch-access.test.ts » CR-123 FR-09 · ai thấy công tắc Dùng quy trình mới]

#### Yêu cầu: Một nút lưu cho bản của công ty (FLOW3-FR-10)
Bản quy trình của công ty chỉ có "Lưu và áp dụng" (áp dụng cho hợp đồng gửi từ giờ, hợp đồng đang chờ giữ bản cũ); "Xuất bản" chỉ cho mẫu Thư viện.
- Kịch bản: khi mở flow có tenant_id thì thanh lưu là "Lưu và áp dụng" và không có Xuất bản [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-123 FR-10 · một nút cho công ty, Xuất bản chỉ cho mẫu Thư viện]

#### Yêu cầu: Menu "+" chỉ bước nghiệp vụ (FLOW3-FR-12)
Công ty thấy Duyệt, Nếu, Ký số, Chờ ký xong, Thông báo, Kết thúc; các loại khác nằm ở "Nâng cao" chỉ quản trị nền tảng thấy.
- Kịch bản: khi công ty mở menu thì không có Nâng cao; quản trị nền tảng có Agent, Công cụ, Dify, DLC [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » CR-123 FR-12 · menu + chỉ có bước nghiệp vụ cho công ty]

#### Yêu cầu: Chữ nghiệp vụ trong trình soạn (FLOW3-FR-13)
Nếu đọc thành câu; Duyệt chọn phòng ban từ danh sách; Chờ ký xong chọn từ danh sách; Ký số hiện nhà cung cấp mặc định; Kết thúc nói ảnh hưởng tới hợp đồng; thống nhất Quy trình · Bước · Phòng ban.
- Kịch bản: khi điều kiện "giá trị > 100 triệu" thì câu đọc "Nếu Giá trị hợp đồng lớn hơn 100 triệu → đi tới …" [test: apps/admin-web/src/features/processes/lib/if-sentence.test.ts » CR-123 FR-13 · If đọc thành câu]
- Kịch bản: khi quản trị công ty mở menu "+" ở bản công ty thì chỉ thấy bước nghiệp vụ [test: e2e/journey-approval/cr122-editor.spec.ts » 1 · menu '+ Thêm bước' (quản trị công ty, CR-123 FR-12): chỉ bước nghiệp vụ, không có Nâng cao / Lõi]

#### Yêu cầu: Nối lại đầu cạnh trên canvas dùng cùng luật với kéo cổng ra
Kéo đầu đích của một cạnh (tiến thường hoặc Đúng/Sai) sang node khác thì đặt lại "Sau đó đi tiếp" / Đúng / Sai theo đúng luật của kéo cổng ra: đích phải ở bước sau, nhánh Nếu không tới bước hành động thật. Sai luật thì không đổi gì và hiện lý do bằng toast (đọc được bằng aria-live).
- Kịch bản: khi nối lại nhánh Đúng của Nếu sang bước sau thì hợp lệ, sang bước hành động thật hoặc bước trước thì bị từ chối kèm mã lỗi [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » nối lại nhánh Đúng: bước sau hợp lệ, bước thật ⇒ ifReal, bước trước ⇒ notLater]
- Kịch bản: khi kéo đầu cạnh trên canvas thật thì ô đích đổi, kéo về bước trước thì có toast lý do và không đổi gì [test: e2e/fnr-showcase/canvas-dnd.fnr.ts » CR-123 · p25 · nối lại đầu cạnh: Sai sang bước sau đổi đích, cạnh tiến kéo về bước trước ⇒ toast lý do, không đổi gì]

#### Yêu cầu: Xoá bước nối liền các cạnh; xoá cạnh đặt lại về bước tiếp theo
Chọn bước rồi nhấn Delete thì bước bị xoá và các cạnh vào/ra được nối liền (A→B→C xoá B ⇒ A→C); không nối liền hợp lệ được (nhánh Nếu sẽ tới bước hành động thật) thì từ chối. Chọn cạnh rồi Delete thì đích của cạnh về mặc định "Bước tiếp theo". Chỉ hỏi xác nhận khi bước đã có cấu hình.
- Kịch bản: khi xoá bước B giữa A và C thì C dồn lên sát A và đích cũ vào B chuyển sang C [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » A→B→C xoá B ⇒ C dồn lên sát A, đích 'đi tiếp' vào B chuyển sang C]
- Kịch bản: khi nối liền sẽ đưa nhánh Nếu vào bước hành động thật thì bị từ chối [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » nối liền sang bước thật mà nhánh Nếu đang trỏ tới ⇒ từ chối, không đổi gì]
- Kịch bản: khi xoá cạnh Sai/Đúng thì về mặc định, cạnh thường bỏ "đi tiếp", đã mặc định thì báo [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » Sai → null (bước kế), Đúng → bước kế nếu có]
- Kịch bản: khi nhấn Delete trên canvas thật rồi Ctrl+Z thì bước trở lại [test: e2e/fnr-showcase/canvas-dnd.fnr.ts » CR-123 · p25 · Delete xoá cạnh/bước, Ctrl+Z và nút Hoàn tác khôi phục, Ctrl+Y làm lại]

#### Yêu cầu: Hoàn tác / làm lại trong phiên sửa, tối đa 100 bước
Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) và hai nút trên thanh công cụ hoàn tác / làm lại các thao tác sửa quy trình trong phiên mở trình sửa (đóng là mất); tối đa 100 bước; gõ liên tiếp vào cùng một ô gộp thành một bước.
- Kịch bản: khi ghi 3 bước rồi lùi 2 và tiến 1 thì về đúng trạng thái [test: apps/admin-web/src/features/processes/lib/edit-history.test.ts » ghi 3 bước, lùi 2, tiến 1]
- Kịch bản: khi ghi quá 100 bước thì bước cũ nhất rớt [test: apps/admin-web/src/features/processes/lib/edit-history.test.ts » tối đa 100 bước: bước cũ nhất rớt]
- Kịch bản: khi bấm tổ hợp phím thì ra đúng lệnh [test: packages/flow-canvas/src/editing.test.ts » Ctrl+Z hoàn tác, Ctrl+Y và Ctrl+Shift+Z làm lại (cả Cmd)]

#### Yêu cầu: Chọn nhiều, kéo nhóm, nhân đôi bằng Ctrl+C / Ctrl+V
Shift+nhấn hoặc Shift+kéo khung chọn nhiều bước; kéo một bước đã chọn thì cả nhóm dời cùng số cột (luật cột giữ nguyên). Ctrl+C rồi Ctrl+V nhân đôi các bước đã chọn (tên "(bản sao)", mã mới, cạnh giữa các bản sao nối với nhau) đặt ngay sau bước đang chọn; vượt số bước tối đa của nền tảng thì từ chối bằng câu cũ.
- Kịch bản: khi dán thì bản sao có tên + mã mới, đặt sau bước chọn, cạnh giữa bản sao nối với nhau [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » bản sao đặt ngay sau bước chọn, tên + mã mới, cạnh giữa các bản sao nối với nhau]
- Kịch bản: khi dán vượt giới hạn bước thì từ chối [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » vượt giới hạn bước ⇒ từ chối bằng câu cũ, không đổi gì]
- Kịch bản: khi kéo nhóm thì cả nhóm dời cùng số cột [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » dời cả nhóm cùng số cột, giữ thứ tự, cột bỏ trống bị nén]
- Kịch bản: khi chọn hai bước bằng Shift+nhấn rồi Ctrl+C/V trên canvas thật thì có hai bản sao [test: e2e/fnr-showcase/canvas-dnd.fnr.ts » CR-123 · p25 · Shift+nhấn chọn nhiều, Ctrl+C / Ctrl+V nhân đôi (tên + mã mới), bảng phím tắt]

#### Yêu cầu: Thả bước từ menu "Thêm bước" vào sơ đồ
Kéo một mục của menu "Thêm bước" thả lên chỗ trống thì bước mới nằm cuối cột dưới con trỏ (đúng độ cao thả); thả lên một mũi tên thì chèn giữa hai bước (nhánh Đúng/Sai không nhận bước hành động thật). Đủ số bước hoặc cột đầy thì báo lý do và không đổi gì.
- Kịch bản: khi thả vào cột có sẵn thì nằm cuối cột và lưu độ cao thả [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » thả vào cột có sẵn ⇒ nằm cuối cột, lưu y điểm thả]
- Kịch bản: khi thả ra ngoài cột cuối thì thành bước mới ở cuối [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » thả ra ngoài cột cuối ⇒ bước mới ở cuối]
- Kịch bản: khi chèn trên nhánh Đúng của Nếu thì bước mới nằm trên nhánh Đúng [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » chèn trên nhánh Đúng của Nếu ⇒ bước mới nằm trên nhánh Đúng, nhánh Sai giữ đích]

#### Yêu cầu: Canvas vẽ cạnh tới bước "đi tiếp" khi khác bước kế
Bước có "Sau đó đi tiếp" trỏ khác bước kế thì canvas vẽ cạnh tới đúng bước đó thay cho cạnh tới bước kế (bước đứng một mình trong cột).
- Kịch bản: khi bước a đi tiếp tới bước 2 thì có cạnh a→c thay a→b [test: apps/admin-web/src/features/processes/lib/jump-edges.test.ts » a đi tiếp tới bước 2 ⇒ cạnh a→c thay a→b]

#### Yêu cầu: Node module là MỘT ô (cụm stage)
Node của app có nhiều stage (Ký số = gửi + chờ ký xong) là một cụm stage liên tiếp, đủ và đúng thứ tự như manifest. Lưu mà cụm bị tách, thiếu, đảo thứ tự hoặc có stage lạ chen giữa bị từ chối 422 `FLOW_NODE_SPLIT` với câu "Bước Ký số bị tách rời — xoá rồi thêm lại bước Ký số".
- Kịch bản: khi stage lạ chen giữa gửi và chờ thì phát hiện split kèm tên bước [test: packages/contracts/src/hub-admin/process-module-nodes.test.ts » stage lạ chen giữa ⇒ split, chỉ rõ bước + câu nghiệp vụ]
- Kịch bản: khi lưu def có cụm Ký số bị tách thì Hub trả 422 FLOW_NODE_SPLIT và không lưu [test: apps/hub-api/src/modules/processes/defs/defs-node-config.int.test.ts » stage lạ chen giữa gửi và chờ ⇒ 422 + message có tên bước + cách sửa, không lưu]

#### Yêu cầu: Menu "+" chỉ một mục Ký số
Menu "+" của công ty không có mục "Chờ ký xong"; "Ký số" chèn cả hai stage (chờ 168 giờ).
- Kịch bản: khi mở menu "+" của công ty thì không có mục Chờ ký xong [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng]
- Kịch bản: khi thêm Ký số thì được hai stage cùng node, tool rồi chờ sự kiện [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » nodeToPatches cho 2 stage cùng node, tool rồi wait_event, chờ 168 giờ]

#### Yêu cầu: Xoá và sao chép đi cả cụm
Xoá hoặc sao chép bất kỳ stage nào của cụm tác động lên cả cụm; nhánh chờ ký mặc định về Kết thúc · Từ chối nếu flow có.
- Kịch bản: khi xoá một stage của Ký số thì cả hai stage mất [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » xoá một stage của cụm ⇒ mất cả hai, bước nén lại]
- Kịch bản: khi sao chép Ký số thì được thêm cả hai stage, vẫn hai cụm hợp lệ [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » sao chép ⇒ cả hai stage, nối tiếp ngay sau cụm gốc, mã/uid mới, vẫn là hai cụm hợp lệ]
- Kịch bản: khi flow có Kết thúc · Từ chối thì nhánh từ chối/huỷ/hết hạn của phần chờ về đó [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » có Kết thúc · Từ chối ⇒ declined/voided/timeout đều về bước đó]

#### Yêu cầu: Node module nhiều stage là một ô trên sơ đồ flow (nguồn: CR-123 FLOW3-FR-14)
Trên sơ đồ flow, các stage liền nhau của cùng một node module (Ký số = gửi ký + chờ ký) hiện thành MỘT ô cùng dáng bước thường: tên bước, loại node,
và các đầu ra theo kết quả nghiệp vụ do manifest khai (`exits`: Ký xong · Từ chối · Hết hạn). Ô chiếm một cột; chọn ô là chọn stage đầu của cụm;
cạnh vào ô tới stage đầu, cạnh "đi tiếp" ra khỏi ô tới bước kế, cạnh Từ chối/Hết hạn theo nhánh của stage chờ. Bản nháp và dữ liệu đã lưu không đổi.
- Kịch bản: khi mở mẫu "Duyệt theo giá trị" thì thấy đúng một ô Ký số với ba đầu ra Ký xong, Từ chối, Hết hạn [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » đúng MỘT ô Ký số với 3 đầu ra Ký xong · Từ chối · Hết hạn]
- Kịch bản: khi gộp thì ô chiếm một cột và số cột đếm ô một lần [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » ô chiếm một cột: cột sau dồn trái, số cột đếm ô một lần]
- Kịch bản: khi stage chờ có nhánh từ chối/hết hạn thì cạnh đi từ đúng đầu ra tới bước đích [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » nhánh Nếu và cạnh Từ chối/Hết hạn đổi theo cột đã gộp]
- Kịch bản: khi vẽ bố cục thì cạnh vào ô tới stage đầu và cạnh ra đi thẳng bước kế [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » bố cục: vào ô tới stage đầu, ra ô đi thẳng bước kế, số cột = 7]
- Kịch bản: khi kéo đầu ra Từ chối / Hết hạn / Ký xong sang bước sau thì đặt nhánh của stage chờ, đích không sau stage chờ thì báo lỗi [test: apps/admin-web/src/features/processes/lib/canvas-connect-exit.test.ts » Từ chối ⇒ declined + voided của stage chờ tới đích, giữ nhánh khác]
- Kịch bản: khi tính chỗ còn lại cho trần số bước thì ô Ký số tính 2 stage [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » số stage thật (trần số bước) khác số ô: ô Ký số = 2 stage]

#### Yêu cầu: Canvas flow nói chữ nghiệp vụ, không nhắc sai, chặn thả sai chỗ (nguồn: CR-123 u4)
Node trên canvas flow không hiện loại kỹ thuật dưới tên bước; lỗi "tính năng chưa bật" nói bằng câu nghiệp vụ kèm cách sửa; cạnh vàng không nhắc thứ mà "Bắt đầu khi" đã có ở mọi bước sau;
điều kiện Nếu trên dữ kiện Có/Không chỉ có "là / không là" + chọn Có/Không; nhãn Đúng/Sai hiện một lần; thả / chèn bước hành động thật (Ký số) mà bước ngay trước chưa phải bước duyệt thì bị chặn kèm lý do.
- Kịch bản: khi node có lỗi "tính năng chưa bật" thì câu lỗi có bản dịch vi và en [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » u4 · câu lỗi trên node có bản dịch (vi + en)]
- Kịch bản: khi flow bắt đầu từ hợp đồng thì bước Ký số không bị nhắc thiếu Hợp đồng [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » có đầu ra trigger (HĐ) ⇒ không báo]
- Kịch bản: khi điều kiện Nếu trên dữ kiện Có/Không thì chỉ có phép là hoặc không là [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » opsForType boolean chỉ eq / ne, kiểu số vẫn đủ 6]
- Kịch bản: khi thả bước Ký số sau bước không phải duyệt thì bị chặn [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » sau bước tự động ⇒ trả uid của bước hành động thật]
- Kịch bản: khi bước Ghi giá trị hay Điền thông tin thì không hiện chữ kỹ thuật dưới tên [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » u4 · bước Ghi giá trị / Điền thông tin không lộ chữ kỹ thuật dưới tên bước]
- Kịch bản: khi kéo mục Thông báo từ menu Thêm bước thả vào canvas công ty thì thêm một node [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]
- Kịch bản: khi dữ kiện Có/Không thì câu đọc là Có hoặc Không thay vì bằng true [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » u4 · câu Có/Không đọc như người nói]
- Kịch bản: khi bước hành động thật mất người duyệt ngay trước thì luật chung của contracts báo bước đó [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » process-real-rule · Ký số cần bước duyệt ngay trước]
- Kịch bản: khi lưu, chèn, thả, kéo nhóm, dán hoặc nối lại thì mọi đường gọi cùng luật chung [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » u4 · MỘT luật Ký số cần bước duyệt ngay trước — mọi đường gọi luật chung của contracts]

#### Yêu cầu: Thả node từ bảng mẫu là node đứng riêng, nối bằng mũi tên (nguồn: CR-123 FLOW3-FR-04 u5)
Thả một loại node lên canvas tạo node mới ĐỨNG RIÊNG tại điểm thả: không tự nối, không tự chèn kể cả thả lên một cạnh; node hiện gợi ý "Kéo mũi tên để nối bước này". Chỉ kéo mũi tên từ đầu ra bước trước mới nối được (sai luật thì từ chối kèm toast lý do giữa-trên, tự đóng sau 4 giây); chèn giữa hai bước chỉ bằng nút "+" trên cạnh. Lưu còn node chưa nối bị chặn kèm câu chỉ bước; danh sách bước hiện node nhiều stage một dòng.
- Kịch bản: khi thả node từ menu Thêm bước thì chỉ thêm một node, không thêm cạnh và hiện gợi ý nối [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]
- Kịch bản: khi còn node đứng riêng thì Lưu bị chặn với tên bước và node có lỗi [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts » cùng một nguồn: freeErrors, validateDraft, blockedInfo (tên bước + chỉ số)]
- Kịch bản: khi có mũi tên tới node thì hết đứng riêng, cả cụm Ký số [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts » markFree chỉ đánh dấu uid vừa thả, clearFree gỡ cờ của cả cụm node module]
- Kịch bản: khi nối từ Bắt đầu khi hoặc bước tự động tới Ký số thì bị từ chối [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts » bước tự động tới Ký số bị từ chối, bước duyệt tới Ký số nối được]
- Kịch bản: khi cột có node đứng riêng thì không vẽ nút gộp thừa [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts » cột có node đứng riêng: nút gộp thừa bị bỏ, nối thẳng nguồn tới đích]

#### Yêu cầu: Kéo mũi tên nối bước dễ và không bị che (nguồn: CR-123 FLOW3-FR-04/05 u8)
Cổng ra của bước, đầu ra của Ký số (Ký xong, Từ chối, Hết hạn) và "Bắt đầu khi" kéo được bằng chuột: cổng đủ lớn, hover phản hồi, dây nối đi theo chuột, node dưới con trỏ viền đậm. Ngăn chi tiết không tự mở khi thả node và không che đích khi đang kéo. Kéo tới node đứng riêng nằm chưa sau nguồn thì node thành bước mới ngay sau nguồn. Thả node không xen vào giữa cụm Ký số.
- Kịch bản: khi kéo mũi tên tới node đứng riêng chưa sau nguồn thì node thành bước mới ngay sau nguồn và hết đứng riêng [test: apps/admin-web/src/features/processes/lib/u8-arrow-drag.test.ts » node đứng riêng nằm chưa sau nguồn ⇒ thành bước mới ngay sau nguồn, nối xong hết đứng riêng]
- Kịch bản: khi thả node vào cột của Ký số thì dời ra sau cụm [test: apps/admin-web/src/features/processes/lib/u8-arrow-drag.test.ts » cột của cụm ⇒ dời ra sau cụm, cột ngoài cụm giữ nguyên]
- Kịch bản: khi kéo từ Bắt đầu khi tới node đứng riêng thì node thành bước đầu tiên [test: apps/admin-web/src/features/processes/lib/u8-arrow-drag.test.ts » tới node đứng riêng ⇒ thành bước đầu tiên và hết đứng riêng]
- Kịch bản: khi thả Duyệt, kéo Ký xong tới nó, kéo từ nó tới Kết thúc thì Lưu và áp dụng thành công [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

#### Yêu cầu: Canvas sửa flow giữ khung nhìn và đọc được (nguồn: CR-123 u11)
Thêm node không làm canvas fit lại: giữ zoom/pan của người dùng và cuộn mượt tới node mới. Mở lần đầu và nút "Vừa khung" hiện trọn số cột nguyên ở zoom không dưới 0.75 (flow dài kéo ngang, không thu nhỏ). Node báo lỗi "chưa bật" bằng nhãn ngắn, câu đầy đủ ở tooltip. Bước Duyệt mới thả ra có tên "Bước duyệt mới" và nhắc đặt tên.
- Kịch bản: khi khung rộng 1100 px thì hiện 4 cột trọn ở zoom không dưới 0.75 và cột kế tiếp không lộ mẩu node [test: packages/flow-canvas/src/columns-fit.test.ts » khung 1100px ⇒ 4 cột trọn, chữ ≥ 0.75, cột thứ 5 bắt đầu ở/ngoài mép phải]
- Kịch bản: khi thả Duyệt thì node có tên "Bước duyệt mới" kèm nhắc đặt tên và flow vẫn lưu được sau khi nối [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

#### Yêu cầu: Mũi tên chỉ bị từ chối khi tạo vòng lặp (nguồn: CR-123 FLOW3-FR-04 u12)
Kéo mũi tên tới bất kỳ bước nào không phải tổ tiên của nguồn đều nối được; bước đích nằm trước nguồn thì các bước được sắp lại để bản nháp vẫn hợp lệ. Nối ngược về tổ tiên bị từ chối bằng "Không nối ngược lại bước trước — sẽ tạo vòng lặp". Ký số vẫn cần Duyệt ngay trước; "Bắt đầu khi" → Ký số báo lý do.
- Kịch bản: khi nối bước đứng sau tới bước nằm trước nhưng không phải tổ tiên thì các bước được sắp lại và mũi tên nối được [test: apps/admin-web/src/features/processes/lib/u12-arrow-order.test.ts » đích nằm trước nguồn và không phải tổ tiên ⇒ sắp lại, mũi tên nối được]
- Kịch bản: khi đích là tổ tiên của nguồn thì bị từ chối vì vòng lặp [test: apps/admin-web/src/features/processes/lib/u12-arrow-order.test.ts » đích là tổ tiên (hoặc bước đầu) ⇒ từ chối vì tạo vòng lặp, không đổi gì]
- Kịch bản: khi nối từ Bắt đầu khi tới Ký số thì bị từ chối kèm lý do [test: apps/admin-web/src/features/processes/lib/u12-arrow-order.test.ts » bị từ chối kèm mã lý do `realNeeds` (hook báo toast)]
- Kịch bản: khi kéo Thông báo tới Kết thúc · Đã duyệt nằm trước nó thì nối được, nối ngược bị từ chối và Bắt đầu khi → Ký số hiện toast [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12 · mũi tên tới bước nằm trước (Thông báo → Kết thúc · Đã duyệt) sắp lại bước, nối ngược bị từ chối vì vòng lặp, Bắt đầu khi → Ký số báo lý do]

#### Yêu cầu: Mũi tên chỉ bị từ chối khi tạo vòng lặp thật; bước Duyệt luôn đứng một mình (nguồn: CR-123 u12b)
Hai bước cùng cột không phải vòng lặp: nối giữa chúng đặt đích ở bước ngay sau nguồn. Node vừa thả luôn thành bước mới ngay sau nguồn khi nối. Bước Duyệt phải đứng một mình trong bước: canvas tách sau mỗi mũi tên và chặn Lưu kèm lý do nếu còn chung cột.
- Kịch bản: khi thả Duyệt vào cột của Thông báo rồi nối Ký xong → Duyệt → Thông báo → Kết thúc thì mọi mũi tên nối được và Duyệt đứng một mình [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » Duyệt → Thông báo và Thông báo → Kết thúc đều nối được (không báo vòng lặp sai)]
- Kịch bản: khi bước Duyệt chung cột với bước khác thì Lưu bị chặn kèm lý do [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » approveAloneErrors chặn Lưu kèm lý do tại stages.i.step]
- Kịch bản: khi chạy đúng trình tự demo thì Bắt đầu khi → Ký số báo lý do và Lưu và áp dụng không trả 422 [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]

#### Yêu cầu: Sơ đồ flow xếp bằng ELK, gập hàng, cổng ra cố định thứ tự, cạnh vuông góc (nguồn: CR-123 u13, ADR-0040)
Sơ đồ flow do ELK `layered` xếp khi mở lần đầu và khi cấu trúc đổi: đi trái → phải, gập thành nhiều hàng cho vừa khung, đầu ra nhiều nhánh (Ký số, Nếu) là cổng ở mép phải theo thứ tự cố định, cạnh vuông góc. Node người dùng kéo tay giữ vị trí; "Sắp xếp" xoá vị trí tay và hoàn tác được.
- Kịch bản: khi xếp flow demo 8 bước thì các bước gập hàng và vừa khung 1100×458 ở chữ đọc được [test: packages/flow-canvas/src/layout/elk.test.ts » flow demo 8 bước: đi trái → phải, gập hàng, vừa khung 1100×458 ở zoom ≥ 0.75]
- Kịch bản: khi node có nhiều đầu ra thì cổng đi từ trên xuống theo thứ tự Ký xong, Từ chối, Hết hạn [test: packages/flow-canvas/src/layout/elk.test.ts » thứ tự cổng từ trên xuống: Ký xong → Từ chối → Hết hạn]
- Kịch bản: khi dựng cạnh thì bước Kết thúc không có cạnh đi tiếp và node Nếu có đúng hai cạnh Đúng/Sai [test: packages/flow-canvas/src/layout/graph.test.ts » bước Kết thúc không có cạnh đi tiếp]
- Kịch bản: khi thả node từ menu thì node thêm đúng một, đứng riêng ở chỗ thả [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]

#### Yêu cầu: Kết thúc là điểm cuối; khung nhìn đi theo node đang làm việc (nguồn: CR-123 u14)
Bước Kết thúc không có cổng ra và không có cạnh đi tiếp; mũi tên không bao giờ xuất phát từ Kết thúc; lưu bị chặn nếu Kết thúc còn bước đi tiếp. Sau thả / nối / bố cục lại, node mới và node vừa nối nằm trọn trong khung (zoom ≥ 0.75).
- Kịch bản: khi kéo mũi tên xuất phát từ Kết thúc thì bị từ chối [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » mũi tên xuất phát từ Kết thúc luôn bị từ chối (kể cả tới bước nằm trước / sau)]
- Kịch bản: khi bản nháp còn Gộp tới ở Kết thúc thì chặn Lưu [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » bản nháp còn 'Gộp tới' ở Kết thúc ⇒ lỗi chặn Lưu tại stages.i.nextStep]
- Kịch bản: khi def lưu có Kết thúc rẽ nhánh đi tiếp thì bị từ chối [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » u14 · Kết thúc là điểm cuối: có luật rẽ nhánh đi tiếp ⇒ FLOW_FINISH_NEXT]
- Kịch bản: khi node mới nằm nửa ngoài khung thì khung nhìn đưa nó và node vừa nối vào trọn khung, zoom không dưới 0.75 [test: packages/flow-canvas/src/view-focus.test.ts » node mới nằm nửa ngoài khung ⇒ khung nhìn đích đưa nó (cùng node vừa nối) vào trọn khung, zoom giữ nguyên]
- Kịch bản: khi mở flow thì Kết thúc không có cổng ra và node thả nằm trọn trong khung [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12 · mũi tên tới bước nằm trước (Thông báo → Kết thúc · Đã duyệt) sắp lại bước, nối ngược bị từ chối vì vòng lặp, Bắt đầu khi → Ký số báo lý do]

#### Yêu cầu: Vế Có/Không của node Nếu là boolean thật ở mọi nơi (nguồn: CR-123 u15)
Điều kiện trên dữ kiện Có/Không lưu, truyền và so sánh bằng boolean thật (như "Bắt đầu khi"); def cũ lưu chuỗi "true"/"false" được đọc thành boolean; luật lưu chỉ nhận boolean + "là / không là".
- Kịch bản: khi tạo def qua API với vế Có/Không là boolean `true` thì lưu được và chạy rẽ đúng nhánh [test: apps/hub-api/src/modules/processes/triggers/flow-bool-one-form.int.test.ts » tạo def qua API với boolean thật ⇒ 201 và lưu đúng boolean]
- Kịch bản: khi def cũ có chuỗi "true" ở vế dữ kiện thì đọc thành boolean, vế input giữ chuỗi [test: packages/contracts/src/hub-admin/process-if-bool.test.ts » "true"/"false" của def cũ ở vế dữ kiện ⇒ boolean khi đọc, vế input/field giữ chuỗi]
- Kịch bản: khi dữ kiện boolean so với chuỗi lạ, số hoặc phép thứ tự thì luật lưu từ chối [test: packages/contracts/src/hub-admin/process-if-bool.test.ts » chuỗi khác / số / phép thứ tự trên dữ kiện boolean ⇒ FLOW_WHEN_INVALID]
- Kịch bản: khi editor lưu điều kiện Có/Không thì gửi boolean thật [test: apps/admin-web/src/features/processes/lib/if-boolean-when.test.ts » CR-123 u15 · editor phát boolean THẬT (cùng dạng với Bắt đầu khi), đọc lại giữ đúng]
- Kịch bản: khi engine so dữ kiện boolean với boolean thật hoặc chuỗi cũ thì cùng kết quả [test: apps/hub-api/src/modules/processes/domain/runs/finish.rules.test.ts » CR-123 u15 · dữ kiện boolean so với boolean THẬT (và chuỗi cũ 'true'/'false' cho cùng kết quả)]

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
