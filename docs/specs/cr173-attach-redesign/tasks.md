# cr173-attach-redesign — CR-173 (thiết kế lại MỌI chỗ đính tệp: một thành phần dùng chung)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md

#### Yêu cầu: Đính tệp lúc soạn bài/tin dùng nút kẹp giấy chung và thẻ tệp nhỏ (CR-173)
Ô soạn bài (Bảng tin, sửa bài), Tin nhắn (Sổ Hợp Tác + Chat AI) và Chat AI dùng MỘT nút icon kẹp giấy (`AttachPickButton`, web-kit, có tên + chú thích) và thẻ tệp bản gọn (`AttachDraftList compact`): biểu tượng theo loại, tên cắt giữa, ✕ bỏ, thanh tiến trình. Luật loại/cỡ giữ ở hàng đợi của từng ô soạn.
- Kịch bản: nút kẹp giấy có tên + chú thích, ô tệp ẩn giữ testid cũ [test: apps/chat-web/src/features/attachments/components/AttachDropzone.test.tsx » AttachDropzone]
- Kịch bản: thẻ tệp có biểu tượng theo loại, tên cắt giữa, đuôi + dung lượng, ✕ có tên [test: apps/chat-web/src/features/attachments/components/AttachDropzone.test.tsx » thẻ tệp đã chọn (CR-173)]

### MODIFIED sht/duyet-ky-so.md

#### Yêu cầu: Mọi ô «đính tệp» của Sổ Hợp Tác là một vùng kéo-thả chung (CR-173)
Ô bằng chứng khi duyệt/ký, «Tài liệu kèm», trang tải HĐ, «Tải lên bản đã ký», tải phiên bản, Nâng thành HĐ, báo giá, ô tệp của form quy trình / phiếu yêu cầu dùng `AttachDropzone`: viền nét đứt bo góc, biểu tượng tải lên, «Kéo thả tệp vào đây hoặc **Chọn tệp**», dòng «Hỗ trợ PDF, DOCX · tối đa 20 MB mỗi tệp», đổi màu và chữ «Thả tệp để đính kèm» khi rê tệp. Tệp đã chọn là thẻ (biểu tượng theo loại, tên cắt giữa, dung lượng, tiến trình, ✕), lỗi sai loại/quá cỡ/quá số lượng hiện ngay dưới vùng. Ô một tệp (bản đã ký, phiên bản) thu thành một hàng khi đã có tệp.
- Kịch bản: vùng kéo-thả có câu «Kéo thả… Chọn tệp», gợi ý loại + dung lượng, ô tệp ẩn đúng accept [test: apps/chat-web/src/features/attachments/components/AttachDropzone.test.tsx » AttachDropzone]
- Kịch bản: một tệp ⇒ không `multiple`, nhiều tệp ⇒ có [test: apps/chat-web/src/features/attachments/components/AttachDropzone.test.tsx » AttachDropzone]
- Kịch bản: đang tải/khoá thì nút Chọn tệp khoá, lỗi hiện tại chỗ [test: apps/chat-web/src/features/attachments/components/AttachDropzone.test.tsx » AttachDropzone]
- Kịch bản: lỗi tại chỗ trên thẻ, đang tải có thanh tiến trình [test: apps/chat-web/src/features/attachments/components/AttachDropzone.test.tsx » thẻ tệp đã chọn (CR-173)]
- Kịch bản: sai loại, quá cỡ, quá số lượng tách đúng thứ tự [test: packages/web-kit/src/attach-layout.test.ts » CR-173 · validateFiles]
- Kịch bản: «Tài liệu kèm» hiện vùng nét đứt, rê tệp đổi trạng thái [test: e2e/contracts-web/cr173-attach-dropzone.cw.ts » CR173 · vùng đính tệp: viền nét đứt, câu kéo thả + nút Chọn tệp, rê tệp ⇒ đổi trạng thái]
- Kịch bản: thả tệp vào vùng thì gửi lên Tài liệu kèm [test: e2e/contracts-web/cr173-attach-dropzone.cw.ts » CR173 · thả tệp vào vùng ⇒ gửi tệp lên Tài liệu kèm]

## Kiểm kê chỗ chọn/đính tệp
| Màn | File | Trước | Sau (CR-173) |
|---|---|---|---|
| Ô bằng chứng duyệt/ký (EvidenceAsk) | `platform/flow/ui/EvidenceInput.tsx` | `<input file>` trần + danh sách chữ | `AttachField` (nhiều tệp, ≤ EVIDENCE_FILES_MAX) — thay |
| Form bước «Điền thông tin» (`file_ref`) | `components/shared/FileUploadField.tsx` | `<input file>` + «×» | `AttachField` một tệp — thay |
| Phiếu yêu cầu (RequestField attachments) | `features/requests/components/RequestField.tsx` | `<input file>` + «×» | `AttachField` nhiều tệp — thay |
| «Tài liệu kèm» | `features/contract-files/components/ContractFilesPanel.tsx` | nút «Thêm tệp» | `AttachDropzone compact` (giữ testid `cfiles-add/-input`) — thay |
| Trang tải HĐ mới | `features/contract-new/pages/NewContractPage.tsx` | nút «Tải lên» | `AttachDropzone` đủ (luật loại/cỡ do hàng đợi báo) — thay |
| «Tải lên bản đã ký» | `features/contract-esign/components/SignedUploadBox.tsx` | `<input file>` | `AttachField` một tệp + nút Tải lên — thay |
| Tải phiên bản mới | `features/contract-versions/components/UploadVersionPanel.tsx` | `<input file>` | `AttachField` một tệp — thay |
| Nâng giao dịch thành HĐ | `features/promote-deal/components/PromoteDeal.tsx` | `<input file>` | `AttachField` một tệp — thay |
| Tải báo giá (nhà cung cấp) | `features/product-suppliers/components/QuoteDialog.tsx` | `<input file>` (đọc `ref`) | `AttachField` một tệp, giữ tệp trong state — thay |
| Bảng tin: ô đăng bài | `modules/community/ui/Composer.tsx` | nút + ô ẩn | `AttachPickButton` — thay |
| Bảng tin: sửa bài | `modules/community/ui/AttachEditor.tsx` | nút + ô ẩn | `AttachPickButton` — thay |
| Tin nhắn (Sổ Hợp Tác + Chat AI) | `packages/messages-web/.../MessageComposer.tsx` | nút + ô ẩn | `AttachPickButton` + thẻ gọn — thay |
| Chat AI: ô soạn | `apps/chat-web/.../AttachButton.tsx`, `AttachmentChip.tsx` | nút + ô ẩn | `AttachPickButton` + thẻ gọn — thay |
| Chat AI: form quy trình (trường tệp) | `processes/inputs/components/InputField.tsx` | nút «Chọn …» + tên | `AttachDropzone` + thẻ — thay |
| Danh sách HĐ: nút «Tải lên» + thả cả trang | `features/contracts-list/pages/ContractsListPage.tsx` | nút trang + `DropOverlay` | **giữ**: là hành động chính của trang, thả cả trang đã có |
| «Tải tệp khác» (HĐ AI đọc lỗi) | `features/contract-review/components/ReviewParts.tsx` | mục menu mở hộp chọn tệp | **giữ**: mục menu, không phải vùng đính tệp |
| Ảnh đại diện / ảnh bìa / logo | `ImagePick`, `CoverField`, `CompanyPane` | chọn ảnh cắt | **không thuộc**: chọn ảnh hồ sơ, không đính tệp |
| Góp ý (FeedbackPanel) | `packages/web-kit/src/ui/FeedbackPanel.tsx` | liên kết «Đính kèm» | **chưa**: bộ chữ riêng từng app, ghi nợ |
| Nhập cấu hình (admin-web) | `apps/admin-web/.../ImportDrop.tsx` | vùng thả riêng | **không thuộc** phạm vi (admin-web) |

## Tasks
- [x] web-kit: `validateFiles`/`matchesAccept`/`acceptTypesLabel`/`attachPickLabels` (attach-layout) + test
- [x] web-kit: `AttachDropzone` (đủ + gọn), `AttachPickButton`, `KindTile`; `AttachDraftList` thẻ mới (+ `compact`, `layout="stack"`, `itemTestId`)
- [x] i18n: khoá `attachPick` (contracts, contracts/messages, community) và `attach.pick` (chat); bỏ `attach.button`
- [x] Thay các chỗ ở bảng kiểm kê (cột «thay»)
- [x] Test: unit web-kit + markup (chat-web) + e2e `cr173-attach-dropzone.cw.ts`
- [ ] Chạy e2e job liên quan (contracts-web, cr127, cr169, community-web, chat) và chụp lại baseline lệch — xem «Việc còn lại»

## Quyết định trong lúc làm
- Test markup đặt ở chat-web (web-kit chưa có react-dom), như CR-164.
- Ô soạn (Bảng tin, Tin nhắn, Chat AI) dùng `check={false}`: loại/cỡ/số lượng đã có hàng đợi + câu lỗi riêng; component chỉ đặt `accept` cho hộp chọn tệp.
- Ô một tệp đã có tệp ⇒ vùng thu thành một hàng nhưng VẪN còn (chọn lại thay tệp, giữ ô `input[type=file]` cho e2e).
- Hai test cũ đỏ ở workspace-web (`table.test.tsx` Pager, `use-flow-caps.test.ts` «Việc của tôi») không chạm file đã sửa — ghi nhận, không sửa.
