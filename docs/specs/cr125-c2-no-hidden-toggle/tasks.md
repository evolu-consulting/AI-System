---
id: cr125-c2-no-hidden-toggle
lát: cr125-c2-no-hidden-toggle
cr: CR-125
làn: đầy đủ
migration: không
phụ thuộc:
---
## Plan (ngắn)
consistency-audit #2 (Cao): gán/áp dụng quy trình xong vẫn phải bật công tắc "Dùng quy trình mới cho công ty này" (`flow_triggers`) ở cùng tab — thao tác ẩn bắt buộc, và cờ + `company_flows` là hai nguồn cho "công ty đang dùng quy trình nào".

## Làm
- Hub: `ensureFlowTriggersOn` (idempotent) gọi trong CÙNG giao dịch của `CompanyFlowsService.apply` (và `publish` cũ) và `assign` ⇒ áp dụng/gán là đủ. Audit `company_flow.apply` ghi thêm `flow_triggers: true`.
- Cờ `tenant_flow_settings.flow_triggers` vẫn là MỘT nguồn mà mọi chỗ đọc hiện có dùng (dispatcher, thẻ duyệt, community, receive…) — chỉ đổi cách GHI: do áp dụng/gán đặt, không còn bước tay. Không đổi chỗ đọc, không migration.
- admin-web: `FlowSwitch` bỏ công tắc bật; còn nút cứu hộ "Tạm dừng quy trình mới" (quản trị công ty, có hỏi xác nhận) khi đang dùng; chưa dùng ⇒ lời chỉ dẫn "mở một quy trình rồi bấm Lưu và áp dụng". Sau áp dụng/gán làm tươi trạng thái.

- Cả hai đường đều đủ, không bước ẩn (QC community B5): platform GÁN (`assign`) và quản trị công ty LƯU VÀ ÁP DỤNG (`apply`) cùng đặt cờ trong giao dịch; mọi thao tác trên danh sách (`useCompanyFlowOp`) và Lưu và áp dụng làm tươi `flow-settings` từ CÙNG nguồn ⇒ khối của platform không còn chữ cũ "Chưa có quy trình" và không còn công tắc bị khoá.
- e2e hành trình không bật cờ sẵn (`enableFlowTriggers(…, false)`): G1.1 gán ⇒ "Đang dùng quy trình mới", G2 áp dụng ⇒ chạy tiếp hành trình thật.

## Không làm / Chạm
- API `PUT /tenants/:tid/flow-settings` giữ nguyên (tương thích; chặn bật khi chưa có quy trình như FR-09) — UI chỉ dùng để tạm dừng.
- Không đụng canvas/esign/partner.

## Test tối thiểu
unit `flow-switch-access.test.ts`; int `company-flows-active.int.test.ts` (áp dụng/gán ⇒ cờ bật cùng giao dịch, chưa áp dụng ⇒ tắt, tạm dừng ⇒ tắt, áp dụng lại ⇒ bật); journey e2e một lần + ảnh Công ty › Quy trình.

## Quyết định trong lúc làm
- Tương thích prod (FLOW_TRIGGERS tắt ở mọi công ty, có 6 dòng `company_flows` bật do platform gán sẵn): công ty CHƯA từng áp dụng/gán sau thay đổi này giữ nguyên cờ TẮT ⇒ chạy đúng như hôm nay; KHÔNG suy cờ từ "có dòng company_flows bật" (sẽ đổi hành vi prod). Cờ chỉ bật khi quản trị bấm Lưu và áp dụng hoặc platform gán.
- Lượt đang chạy an toàn: cờ chỉ quyết sự kiện MỚI (hợp đồng gửi từ lúc đó); lượt đã mở giữ def của nó. Tạm dừng cũng chỉ ảnh hưởng hợp đồng gửi sau đó.
- Gán lại quy trình khi công ty đang tạm dừng sẽ BẬT lại (hành động có chủ ý của platform/quản trị).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Nhân bản rồi gán
Nhân bản mọi quy trình (kể cả đang dùng) thành nháp mới cùng khe, chưa gán; sửa bản nhân bản không ảnh hưởng tenant nào. Với flow của công ty: "Lưu và áp dụng" hoặc gán quy trình là đủ để công ty dùng quy trình mới (cờ `flow_triggers` được đặt cùng giao dịch), không còn công tắc bật bắt buộc; chỉ còn nút "Tạm dừng quy trình mới" cho quản trị công ty. Quy tắc tương thích: công ty chưa từng áp dụng hoặc được gán quy trình sau thay đổi này giữ nguyên cờ (tắt ở prod) và chạy đúng như trước; hợp đồng đang chạy không bị ảnh hưởng.
- Kịch bản: khi quản trị công ty bấm Lưu và áp dụng thì công ty dùng quy trình mới ngay, không cần bật công tắc nào khác [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » Lưu và áp dụng ⇒ cờ BẬT cùng giao dịch + audit ghi flow_triggers, không cần bật công tắc riêng]
- Kịch bản: khi công ty có sẵn dòng gán nhưng chưa áp dụng thì vẫn chạy cách cũ như hôm nay [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » công ty có sẵn dòng gán nhưng chưa áp dụng ⇒ cờ TẮT (như trước), sao chép để sửa cũng không bật]
- Kịch bản: khi tạm dừng rồi áp dụng lại thì dừng rồi dùng lại [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » tạm dừng (cứu hộ) ⇒ TẮT, áp dụng lại ⇒ BẬT lại]
- Kịch bản: khi platform gán quy trình cho công ty thì công ty dùng ngay và công ty khác không đổi [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » platform gán quy trình cho công ty mới ⇒ BẬT, công ty không đụng tới ⇒ vẫn TẮT]
- Kịch bản: khi xem khối quy trình mới thì chỉ có nút Tạm dừng lúc đang dùng, lúc chưa dùng chỉ có lời chỉ dẫn [test: apps/admin-web/src/features/tenants/flows/lib/flow-switch-access.test.ts » đang dùng ⇒ on (chỉ có nút Tạm dừng), có quy trình nhưng chưa dùng/đã tạm dừng ⇒ idle (chỉ lời chỉ dẫn), chưa có quy trình ⇒ none]

## Việc còn lại
ops-watch: cảnh báo công ty có `company_flows` bật mà cờ tắt (cấu hình nửa vời, audit mục 9) — lát riêng.