---
id: cr123-u2-contracts-ux
lát: cr123-u2-contracts-ux
cr: CR-123
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

FLOW3-FR-11 + FLOW3-FR-13 phần C (`docs/specs/CR-123/ux-audit.md` dòng 24–30) ở ứng dụng Hợp đồng (workspace-web): thẻ duyệt 3 dòng
(trạng thái · lý do · bước kế), một chữ "Cần xử lý", người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối, ẩn token cho người thường,
"Giai đoạn" → "Bước", cảnh báo bước Thông báo không có người nhận, và bỏ màn sửa "luật chọn quy trình" trong ứng dụng (chỉ đọc).

## Làm

- `lib/card-status.ts` (thuần, có unit): `rowStatusLines` / `esignStatusLines` / `noRecipientSteps`; `components/StatusLines.tsx`; `Row` (ApprovalSteps) và `EsignStepRow` dùng 3 dòng.
- Nút người duyệt: `contracts.approval.pass` "Đạt" → "Duyệt", `return` → "Trả lại sửa"; từ chối vẫn bắt buộc lý do.
- i18n contracts: "Cần quyết"/"Cần quyết định" → "Cần xử lý"; "Giai đoạn" → "Bước"; lỗi gửi ký lại nói vì sao + cách sửa; `FLOW_ROUTE_NONE/UNAVAILABLE` chỉ tới Công ty › Quy trình.
- Cài đặt › Ứng dụng & quy trình: `SlotCard` chỉ đọc ("Đang áp dụng: <tên>" + sơ đồ), `AppsPane` nút "Mở trang Quy trình" (SSO `flowEditorUrl`). Gỡ `RoutingEditor`, `RuleRow`, `DeptPicker`, `KindPicker`, `useSaveRouting`, `useDepartments`, `putRouting`, cùng khoá i18n sửa luật (D6: một control).
- `ScoutQuota`: ẩn "token" (dòng đã dùng + ô trần token) với người không phải quản trị; thân PUT vẫn gửi `tokens_month` cũ.
- NOTIFY_NO_RECIPIENT (chỉ phần hiển thị): contract thêm `warning?` (tuỳ chọn) vào `ApprovalCardStep` và `FlowStepView`; `ApprovalTimeline` hiện dòng cảnh báo cho chủ HĐ.

## Không làm / Chạm

- Không đổi admin-web, `packages/flow-canvas`, hub-api runtime, DLC, engine.
- Hub `PUT /tenants/:tid/process-routing/:slot` GIỮ NGUYÊN (admin-web dùng); ứng dụng Hợp đồng không còn gọi — để không dùng, không xoá.
- Chạm ngoài phạm vi liệt kê: `packages/contracts` (chỉ thêm trường tuỳ chọn `warning`), `e2e/contracts-web/contract-flow.cw.ts` (chữ mới) + `u2-contracts-ux.cw.ts` mới.
- Dòng 30 audit: chữ "Từ chối đi tới / Trả lại đi tới" chỉ nằm ở chuỗi cấu hình quy trình của admin (`process/admin.*.json`), thẻ duyệt ở ứng dụng không dùng ⇒ không có gì để gỡ ở đây.

## Test tối thiểu

- Unit: `contract-approval/lib/card-status.test.ts` (3 dòng mọi trạng thái, ký số, NOTIFY_NO_RECIPIENT, nút theo vai, từ vựng i18n).
- e2e: sửa `contract-flow.cw.ts` (chữ mới); `journey-approval` chạy một lần qua evotest.

## Quyết định trong lúc làm

- Nút [Nhắc] trong ví dụ "Đang chờ Trưởng phòng duyệt · từ 8/11, hạn 9/11 · [Nhắc]": CHƯA làm — thẻ không có endpoint nhắc bước duyệt và không có mốc "từ ngày" (`opened_at`); dòng 1-2-3 hiện hạn, thiếu mốc bắt đầu. Hàng chờ cho slice hub.
- Server chưa điền `warning` vào thẻ/FlowView ⇒ cảnh báo NOTIFY_NO_RECIPIENT chỉ hiện khi hub gửi (hub-api ngoài phạm vi lát này). Hàng chờ: map `warn_no_recipient` (`run-detail.repo.ts`) sang bước thẻ.
- Dòng "Sẽ bỏ qua (…)" của bước chưa tới giữ một dòng (không 3 dòng) vì bước đó không ai làm gì.
- Bước sau khi trả lại/từ chối: lý do = góp ý của người duyệt; tên người quyết không còn dòng riêng (chỉ có ở bước đã duyệt: "Bởi X lúc …").

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt hiển thị ba dòng cho mỗi bước
Mỗi bước trên thẻ duyệt hiện đúng ba dòng ngắn: trạng thái · lý do · bước kế (ai cần làm gì). Một chữ "Cần xử lý" cho trạng thái cần người xử lý.
Lỗi gửi ký lại nói vì sao và cách sửa.
- Kịch bản: khi bước duyệt đang mở thì thẻ hiện "Đang chờ <phòng> duyệt", hạn, và "Bạn cần: Duyệt, Trả lại sửa hoặc Từ chối" cho người duyệt [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » rowStatusLines · mỗi trạng thái đủ 3 dòng]
- Kịch bản: khi bước ký số lỗi thì lý do kèm cách sửa và bước kế theo quyền gửi lại [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » esignStatusLines]
- Kịch bản: khi xem thẻ ở trình duyệt thì mỗi bước có ba dòng [test: e2e/contracts-web/contract-flow.cw.ts » dòng thời gian: tên bước, tên phòng, trạng thái, hạn quá hạn]

#### Yêu cầu: Người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối
Ở bước duyệt, người có quyền chỉ thấy ba nút Duyệt, Trả lại sửa, Từ chối (Từ chối và Trả lại bắt buộc ghi lý do). Không dùng chữ "Đạt" hay "Cần quyết".
- Kịch bản: khi người duyệt mở thẻ thì đúng ba nút, không Xác nhận/Đọc lại [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » nút theo vai (người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối)]
- Kịch bản: khi đọc chuỗi tiếng Việt của ứng dụng Hợp đồng thì không còn "Cần quyết", "Giai đoạn", "Đạt", "đi tới" [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » từ vựng thẻ duyệt trong chuỗi contracts]

#### Yêu cầu: Bước Thông báo không có người nhận được báo cho chủ hợp đồng
Khi một bước Thông báo xong nhưng không có người nhận, thẻ duyệt hiện cho chủ hợp đồng dòng "Không có ai nhận thông báo bước <tên> — chọn người nhận trong Công ty › Quy trình" thay vì im lặng.
- Kịch bản: khi hub gửi cờ cảnh báo ở bước Thông báo thì chủ hợp đồng thấy dòng cảnh báo [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » noRecipientSteps (NOTIFY_NO_RECIPIENT)]
- Kịch bản: khi xem thẻ ở trình duyệt thì dòng cảnh báo hiện cho chủ hợp đồng [test: e2e/contracts-web/u2-contracts-ux.cw.ts » chủ HĐ thấy cảnh báo bước Thông báo không có người nhận]

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Quy trình duyệt chỉ chọn ở một nơi
Ứng dụng Hợp đồng không còn sửa "luật chọn quy trình". Cài đặt › Ứng dụng & quy trình chỉ hiện quy trình đang áp dụng (chỉ đọc) và nút "Mở trang Quy trình" tới Công ty › Quy trình ở trang quản trị. Khi chưa có quy trình: "Hợp đồng chưa có quy trình duyệt — quản trị công ty chọn tại Công ty › Quy trình".
- Kịch bản: khi quản trị công ty mở Cài đặt thì thấy "Đang áp dụng: <tên>", nút "Mở trang Quy trình", không có "Thêm luật"/"Lưu luật" [test: e2e/contracts-web/u2-contracts-ux.cw.ts » Cài đặt › Ứng dụng & quy trình: chỉ đọc, một nút Mở trang Quy trình]
- Kịch bản: khi công ty chưa có quy trình thì thấy câu chỉ rõ ai chọn ở đâu [test: e2e/contracts-web/u2-contracts-ux.cw.ts » Cài đặt › Ứng dụng & quy trình: chưa có quy trình ⇒ nói rõ ai làm gì ở đâu]

#### Yêu cầu: Token chỉ hiện cho quản trị
Mức dùng và ô trần "token" ở Cài đặt › Dò giá chỉ hiện cho quản trị công ty/nền tảng; người bán hàng và giám đốc không thấy.
- Kịch bản: khi người không phải quản trị mở mục Dò giá thì không thấy "token" [test: thủ công — hiển thị theo vai ở ScoutQuota, không có logic tách riêng để kiểm đơn vị]

## Việc còn lại

- Hub: map `warn_no_recipient` sang `ApprovalCardStep.warning` / `FlowStepView.warning`; endpoint "Nhắc" cho bước duyệt + mốc `opened_at` (nút [Nhắc], "từ 8/11").
- Admin-web: các dòng 1–23, 31–33 của audit (lát khác).
