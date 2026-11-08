# Admin · trang cấu hình app `/apps/<key>` (ADM-FR-84/85)

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-app-config, cr118-flow-canvas). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Trang cấu hình app theo 5 tab (ADM-FR-84) (nguồn: cr118-app-config)
Quản trị nền tảng mở một app ở `/apps/<key>` và thấy 5 phần Tổng quan, Tính năng, Quy trình, Công ty, Xem trước; sửa theo công ty và theo app dùng cùng một thẻ app, cùng khối gán quy trình trong thẻ và cùng một lần lưu. Công ty đang sửa dở không bị bỏ khi chuyển tab.
- Kịch bản: khi mở `?tab=` lạ thì trang rơi về Tổng quan và thứ tự 5 tab đúng wireframe [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » 5 tab theo thứ tự wireframe, giá trị lạ ⇒ undefined]
- Kịch bản: khi một công ty có các feature mức đọc, ghi, quản trị và tính năng thêm thì bảng Công ty hiện đúng mức cao nhất, số tính năng thêm và số người [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » mức = mức cao nhất, tính năng thêm chỉ tính khi app bật, người = max entitlement]
- Kịch bản: khi đang sửa dở một công ty thì không chuyển sang công ty khác, và bản nháp chỉ chọn được khi có nháp thật [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » đang sửa dở ⇒ không chuyển sang công ty khác, sạch ⇒ chuyển tự do]
- Kịch bản: khi app thiếu địa chỉ hoặc công ty được gán quy trình riêng nhưng chưa bật tính năng của khe thì Tổng quan cảnh báo [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » công ty được gán quy trình riêng nhưng chưa bật tính năng thêm của khe]
- Kịch bản: khi platform_admin chọn công ty ở tab Công ty, đặt mức Sửa, xem trước bản nháp rồi lưu thì bảng và trang công ty phản ánh mức Sửa [test: e2e/app-config.spec.ts » CR-118 · F1 · /apps → Sổ Hợp Tác: 5 tab, tab Công ty → acme → mức Sửa → Xem trước bản nháp (quản trị công ty thấy 'Tạo và sửa hợp đồng') → quay lại Lưu ⇒ bảng phản ánh]
- Kịch bản: khi chưa có Hub thì tab Quy trình nêu rõ chưa cấu hình và Tổng quan vẫn đếm công ty theo mức [test: e2e/app-config.spec.ts]
- Kịch bản: khi tenant_admin xem thẻ app ở công ty mình thì chỉ đọc, không có nút Lưu hay liên kết cấu hình, và không vào được trang cấu hình app [test: e2e/app-config.spec.ts » CR-118 · F4 · tenant_admin (binh) xem thẻ app chỉ-đọc ở trang công ty mình: không có nút Lưu/liên kết cấu hình, /apps/contracts báo chỉ dành cho quản trị nền tảng]

#### Yêu cầu: Xem trước công ty thấy gì theo vai (ADM-FR-85) (nguồn: cr118-app-config)
Hàm thuần `previewApp` ghép manifest dữ liệu của app, feature của công ty (bản đang lưu hoặc bản nháp chưa lưu), vai của công ty và quy trình đang gán để cho biết, với Quản trị công ty, Thành viên và Đối tác, menu nào hiện, mục nào ẩn kèm lý do, hành động nào làm được và khe quy trình nào đang chạy quy trình nào. Đối tác không bao giờ thấy nhóm Sổ Hợp Tác hay quy trình của công ty.
- Kịch bản: khi công ty có app mức Xem thì thành viên thấy Bảng tin, Bài của tôi, không thấy Duyệt bài và không có hành động đăng bài [test: packages/contracts/src/app-manifest/preview.test.ts » mức Xem: thành viên thấy Bảng tin + Bài của tôi, không thấy Duyệt bài, không có hành động Đăng bài]
- Kịch bản: khi app Tắt thì không vai nào thấy nhóm app [test: packages/contracts/src/app-manifest/preview.test.ts » app Tắt: không vai nào thấy nhóm app, lý do app_off]
- Kịch bản: khi công ty bật Sổ Hợp Tác ở mức Quản trị thì đối tác vẫn không thấy nhóm Sổ Hợp Tác và khe quy trình [test: packages/contracts/src/app-manifest/preview.test.ts » đối tác không bao giờ thấy nhóm Sổ Hợp Tác (dù công ty bật Quản trị)]
- Kịch bản: khi thiếu tính năng thêm thì hành động duyệt theo quy trình ẩn kèm tên dễ hiểu của tính năng và khe không chạy [test: packages/contracts/src/app-manifest/preview.test.ts]
- Kịch bản: khi bản nháp bật thêm tính năng thì khe chạy quy trình đang gán còn bản lưu thì chưa [test: packages/contracts/src/app-manifest/preview.test.ts]
- Kịch bản: khi công ty đã có vai nhưng không vai nào đủ mức thì thành viên bị ẩn hành động ghi còn quản trị công ty thì không [test: packages/contracts/src/app-manifest/preview.test.ts » thành viên: công ty đã có vai nhưng không vai nào đủ mức Sửa ⇒ ẩn mục Cài đặt/hành động ghi (no_role)]
- Kịch bản: khi xem trước acme ở vai đối tác thì không có mục nào hiện, vai thành viên hiện mục theo mức và nêu lý do ẩn [test: e2e/app-config.spec.ts]

#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84) (nguồn: cr118-app-config)
Ở tab Ứng dụng & Gói của công ty, các khe quy trình của một app hiện ngay trong thẻ app đó (không còn khối riêng cuối tab); app không có khe thì thẻ không hiện khối này.
- Kịch bản: khi lọc khe theo app thì chỉ giữ khe có tiền tố của app đó [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » lọc khe theo tiền tố app]

#### Yêu cầu: Sơ đồ và bảng bước chỉ đọc trong tab Quy trình (ADM-FR-84) (nguồn: cr118-app-config)
Thẻ khe hiện sơ đồ Bắt đầu → các bước → Ghi Đã duyệt (nút hệ thống khoá) và bảng bước (tên, người làm, hạn và nhắc, điều kiện) của quy trình mặc định, chỉ đọc; nút "Xem sơ đồ" vẫn mở trình soạn. Khe có dạng thân lạ thì mời mở trình soạn.
- Kịch bản: khi quy trình mặc định có bước duyệt, ký số và tự động thì bảng nêu đúng người làm, hạn, nhắc và điều kiện bằng lời [test: apps/admin-web/src/features/apps/lib/flow-view.test.ts » dạng bọc {steps}: dòng bước đủ người làm, hạn/nhắc và điều kiện bằng lời]
- Kịch bản: khi thân quy trình có dạng lạ thì không vẽ và mời mở trình soạn [test: apps/admin-web/src/features/apps/lib/flow-view.test.ts » mảng trần cũng đọc được, dạng lạ hoặc loại bước lạ ⇒ null (UI mời mở trình soạn)]

#### Yêu cầu: Danh sách quy trình lọc theo app (ADM-FR-84) (nguồn: cr118-app-config)
Từ thẻ khe có link tới `/processes?app=<key>`: thư viện chỉ hiện quy trình của khe thuộc app đó, có dòng nói rõ đang lọc, link về trang app và nút bỏ lọc.
- Kịch bản: khi lọc theo app thì chỉ giữ khe có tiền tố của app đó [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » lọc khe theo tiền tố app]

#### Yêu cầu: Tab Quy trình của app dùng cùng gói sơ đồ chung (ADM-FR-84) (nguồn: cr118-flow-canvas)
Thẻ khe ở `/apps/<key>` › Quy trình hiện sơ đồ chỉ xem do cùng `@ai/flow-canvas` vẽ (Bắt đầu → bước → Ghi Đã duyệt, khoá), nạp lười; bảng bước giữ bên dưới.
- Kịch bản: khi khe có bước duyệt và bước ký thì sơ đồ xếp dọc kèm huy hiệu loại bước và điều kiện [test: packages/flow-canvas/src/layout/vertical.test.ts » dòng bước đã gắn nhãn điều kiện (host tự ghép chữ) vẫn dựng đúng nhánh bỏ qua]
- Kịch bản: khi bước có hạn và nhắc thì node hiện một dòng thông tin thời hạn [test: packages/flow-canvas/src/layout/vertical.test.ts » chiều cao node theo số dòng thông tin (chuyển cấp / cảnh báo thiếu nhóm)]


## Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (lát: cr120-slot-contract, cr121-c11-company-flows, cr121-c12-company-apps, cr121-c13-remove-old-assign).

#### Yêu cầu: App phải khai báo khe quy trình (nguồn: cr120-slot-contract)
Manifest mỗi app khai báo ít nhất một khe quy trình và ít nhất một khe luôn bật; mỗi khe có mục đích, quy trình mặc định, loại bước được phép và sự kiện mở lượt. Kiểm tĩnh chặn commit/CI khi sai.
- Kịch bản: khi app không có khe hoặc chỉ có khe cần tính năng thêm thì `check:app-slots` đỏ [test: packages/contracts/src/app-manifest/slots.rules.test.ts » app 0 khe ⇒ đỏ no_slots; packages/contracts/src/app-manifest/slots.rules.test.ts » chỉ có khe cần add-on hoặc không bắt buộc ⇒ đỏ no_always_on_slot]
- Kịch bản: khi khe có loại bước rỗng/lạ, key quy trình mặc định sai dạng, mục đích/sự kiện rỗng hoặc quá dài, key khe sai dạng/trùng thì đỏ [test: packages/contracts/src/app-manifest/slots.rules.test.ts » allowedKinds rỗng/lạ, defaultDefKey sai dạng, purpose/trigger rỗng hoặc quá dài ⇒ đỏ; packages/contracts/src/app-manifest/slots.rules.test.ts » key khe sai dạng, khác tiền tố app, trùng trên toàn tập ⇒ đỏ]
- Kịch bản: Sổ Hợp Tác có khe Tiếp nhận hợp đồng luôn bật + khe Duyệt hợp đồng theo tính năng thêm; Community có 3 khe (duyệt bài, đối tác xin tham gia, báo cáo vi phạm) [test: packages/contracts/src/app-manifest/slots.rules.test.ts » manifest thật (contracts, community) hợp lệ: mỗi app ≥ 1 khe luôn bật]
- Kịch bản: khi hub khởi động mà khe manifest thiếu đăng ký khe hoặc (runtime bật) thiếu adapter thì ghi log lỗi, không chặn khởi động [test: apps/hub-api/src/modules/packs/kit/domain/slot-contract.rules.test.ts » khe manifest thiếu SlotSpec ⇒ gap spec, runtime bật mà thiếu adapter ⇒ gap adapter]
#### Yêu cầu: Tab Quy trình của app hiện mọi khe khai báo (nguồn: cr120-slot-contract)
Trang app ở admin liệt kê mọi khe theo manifest kèm mục đích, sự kiện mở lượt và luôn bật / cần tính năng thêm; khe chưa có trên hub hiện cảnh báo thiếu quy trình mặc định.
- Kịch bản: khi manifest có khe mà hub chưa có thì vẫn hiện thẻ khe với cảnh báo; khe hub ngoài manifest hiện sau [test: apps/admin-web/src/features/apps/lib/slot-rows.test.ts » mọi khe manifest có hàng (thiếu hub ⇒ view null), khe hub ngoài manifest đứng sau]

#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84) (nguồn: cr118-app-config; cr121-c11-company-flows)
Thẻ app ở tab Ứng dụng của công ty không còn khối gán quy trình; gán quy trình cho công ty chỉ làm ở tab Quy trình (một nơi duy nhất). Chỗ gán ở tab Quy trình và ngăn Công ty của trang app gỡ ở c13.
- Kịch bản: khi mở thẻ app ở tab Ứng dụng thì không còn khối gán quy trình, việc gán nằm ở tab Quy trình của công ty [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]

#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84) (nguồn: cr118-app-config; cr121-c12-company-apps)
Tab Ứng dụng của công ty là bảng mỗi hàng một ứng dụng (Quyền truy cập, Trạng thái kèm lý do, Thành viên, Quy trình "x bật · y tắt"); không còn thẻ app và khối gán quy trình. Dải "Cần xử lý" mở ngăn Gán ở tab Quy trình; nhãn mức không tràn khi thu gọn (cắt + tooltip) và có ⓘ giải nghĩa.
- Kịch bản: nhãn mức cắt chữ và có tooltip đầy đủ, ⓘ nêu Xem = chỉ đọc · Sửa = tạo và sửa · Quản trị = thêm cài đặt app và người dùng [test: apps/admin-web/src/features/tenants/apps/components/LevelControl.test.tsx » mỗi mức cắt chữ (truncate) và có tooltip đầy đủ (title), không tràn khi thu gọn]
- Kịch bản: cột Quy trình ghi "x bật · y tắt" theo app [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » flowCounts]
- Kịch bản: Community chưa gán Duyệt bài ⇒ dải Cần xử lý 1 dòng, app tắt thì ẩn, gán xong thì hết [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » attentionOf (dải Cần xử lý, Q5)]
- Kịch bản: trạng thái hàng kèm lý do (luôn bật, đang tắt, quyền không chuẩn, việc chưa bật) [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » rowStatus]
- Kịch bản: bảng ứng dụng đổi mức và lưu một lượt như trước [test: e2e/feature-ui.spec.ts » CR-112 · tab Ứng dụng & Gói của acme]

#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84) (nguồn: cr118-app-config; cr121-c13-remove-old-assign)
Trang app (`/apps/<key>`) chỉ còn thông tin app (Tổng quan, Tính năng, Xem trước) và link sang Công ty › Quy trình của từng công ty; không còn tab Quy trình gán hay ngăn Công ty. `/processes` chỉ còn là Thư viện; tenant_admin và `?tenant=<id>` được chuyển tới Công ty › Quy trình.
- Kịch bản: URL cũ của tab gán ở trang app mở Tổng quan kèm thông báo gán ở trang Công ty [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » tab]
- Kịch bản: `/processes?tenant=<id>` và tenant_admin chuyển tới tab Quy trình của công ty [test: apps/admin-web/src/features/tenants/lib/legacy-redirect.test.ts » CR-121 c13 · /processes?tenant= chuyển tới Công ty › Quy trình]
