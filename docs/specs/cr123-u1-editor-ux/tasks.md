---
id: cr123-u1-editor-ux
lát: cr123-u1-editor-ux
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: p22 (đã gộp)
---
## Plan (ngắn)
Trình soạn quy trình + Công ty › Quy trình đọc bằng chữ nghiệp vụ cho giám đốc/sale (CR-123 FLOW3-FR-09, 10, 12, 13; ux-audit A+B).

## Làm
- FR-09: công tắc "Dùng quy trình mới" cho quản trị nền tảng + quản trị công ty mình (hub-api `FlowSettingsService` kiểm công ty; web `canSeeFlowSwitch`).
- FR-10: bản của công ty (flow có `tenant_id`, kể cả platform mở qua `?company=`) chỉ "Lưu và áp dụng" + một dòng phạm vi; "Xuất bản" chỉ ở mẫu Thư viện (`isCompanyFlow/isCompanyOwned/saveModeOf`).
- FR-12: menu "+" chỉ Duyệt · Nếu · Ký số · Chờ ký xong · Thông báo · Kết thúc; "Nâng cao" chỉ quản trị nền tảng (`lib/node-menu.splitMenu`); bỏ nhóm "Lõi"/"Cơ bản".
- FR-13: Nếu đọc thành câu (`lib/if-sentence`); Duyệt = "Ai duyệt" + "Hạn trả lời" (còn lại Nâng cao); Chờ ký xong chọn từ danh sách; Ký số "Ký bằng: …" + liên kết Cài đặt › Ký số; Kết thúc nói ảnh hưởng; node Công cụ ẩn dưới Nâng cao; thống nhất từ ở `admin.*.json`.

## Không làm / Chạm
- Không chạm `packages/flow-canvas`, kéo/nối ProcessCanvas (p25), `apps/workspace-web` (u2), DLC, engine.
- Bỏ qua (ghi lại): ux-audit #7, #8 (câu lỗi gán/xoá theo mã lỗi riêng ở tenants/api, chỉ đổi 3 mã chính), #14 (nội dung mẫu thông báo), #19 (tự nối cầu dữ liệu — cần engine), #29 (chặn lưu khi không người nhận — hợp đồng contract), #20/#21 chỉ đổi chữ.

## Test tối thiểu
- unit: `node-menu.test.ts`, `if-sentence.test.ts`, `company-copy.test.ts`, `flow-switch-access.test.ts`; int: `flow-settings.int.test.ts`.
- e2e sửa chữ/selector: cr122-editor (menu), cr121-editor, cr121-d6b-notify, editor.fnr, P-d admin-stage/real-step, canvas.pb2.

## Quyết định trong lúc làm
- "Hạn trả lời" của Duyệt dùng trường `remind` (nhắc sau N giờ) — đúng một ô, không thêm trường mới.
- "Chờ ký xong" thêm vào bảng node (`waitEsign`, chỉ app Hợp đồng) với sự kiện mặc định `esign.completed`, hạn 168 giờ.
- Liên kết "Đổi ở Cài đặt › Ký số" mở app Hợp đồng ở `/settings` bằng SSO một lần (tab mới).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
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

## Việc còn lại
- Chạy e2e cr122-editor / cr121-editor / editor.fnr / P-d một lần ở cuối đợt (chưa chạy trong lát).
- Ảnh trước/sau: xem `docs/specs/CR-123/shots/`.
