# CR-127 · Nghiệp vụ hợp đồng theo quy trình — tài liệu nghiệp vụ

Trạng thái: **ĐÃ CHỐT 2026-11-10 (trừ §15 Q mở)**. Chưa code. Gom từ phiên trao đổi 2026-11-09…10 (Intake Đầy đủ + mockup).
Mockup: canvas "Mockup quy trình duyệt hợp đồng" (artifact riêng của người dùng), số màn ghi `[M…]`.
Mã yêu cầu: `C127-BR-xx`. Câu còn mở ở §15 — mỗi câu có mặc định; chưa trả lời ⇒ áp mặc định.
Sửa 2026-11-10 (đối chiếu code `gap-a…d`): §3 "Giao dịch", §10.2 (BR-48…51), §12.3 (BR-72/73) theo mô hình thật; §15 thêm Q6…Q18. Spec kỹ thuật: `spec.md`; kế hoạch: `tasks.md`.

---

## 1. Mục tiêu
1. Mỗi hợp đồng đi theo **một quy trình duyệt** do quản trị nền tảng soạn riêng cho từng công ty; người duyệt dùng **phòng ban và người thật** của công ty.
2. Mọi quyết định và mọi thay đổi đụng tới cam kết hợp đồng đều có **bằng chứng** (ý kiến + chữ ký hoặc tệp), xem lại được, không sửa được.
3. Trang chi tiết hợp đồng cho thấy: **trạng thái duyệt**, **việc ai đang phải làm**, **các mốc thực hiện**, **điều khoản pháp lý cần lưu ý** và **phạt phát sinh**.
4. Việc bán/mua từ **Sản phẩm & Giá** tự cập nhật mốc của hợp đồng tương ứng.
5. Những việc đang viết cứng (hết hạn, mốc quá hạn, giao dịch lớn, đổi mốc…) chuyển thành **quy trình cấu hình được**.

## 2. Vai trò
| Vai trò | Làm gì |
|---|---|
| Quản trị nền tảng | Soạn quy trình cho từng công ty (chọn công ty trước), Chạy thử, Áp dụng; quản lý Thư viện mẫu |
| Quản trị công ty | Xem quy trình được áp dụng; cài đặt công ty (ngưỡng mức quan trọng, người phụ trách HĐ nhận, nhóm "Người ký HĐ"); đặt uỷ quyền thay người vắng |
| Người gửi (người tải HĐ) | Tải lên, sửa ở DRAFT, Xác nhận & lưu, Rút về DRAFT, Gửi lại |
| Người phụ trách HĐ | Theo dõi, xác nhận mốc, ghi giao dịch, tạm khoá, quyết định khi sắp hết hạn |
| Người duyệt / người ký | Nhận việc, quyết định kèm bằng chứng, ký |
| Trưởng nhóm | Giao lại việc của nhóm cho người khác |
| Người chỉ xem | Xem tiến trình, không thao tác |

## 3. Khái niệm và tên gọi (một khái niệm = một tên)
| Tên trên màn hình | Nghĩa | Ghi chú |
|---|---|---|
| **Trạng thái** | Tiến trình duyệt của HĐ: DRAFT / PROCESSING / REJECT / DONE | §4 |
| **Hiệu lực** | Vị trí của HĐ trên trục thời gian: Chưa hiệu lực / Còn hiệu lực / Sắp hết / Hết hạn / Đã gia hạn / Đã chấm dứt | §5 — KHÔNG phải trạng thái |
| **Quy trình** | Chuỗi bước do quản trị nền tảng soạn | §6 |
| **Bước** | Một ô trong quy trình (Duyệt, Nếu, Ký số…) | §6.3 |
| **Bằng chứng** | Ý kiến (bắt buộc) + ít nhất một: chữ ký điện tử hoặc tệp | §7.2, dùng chung mọi nơi |
| **Hồ sơ duyệt** | Danh sách mọi quyết định + bằng chứng của một HĐ | không sửa được |
| **Mốc** | Một việc phải làm theo HĐ có hạn: giao, nhận, thu, chi, hoa hồng, bảo hành, báo trước… | §10 |
| **Giao dịch** | Một lần giao/nhận hàng hoặc thu/chi tiền đã ghi NỘI BỘ (xuất/nhập kho, công nợ). **Thuộc một HĐ** ⇒ chính là **mốc đã làm** của HĐ đó (cùng bản ghi mốc, không có bản ghi thứ hai). **Không theo HĐ** ⇒ là một **chứng từ giao dịch** riêng (như hôm nay, CR-101). Sổ giao dịch cũ của CR-097 chỉ còn để xem lịch sử | §10.2 — không gửi đối tác |
| **Phiên bản** | Bản cập nhật của cùng một HĐ (v1, v2…), so sánh được | §8 |
| **Nhận việc** | Một người trong nhóm nhận việc của nhóm về mình | §7.3 |
| **Uỷ quyền** | Người khác làm thay việc của một người trong khoảng thời gian | §7.4 |

## 4. Trạng thái hợp đồng (C127-BR-01…06)
- **C127-BR-01** Chỉ có 4 trạng thái: **DRAFT** (nháp, sửa được) · **PROCESSING** (đang duyệt, khoá nội dung) · **REJECT** (bị từ chối, kết thúc) · **DONE** (đã duyệt xong, khoá nội dung).
- **C127-BR-02** Chuyển trạng thái do **app** quyết theo kết quả quy trình; quy trình không tự đặt trạng thái:

| Từ | Sự kiện | Sang |
|---|---|---|
| (mới) | Tải lên; AI đọc xong | DRAFT |
| DRAFT | Người gửi bấm **Xác nhận & lưu** | PROCESSING (quy trình bắt đầu ngay, không còn nút "Gửi duyệt" riêng) |
| PROCESSING | Đi hết quy trình | DONE |
| PROCESSING | Ai đó **Từ chối** | REJECT |
| PROCESSING | Ai đó **Trả lại** | DRAFT (có lý do) |
| PROCESSING | Người gửi **Rút về DRAFT** (chưa ai quyết ở bước hiện tại) | DRAFT |
| DRAFT (bị trả lại) | **Gửi lại** | PROCESSING, chạy lại **từ bước đầu**; hồ sơ duyệt giữ cả lần trước |

- **C127-BR-03** REJECT là kết thúc. Muốn trình lại ⇒ "Tạo hợp đồng mới từ văn bản này" (HĐ mới, DRAFT).
- **C127-BR-04** Công ty chưa có quy trình hợp đồng được áp dụng ⇒ Xác nhận & lưu chuyển thẳng DONE, màn hình ghi "Công ty chưa có quy trình duyệt".
- **C127-BR-05** Danh sách HĐ lọc theo 4 trạng thái; cột **Đang chờ** (bước, người, còn bao lâu); cột **Hiệu lực** riêng [M7].
- **C127-BR-06** Chuyển dữ liệu cũ (prod) — xem §13.

## 5. Hiệu lực (trục thời gian, tách khỏi trạng thái) (C127-BR-07…09)
- **C127-BR-07** Hiệu lực chỉ có nghĩa khi HĐ **DONE**; tính từ ngày hiệu lực / ngày hết hạn và các mốc: Chưa hiệu lực · Còn hiệu lực · Sắp hết (≤ N ngày, N = "nhắc trước") · Hết hạn · Đã gia hạn · Đã chấm dứt.
- **C127-BR-08** "Đã gia hạn" / "Đã chấm dứt" do quy trình Sắp hết hạn (§12.1) đặt, kèm bằng chứng.
- **C127-BR-09** Hiệu lực hiện thành chip riêng cạnh trạng thái; sắp hết ⇒ chip cam.

## 6. Soạn quy trình (ai-admin) (C127-BR-10…19)
### 6.1 Ai soạn
- **C127-BR-10** Chỉ **quản trị nền tảng** tạo/sửa. Tạo mới: **chọn công ty trước** → tên → bắt đầu từ trống hoặc từ mẫu Thư viện (mẫu tự khớp phòng ban của công ty) [M1].
- **C127-BR-11** Quản trị công ty chỉ xem quy trình đang áp dụng của công ty mình.

### 6.2 Màn soạn [M2]
- **C127-BR-12** Các bước xếp **một cột từ trên xuống**, đọc như một câu; thêm bước bằng nút **"+"** giữa hai bước. Bỏ kéo thả tự do, bỏ chuyển Sơ đồ/Danh sách, Ngang/Dọc.
- **C127-BR-13** **Nếu** tách thành hai cột Đúng / Sai rồi nhập lại; nhánh để trống = đi tiếp. Nhiều mức (vd < 100 tr / 100–500 / > 500) = lồng nhiều Nếu.
- **C127-BR-14** Không vẽ bước Kết thúc: **Hoàn tất (DONE)** luôn ở cuối; REJECT / về DRAFT đến từ nút Từ chối / Trả lại của bước Duyệt.
- **C127-BR-15** Mỗi thẻ bước có một dòng tóm tắt (vd "48 giờ · ý kiến + chữ ký hoặc tệp"); lỗi/lưu ý hiện trên đúng thẻ (vd "phòng chỉ có 1 người", "phòng chưa có ai").
- **C127-BR-16** Bỏ khỏi màn: hộp "Bắt đầu khi" + điều kiện giả, khối "Các trường", nhãn/dòng lộ khái niệm kỹ thuật (Dify, hub, khe), tab "Mẫu có sẵn" AI-SDLC; thiết lập AI chỉ hiện khi quy trình có bước AI [M8].
- **C127-BR-17** **Chạy thử** trước khi áp dụng: nhập HĐ thử, đóng vai từng người, thấy nhánh đi và người sẽ nhận việc lúc chạy thật; nút thử nhanh 4 trường hợp; không tạo HĐ thật, không gửi thông báo [M3].
- **C127-BR-18** **Áp dụng**: HĐ đang chạy giữ bản quy trình cũ tới khi xong; bản mới chỉ áp cho HĐ Xác nhận & lưu sau thời điểm áp dụng.
- **C127-BR-19** Menu "+" chỉ hiện bước của app công ty đã bật.

### 6.3 Danh sách bước [M2b]
| Nhóm | Bước | Tình trạng hôm nay |
|---|---|---|
| Khi nào chạy | Tải hợp đồng lên (lọc Mua/Bán) | có · đổi thời điểm sang Xác nhận & lưu |
| | Đối tác gửi hợp đồng | có (CR-124) |
| | Phiếu yêu cầu | có (CR-126) |
| | Sắp hết hạn · Mốc quá hạn · Giao dịch được lưu · Yêu cầu thay đổi thực hiện | mới (§12) |
| Người làm | **Duyệt**: ai (phòng/người), cần (một người nhận việc / trưởng phòng / tất cả), hạn, quá hạn chuyển, bằng chứng | gộp "Duyệt" + "Nhiều phòng cùng duyệt" |
| | Bổ sung thông tin | mới thành bước riêng |
| | Đồng ý ký cùng lúc | mới (§11) |
| Rẽ nhánh | Nếu (giá trị, loại Mua/Bán, phòng người gửi, mức quan trọng, đối tác mới / điểm thấp, có sản phẩm X, đối tác đề nghị ký cùng lúc) | có · thêm điều kiện |
| Hợp đồng | Ký số · Gửi đối tác xác nhận · Tạo hợp đồng từ hồ sơ | có |
| Báo tin · Chờ | Thông báo (chuông/email) · Chờ (tới ngày / một khoảng) | gộp 2+2 bước cũ |
| Nâng cao (ẩn) | Quy trình con · Công cụ (Dify/MCP/API) | ẩn với quy trình hợp đồng |

- Quy trình gọi Dify **chỉ qua bước Công cụ** bên trong quy trình; sự kiện app luôn vào Hub engine, không nối thẳng Dify.

## 7. Thực hiện bước duyệt (C127-BR-20…34)
### 7.1 Người duyệt
- **C127-BR-20** "Ai duyệt" chọn từ **phòng ban và người thật** của công ty; "Trưởng phòng" = trưởng của phòng đã chọn. Không có "trưởng phòng của người gửi".
- **C127-BR-21** Người gửi không tự duyệt HĐ của mình (khi người gửi thuộc phòng duyệt ⇒ người khác trong phòng).
- **C127-BR-22** Thẻ duyệt đủ thông tin [M5]: tóm tắt HĐ, tiến trình, ý kiến + bằng chứng của người trước, văn bản; khi gửi lại có **so sánh với lần trước**.

### 7.2 Bằng chứng (dùng chung)
- **C127-BR-23** Mỗi bước Duyệt chọn: "Chỉ ý kiến" hoặc "Ý kiến + chữ ký hoặc tệp" (mặc định). Ý kiến luôn bắt buộc khi Trả lại / Từ chối.
- **C127-BR-24** Chữ ký điện tử khi duyệt = **ký tay trên màn hình** (ảnh chữ ký). Ký số bằng chứng thư chỉ ở bước Ký số.
- **C127-BR-25** Bằng chứng lưu vào hồ sơ duyệt tại thời điểm gửi; không sửa, không xoá. Hồ sơ duyệt tải được PDF [M6].
- **C127-BR-26** Ý kiến và tệp của người duyệt chỉ người trong quy trình và quản lý xem; người chỉ xem thấy tiến trình.

### 7.3 Nhận việc
- **C127-BR-27** Việc giao cho nhóm với "Cần: một người" ⇒ cả nhóm thấy "Chưa ai nhận" + nút **Nhận việc**. Nhận ⇒ việc là của người đó; người khác chỉ xem "X đang xử lý".
- **C127-BR-28** Hai người bấm cùng lúc ⇒ một người được, người sau thấy "X vừa nhận".
- **C127-BR-29** Người đã nhận có **Trả về nhóm**; trưởng nhóm có **Giao cho người khác**. Nhận rồi không thao tác sau **24 giờ** ⇒ tự trả về nhóm, báo trưởng nhóm.
- **C127-BR-30** Hạn tính từ lúc việc vào nhóm, không đặt lại khi nhận. Không áp cho "Cần: tất cả" và việc giao đích danh.
- **C127-BR-31** Áp cho mọi việc giao nhóm cần một người: Duyệt, Bổ sung thông tin, xác nhận mốc. *(Q11 chốt: xác nhận mốc là việc nhóm trong CR-127.)*

### 7.4 Uỷ quyền
- **C127-BR-32** Hai cách:
  1. **Trong nhóm (tức thời):** người đang giữ việc bấm **Chuyển cho** một thành viên khác cùng nhóm (có lý do).
  2. **Chỉ định trước (khi vắng):** người dùng đặt "Uỷ quyền cho B từ ngày… tới ngày…" (B bất kỳ trong công ty, có quyền xem HĐ). Quản trị công ty / trưởng nhóm đặt thay được cho người vắng đột xuất.
- **C127-BR-33** Trong khoảng uỷ quyền: việc **mới** giao cho A tự sang B; việc A **đang giữ** ⇒ hỏi A chuyển (hoặc tự chuyển nếu quản trị đặt). Hồ sơ duyệt ghi "B duyệt thay A (uỷ quyền 12–15/11)".
- **C127-BR-34** Giới hạn: B không phải người gửi HĐ đó (việc đó ở lại nhóm); không uỷ quyền tiếp (không chuỗi; B chỉ trả về nhóm); uỷ quyền **ký số** chỉ cho người thuộc nhóm "Người ký HĐ". Chọn loại việc uỷ quyền: Duyệt / Bổ sung thông tin / Xác nhận mốc / Ký số. Hết khoảng uỷ quyền: việc chưa xong ở lại B, việc mới về lại A. Việc của B hiện nhãn "Thay A" [M14].

### 7.5 Hạn
- Hạn theo giờ; nhắc theo chu kỳ đặt ở bước; quá hạn ⇒ chuyển nhóm/người đã chọn (một lần). Hạn theo giờ làm việc: không làm (Mức 3 hoãn).

## 8. Phiên bản hợp đồng (C127-BR-35…38)
- **C127-BR-35** HĐ DONE cần đổi nội dung ⇒ **Tải phiên bản mới** ⇒ bản v(n+1) ở DRAFT, đi lại quy trình. Bản v(n) **vẫn DONE và đang dùng** tới khi v(n+1) DONE; lúc đó v(n) thành "đã thay thế" (chỉ đọc).
- **C127-BR-36** Giữ **so sánh phiên bản** như hiện có (chọn hai bản, xem khác nhau ở trường và văn bản); thẻ duyệt của v(n+1) có sẵn so sánh với v(n).
- **C127-BR-36a** Gửi lại sau Trả lại: thẻ duyệt mở sẵn tab **"Đã đổi so với lần trước"** (trường đổi, đoạn văn bản đổi theo điều khoản, yêu cầu lần trước + đánh dấu có đổi ở điều khoản đó không). Gửi lại mà không đổi gì ⇒ người gửi xác nhận + lý do [M15].
- **C127-BR-36b** Khi v(n+1) DONE: mốc còn mở của v(n) chuyển sang v(n+1); giao dịch đã ghi giữ ở v(n).
- **C127-BR-37** Mỗi chuỗi chỉ một bản nháp cập nhật mở cùng lúc. Gia hạn = **HĐ mới** liên kết HĐ cũ (không phải phiên bản). Không tạo phụ lục mới (giữ như CR-101a).
- **C127-BR-38** **Bỏ "Mở lại hợp đồng đã khoá"** — mọi sửa sau khi khoá đi qua phiên bản mới (§12.4).

## 9. Khoá (C127-BR-39…42)
- **C127-BR-39** **Khoá nội dung** (tự động): PROCESSING và DONE. Thông tin hiện dạng chữ đọc, không phải ô nhập.
- **C127-BR-40** **Khoá đang xử lý** (tự động): người đã nhận việc đang làm ⇒ người khác chỉ xem.
- **C127-BR-41** **Tạm khoá thực hiện** (người phụ trách / quản lý bấm, cần bằng chứng): tranh chấp, nợ quá hạn, chờ pháp lý. Chặn giao/nhận và xác nhận mốc (cả từ Sản phẩm & Giá); **vẫn ghi được tiền thu**. Mở khoá cần bằng chứng. Vượt ngưỡng ⇒ quy trình (§12.5).
- **C127-BR-42** Chip khoá hiện ở chi tiết, danh sách và Sản phẩm & Giá; thao tác bị chặn nói rõ ai khoá, lý do.

## 10. Thực hiện hợp đồng (C127-BR-43…55)
### 10.1 Mốc
- **C127-BR-43** Khi HĐ DONE, AI lập mốc từ điều khoản giao hàng, thanh toán, bảo hành, gia hạn; người phụ trách sửa được trước khi bắt đầu thực hiện. Mỗi mốc: loại, ai làm (mình / đối tác), hạn, số lượng hoặc số tiền, **điều khoản gốc** (Điều x, trang y).
- **C127-BR-44** Trang chi tiết [M9]: 4 ô số (đã giao, đã thu, mốc kế tiếp, phạt phát sinh); danh sách mốc ở giữa; mỗi mốc ghi trạng thái (chưa tới / sắp tới / quá hạn / xong đúng hạn / xong trễ), người xác nhận, bằng chứng.
- **C127-BR-45** **Xác nhận mốc** [M11]: ngày làm thật, số lượng/số tiền thật, bằng chứng (ý kiến + chữ ký hoặc tệp; nên kèm biên bản giao nhận / chứng từ chuyển khoản). Trễ ⇒ hỏi **lỗi do ai** (đối tác / mình / chưa rõ); lỗi đối tác ⇒ trừ điểm đối tác (như hiện có).
- **C127-BR-46** Làm thiếu (giao 400/650, thu 300/455) ⇒ chọn **giữ hạn cũ cho phần còn lại** hoặc **tách mốc mới** có hạn mới.
- **C127-BR-47** Nhắc trước hạn 3 ngày; mốc của đối tác có nút gửi email nhắc đối tác; quá hạn ⇒ mốc đỏ ở chi tiết, danh sách, Việc của tôi (leo thang theo §12.2).

### 10.2 Giao dịch từ Sản phẩm & Giá (nội bộ)
*(Sửa 2026-11-10 cho khớp code: từ CR-101 giao dịch là một loại chứng từ — "Giao dịch" (`doc_type='deal'`), không có trạng thái nháp/ghi sổ; mốc của HĐ là bảng nghĩa vụ `contracts.obligations`. Xem `gap-c-execution.md` §0, §3.1.)*
- **C127-BR-48** Giao dịch là sổ **nội bộ** của công ty (xuất/nhập kho, công nợ), không gửi đối tác. Ghi từ trang Sản phẩm & Giá / trang tạo giao dịch hay bấm "Xác nhận đã giao" trên mốc đều là **cùng một thao tác "ghi việc đã làm vào mốc"**; tiến độ mốc = các phần mốc đã làm, không nhập hai lần.
- **C127-BR-49** Bán/nhập một sản phẩm cho đối tác đang có HĐ DONE còn hiệu lực chứa sản phẩm đó ⇒ ô **"Thuộc hợp đồng nào"** bắt buộc (gợi ý HĐ + mốc đang mở). Chọn "Không theo hợp đồng" ⇒ ghi lý do; HĐ đang tạm khoá không hiện để chọn [M12]. Điểm vào: trang tạo giao dịch hiện có + nút **"Ghi bán / Ghi nhập"** trên trang Sản phẩm (mở trang đó, điền sẵn sản phẩm) — *(Q7)*.
- **C127-BR-50** Chọn một HĐ ⇒ **không tạo chứng từ giao dịch riêng**: ghi thẳng vào mốc đang mở của HĐ đó (mốc thành "đã làm" với ngày/số lượng/số tiền thật), trừ/cộng kho, cập nhật công nợ. Làm thiếu ⇒ phần còn lại thành **mốc con** của mốc đó (giữ hạn cũ hoặc hạn mới — C127-BR-46).
- **C127-BR-51** Chọn "Không theo hợp đồng" ⇒ tạo **chứng từ giao dịch** như hôm nay, kèm lý do. Một nguồn dữ liệu: với HĐ, mốc là nơi duy nhất ghi "đã giao / đã thu"; không thêm bảng thứ ba, không đồng bộ hai chiều giữa chứng từ giao dịch và mốc.

### 10.3 Bằng chứng khi đụng tới cam kết
- **C127-BR-52** Cần bằng chứng: ghi nhận đã làm (giao, nhận, thu, chi); **đổi điều đã thoả thuận** (dời hạn, tách đợt, đổi SL/số tiền mốc, miễn phạt, huỷ giao dịch); khoá/mở khoá.
- **C127-BR-53** Đổi giá trị, đơn giá, các bên, điều khoản ⇒ không sửa ở mốc ⇒ **phiên bản mới**.
- **C127-BR-54** Mọi thay đổi trên ghi vào **lịch sử hợp đồng** (ai, khi nào, trước → sau, bằng chứng).

### 10.4 Điều cần lưu ý và phạt
- **C127-BR-55** Thẻ **Điều cần lưu ý** (thay "Tóm tắt hợp đồng"): AI tóm từ văn bản — phạt vi phạm (cả hai chiều), thanh toán, giao hàng & nghiệm thu, bảo hành, gia hạn/chấm dứt, tranh chấp; mỗi ý có điều khoản + trang. Thẻ **Cần chú ý**: rủi ro AI thấy (tự gia hạn, thiếu điều khoản tạm ngừng…).
- **C127-BR-56** AI trích phạt thành **con số** (tỷ lệ, cơ sở tính, mức trần). Mốc trễ ⇒ hiện phạt ước tính theo điều khoản; người phụ trách chọn **Ghi vào công nợ** hoặc **Miễn phạt** (bằng chứng). Không tự trừ tiền.

## 11. Hợp đồng giữa hai công ty trên Evolu (C127-BR-57…66)
### 11.1 Gửi / nhận bình thường (đã có CR-124/125)
- **C127-BR-57** Bên gửi có bước **Gửi đối tác xác nhận** (kết quả: Đã xác nhận / Trả lại sửa / Từ chối / Hết hạn). Bên nhận chạy quy trình bắt đầu bằng **Đối tác gửi hợp đồng**. Phần chuyển giữa hai công ty là cố định trong app; bên gửi không thấy người duyệt bên nhận.
- **C127-BR-58** Bên nhận theo 4 trạng thái: vừa nhận ⇒ PROCESSING; Đồng ý ⇒ DONE; Từ chối ⇒ REJECT; Trả lại ⇒ DRAFT ("chờ đối tác gửi bản sửa"); bản sửa tới ⇒ chạy lại từ đầu. Hai mẫu Thư viện "Nhận HĐ thường" / "Nhận HĐ quan trọng" cập nhật theo.
- **C127-BR-59** Mục "Hợp đồng đối tác gửi" gộp vào danh sách Hợp đồng bằng bộ lọc **Nguồn: Mình tải lên / Đối tác gửi**; lời mời lần đầu hiện thành băng trên đầu danh sách [M2c]. *(Câu mở Q3)*

### 11.2 Ký cùng lúc (khẩn) [M2d]
- **C127-BR-60** Bên gửi bật **Đề nghị ký cùng lúc** ở bước Gửi đối tác xác nhận, kèm lý do khẩn (bắt buộc), hạn trả lời (mặc định 2 giờ), hạn ký (mặc định 4 giờ), người ký bên mình.
- **C127-BR-61** **Bên nhận phải đồng ý trước**: người phụ trách HĐ nhận thấy việc ghim đầu Việc của tôi (chuông + email) với 3 nút: **Đồng ý ký cùng lúc** (chọn người ký trong nhóm "Người ký HĐ") · **Xử lý bình thường** · **Từ chối HĐ**. Hết hạn trả lời ⇒ xử lý bình thường; bên gửi được báo.
- **C127-BR-62** **Chỉ cần người ký**, không có bước duyệt nhanh. Quy trình nhận: Nếu "đối tác đề nghị ký cùng lúc" ⇒ Đúng: Đồng ý ký cùng lúc → Ký số song song; Sai: nhánh duyệt thường.
- **C127-BR-63** **Phiên ký chung**: hai bên ký song song **cùng một bản**, nội dung khoá; hai bên cùng thấy ai đã ký (tên công ty + người ký).
- **C127-BR-64** Cả hai ký ⇒ DONE ở cả hai bên. Một bên từ chối ký ⇒ huỷ phiên ở cả hai, REJECT kèm lý do. Quá hạn ⇒ huỷ phiên; bên gửi chọn gửi lại (DRAFT) hoặc dừng (REJECT).
- **C127-BR-65** Muốn sửa nội dung ⇒ "Huỷ phiên ký" (lý do), sửa, gửi lại từ đầu.
- **C127-BR-66** Đối tác **ngoài** Evolu: dùng Ký số có đối tác ký song song qua link (đã có); không có bước "đồng ý trước".

## 12. Việc chuyển thành quy trình (C127-BR-67…76)
Mỗi mục (trừ 12.4) là một **kiểu bắt đầu mới** (cần code) + một mẫu Thư viện mặc định; quản trị nền tảng tự soạn/sửa trên màn soạn như mọi quy trình [M16]. Công ty không có quy trình riêng ⇒ chạy mẫu mặc định. Số ngưỡng trong mẫu (100 tr, 7 ngày, 10 tr) chỉ là giá trị khởi đầu ở bước Nếu, sửa được.

### 12.1 Sắp hết hạn / gia hạn
- **C127-BR-67** Bắt đầu: "Còn N ngày tới ngày hết hạn" (HĐ DONE; N đặt ở bước, mặc định = nhắc trước của HĐ hoặc 30).
- **C127-BR-68** Mẫu: giao người phụ trách quyết **Gia hạn / Chấm dứt / Để hết hạn** (bằng chứng). Gia hạn ⇒ tạo HĐ gia hạn DRAFT liên kết HĐ cũ, chờ tải văn bản ⇒ đi quy trình duyệt HĐ; DONE ⇒ HĐ cũ hiệu lực "Đã gia hạn". Chấm dứt ⇒ "Đã chấm dứt". Không quyết tới ngày hết hạn ⇒ "Hết hạn". HĐ tự gia hạn: nhắc hạn báo trước theo điều khoản.
- **C127-BR-69** Thay hẳn "Hạn chót hành động + Ghi nhận xử lý" đang viết cứng trên chi tiết HĐ.

### 12.2 Mốc quá hạn
- **C127-BR-70** Bắt đầu: "Mốc quá hạn N ngày" (lọc: mốc của mình / đối tác, loại mốc).
- **C127-BR-71** Mẫu: báo người phụ trách → chờ 3 ngày → báo trưởng phòng; mốc của đối tác ⇒ thêm email nhắc đối tác.

### 12.3 Giao dịch lớn / không theo hợp đồng
- **C127-BR-72** Bắt đầu: "Giao dịch được lưu" (cả giao dịch thuộc HĐ lẫn không theo HĐ). Khi công ty có quy trình cho kiểu bắt đầu này, giao dịch vừa lưu ở trạng thái **Chờ duyệt**: chưa ghi vào mốc, chưa tạo chứng từ giao dịch, kho/công nợ **chưa đổi**. Duyệt xong ⇒ mới ghi (vào mốc nếu thuộc HĐ; tạo chứng từ giao dịch nếu không theo HĐ). Công ty không có quy trình này ⇒ ghi ngay như hôm nay. *(Hôm nay giao dịch không có "nháp/ghi sổ" — Chờ duyệt là một yêu cầu chờ, dùng chung cơ chế với §12.5; Q8.)*
- **C127-BR-73** Mẫu: Nếu giá trị > ngưỡng **hoặc** không theo HĐ ⇒ Duyệt ⇒ ghi (từ chối ⇒ giao dịch bị từ chối, kèm lý do, không ghi gì); ngược lại ghi ngay (vài giây sau khi lưu, màn hình hiện "Đang kiểm duyệt…" trong lúc đó).

### 12.4 Bỏ mở lại hợp đồng đã khoá
- **C127-BR-74** Gỡ thao tác "Mở lại" (và "Mở lại để sửa lỗi trích xuất"); sửa lỗi trích xuất làm ở DRAFT; sửa sau khi khoá ⇒ phiên bản mới (§8).

### 12.5 Thay đổi thực hiện cần duyệt
- **C127-BR-75** Bắt đầu: "Yêu cầu thay đổi thực hiện" — loại: dời hạn, tách mốc, miễn phạt, tạm khoá, mở khoá; kèm bằng chứng.
- **C127-BR-76** Mẫu: Nếu (dời > N ngày, miễn phạt > X đồng, tạm khoá) ⇒ Duyệt (vd trưởng phòng / Giám đốc); ngược lại áp ngay. Đang chờ ⇒ mốc ghi "Chờ duyệt thay đổi".

## 12b. Dùng lại quy trình giữa các công ty (C127-BR-80…88) [M17] — **HOÃN** (người dùng 2026-11-10: "chưa cần thư viện, để tôi suy nghĩ thêm"). Không thuộc phạm vi CR-127; giữ lại để tham khảo. C127-BR-87 (bộ mặc định) cũng hoãn — 4 quy trình mới (§12) đưa vào Thư viện như mẫu thường.
Đã có: Thư viện (mẫu có phiên bản, xuất bản, quay lại bản trước, gán cho công ty, xem tác động khi xuất bản). Thêm:
- **C127-BR-80** **Một đường duy nhất**: sao chép, tải lên, áp bộ quy trình đều đi qua **màn khớp** rồi tạo quy trình **Nháp** ở công ty đích; không áp thẳng, không đè quy trình đang áp dụng. Chạy thử + Áp dụng như bình thường (có "Áp dụng tất cả" khi mọi quy trình của bộ đều không lỗi).
- **C127-BR-81** **Màn khớp**: mỗi phòng/nhóm trong quy trình nguồn ⇒ chọn phòng/nhóm của công ty đích (tự khớp theo mã/tên; thiếu ⇒ "Tạo nhóm theo gợi ý" hoặc chọn nhóm có sẵn); kiểm app đã bật, ký số đã cấu hình, công cụ (Dify/MCP) có ở công ty đích (không có ⇒ bước tắt, phải chọn lại), trùng tên ⇒ "(bản sao)".
- **C127-BR-82** Từ một quy trình của công ty: **Sao chép sang công ty khác** · **Lưu thành mẫu Thư viện** · **Thêm vào bộ quy trình** · **Tải xuống (.json)**. Lưu thành mẫu / tải xuống: người cụ thể phải đổi thành phòng/nhóm trước.
- **C127-BR-83** **Tệp quy trình (.json)**: chỉ cấu trúc (bước, điều kiện, mã phòng/nhóm, mã công cụ), có số định dạng và nơi tạo; **không** chứa dữ liệu, người, id nội bộ, khoá/mật khẩu. Tải lên: kiểm định dạng chặt; đưa vào một công ty (qua màn khớp) hoặc vào Thư viện. Dùng cho chuyển staging → prod, sao lưu, đối tác triển khai.
- **C127-BR-84** **Bộ quy trình**: tập mẫu Thư viện có tên + phiên bản (vd "Sổ Hợp Tác · chuẩn" 7 quy trình) + danh sách phòng/nhóm cần có. "Áp cho công ty…" chọn được nhiều công ty; mỗi công ty qua màn khớp riêng. Quy trình con được gọi tới tự đi kèm.
- **C127-BR-85** Mẫu/bộ có bản mới: công ty dùng **nguyên mẫu** ⇒ nút "Cập nhật" (xem trước tác động; lượt đang chạy giữ bản cũ — C127-BR-18); công ty **đã chỉnh riêng** ⇒ không đè, chỉ hiện "So sánh với mẫu mới".
- **C127-BR-86** Chỉ quản trị nền tảng làm các thao tác trên; mọi lần sao chép/tải lên/áp bộ ghi nhật ký (ai, nguồn, đích, bộ + phiên bản).
- **C127-BR-87** Mục 12 (bốn quy trình mới) + duyệt HĐ mua/bán + nhận HĐ đóng thành bộ mặc định "Sổ Hợp Tác · chuẩn".
- **C127-BR-88** Tải lên là đầu vào từ ngoài ⇒ coi như dữ liệu không tin cậy: giới hạn kích thước, không chạy gì khi đọc, không tham chiếu được công ty khác.

## 13. Chuyển dữ liệu hiện có (C127-BR-77…79)
- **C127-BR-77** Trạng thái cũ ⇒ mới:

| Cũ | Trạng thái mới | Hiệu lực |
|---|---|---|
| extracting, extract_failed, needs_review | DRAFT | — |
| active, expiring, expired | DONE | tính lại từ ngày |
| renewed | DONE | Đã gia hạn |
| terminated | DONE | Đã chấm dứt |
| rejected | REJECT | — |

- **C127-BR-78** HĐ đang duyệt dở theo đường cũ chạy tiếp tới khi xong rồi đổi theo bảng trên; sau đó gỡ đường duyệt cũ (cờ `FLOW_TRIGGERS`) và các chỗ đọc 9 trạng thái (một nguồn — Luật GỐC 1).
- **C127-BR-79** Có kiểm tự động phát hiện HĐ lệch (trạng thái vs lượt chạy, mốc vs giao dịch).

## 14. Ngoài phạm vi / để sau
- Duyệt hàng loạt, duyệt qua email/điện thoại, hạn theo giờ làm việc (Mức 3).
- Giao việc theo "trưởng phòng của người gửi"; lớp vai trò "Người phụ trách".
- Đối tác tự xác nhận "Đã nhận hàng" qua link.

## 15. Câu còn mở (chưa trả lời ⇒ áp mặc định)
| # | Câu | Mặc định |
|---|---|---|
| Q1 | ~~Chia đợt?~~ | **Chốt 2026-11-10: làm tất cả trong một CR-127** (bên trong vẫn chia lát nhỏ theo Luật 0d; e2e một lần cuối) |
| Q2 | Tự trả việc về nhóm sau 24 giờ không thao tác — cố định hay công ty đặt? | 24 giờ, quản trị công ty đổi được |
| Q3 | Gộp "Hợp đồng đối tác gửi" vào danh sách Hợp đồng? | Gộp, bộ lọc Nguồn |
| Q4 | Người bấm "Đồng ý ký cùng lúc" bên nhận | Người phụ trách HĐ nhận (chọn người ký) |
| Q5 | ~~Số khởi đầu trong mẫu~~ | **Chốt**: giao dịch > 100 tr; dời > 7 ngày; miễn phạt > 10 tr; tạm khoá luôn duyệt — sửa được ở bước Nếu |

**Câu CHẶN mới từ đối chiếu code (2026-11-10, `gap-a…d`)** — chưa trả lời ⇒ áp mặc định; spec.md đã viết theo mặc định.
| # | Câu | Mặc định |
|---|---|---|
| Q6 | C127-BR-10/11 đảo quyết định CR-121/123 (quản trị công ty được sao chép/sửa/xuất bản bản công ty). Bản công ty quản trị công ty đã tạo ở prod xử lý sao? (gap-b B1) | Gỡ quyền ghi của quản trị công ty (chỉ xem); bản công ty đã có **giữ chạy nguyên**, quản trị nền tảng sửa hộ; không chuyển dữ liệu |
| Q7 | Không có màn "giao dịch từ Sản phẩm & Giá" — giao dịch tạo ở trang Tạo chứng từ → Giao dịch. Làm màn mới hay gắn vào trang có sẵn? (gap-c Q-C1) | Gắn ô "Thuộc hợp đồng nào" vào trang tạo giao dịch có sẵn + nút "Ghi bán / Ghi nhập" ở trang Sản phẩm mở trang đó điền sẵn SP |
| Q8 | "Chờ duyệt" của giao dịch lưu ở đâu khi giao dịch không có nháp/ghi sổ? (gap-c Q-C4) | Một **yêu cầu chờ duyệt** (cùng bảng với Yêu cầu thay đổi thực hiện §12.5); duyệt xong mới ghi mốc / tạo chứng từ. Không thêm trạng thái cho chứng từ giao dịch |
| Q9 | Ký cùng lúc: DocuSign không cho một phong bì chứa hai công ty. Dùng gì? (gap-d D-Q2) | Hai phong bì (mỗi bên một) + **phiên ký chung** ở nền tảng giữ "tất cả hoặc không"; giai đoạn này chỉ ký nội bộ (selfsign), màn hình ghi "chưa có giá trị pháp lý"; DocuSign để sau |
| Q10 | Đối tác trả lại rồi gửi bản sửa: vào **cùng** HĐ nhận hay HĐ nhận mới? (gap-d D-Q1) | Cùng HĐ nhận (DRAFT → PROCESSING, chạy lại từ đầu, hồ sơ giữ lần trước) |
| Q11 | ~~Xác nhận mốc là việc nhóm có Nhận việc?~~ | **Chốt 2026-11-10: làm luôn trong CR-127** — xác nhận mốc là việc giao nhóm (mặc định phòng của người phụ trách HĐ) có Nhận việc / Trả về nhóm / uỷ quyền / quá hạn chuyển như bước Duyệt; bắt đầu khi mốc còn N ngày (mặc định 3). Công ty chưa áp quy trình này ⇒ người phụ trách xác nhận trực tiếp như cũ |
| Q12 | "Cần: tất cả" = mọi thành viên phòng phải duyệt? (gap-b B3) | Có (n/n); không có Nhận việc; một người Từ chối/Trả lại ⇒ kết quả ngay |
| Q13 | Bằng chứng mặc định "Ý kiến + chữ ký hoặc tệp" bắt buộc cả khi bấm **Duyệt**? (gap-b B6) | Có; Trả lại/Từ chối chỉ bắt buộc ý kiến |
| Q14 | "Quản lý" được xem ý kiến/tệp (C127-BR-26) là ai? (gap-b B5) | Người trong quy trình ∪ người gửi ∪ người phụ trách HĐ ∪ quản trị công ty ∪ trưởng phòng duyệt |
| Q15 | Kiểu bắt đầu "Tải hợp đồng lên" dời sang lúc Xác nhận & lưu: quy trình "Tiếp nhận" đang gắn lúc tải lên (CR-120) xử lý sao? (gap-a Q-A5) | "Tải hợp đồng lên (lọc Mua/Bán)" = lúc **Xác nhận & lưu**; kiểu bắt đầu cũ lúc tải lên giữ chạy cho quy trình đã có nhưng ẩn khỏi menu |
| Q16 | ~~Prod còn HĐ đang duyệt theo đường cũ lúc deploy~~ | **Chốt 2026-11-10: prod chưa có người dùng** ⇒ deploy một đợt; bước gỡ vẫn có chốt chặn (còn lượt cũ ⇒ dừng, tách hai đợt) |
| Q17 | "Người ký HĐ" là nhóm nào? (gap-d D-Q3) | Một phòng/nhóm thường do quản trị công ty chọn trong Cài đặt công ty; chưa chọn ⇒ bước Đồng ý ký cùng lúc báo "Công ty chưa chọn nhóm Người ký HĐ" và tự xử lý bình thường |
| Q18 | Quá hạn ⇒ chuyển tới **một người** (hôm nay chỉ chuyển tới phòng)? (gap-b B7) | Hỗ trợ cả phòng và một người cụ thể |
| Q19 | ~~Gán 4 quy trình mẫu §12 cho mọi công ty prod?~~ | **Chốt 2026-11-10:** chỉ tự gán cho công ty **mới**; công ty đang có, quản trị nền tảng áp tay |
| Q20 | ~~Bên nhận không có quy trình nhận khớp?~~ | **Chốt 2026-11-10:** giao việc cho người phụ trách HĐ nhận quyết Đồng ý / Trả lại / Từ chối |
| Q21 | ~~Đếm thử chuyển dữ liệu trên bản sao prod?~~ | **Chốt 2026-11-10: không cần** — prod chưa có người dùng; chuyển dữ liệu vẫn chạy cho staging/dữ liệu thử |

## 16. Rủi ro và làn (Luật 0c/0d)
| Phần | Rủi ro | Làm |
|---|---|---|
| Máy trạng thái HĐ 4 giá trị + chuyển dữ liệu | Cao (máy trạng thái; dữ liệu khách thấp — prod chưa có người dùng, Q21) | Opus |
| Nhận việc, uỷ quyền, hạn | Cao (máy trạng thái task) | Opus |
| Phiên ký chung hai công ty | Cao (liên công ty, tất cả-hoặc-không) | Opus + e2e hai công ty thật |
| Giao dịch bắt buộc HĐ, tách mốc, chờ duyệt giao dịch | Cao vừa (đường ghi kho/tiền) | Sonnet high + Opus soát |
| Tạm khoá, uỷ quyền (quyền) | Quyền | Opus soát |
| Màn soạn quy trình, chi tiết HĐ, thẻ duyệt, Điều cần lưu ý | Thường | Sonnet, UI một đợt |
| AI trích phạt dạng số, trích dẫn điều khoản | Thường (AI) | Sonnet |

## 17. Ánh xạ mockup
M1 Tạo quy trình · M2 Soạn (danh sách dọc) · M2b Danh sách bước · M2c Đối tác gửi HĐ · M2d Ký cùng lúc · M3 Chạy thử · M4 Tải lên · M5 Người duyệt · M6 Hồ sơ duyệt · M7 Danh sách · M8 Nên gỡ/gộp · M9 Chi tiết HĐ · M10 Đầu trang theo trạng thái · M11 Xác nhận mốc · M12 Giao dịch → mốc · M13 Theo người xem + khoá · M14 Uỷ quyền · M15 So sánh khi gửi lại / giữa phiên bản · M16 Bốn quy trình mới (§12) · M17 Dùng lại quy trình giữa công ty (§12b).
