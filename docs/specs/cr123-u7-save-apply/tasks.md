---
id: cr123-u7-save-apply
lát: cr123-u7-save-apply
cr: CR-123
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Blocker CEO/sale (ux-review-ceo.md hàng 1): "Lưu và áp dụng" của flow công ty chỉ lưu def; bản công ty vẫn "Tắt · chưa xuất bản", gốc vẫn "Đang dùng", phải bấm Xuất bản + Bật rồi gặp "không bật cùng lúc".
Sửa: editor lưu def (API cũ, giữ nguyên kiểm hợp lệ) rồi gọi `POST /tenants/:tid/company-flows/apply {flow_id}` — MỘT tx: bản công ty Bật, gốc Thư viện Tắt (`replaced`, `replaced_by`). Dòng xác nhận ngay trong thanh lưu.

## Làm
- Hub: `CompanyFlowsService.apply` + `#activate` (dùng chung với `publish` cũ), repo `rowIdOfFlow`, route `POST …/company-flows/apply`. Chặn: thiếu nhóm duyệt (422 FLOW_GROUP_MISSING), def không có Bắt đầu khi / của công ty khác (422 FLOW_NOT_ASSIGNABLE), bản có điều kiện thay gốc không điều kiện cuối của sự kiện `required` (409 FLOW_REQUIRED_LAST, không đổi gì).
- admin-web: `useApplyFlow` + `ApplyStatusLine`; `ProcessSaveBar` (Sơ đồ) và `FlowFormEditor` (Form) gọi apply sau khi lưu; Form bật nút khi chưa áp dụng dù không sửa. Danh sách công ty: bỏ nút Xuất bản; bản công ty chỉ còn Tắt khi đang bật (không Bật riêng); nhãn "Tắt · chưa áp dụng".
- i18n vi/en; e2e G2 (cr122-flows) đi qua "Lưu và áp dụng" thật.

## Không làm / Chạm
Không đụng canvas/*, esign, DLC, migration. Route `POST …/:id/publish` giữ (không UI gọi) để khỏi vỡ test cũ.

## Test tối thiểu
unit `company-flow-view.test.ts`; int `company-flows-apply.int.test.ts`; e2e G2 một lần trên server.

## Quyết định trong lúc làm
- "Thay flow đang dùng của cùng sự kiện" = thay đúng bản gốc Thư viện mà bản công ty sao ra (một nguồn `company_flows`); không tự tắt flow khác cùng sự kiện (có thể là flow có điều kiện chạy song song).
- Lưu và áp dụng là 2 request (PUT def → apply); apply là một tx nguyên tử. Lưu xong mà apply lỗi ⇒ thanh lưu nêu lỗi nghiệp vụ + cách sửa, def đã lưu giữ nguyên.
- perf: apply = số câu SQL cố định (≤ 9, không phụ thuộc số flow của công ty).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Nhân bản rồi gán
Nhân bản mọi quy trình (kể cả đang dùng) thành nháp mới cùng khe, chưa gán; sửa bản nhân bản không ảnh hưởng tenant nào. Với flow của công ty (CR-123 FLOW3-FR-10): MỘT nút "Lưu và áp dụng" = lưu + bản công ty thành flow đang dùng của sự kiện, thay bản gốc Thư viện trong một giao dịch; hợp đồng đang chờ giữ bản cũ; không còn Xuất bản/Bật riêng cho bản công ty (chỉ Tắt khi đang bật; Xuất bản chỉ có ở mẫu Thư viện).
- Kịch bản: khi bấm Lưu và áp dụng một bản công ty đã sao thì bản công ty Bật, bản gốc Tắt "đã thay bằng bản công ty" và chỉ một dòng Bật cho sự kiện [test: apps/hub-api/src/modules/processes/library/company-flows-apply.int.test.ts » một lần áp dụng ⇒ bản công ty Bật, gốc Thư viện Tắt (replaced_by) trong cùng phản hồi, áp dụng lại không đổi]
- Kịch bản: khi áp dụng bị chặn giữa chừng (bản có điều kiện thay gốc không điều kiện cuối của sự kiện bắt buộc) thì không dòng nào đổi [test: apps/hub-api/src/modules/processes/library/company-flows-apply.int.test.ts » nguyên tử: bản công ty có điều kiện thay gốc không điều kiện cuối của sự kiện required ⇒ 409 và KHÔNG đổi dòng nào]
- Kịch bản: khi còn bước duyệt chưa chọn nhóm thì áp dụng bị chặn kèm câu sửa [test: apps/hub-api/src/modules/processes/library/company-flows-apply.int.test.ts » còn bước duyệt chưa chọn nhóm ⇒ 422 FLOW_GROUP_MISSING, không đổi gì]
- Kịch bản: khi quản trị công ty khác hoặc member gọi áp dụng, hoặc áp dụng def của công ty khác, thì bị chặn và không lộ [test: apps/hub-api/src/modules/processes/library/company-flows-apply.int.test.ts » cách ly: member 403, quản trị công ty khác 404, def của công ty khác không áp dụng được và không lộ]
- Kịch bản: khi xem danh sách flow công ty thì bản công ty không có nút Xuất bản/Bật riêng [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » hành động theo loại dòng]
- Kịch bản: khi tenant_admin mở bản công ty, bấm Lưu và áp dụng thì thấy "Đã áp dụng — hợp đồng gửi từ giờ dùng quy trình này" và hợp đồng gửi sau chạy bản mới [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

## Việc còn lại
