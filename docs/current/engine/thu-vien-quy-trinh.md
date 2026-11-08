# Engine · Thư viện quy trình

Cập nhật: 2026-10-31 · Nguồn: CR-105 (docs/specs/process-library, pl-*). Quy trình cấp nền tảng gắn khe của app, gán theo tenant; app đọc qua `resolveSlot` lúc mở lượt (xem `sht/duyet-ky-so.md` §1b).

#### Yêu cầu: Quy trình thư viện gắn khe của app
Platform admin tạo quy trình cấp nền tảng gắn khe (v1 `contracts.approval` — "Sổ Hợp Tác · Duyệt hợp đồng"); bước trỏ phòng ban bằng mã, không id; mẫu chạy thử tách riêng.
- Kịch bản: khi def thư viện có khe chứa `group_id` thay vì mã thì lưu bị từ chối 422 `PROCESS_REF_INVALID` [test: apps/hub-api/src/modules/processes/defs/def-group-keys.rules.test.ts » def thư viện dùng id Group ⇒ PROCESS_REF_INVALID]
- Kịch bản: khi người không phải platform_admin gọi API thư viện thì nhận 403 [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » không phải platform_admin ⇒ 403]
- Kịch bản: khi lấy danh sách mặc định thì không có mẫu chạy thử và không có def vật chất hoá; tab "Mẫu · chạy thử" có mẫu [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » danh sách library không lẫn mẫu và def vật chất hoá]

#### Yêu cầu: Gán tenant × khe = đúng một quy trình
Bảng gán có khoá chính (tenant, khe); gán quy trình khác thay thế; chỉ platform admin gán; tenant thiếu phòng ban theo mã thì không gán được.
- Kịch bản: khi gán X → A rồi gán X → B thì chỉ còn một hàng X → B [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » gán lại thay thế, một tenant một khe một quy trình]
- Kịch bản: khi tenant thiếu Group theo mã mà quy trình dùng thì gán bị từ chối 422 `SLOT_GROUPS_MISSING` liệt kê mã thiếu [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » tenant thiếu Group ⇒ SLOT_GROUPS_MISSING]
- Kịch bản: khi tenant Y đọc bảng gán, bản phát hành, khe thì không thấy hàng của tenant X [test: apps/hub-api/src/modules/processes/library/library-rls.int.test.ts » chặn đọc chéo tenant bảng gán, release, khe]

#### Yêu cầu: Quy trình mặc định của khe
Mỗi khe đúng một quy trình mặc định, nhãn "Mặc định · Sổ Hợp Tác · Duyệt hợp đồng"; tenant chưa gán chạy mặc định; không xoá/tắt được; platform admin đổi mặc định sang quy trình đã xuất bản khác.
- Kịch bản: khi xoá hoặc tắt quy trình đang là mặc định hoặc đang gán thì nhận 409 `PROCESS_IN_USE` [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » xoá hoặc tắt quy trình đang dùng ⇒ PROCESS_IN_USE]
- Kịch bản: khi đổi mặc định sang B thì tenant chưa gán mở lượt duyệt kế tiếp chạy B, tenant đã gán A vẫn chạy A [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » đổi mặc định áp cho tenant chưa gán ở lượt kế]

#### Yêu cầu: Nháp, xuất bản, lịch sử, quay lại, nhật ký
Sửa trên nháp; chỉ bản xuất bản được chạy; xuất bản kiểm trước (đủ nút hệ thống, không bước không tới được, điều kiện hợp lệ, mọi tenant đang dùng đủ phòng ban) và hiện tác động; quay lại tạo bản mới; mọi xuất bản/gán/quay lại/đổi mặc định ghi audit.
- Kịch bản: khi sửa nháp mà chưa xuất bản thì lượt mới vẫn chạy bản xuất bản cũ [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » sửa nháp chưa xuất bản không đổi lượt mới]
- Kịch bản: khi xuất bản thì tạo bản v+1, ghi một dòng audit, impact trả số tenant đang dùng và số lượt đang chạy [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » xuất bản tạo bản mới, ghi audit, impact đúng số]
- Kịch bản: khi quy trình thiếu nút `contracts-finalize` hoặc có bước không tới được thì xuất bản bị từ chối 422 chỉ rõ bước sai [test: apps/hub-api/src/modules/processes/library/library-publish.rules.test.ts » thiếu nút hệ thống hoặc bước không tới được ⇒ từ chối]
- Kịch bản: khi quay lại bản 2 từ bản 4 thì có bản 5 nội dung bằng bản 2 và nháp về bản 2 [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » quay lại tạo bản mới bằng bản cũ]

#### Yêu cầu: Editor một chỗ, hai cách xem, xem trước đường đi
Editor ai-admin có nút Canvas/Form; nút hệ thống khoá; khe `contracts.approval` chỉ nhận dạng tuần tự; xem trước tô bước chạy/bỏ qua theo loại HĐ + giá trị mẫu.
- Kịch bản: khi canvas gửi hai bước song song cho quy trình khe `contracts.approval` thì lưu bị từ chối 422 `SLOT_SHAPE_UNSUPPORTED` [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-stages.rules.test.ts » dạng song song ⇒ SLOT_SHAPE_UNSUPPORTED]
- Kịch bản: khi `fromStages(compileDef(flow))` thì ra đúng `flow` ban đầu kể cả `when` và bước Ký số [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-stages.rules.test.ts » fromStages nghịch compileDef]
- Kịch bản: khi xem trước với loại "mua" giá trị 50.000.000 thì bước cấp 2 bị bỏ qua và không ghi gì [test: apps/hub-api/src/modules/processes/library/library-preview.int.test.ts » xem trước tô bước bỏ qua, không ghi]
- Kịch bản: khi platform admin sửa ở Form, xuất bản, gán cho tenant thì cột "Tenant đang dùng" tăng và Canvas hiện nút hệ thống khoá [test: e2e/P-a/pf4/process-library.pa.ts » sửa Form, xuất bản, gán tenant, canvas khoá nút hệ thống]

## CR-118 · Delta gộp 2026-11-04 (đợt cr118-r1)
Mục dưới đây thắng nội dung cũ cùng chủ đề ở trên (lát: cr118-flow-canvas, cr118-flow-routing).

#### Yêu cầu: Canvas editor quy trình dùng gói sơ đồ chung (ADM-FR-71) (nguồn: cr118-flow-canvas)
Canvas của trình soạn quy trình do `@ai/flow-canvas` vẽ ở chế độ sửa: bố cục cột theo bước, làn Đúng/Sai của node If, cạnh quay lại/rẽ nhánh, kéo thả chốt cột. Bố cục và hành vi giữ nguyên toạ độ từng điểm; node giai đoạn do admin-web cấp.
- Kịch bản: khi có các giai đoạn song song và nhánh If thì toạ độ node và cạnh bằng đúng bản trước khi gộp gói [test: packages/flow-canvas/src/layout/columns.test.ts » snapshot bố cục cột: toạ độ node và cạnh giữ nguyên (song song, quay lại, If)]
- Kịch bản: khi thả node thì cột gần nhất được chọn và độ dịch để node không nằm dưới ngăn chi tiết đúng như trước [test: packages/flow-canvas/src/layout/columns.test.ts » stepFromDropX: cột gần nhất, vượt cuối ⇒ bước mới, revealDx]
- Kịch bản: khi bật chế độ chỉ xem thì node không kéo được, chế độ sửa thì kéo được và gọi móc của host [test: packages/flow-canvas/src/mode.test.ts » mode view khoá kéo/nối/chọn, edit chỉ mở kéo]
- Kịch bản: khi mở canvas ở trình soạn thì các nút giai đoạn và panel chi tiết vẫn hiện như trước [test: e2e/P-b2/admin/canvas.pb2.ts » ADM-FR-71 · E-PB2-01 · mở pb2-canvas ⇒ application 'Canvas quy trình', 4 nút 'Giai đoạn n: …', panel 'Chi tiết giai đoạn' chọn sẵn Giai đoạn 1]

#### Yêu cầu: Chọn quy trình theo phòng ban người khởi tạo (nguồn: cr118-flow-routing)
Mỗi tenant × khe có danh sách luật có thứ tự {phòng ban → quy trình} + một luật mặc định; luật đầu tiên khớp thắng (phòng ban
con khớp luật của phòng cha); không khớp ⇒ mặc định; không có mặc định ⇒ chặn khởi tạo. Không có luật ⇒ như cũ (gán ⇒ mặc định khe).
- Kịch bản: luật thuần chọn theo thứ tự, phòng con, mặc định, chặn [test: apps/hub-api/src/modules/processes/library/routing.rules.test.ts » pickProcess]
- Kịch bản: khởi tạo bởi người phòng ban có luật ⇒ quy trình của luật đó, ghi id luật vào run [test: apps/hub-api/src/modules/processes/library/routing-launch.int.test.ts » launch chọn quy trình theo phòng ban người khởi tạo]
- Kịch bản: đổi luật sau khi khởi tạo ⇒ run cũ giữ quy trình đã chọn [test: apps/hub-api/src/modules/processes/library/routing-launch.int.test.ts » run cũ giữ quy trình khi đổi luật]
- Kịch bản: không có luật ⇒ kết quả như resolveSlot cũ [test: apps/hub-api/src/modules/processes/library/routing-launch.int.test.ts » không có luật ⇒ như resolveSlot]

#### Yêu cầu: Gán nhiều quy trình cho tenant (platform_admin) (nguồn: cr118-flow-routing)
platform_admin gán/bỏ gán quy trình thư viện đã xuất bản cho tenant × khe; bỏ gán quy trình đang được luật dùng ⇒ 409 kèm danh sách luật.
- Kịch bản: gán rồi bỏ gán; bỏ gán khi luật đang dùng ⇒ 409 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » platform_admin gán và bỏ gán quy trình]

#### Yêu cầu: Tenant admin sửa luật chọn quy trình của tenant mình (nguồn: cr118-flow-routing)
GET/PUT luật cho platform_admin và tenant_admin của chính tenant; thay cả danh sách trong một transaction, `version` chống ghi
đè (409), chỉ quy trình đã gán (422), phòng ban của tenant (422), ≤ 50 luật; audit trước/sau; bump cấu hình Hub.
- Kịch bản: tenant admin lưu luật OK + audit + bump [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » tenant admin lưu luật]
- Kịch bản: quy trình chưa gán ⇒ 422 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » quy trình chưa gán ⇒ 422]
- Kịch bản: phòng ban tenant khác ⇒ 422 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » phòng ban tenant khác ⇒ 422]
- Kịch bản: tenant admin tenant khác ⇒ 404; member ⇒ 403 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » tenant admin tenant khác ⇒ 404, member ⇒ 403]
- Kịch bản: ghi đồng thời cùng version ⇒ 409 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » ghi đồng thời ⇒ 409]
- Kịch bản: RLS — scope user tenant khác không đọc được luật/tập gán [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » RLS chặn đọc chéo tenant]

#### Yêu cầu: Xuất bản flow Thư viện theo sự kiện
Flow Thư viện có "Bắt đầu khi" (trigger) và không có khe xuất bản được như flow theo khe: lưu bản phát hành v+1 sau khi kiểm luật flow (bước Kết thúc, sự kiện/điều kiện của app, cạnh giữa các bước); không đòi khe hay nút hệ thống của khe. Flow sai luật ⇒ 422 kèm đường dẫn lỗi và không tạo bản phát hành. Flow đã xuất bản gán được cho công ty và chạy từ bản phát hành mới nhất.
- Kịch bản: khi xuất bản flow Thư viện có trigger rồi gán cho công ty thì sự kiện mở đúng một lượt chạy từ bản phát hành [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » tạo → xuất bản v1 → gán công ty → sự kiện mở đúng 1 lượt từ BẢN XUẤT BẢN; xuất bản lại ⇒ v2]
- Kịch bản: khi flow Thư viện sai luật thì xuất bản trả 422 kèm đường dẫn và không có bản phát hành [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » flow lỗi ⇒ 422 PROCESS_DEF_INVALID + paths, không tạo bản xuất bản]
- Kịch bản: khi xuất bản def theo khe cũ thì vẫn kiểm luật khe như trước [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » def theo khe cũ xuất bản như trước (luật khe + nút hệ thống)]
- Kịch bản: khi flow Thư viện có trigger chưa gán cho công ty thì tenant_admin không thấy, gán rồi thì mở xem được [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » tenant_admin chỉ mở (chỉ đọc) def Thư viện có trigger khi ĐÃ gán cho công ty của mình]

#### Yêu cầu: Def theo khe đã backfill (M1) vẫn sửa được theo đường khe
Def khe có thêm node Kết thúc ở đuôi (hub 0111) vẫn dựng lại được body từ stages (canvas) và lưu theo đường khe; luật FlowDef không áp cho def khe / bản riêng lưu theo khe. Nhân bản def khe không chép trigger/app. Def mặc định của seed có `published_version` 2 vì M1 tạo release v+1 (test library.routes cập nhật theo).
- Kịch bản: khi sửa bản riêng chỉ gửi stages có node Kết thúc đuôi thì body dựng lại và lưu được [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » PUT bản riêng (chỉ gửi stages) ⇒ slot_body được dựng lại + giữ, slot vẫn null, nguồn/bản không đổi]

#### Yêu cầu: Mẫu "Duyệt theo phòng ban" không cho ký khi chưa ai duyệt
Hợp đồng của phòng ban không khớp điều kiện vẫn phải qua Trưởng phòng duyệt rồi mới tới Ký số.
- Kịch bản: phòng ban khác X ⇒ nhóm Trưởng phòng duyệt ⇒ gộp ⇒ Ký số [test: apps/hub-api/src/modules/processes/library/flow-templates.def.test.ts]

#### Yêu cầu: Xem và sao chép flow Thư viện theo sự kiện
Flow Thư viện có "Bắt đầu khi" mở ra canvas chỉ đọc (có node Bắt đầu khi); công ty sao chép được thành bản riêng (chép trigger/app/các bước, giữ nguồn và phiên bản, chưa xuất bản). Lưu bị chặn luôn báo lý do và bước cần sửa.
- Kịch bản: tenant_admin sao chép flow trigger đã gán ⇒ bản công ty có trigger, chưa xuất bản [test: apps/hub-api/src/modules/processes/library/clone-flow-for-company.int.test.ts]
- Kịch bản: def có trigger ⇒ dựng canvas chỉ đọc [test: apps/admin-web/src/features/processes/lib/library-flow.test.ts]

#### Yêu cầu: Flow Thư viện có node Duyệt theo mã Group không cần id
Flow Thư viện (không thuộc công ty, có sự kiện kích hoạt) chấp nhận mã Group (`group_key`) ở node Duyệt khi lưu, bật và xuất bản; không đòi `group_id`. Khi gán cho công ty và mở lượt, mã được đổi sang id Group của công ty đó và task duyệt giao đúng nhóm.
- Kịch bản: khi platform_admin tạo flow Thư viện có node Duyệt theo `group_key`, bật, xuất bản rồi gán công ty có Group mã đó thì lưu/xuất bản thành công và Group duyệt khi mở lượt là id Group của công ty [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P6 · flow Thư viện có node Duyệt theo group_key: tạo + bật + xuất bản + gán công ty ⇒ Group duyệt = id của công ty]

#### Yêu cầu: Def của công ty vẫn chỉ trỏ Group bằng id
Lưu def công ty nhận mã nhóm hợp lệ của chính công ty và tự đổi sang id (phòng client cũ); mã không có nhóm ở công ty ⇒ 422 `GROUPS_MISSING` nêu mã.
- Kịch bản: khi lưu def công ty có mã nhóm không tồn tại thì 422 `GROUPS_MISSING` "Nhóm <mã> chưa có ở công ty — chọn nhóm khác." [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P6/P15 · def của công ty: group_key lạ]
- Kịch bản: khi PUT bản sao với mã nhóm hợp lệ của công ty thì lưu thành id [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P15 · sao chép flow Thư viện có Duyệt theo key]

#### Yêu cầu: Sao chép flow Thư viện về công ty đổi người duyệt theo mã sang id
"Sao chép để sửa" đổi mọi mã nhóm của flow Thư viện sang id nhóm của công ty và bỏ mã trong bản sao, nên bản sao sửa và lưu được. Mã chưa có nhóm ở công ty ⇒ ô nhóm để trống, vẫn sao chép được, dòng flow báo "Nhóm <mã> chưa có ở công ty — chọn nhóm khác".
- Kịch bản: khi sao chép flow Thư viện có bước Duyệt theo mã thì bản sao có `group_id` và không còn `group_key`, rồi đổi người duyệt (PUT) trả 200 [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P15 · sao chép flow Thư viện có Duyệt theo key]
- Kịch bản: khi mã nhóm chưa có ở công ty thì vẫn sao chép được, có cảnh báo `group_missing` và chọn nhóm khác lưu được [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P15 · mã nhóm chưa có ở công ty]
- Kịch bản: khi công ty thiếu nhóm theo mã thì sao chép trả 201 kèm mã thiếu [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » sao chép để sửa]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Nhân bản rồi gán (nguồn: cr125-c2-no-hidden-toggle)
Nhân bản mọi quy trình (kể cả đang dùng) thành nháp mới cùng khe, chưa gán; sửa bản nhân bản không ảnh hưởng tenant nào. Với flow của công ty: "Lưu và áp dụng" hoặc gán quy trình là đủ để công ty dùng quy trình mới (cờ `flow_triggers` được đặt cùng giao dịch), không còn công tắc bật bắt buộc; chỉ còn nút "Tạm dừng quy trình mới" cho quản trị công ty. Quy tắc tương thích: công ty chưa từng áp dụng hoặc được gán quy trình sau thay đổi này giữ nguyên cờ (tắt ở prod) và chạy đúng như trước; hợp đồng đang chạy không bị ảnh hưởng.
- Kịch bản: khi quản trị công ty bấm Lưu và áp dụng thì công ty dùng quy trình mới ngay, không cần bật công tắc nào khác [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » Lưu và áp dụng ⇒ cờ BẬT cùng giao dịch + audit ghi flow_triggers, không cần bật công tắc riêng]
- Kịch bản: khi công ty có sẵn dòng gán nhưng chưa áp dụng thì vẫn chạy cách cũ như hôm nay [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » công ty có sẵn dòng gán nhưng chưa áp dụng ⇒ cờ TẮT (như trước), sao chép để sửa cũng không bật]
- Kịch bản: khi tạm dừng rồi áp dụng lại thì dừng rồi dùng lại [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » tạm dừng (cứu hộ) ⇒ TẮT, áp dụng lại ⇒ BẬT lại]
- Kịch bản: khi platform gán quy trình cho công ty thì công ty dùng ngay và công ty khác không đổi [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » platform gán quy trình cho công ty mới ⇒ BẬT, công ty không đụng tới ⇒ vẫn TẮT]
- Kịch bản: khi xem khối quy trình mới thì chỉ có nút Tạm dừng lúc đang dùng, lúc chưa dùng chỉ có lời chỉ dẫn [test: apps/admin-web/src/features/tenants/flows/lib/flow-switch-access.test.ts » đang dùng ⇒ on (chỉ có nút Tạm dừng), có quy trình nhưng chưa dùng/đã tạm dừng ⇒ idle (chỉ lời chỉ dẫn), chưa có quy trình ⇒ none]

#### Yêu cầu: Số bước trong lỗi xuất bản đếm từ 1 ở cả hub và web (nguồn: cr125-fix-errors)
`step` là số thứ tự từ 1; web trỏ đúng bước bị lỗi. `SLOT_LOCKED` có câu hướng dẫn riêng.
- Kịch bản: khi lỗi ở `steps.2` thì hub trả step 3 và web nhảy tới chỉ số 2 [test: apps/hub-api/src/modules/processes/library/library-publish.messages.test.ts » hợp đồng bước TỪ 1]
- Kịch bản: khi web nhận step 3 thì chỉ số bước là 2 [test: apps/admin-web/src/features/processes/lib/publish-issues.test.ts » hợp đồng bước TỪ 1]

#### Yêu cầu: Lỗi kiểm quy trình khi xuất bản / gán trả mã và biến, web dịch (nguồn: cr125-g1-error-codes)
Hub trả mỗi vi phạm dạng `{path, rule, step, field, code, params}` (không có câu chữ); admin-web dịch bằng đúng một khoá i18n cho mỗi mã
(`process.admin.library.form.err.<MÃ>`) với biến Hub trả, kèm "Bước N" khi có bước; mã lạ hiện câu chung kèm mã. Mã chưa có câu (`FLOW_NONE_ASSIGNED`) cũng có câu nói cách khắc phục.
- Kịch bản: khi xuất bản quy trình có điều kiện dùng thông tin chưa khai báo thì Hub trả 422 với `code`=`COND_FIELD_UNDECLARED`, `params.param` và không có `message` [test: apps/hub-api/src/modules/processes/library/library-validate.int.test.ts » PROCESS_PUBLISH_INVALID]
- Kịch bản: khi gán quy trình cho công ty thiếu mã phòng ban thì Hub trả `GROUP_MISSING_IN_TENANT` với `params.key` và `params.tenant` [test: apps/hub-api/src/modules/processes/library/library-publish.messages.test.ts » missingGroupIssues]
- Kịch bản: khi Hub trả `DUE_RANGE` kèm `min`,`max` thì admin hiện câu của khoá mã đó kèm "Bước N" [test: apps/admin-web/src/features/processes/lib/publish-issues.test.ts » parsePublishIssues]

