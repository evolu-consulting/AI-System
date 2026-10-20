---
id: V2-F
title: Hợp đồng UI v2 (danh sách · form nhập tay/xác nhận · chi tiết + dòng thời gian mốc) — contracts-web
lane: nhanh (UI; phần backend chỉ thêm khoá tuỳ chọn cho dòng hàng + `start_date` ở `progress`, không RLS/tiền/migration)
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf §3.1, §4.2, §5.5, §5.7e · intake HD-01/03/04/09/10/11, 5.5a, 5.7e, C10, C12
design: docs/platform/ba-v2/mockup-niti.html (chỉ đọc bố cục/màu/chữ; đã dựng bằng Playwright để so)
---
# V2-F — tasks

## Plan (đã làm)
| # | Việc | Trạng thái |
|---|---|---|
| 1 | API (nhỏ): `POST /contracts/manual` nhận `product_id` + `component_ids` từng dòng (SP không có/tenant khác ⇒ 422 `PRODUCT_INVALID`); `progress[].start_date` | ✔ |
| 2 | Danh sách: nút «Thêm thủ công» + «Upload hợp đồng»; cột Hợp đồng · Đối tác · Loại · Giá trị · Hiệu lực · Giai đoạn (+ bước hiện tại, đỏ khi quá hạn) · Thao tác (Xem; Xoá ẩn tới V2-M); bấm hàng mở HĐ | ✔ |
| 3 | Form dùng chung (`features/contract-form`): thanh Huỷ/Lưu dính, 3 ô loại, ô bắt buộc viền đỏ, đối tác + điểm uy tín / «Đối tác mới · sẽ tạo khi lưu» (V2-C), bảng dòng + «Sản phẩm trong danh mục» + thành phần (V2-B), giá trị tự cộng, «Bán vượt tồn» | ✔ |
| 4 | Chi tiết (`contract-review`): Thông tin (loại khoá, PATCH ô đã đổi) · Sản phẩm (Nhập/Xuất kho) · Dòng thời gian (`contract-milestones`) · Tóm tắt; «Ghi việc» (HD7) cuối trang | ✔ |
| 5 | Bước xác nhận sau upload (`needs_review`) dùng cùng lưới ô + thanh dính (Huỷ = trả về giá trị đã lưu, Lưu = PATCH, «Xác nhận» của HD3) | ✔ (xem "Việc còn lại" cho dòng SP) |
| 6 | Test: unit (form-model, detail-form/stock/suggest, timeline/milestone-form, row-view/summary), int `tests/acceptance/V2-F`, e2e `v2f-form/list/detail.cw.ts` + 10 cảnh mới; relock tệp e2e đã đổi — lý do «CR-096 V2-F» | ✔ |

## Quyết định trong lúc làm
- Nhãn nút lấy đúng từ khoá có sẵn «Huỷ» (không «Hủy») để khỏi đổi chuỗi chung; «Thêm thủ công» + «Upload hợp đồng» thay «Nhập tay» + «+ Thêm hợp đồng».
- Đối tác nằm ở bên bán khi Mua, bên mua khi Bán/Giới thiệu (V2-A) — dùng chung cho form, PATCH, danh sách, tóm tắt (`contract-form/lib/deal.ts`, `detail-form.ts`).
- Ô bắt buộc: Tên, Đối tác, Hiệu lực từ; Giới thiệu thêm «% hoa hồng» **hoặc** số tiền cố định (không có «Giá trị»). Dòng có tên mà chưa gắn SP ⇒ chặn lưu (5.5a).
- Giá trị trống ⇒ placeholder «Tự tính: …» và gửi tổng SL × đơn giá các dòng tính được; gõ tay thì thắng. Tính ở client (hiển thị) và gửi số cụ thể (API không đổi).
- Gợi ý SP: rời ô tên mà chưa chọn ⇒ `POST /products/match`; có gợi ý ⇒ chọn sẵn + nhãn «Gợi ý» (kèm thành phần), không ⇒ «Tạo sản phẩm mới» (tên dòng, nhóm Hàng hoá; Giới thiệu ⇒ nhóm Giới thiệu). Gợi ý đến muộn không đè lựa chọn tay; sửa tên sau gợi ý ⇒ chọn lại.
- «Tạo sản phẩm mới»: `POST /products` từng dòng TRƯỚC khi lưu HĐ (HĐ Mua ⇒ NCC chính = đối tác, 5.5d). Lỗi giữa chừng có thể để lại SP đã tạo (SP không gắn HĐ vô hại; xoá SP là V2-M).
- Tồn + «Bán vượt tồn»: chỉ thành phần giữ hàng (`stock`/`quota`); SP nhiều thành phần cần chọn thành phần mới biết tồn; chỉ cảnh báo ở HĐ Bán (BA 5.7e) và KHÔNG chặn lưu.
- Dòng thời gian: nút Ký HĐ → mốc theo hạn (bỏ mốc huỷ) → Hết hiệu lực; bước hiện tại = `next_milestone_id` (đỏ «quá hạn n ngày» khi hạn < hôm nay theo giờ máy); tiến độ n/m bỏ «Nhắc gia hạn». Bút sửa + «Xoá mốc» chỉ ở mốc chưa xác nhận; viewer chỉ xem.
- «Xác nhận xong»: hỏi ngày thực tế (mặc định hôm nay); ngày > hạn ⇒ hỏi «lỗi của ai» (Đối tác / Phía mình / Chưa rõ, mặc định Đối tác) và gửi `settle {at, fault}`; không trễ thì không gửi `fault`. Mô tả điểm chỉ nói «chỉ lỗi đối tác mới trừ điểm» (bảng điểm chi tiết là V2-E).
- Hộp Thêm/Sửa mốc: SL chỉ Giao hàng, số tiền chỉ Thu tiền/Thanh toán/Nhận hoa hồng (khớp luật 422 của V2-A); đổi loại ⇒ việc của ai theo mặc định của loại (`defaultOwner` ≡ máy chủ), tên theo loại nếu chưa tự sửa. Số tiền để trống giữ trống (5.4a chia tự động) — sửa mốc không biến số tự chia thành số đã ghi.
- Tóm tắt: chưa có API tóm tắt AI ⇒ chỉ nêu điểm chính suy từ dữ liệu đã lưu + cảnh báo của agent (không bịa câu chữ). Cảnh báo chuyển từ đầu trang xuống khối này.
- Danh sách cần ngày bắt đầu ⇒ thêm `start_date` vào `ContractProgress` (SQL đã chọn sẵn cột này; không đổi `ListRow` đã khoá). Test khoá `V2-A/money.int.test.ts` cập nhật đúng 1 dòng kỳ vọng.
- Sticky: thanh `FormBar` dính ở đỉnh vùng cuộn của Shell (`-top-7`, bù padding `main`); chỉ dùng ở form nhập tay và bước xác nhận. Trang chi tiết thường dùng tiêu đề thường + «Lưu thay đổi» ở đầu khối Thông tin (theo mockup).
- Dọn: bỏ `ReviewFields`, `ItemRows`, `new-form`, nhãn `contracts.newContract.*` / `review.fields.*`; chuỗi mới ở `v2f.{vi,en}.json` (`contracts.cform.*`, `contracts.cdetail.*`).
- C10: KHÔNG làm đổi thứ tự hiển thị mốc và dời hạn (mockup vượt BA, C10 «BA thắng»); mốc luôn theo hạn tăng dần như API.

## Kiểm
- Unit contracts-web + i18n + hub-api mapper/rules: 185+ pass (local).
- e2e contracts-web local (Windows): `v2f-form/list/detail` + `hd2/hd3/hd4/hd5` + `scenes` (31 cảnh) xanh; baseline `win32` chụp lại đúng các cảnh đổi + 10 cảnh mới; baseline `linux` chụp ở evotest (`-Step e2e -Capture cw`).
- int evotest: `V2-F/manual-items` + `V2-A` (xem kết quả cuối báo cáo của lát).

## Việc còn lại (lát sau)
- **Gắn/sửa SP của dòng HĐ đã lưu (xác nhận sau upload)**: API đọc chưa trả `product_id/component_ids` và chưa có lệnh sửa dòng ⇒ bảng «Sản phẩm» ở chi tiết chỉ xem. Làm cùng V2-G (upload ⇒ Lưu) vì C12 khoá dòng sau lưu.
- Sửa % hoa hồng sau lưu (ô đang khoá; cần PATCH riêng) ⇒ V2-G/V2-L.
- Nút Xoá HĐ ở danh sách (đảo sổ kho/giá vốn) ⇒ V2-M.
- Điểm +/- từng mốc ở dòng thời gian (mockup `dl`) và thông báo «kho X: a → b» ⇒ V2-E / V2-D.
- Tóm tắt viết bằng AI ⇒ V2-G.
