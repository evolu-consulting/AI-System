---
id: cr118-flow-web
lát: cr118-flow-web
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-flow-contract, cr118-form-node, cr118-flow-admin, cr118-bundle
---
## Plan (ngắn)
Web gộp (`apps/sohoptac-web`) vẽ flow theo khe: `platform/flow` = cổng `FlowRuntime` + adapter HTTP của route kit hub + registry renderer theo
loại bước (đủ mọi `FlowStepKind` ⇒ thiếu = lỗi typecheck; loại lạ ⇒ `GenericStep`; renderer lazy theo loại) + renderer `form` + `<FlowPanel/>`.
Thẻ duyệt HĐ vẽ dòng thời gian QUA `<FlowPanel slot="contracts.approval">` với hành vi/chữ/data-testid y hệt cũ. Danh sách HĐ lấy huy hiệu
"Cần xử lý" từ endpoint tóm tắt (một yêu cầu cho cả trang). Không đổi server, không migration.

## Làm
- [x] `platform/flow/port.ts` (FlowRuntime: view/act/submitForm/summary) + `adapters/http.ts` (`/pack/<k>/flow/...`; 404 ⇒ null; summary nhớ khe tắt).
- [x] `hooks/use-flow.ts` (useFlowView, useFlowSummary chia lô ≤ 100, useFlowSubmitForm) · `lib/form-values.ts` (nháp ⇒ giá trị + lỗi từng trường, dùng `flowFormValuesSchema` của contract).
- [x] `ui/`: registry (`RENDERERS: StepRenderers`), `StepRow` (mặc định + Generic), `FormStep`, `Legacy`, `FlowPanel` (+ `FlowPanelBody` thuần cho test).
- [x] Thẻ duyệt: `lib/flow-view.ts` (thẻ ⇒ FlowView, FlowView ⇒ dòng thời gian), `components/ApprovalSteps.tsx` (override review/dify/esign = Row/EsignStepRow cũ), `ApprovalTimeline` qua FlowPanel.
- [x] Danh sách HĐ: `hooks/use-row-flow.ts` + `AttentionTag` ở cột Giai đoạn (chỉ khi `attention`).
- [x] i18n `contracts.flowPanel.*` (vi/en, trong `esignflow.*.json` gộp sâu).

## Không làm / Chạm
- Không sửa server/contract/engine; không đụng `shell/`, `routes/community*`, `modules/community`, `platform/features` (lát cr118-shell).
- Nút Duyệt/Trả lại/Từ chối của thẻ duyệt vẫn do `useApprovalUi` (cần lưu ô trước, hộp gắn sản phẩm) — chưa đi qua `FlowRuntime.act`.
- `FlowDefinitionReader` (đọc định nghĩa) chưa làm: chưa có endpoint đọc phía hub.

## Test tối thiểu
- unit: registry đủ loại / loại lạ ⇒ Generic · renderer form (ô theo loại, nhãn TEXT, chỉ hiện khi có task mở) · trạng thái FlowPanel · adapter HTTP · giới hạn form phía client = contract · thẻ ⇒ FlowView ⇒ dòng thời gian trùng `timelineRows` cũ.
- e2e contracts-web chạy MỘT lần trên evotest (`-Filter contracts-web -All`); e2e bước form: xem "Quyết định".

## Quyết định trong lúc làm
- Thẻ duyệt lấy FlowView từ dữ liệu thẻ ĐÃ TẢI (phép chiếu ở web, phản chiếu `approval-flow-view.rules.ts` của hub) thay vì gọi `GET /pack/contracts/flow/...`: route kit nằm sau cờ `HUB_FLOW_RUNTIME` (mặc định TẮT) và FlowView không mang `finalizes_on_approve`/`needs_reopen`/idx bước; gọi thêm sẽ nhân đôi yêu cầu và đổi hành vi. `<FlowPanel view=…>` (controlled) không gọi mạng.
- Lượt `machine` ⇒ `LegacyMachineRenderer` = một `<span hidden>` đánh dấu, KHÔNG dòng bước (như `ApprovalTimeline` cũ trả null); thẻ cũ (nút/ghi chú) vẫn do khe vẽ.
- Danh sách: cờ tắt ⇒ summary 404 ⇒ adapter trả null và nhớ khe (1 yêu cầu 404 mỗi phiên trang), không huy hiệu, không đổi DOM.
- `file_ref` hiện là ô nhập id tệp (uuid) — chưa có upload FileBox trong web gộp.
- Trần lô summary chép số 100 ở web (`SUMMARY_BATCH`, test khớp `FLOW_REF_MAX_BATCH`) để không kéo schema zod của flow vào chunk đầu (JS đầu 161,5 → 161,8 KB, trần 162).
- e2e bước form: không dựng được fixture rẻ (cần quy trình engine có node `form` + cờ `HUB_FLOW_RUNTIME` bật cho hub của e2e) ⇒ chỉ unit + ghi chú.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-04 (đợt cr118-r1)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt HĐ vẽ dòng thời gian qua FlowPanel, hành vi không đổi
Web gộp vẽ dòng thời gian các bước duyệt của HĐ bằng `<FlowPanel slot="contracts.approval">` (nguồn = thẻ duyệt đã tải, không thêm yêu cầu mạng);
chữ, khung, `data-testid`/`data-status`, nhãn quá hạn/chuyển cấp/bỏ qua, dòng Ký số và nút "Gửi lại" y hệt trước. Lượt máy trạng thái cũ
(`mode=machine`) đi qua renderer legacy (không dòng bước). Nút Duyệt/Trả lại/Từ chối và hộp lý do vẫn do thẻ duyệt lo.
- Kịch bản: khi thẻ duyệt engine có bước (kể cả quá hạn tự tính, bỏ qua, chuyển cấp, Dify) thì dòng thời gian dựng từ FlowView trùng dòng thời gian cũ [test: apps/sohoptac-web/src/features/contract-approval/lib/flow-view.test.ts » dòng thời gian từ FlowView trùng timelineRows(steps) cũ (kể cả quá hạn tự tính, bỏ qua, chuyển cấp)]
- Kịch bản: khi lượt chạy bằng máy cũ thì FlowPanel không vẽ dòng bước, chỉ đánh dấu legacy [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » lượt machine ⇒ LegacyMachineRenderer (không dòng bước)]
- Kịch bản: khi thẻ có bước Ký số thì bước này nối cuối danh sách [test: apps/sohoptac-web/src/features/contract-approval/lib/flow-view.test.ts » slot/ref/state/phase + bước Ký số nối cuối · tasks rỗng (nút thẻ do useApprovalUi)]
- Kịch bản: khi e2e thẻ duyệt hiện có chạy thì vẫn xanh [test: e2e/contracts-web/contract-flow.cw.ts » dòng thời gian: tên bước, tên phòng, trạng thái, hạn quá hạn]

### ADDED engine/flow-web.md
#### Yêu cầu: Renderer theo loại bước, thiếu loại là lỗi biên dịch
Web gộp có registry renderer theo `FlowStepKind` (review, dify, esign, form, wait, system); thêm loại bước vào contract mà thiếu renderer là
lỗi typecheck. Mỗi loại là một chunk lazy riêng. Loại không có trong registry (snapshot cũ) vẽ bằng renderer chung từ các trường nền, không vỡ trang.
- Kịch bản: khi liệt kê registry thì có đủ mọi loại bước của contract và không thừa [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » RENDERERS có đủ mọi loại bước của contract, không thừa]
- Kịch bản: khi gặp loại bước lạ (kể cả tên trùng thuộc tính Object) thì dùng renderer chung [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » loại lạ (snapshot cũ) ⇒ GenericStep, kể cả tên trùng thuộc tính Object]
- Kịch bản: khi khe của gói đặt renderer riêng cho một loại thì nó thắng registry [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » loại đã biết ⇒ renderer của registry · override của khe thắng]
- Kịch bản: khi FlowPanel ở các trạng thái đang tải, lỗi, không có lượt, có bước thì vẽ đúng [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » có bước ⇒ danh sách theo thứ tự qua renderer của loại · loại lạ ⇒ Generic]

#### Yêu cầu: Bước form hiển thị và gửi qua đường review-tasks sẵn có
Người có task đang mở ở bước `form` thấy form theo định nghĩa trong snapshot (≤ 20 trường; nhãn/gợi ý là text thuần) và gửi bằng
`POST /review-tasks/:id/form`; client báo lỗi sớm theo đúng giới hạn của Hub (cùng `flowFormValuesSchema`), Hub vẫn kiểm lại. Người khác
chỉ thấy dòng bước. Không thay đổi server.
- Kịch bản: khi có task mở thì form có ô theo loại trường, nhãn bị escape, nút Gửi [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » có task đang mở ⇒ form với ô theo loại trường, nhãn là TEXT (thẻ bị escape), dấu * cho trường bắt buộc, nút Gửi]
- Kịch bản: khi không có task của người xem hoặc bước không mở thì không có form [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » không có task của người xem (hoặc bước không mở) ⇒ chỉ hiển thị dòng bước, không form]
- Kịch bản: khi giá trị vượt giới hạn trường thì báo lỗi từng trường như Hub [test: apps/sohoptac-web/src/platform/flow/lib/form-values.test.ts » giới hạn: text > max_len ⇒ tooLong · số ngoài khoảng ⇒ range · không nguyên ⇒ integer · chữ ⇒ invalid]
- Kịch bản: khi gửi form thì gọi `POST /review-tasks/:id/form` với `{values}` [test: apps/sohoptac-web/src/platform/flow/adapters/http.test.ts » submitForm ⇒ POST /review-tasks/:id/form {values} (đường sẵn có, không đổi server)]

#### Yêu cầu: Huy hiệu danh sách HĐ từ tóm tắt flow, một yêu cầu cho cả trang
Cột Giai đoạn của danh sách HĐ hiện huy hiệu "Cần xử lý" cho HĐ có `attention` theo `POST /pack/contracts/flow/contracts.approval/summary`
(một yêu cầu cho cả trang, chia lô ≤ 100, không gọi từng HĐ). Runtime chưa bật (404) ⇒ không huy hiệu, không lặp lại yêu cầu trong phiên.
- Kịch bản: khi tải trang danh sách thì summary là MỘT yêu cầu cho cả lô; khi 404 thì null và không gọi lại [test: apps/sohoptac-web/src/platform/flow/adapters/http.test.ts » summary ⇒ một POST cho cả lô · 404 (runtime tắt) ⇒ null và KHÔNG gọi lại ở lần sau]
- Kịch bản: khi danh sách dài hơn trần lô thì chia theo trần của contract [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » trần lô của web = trần của contract (FLOW_REF_MAX_BATCH)]

## Việc còn lại
- e2e bước form (cần fixture quy trình có node `form` + `HUB_FLOW_RUNTIME=on` cho hub e2e).
- Nút hành động của thẻ duyệt đi qua `FlowRuntime.act` khi cờ bật và route flow thay thế đường `/approval` (lát sau).
- Upload FileBox cho trường `file_ref`.
