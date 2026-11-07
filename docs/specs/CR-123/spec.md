---
id: CR-123
tên: Trình sửa flow kéo-thả, chọn bước theo tên, giới hạn bước do platform cấu hình
mã yêu cầu: FLOW3-FR-01..08
trạng thái: đã chốt 2026-11-07 (Intake, người dùng); p22 đang làm, p25 chưa làm
---
# CR-123 · Trình sửa flow (canvas)

## Mục tiêu
Người dùng dựng flow bằng tay kéo-thả như công cụ vẽ quy trình hiện đại: kéo mũi tên là nối bước, ô chọn bước tự theo, tên bước rõ ràng, số bước tối đa do platform admin đặt. Thao tác nào cũng theo đúng luật hợp lệ của flow; sai thì nói rõ vì sao bằng tiếng Việt.

## Luật hợp lệ chung (dùng cho ô chọn VÀ kéo-thả, một nguồn)
1. Bước tiếp theo phải là bước ở sau (không nối ngược/vòng).
2. Nhánh If (Đúng/Sai) không được trỏ tới bước hành động thật (`real_action`).
3. Bước Ký số cần một bước duyệt của người ngay trước nó.
4. Tổng số bước không vượt giới hạn của platform.

## Yêu cầu và tiêu chí nghiệm thu
**FLOW3-FR-01 Kéo mũi tên đặt bước kế.** Given canvas có node A, B (B sau A); When kéo mũi tên từ A sang B; Then ô "Tiếp theo" của A đổi thành B (với If: ô Đúng hoặc Sai theo cổng kéo từ), cạnh vẽ lại. Ngược lại đổi ô chọn thì cạnh đổi theo.

**FLOW3-FR-02 Ô chọn bước hiện tên.** Given flow có bước tên "Giám đốc duyệt"; When mở ô chọn bước ở bất kỳ node; Then mỗi lựa chọn là "N · Giám đốc duyệt" (bước chưa đặt tên: "N · <loại bước>"); giá trị đã chọn cũng hiện theo dạng này.

**FLOW3-FR-03 Giới hạn bước do platform cấu hình.** Given platform admin đặt giới hạn 30 (mặc định 22, trần cứng 50, giá trị ngoài 1..50 bị từ chối); When người dùng thêm bước thứ 31 hoặc xuất bản def quá giới hạn; Then bị chặn kèm câu "Flow tối đa 30 bước (do quản trị nền tảng đặt)". Giới hạn mới áp cho lần sửa/xuất bản kế; def cũ vượt giới hạn vẫn chạy, chỉ không xuất bản lại được cho tới khi rút gọn.

**FLOW3-FR-04 Kéo node từ bảng mẫu.** Given bảng loại node; When kéo một loại thả lên canvas; Then node mới xuất hiện ĐỨNG RIÊNG tại điểm thả (không tự nối, không tự chèn kể cả thả lên một cạnh) kèm gợi ý "Kéo mũi tên để nối bước này"; When kéo mũi tên từ đầu ra của bước trước tới node; Then node được nối (sai luật, vd Bắt đầu khi → Ký số ⇒ từ chối kèm toast lý do giữa-trên, tự đóng 4 giây); chèn giữa A→C chỉ bằng nút "+" trên cạnh; Lưu / Lưu và áp dụng khi còn node chưa nối ⇒ chặn: "Bước «X» chưa được nối — kéo mũi tên từ bước trước tới bước này", node viền lỗi, bấm thông báo cuộn tới và chọn bước.

**FLOW3-FR-05 Nối lại và xoá.** When kéo đầu một cạnh sang node khác; Then cạnh nối lại nếu hợp lệ. When chọn node/cạnh rồi nhấn Delete; Then bị xoá, các cạnh vào/ra node được nối liền (A→B→C xoá B ⇒ A→C) hoặc báo nếu không nối liền hợp lệ được.

**FLOW3-FR-06 Hoàn tác / làm lại.** When thực hiện N thao tác rồi Ctrl+Z; Then trạng thái về trước thao tác cuối; Ctrl+Y áp lại. Lịch sử theo phiên mở trình sửa (đóng là mất), tối đa 100 bước.

**FLOW3-FR-07 Chọn nhiều, kéo nhóm, nhân đôi.** When chọn nhiều node (kéo khung hoặc Shift+nhấn) rồi kéo; Then cả nhóm di chuyển. When Ctrl+C rồi Ctrl+V; Then nhân bản node (kèm cạnh giữa chúng), đặt lệch, bị chặn nếu vượt giới hạn bước.

**FLOW3-FR-08 Điều hướng nhanh.** Có minimap, phóng/thu, "Tự xếp bố cục" (một nhấn, hoàn tác được), bảng phím tắt (phím ?). Mỗi thao tác kéo-thả có cách làm bằng bàn phím/ô chọn tương đương.

**Thả sai (áp cho FR-01, 04, 05, 07).** Given thao tác vi phạm luật hợp lệ; When thả; Then không đổi gì, hiện lý do, ví dụ: "Bước tiếp theo phải nằm sau bước này", "Nhánh Đúng/Sai không nối được tới bước thực hiện hành động", "Bước Ký số cần một bước duyệt của người ngay trước", "Đã đạt tối đa 22 bước".

## Không làm (non-goals)
- Không đổi mô hình `FlowDef`, engine chạy flow, hay lượt đang chạy.
- Không sửa nhiều người cùng lúc, không lịch sử phiên bản qua phiên sửa (hoàn tác chỉ trong phiên).
- Không thêm loại node mới; không đụng DLC của Rowan.

## Quyết định (mặc định, người dùng 2026-11-07 chốt "làm hết")
- Trần cứng 50 bước; mặc định 22; cài đặt nằm ở cài đặt platform (không theo công ty).
- Lịch sử hoàn tác theo phiên sửa, không lưu DB.
- Luật hợp lệ ở một module dùng chung cho ô chọn, kéo-thả và kiểm khi xuất bản (một nguồn).

## Soát UX theo góc nhìn giám đốc/sale (2026-11-07) — `ux-audit.md` (33 điểm) + quyết định người dùng
Nguyên tắc (người dùng): "mô hình đơn giản dễ hiểu mà đủ mạnh; người dùng chỉ là sale hoặc giám đốc công ty; đúng trên góc nhìn đó ở bề nổi".
- **FLOW3-FR-09 · Công tắc "Dùng quy trình mới":** chỉ quản trị công ty (tenant admin) thấy; người dùng khác của công ty không thấy.
- **FLOW3-FR-10 · Một nút cho công ty:** bản quy trình của công ty chỉ có "Lưu và áp dụng" (áp dụng cho HĐ gửi từ giờ; HĐ đang chờ giữ bản cũ). "Xuất bản" chỉ còn cho mẫu Thư viện của nền tảng.
- **FLOW3-FR-11 · Một nơi chọn quy trình:** chỉ ở admin "Công ty › Quy trình". App Hợp đồng chỉ hiện quy trình đang áp dụng (chỉ đọc) + nút "Mở trang Quy trình"; gỡ màn sửa "luật chọn quy trình" trong app (D6: một control cho một việc).
- **FLOW3-FR-12 · Menu "+" chỉ bước nghiệp vụ:** Duyệt, Nếu, Ký số, Chờ ký xong, Thông báo, Kết thúc. Agent, Công cụ, Chuẩn bị dữ liệu, Dify, DLC… vào "Nâng cao", chỉ quản trị nền tảng thấy.
- **FLOW3-FR-13 · Chữ nghiệp vụ, không lộ kỹ thuật:** áp các đề xuất Chặn/Cao của `ux-audit.md` (panel Công cụ/Chờ sự kiện ẩn mã, Nếu đọc thành câu, Duyệt chọn từ danh sách không gõ mã, Ký số một nơi chọn nhà cung cấp, Kết thúc nói ảnh hưởng tới HĐ, lỗi chỉ đúng bước + cách sửa, thống nhất từ: Quy trình · Bước · Duyệt/Từ chối/Trả lại · Phòng ban, thẻ duyệt 3 dòng trạng thái · lý do · bước kế, "Cần xử lý" một chữ).

- **FLOW3-FR-14 · Node của app luôn là MỘT node trên sơ đồ** (người dùng 2026-11-07: "m tách node mà không xem lại à"): node module có nhiều stage bên trong (Ký số = gửi + chờ; sau này Gửi đối tác xác nhận) hiện **một ô** với các đầu ra theo kết quả nghiệp vụ (Ký số: Ký xong · Từ chối · Hết hạn), **một panel** cấu hình (người ký, nhà cung cấp, hạn ký, nhắc), menu "+" chỉ một mục (bỏ "Chờ ký xong" riêng). Xoá / sao chép / kéo đi cả cụm; validator chặn cụm bị tách hoặc thiếu stage. Không migration: def đã lưu có `node` (hub 0113) tự gộp. Nghiệm thu: Given flow mẫu "Duyệt theo giá trị" mở trên canvas Then thấy đúng một ô Ký số có 3 đầu ra; When kéo đầu ra "Từ chối" tới Kết thúc · Từ chối Then nhánh từ chối của phần chờ đổi theo; When xoá ô Ký số Then cả hai stage bị xoá, Ctrl+Z khôi phục cả hai; Given menu "+" của công ty Then không có mục "Chờ ký xong".

## Chia lát
- **u3 (sau p25, cùng vùng canvas):** FLOW3-FR-14 + soát mọi node module đang hiện tách đôi.
- **p22 (đã gộp):** FR-01, FR-02, FR-03 (kèm luật hợp lệ dùng chung).
- **u1 (admin-web trình soạn + Công ty › Quy trình):** FR-09, FR-10, FR-12, FR-13 phần A/B của ux-audit.
- **u2 (app Hợp đồng):** FR-11, FR-13 phần C của ux-audit.
- **p25:** FR-04..FR-08 + thông báo thả sai; làm sau p22 gộp (cùng vùng trình sửa). UI một đợt, đóng băng sau đó (Luật 0d.4). e2e hành trình một lần cuối.

## Rủi ro
- **Hiệu năng canvas lớn:** tới 50 node + cạnh; kiểm kéo nhóm mượt (mục tiêu ≥ 50 khung/s ở 50 node), tính luật hợp lệ theo tập, không tính lại toàn bộ mỗi chuyển động chuột (chỉ khi thả/đang kéo qua đích).
- **Truy cập bàn phím (a11y):** mọi thao tác kéo có cách tương đương bằng bàn phím và ô chọn; thông báo lý do thả sai qua vùng đọc màn hình (aria-live).
- **Hai nguồn luật:** nếu luật kéo-thả tách khỏi ô chọn sẽ lệch ⇒ bắt buộc dùng chung module, có unit test cho cả hai đường.
