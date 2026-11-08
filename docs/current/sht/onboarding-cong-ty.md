# onboarding cong ty

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Quản trị công ty đầu tiên dùng được mọi app đã bật ngay sau onboarding (nguồn: cr125-ux-s1-onboard)
Khi platform bật một app cho công ty (bước Ứng dụng của wizard), mọi quản trị công ty nội bộ của công ty đó tự vào vai Chủ gói của app; người dùng thường không được thêm. Bỏ qua bước Phân quyền không làm quản trị mất quyền.
- Kịch bản: khi platform bật app `pkdemo` cho công ty có quản trị `admin-a` và người dùng `lan` thì `admin-a` ở nhóm Chủ gói với đủ 3 mã gói còn `lan` không có vai nào [test: apps/admin-api/src/modules/packs/packs.first-admin.int.test.ts » C1 · bật app bằng đường wizard]
- Kịch bản: khi công ty B bật app thì quản trị công ty A không bị đổi [test: apps/admin-api/src/modules/packs/packs.first-admin.int.test.ts » C1 · công ty B bật app]
- Kịch bản: khi platform lập công ty mới, bật Sổ Hợp Tác, bỏ qua bước Phân quyền thì quản trị công ty vào Sổ Hợp Tác thấy danh sách hợp đồng, không gặp "chưa có quyền dùng gói Hợp đồng" [test: e2e/journey-approval/cr125-s1-onboard.spec.ts » platform admin lập công ty]

#### Yêu cầu: Bước Xem lại liệt kê việc còn thiếu kèm nút Sửa (nguồn: cr125-ux-s1-onboard)
Bước Xem lại của wizard hiện danh sách: chưa bật app nào; app chưa ai có vai; chưa có người dùng ngoài quản trị công ty; việc quy trình đang tắt của app đang dùng. Mỗi mục có liên kết "Sửa" tới đúng bước/tab. Không còn mục thì hiện "Công ty dùng được ngay".
- Kịch bản: khi chưa bật app thì chỉ có mục "chưa bật ứng dụng"; khi app đã bật mà chưa ai có vai thì có mục theo app đó; đủ trọn thì danh sách rỗng [test: apps/admin-web/src/features/tenants/lib/review-checklist.test.ts » reviewChecklist]
- Kịch bản: khi quản trị vừa lập công ty và bỏ qua phân quyền thì Xem lại báo chưa có người dùng khác nhưng không báo "chưa ai có vai" [test: e2e/journey-approval/cr125-s1-onboard.spec.ts » platform admin lập công ty]

#### Yêu cầu: Gán quy trình ngay trong wizard (nguồn: cr125-ux-s1-onboard)
Trong wizard, nút "Gán" ở dải "Cần xử lý" mở hộp chọn quy trình Thư viện (kèm kiểm dùng được ở công ty chưa) và gán xong ở lại bước, không thoát sang tab Quy trình.
- Kịch bản: khi bấm "Gán" trong wizard thì hộp "Gán quy trình cho công ty" mở tại bước [test: thủ công — UI hộp thoại tái dùng AssignFlow đã có e2e ở cr122-flows]

