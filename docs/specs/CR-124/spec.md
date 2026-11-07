---
id: CR-124
tên: Gửi đối tác xác nhận hợp đồng (liên công ty) + quy trình nhận theo mức quan trọng
mã yêu cầu: FLOW4-FR-01..17, FLOW4-NFR-01..04
trạng thái: Intake 2026-11-07 (người dùng chốt hướng + đồng ý thiết kế node/kênh/bên nhận "Yes, update spec"), chưa làm — làm SAU video demo CR-122/123
liên quan: CR-122 (sự kiện, node module FLOW2-FR-25, node Ký số), CR-123 FR-11 (một nơi chọn quy trình), CR-121 (hồ sơ công ty `admin.tenants`)
---
# CR-124 · Gửi đối tác xác nhận hợp đồng

## 1. Mục tiêu
Công ty A gửi một hợp đồng cho công ty B xác nhận ngay trong quy trình. B nhận bằng **quy trình nhận của chính B**, chọn theo **mức quan trọng** của tài liệu (giá trị cao ⇒ qua Giám đốc; thường ⇒ một người xác nhận). B chưa dùng nền tảng ⇒ người liên hệ của B nhận email, mở link xem và trả lời, không cần tài khoản. Kết quả quay về flow của A để rẽ nhánh như Ký số.

## 2. Người tham gia
| Ai | Làm gì |
|---|---|
| **Bên gửi** (A: sale, giám đốc, quản trị công ty) | Đặt node trong flow; chọn công ty nhận từ danh bạ, đối chiếu thông tin công khai; theo dõi trạng thái trên thẻ HĐ |
| **Bên nhận có dùng nền tảng** (B) | Quản trị B đặt luật "mức quan trọng ⇒ quy trình nhận"; người được giao xác nhận/trả lại/từ chối trên HĐ nhận |
| **Bên nhận chưa dùng nền tảng** (người liên hệ của B) | Mở link email, xem PDF + thông tin chính, bấm Đồng ý / Trả lại / Từ chối; được mời dùng nền tảng |
| **Quản trị nền tảng** | Cấp dấu "Đã xác minh" cho công ty trong danh bạ; xem nhật ký, chặn lạm dụng |

## 3. Node "Gửi đối tác xác nhận" (node module của contracts)
- Khai trong `contracts.manifest.ts › nodes[]` như `contracts.esign` (FLOW2-FR-25): nhóm "Đối tác", khoá tính năng `contracts-partner-confirm`; **2 stage**: tool `contracts-partner-send` (`real_action`) + `wait_event` `partner.confirmed` với `also_events: [partner.returned, partner.declined]`, `timeout_h` theo cấu hình (mặc định 168). Không executor mới.
- Cấu hình node (một panel, chữ nghiệp vụ): **Gửi cho** (đối tác của HĐ — mặc định lấy từ HĐ; đổi được trong danh bạ), **Mức quan trọng** (Thường / Quan trọng / Rất quan trọng; mặc định "Tự theo giá trị HĐ" — xem §6), **Gửi kèm** (PDF HĐ luôn có + chọn trường: giá trị, ngày hiệu lực, hạn thanh toán, sản phẩm), **Hạn trả lời** (ngày), **Lời nhắn**.
- **KHÔNG phải node kết thúc** (người dùng hỏi 2026-11-07): như Ký số, node gửi rồi tự chờ; có kết quả thì flow A **chạy tiếp** theo 4 nhánh rẽ được: **Đồng ý** (thường ⇒ Ký số → Kết thúc · Đã duyệt) · **Trả lại sửa** (lý do bắt buộc ⇒ về nhân viên phụ trách sửa rồi gửi lại: lần gửi mới, bên nhận thấy "bản sửa lần N") · **Từ chối** (⇒ Kết thúc · Từ chối) · **Hết hạn** (mặc định 7 ngày, nhắc trước 1 ngày ⇒ báo người phụ trách: Gửi lại / Ghi nhận thủ công / Dừng).
- **Một node, ba kênh, cùng 4 nhánh** — hệ thống **tự chọn kênh**, người soạn flow không chọn: (1) đối tác là công ty trên nền tảng đã nối ⇒ **nền tảng** (§7); (2) chưa trên nền tảng/không cho tìm thấy nhưng có email liên hệ ⇒ **email tự động** do hệ thống gửi (§8); (3) không có email ⇒ **ghi nhận thủ công** (§8b). Kênh đã chọn hiện trên thẻ ("gửi qua nền tảng" / "gửi qua email").
- Luật hợp lệ chung (CR-123): node là `real_action`; nhánh Nếu không trỏ thẳng tới nó; cần HĐ có tệp PDF (khác ⇒ lỗi khi lưu flow "Bước Gửi đối tác cần HĐ có tệp PDF").

## 4. Danh bạ công ty (công khai, tự nguyện)
- Nguồn: hồ sơ công ty `admin.tenants` (CR-121: `legal_name`, `tax_code`, `address`) — **không sao chép** sang bảng khác; danh bạ là **view/hàm chỉ đọc** trên các cột công khai.
- **Công khai chỉ:** tên pháp lý, MST, địa chỉ, tỉnh/thành, logo, dấu Đã xác minh. **Không bao giờ:** người dùng, email/điện thoại liên hệ, số liệu, hợp đồng.
- **Tự nguyện:** quản trị B bật "Cho phép công ty khác tìm thấy và gửi HĐ cho chúng tôi" ở Công ty › Hồ sơ (mặc định **Tắt**). Tắt ⇒ không hiện trong danh bạ; A vẫn gửi được qua email (§8).
- **Dấu Đã xác minh:** quản trị nền tảng cấp sau khi đối chiếu MST với tra cứu thuế (v1 tay; tự động là việc sau). Chưa xác minh ⇒ hiện nhãn "Chưa xác minh" + cảnh báo khi chọn.
- Tìm theo MST (khớp đúng) hoặc tên (≥ 3 ký tự); tối đa 20 kết quả; MST là khoá đối chiếu chính.

## 5. Nối đối tác (một lần)
**Quyết định mặc định:** lần gửi ĐẦU từ A tới B tạo **lời mời nối** kèm HĐ; B chấp nhận một lần ("Nhận HĐ từ công ty A") thì các lần sau vào thẳng quy trình nhận. B từ chối/chặn ⇒ A không gửi được qua nền tảng nữa (vẫn thấy lý do "Công ty B không nhận HĐ qua nền tảng — gửi qua email").
**Vì sao (so với quyết định 1):** quyết định 1 cho A tự chọn và đối chiếu — đủ để A chắc *đúng công ty*, nhưng không chặn được *spam/giả mạo phía nhận*. Một lần chấp nhận của B là lớp bảo vệ thứ hai, chỉ tốn một thao tác cho mỗi cặp công ty. Nối lưu ở danh bạ đối tác của B (`contracts` party theo MST), không thêm "một khái niệm đối tác" thứ hai (Luật GỐC 1).

## 6. Mức quan trọng ⇒ quy trình nhận
- **Ai đặt:** A gửi kèm *gợi ý* mức (node §3). **B quyết định cuối**: luật của B tính lại từ dữ kiện chung (giá trị, loại HĐ, đối tác mới) — B không phải tin mức A tự khai. Mức cuối = **max(gợi ý A, mức theo luật B)**.
- **Luật của B** nằm ở **Công ty › Quy trình** (cùng chỗ CR-123 FR-11, không màn riêng): đó chính là các flow Bắt đầu khi *Khi nhận HĐ từ đối tác* (`contract.received`) với điều kiện trên dữ kiện `importance`, `total_value`, `contract_type`, `new_partner`, `sender_verified`. Ví dụ mẫu Thư viện cấp sẵn khi bật tính năng:
  - "Nhận HĐ quan trọng": `importance ≥ Quan trọng` ⇒ Duyệt (Kế toán) → Duyệt (Giám đốc) → Kết thúc · Đồng ý.
  - "Nhận HĐ thường" (không điều kiện, cuối danh sách): Duyệt (một người, phòng Kinh doanh) → Kết thúc · Đồng ý.
- Sự kiện `contract.received`: `required` + `decides` (H1: flow khớp đầu tiên theo thứ tự quyết). Ngưỡng mức theo giá trị đặt trong cùng màn (mặc định Quan trọng ≥ 500 triệu, Rất quan trọng ≥ 2 tỷ).
- Kết thúc của flow nhận có `outcome`: **Đồng ý / Trả lại / Từ chối** ⇒ `OutcomeHandler` của contracts gửi kết quả về A (§7).

## 7. Cái gì đi qua ranh giới công ty, và giữ cách ly thế nào
- **Chỉ một bản chia sẻ:** PDF (bản chụp lúc gửi, băm SHA-256) + các trường A chọn + tên công ty A + lời nhắn. **Không bao giờ** dòng `contracts.*` của A, id nội bộ, người dùng, lịch sử duyệt của A.
- **Bên nhận có bản ghi riêng**: "HĐ nhận từ đối tác" (`contracts.contracts`, `source='partner_inbox'`) trong tenant B, RLS của B; B sửa ghi chú/tệp riêng không ảnh hưởng A. Tệp PDF chép vào FileBox của B.
- **Hộp thư liên công ty** (bảng nền tảng `hub.partner_mailbox`, KHÔNG có policy SELECT cho role gói/ người dùng): một dòng mỗi lần gửi `{id, from_tenant, to_tenant | to_email, payload jsonb (bản chia sẻ), file_ref, status, outcome, reason, expires_at, token_hash}`.
- **Chỉ qua hàm SECURITY DEFINER** (search_path cố định, kiểm `app.tenant_id` như `hub.emit_flow_event`):
  1. `hub.partner_send(...)` — gọi trong tx của A; chỉ ghi `from_tenant = tenant hiện tại`; kiểm B cho phép (§4) + nối (§5) + hạn mức; trả id.
  2. Bộ chuyển (job hệ thống, `FOR UPDATE SKIP LOCKED`, theo lô) mở tx **trong scope tenant B** ⇒ tạo HĐ nhận + `emit_flow_event('contract.received')` cùng tx (idempotent theo `mailbox.id` = `event_id`).
  3. `hub.partner_reply(mailbox_id, outcome, reason)` — gọi trong tx của B (từ OutcomeHandler) hoặc từ trang email (§8); chỉ được khi `to_tenant = tenant hiện tại` (hoặc token hợp lệ); bộ chuyển phát `partner.confirmed|returned|declined` vào tenant A ⇒ node §3 đi tiếp.
- **Không có SELECT chéo tenant** ở bất kỳ đâu; mỗi bên chỉ đọc trạng thái lần gửi của mình qua hàm `hub.partner_mailbox_mine()` (lọc theo tenant hiện tại, chỉ trả cột trạng thái).

## 8. Đường email (bên nhận chưa dùng nền tảng)
- Người nhận = liên hệ đối tác trong HĐ (`partner_contacts`, có email); A xác nhận email trước khi gửi.
- Link chứa **token ngẫu nhiên 256-bit** (chỉ lưu băm), một lần gửi một token, hết hạn = Hạn trả lời (≤ 30 ngày); bấm trả lời xong ⇒ token chỉ còn xem (7 ngày) rồi hết.
- Trang xem (không đăng nhập, `noindex`, không lộ id): tên + MST công ty gửi (dấu Xác minh), PDF xem trong trang, các trường được gửi, lời nhắn, hạn; ba nút **Đồng ý · Trả lại (bắt buộc lý do) · Từ chối**; ô tên + chức vụ người trả lời; cuối trang "Dùng nền tảng để nhận HĐ theo quy trình công ty bạn" (mời).
- Chống lạm dụng: tối đa 30 lần mở/giờ/token, 5 lần gửi lại/HĐ/ngày, 200 email đối tác/công ty/ngày (cấu hình nền tảng); captcha không dùng (link riêng).
- **Nhật ký:** mỗi lần mở/trả lời ghi thời điểm, IP rút gọn (/24), user-agent, tên + chức vụ người trả lời, băm PDF — hiện cho A ở lịch sử lần gửi. Ghi rõ "Xác nhận qua email, không phải chữ ký số".

## 8b. Ghi nhận kết quả thủ công (kênh 3, và dự phòng cho kênh 1–2)
- Thẻ HĐ của A luôn có nút **"Ghi nhận kết quả đối tác"** khi lần gửi đang chờ (cả khi gửi qua nền tảng/email — đối tác có thể trả lời bằng điện thoại, email riêng, bản giấy). Chỉ người phụ trách HĐ / quản trị gói.
- Người ghi chọn **Đồng ý / Trả lại / Từ chối**, nhập lý do (bắt buộc với Trả lại/Từ chối), **đính kèm bằng chứng** (ảnh email, biên bản; ≥ 1 tệp khi kênh là thủ công), ghi "người bên đối tác trả lời: tên · chức vụ".
- Ghi xong ⇒ cùng đường `hub.partner_reply` (nguồn `manual`, người ghi = người dùng A) ⇒ flow A đi tiếp đúng nhánh; lần gửi qua nền tảng/email còn mở bị đóng ("đã ghi nhận thủ công"), bên nhận thấy trạng thái đó.
- Lịch sử ghi rõ "Ghi nhận thủ công bởi <người A> lúc <giờ> · bằng chứng". Không là chữ ký số.

## 8c. Phía công ty nhận (có dùng nền tảng)
- **Hộp "Hợp đồng đối tác gửi"** trong app Hợp đồng (mục riêng ở thanh trái): mỗi dòng = công ty gửi (dấu Đã xác minh) · tên HĐ · mức quan trọng · hạn trả lời · bước nội bộ hiện tại.
- Mở một dòng ⇒ trang HĐ nhận (bản ghi riêng của B, §7) với thẻ duyệt của quy trình nhận; lời mời nối lần đầu hiện ngay đầu trang (§5).
- **Trả lời tự động, không thêm node:** Kết thúc của quy trình nhận tự thành câu trả lời: Kết thúc · Đồng ý ⇒ Đồng ý; Trả lại ⇒ Trả lại sửa (kèm lý do người duyệt ghi); Từ chối ⇒ Từ chối. Không có node "Trả lời đối tác" riêng (một khái niệm ít hơn).
- Mẫu Thư viện 3 quy trình nhận theo mức: **Thường** (một người xác nhận) · **Quan trọng** (Trưởng phòng → Giám đốc) · **Rất quan trọng** (Trưởng phòng → Pháp chế → Giám đốc, có thể thêm Ký số); công ty dùng mẫu hoặc sửa ở Công ty › Quy trình.

## 9. Trạng thái trên thẻ (3 dòng: trạng thái · lý do · bước kế)
| Thẻ | Ví dụ |
|---|---|
| A (HĐ gửi) | "Chờ Công ty B xác nhận · gửi 07/11, hạn 14/11 · B đang duyệt nội bộ (bước 2/3)" — chỉ số bước, không tên người của B |
| A khi xong | "Đối tác đã trả lại · Lý do: sai đơn giá mục 3 · Sửa HĐ rồi gửi lại" |
| B (HĐ nhận) | "Chờ Giám đốc xác nhận · HĐ 2,1 tỷ từ Công ty A (Rất quan trọng) · Mở để Đồng ý / Trả lại / Từ chối" |
| B chưa nối | "Công ty A muốn gửi HĐ cho bạn · lần đầu · Nhận HĐ từ công ty A / Chặn" |
Thông báo: chuông + email cho người được giao ở B; chuông cho người gửi ở A khi có kết quả / còn 1 ngày tới hạn / hết hạn.

## 10. Yêu cầu và nghiệm thu
- **FLOW4-FR-01 Node gửi.** Given flow A có node Gửi đối tác xác nhận sau Duyệt; When HĐ duyệt xong; Then một lần gửi tạo trong hộp thư, thẻ A "Chờ Công ty B xác nhận".
- **FLOW4-FR-02 Rẽ theo kết quả.** Given lần gửi đang chờ; When B Đồng ý / Trả lại / Từ chối hoặc quá hạn; Then flow A đi đúng nhánh Đồng ý / Trả lại / Từ chối / Hết hạn, lịch sử ghi người + lý do.
- **FLOW4-FR-03 Danh bạ.** Given B bật cho phép tìm thấy; When A tìm theo MST B; Then thấy đúng một dòng tên · MST · địa chỉ · dấu xác minh; B tắt ⇒ không thấy.
- **FLOW4-FR-04 Chỉ thông tin công khai.** Given bất kỳ truy vấn danh bạ; Then không có cột người dùng/liên hệ/số liệu (test hợp đồng API).
- **FLOW4-FR-05 Cảnh báo chưa xác minh.** When A chọn công ty chưa xác minh; Then hiện "Công ty này chưa được nền tảng xác minh — đối chiếu MST trước khi gửi" và phải bấm xác nhận.
- **FLOW4-FR-06 Nối một lần.** Given A chưa nối với B; When A gửi; Then B thấy lời mời; B chấp nhận ⇒ HĐ vào quy trình nhận, lần sau không hỏi; B chặn ⇒ A thấy lý do + gợi ý gửi email.
- **FLOW4-FR-07 Bản ghi riêng ở B.** When lần gửi tới B; Then B có "HĐ nhận từ đối tác" trong tenant B (PDF + trường đã chọn), A không có dòng nào ở B và ngược lại.
- **FLOW4-FR-08 Mức quan trọng.** Given B đặt ngưỡng Quan trọng ≥ 500 triệu; When A gửi HĐ 600 triệu với gợi ý Thường; Then mức cuối = Quan trọng, flow "Nhận HĐ quan trọng" chạy.
- **FLOW4-FR-09 Một nơi đặt luật nhận.** Luật nhận chỉ ở Công ty › Quy trình (flow sự kiện `contract.received`); app Hợp đồng chỉ đọc + "Mở trang Quy trình".
- **FLOW4-FR-10 Sự kiện bắt buộc.** Given B bật tính năng; Then luôn có ≥ 1 flow nhận Bật không điều kiện (chặn tắt kèm câu sửa, FLOW2-FR-20).
- **FLOW4-FR-11 Kết quả về A.** When flow B tới Kết thúc · Đồng ý; Then A nhận `partner.confirmed` (idempotent: webhook/job chạy lại ⇒ một lần).
- **FLOW4-FR-12 Đường email.** Given B không dùng nền tảng; When A gửi; Then liên hệ B nhận email link; trả lời trên trang ⇒ A đi nhánh tương ứng, lịch sử ghi "qua email · tên · chức vụ · giờ".
- **FLOW4-FR-13 Token.** Token hết hạn / đã dùng / sai ⇒ trang "Link đã hết hạn — liên hệ <tên công ty A>", không lộ nội dung; vượt hạn mức mở ⇒ 429.
- **FLOW4-FR-14 Thẻ 3 dòng + thông báo** như §9 ở cả hai bên.
- **FLOW4-FR-15 Tự chọn kênh.** Given B trên nền tảng và đã nối ⇒ kênh nền tảng; Given B không trên nền tảng có email ⇒ email tự động; Given không email ⇒ thẻ A "Chờ ghi nhận thủ công · đối tác chưa có email · Bấm Ghi nhận kết quả đối tác khi có trả lời".
- **FLOW4-FR-16 Ghi nhận thủ công.** Given lần gửi đang chờ ở bất kỳ kênh; When người phụ trách A ghi Trả lại + lý do + tệp bằng chứng; Then flow A đi nhánh Trả lại, lần gửi đóng "đã ghi nhận thủ công", lịch sử có người ghi + bằng chứng; người không phụ trách ⇒ không thấy nút.
- **FLOW4-FR-17 Gửi lại sau Trả lại.** Given A sửa HĐ sau nhánh Trả lại; When flow quay lại node gửi; Then lần gửi mới tới cùng đối tác, B thấy "bản sửa lần 2" + lý do lần trước, không tạo lời mời nối lại.
- **NFR-01 (cách ly)** test: role gói A/B không SELECT được `hub.partner_mailbox`; gọi `partner_send` với `from_tenant` khác ⇒ 42501; `partner_reply` sai tenant ⇒ 42501. **NFR-02 (idempotent)** khoá `mailbox.id` ⇒ chạy lại / 2 Hub vẫn một HĐ nhận, một sự kiện. **NFR-03 (perf)** bộ chuyển theo lô, số câu SQL cố định mỗi lô; tìm danh bạ một câu SQL p95 ≤ 20 ms (index MST, trigram tên). **NFR-04 (một nguồn)** danh bạ đọc `admin.tenants`, không bảng sao.
- **e2e hành trình (một lần cuối CR):** Demo gửi NiTi-test HĐ 600 triệu ⇒ NiTi chấp nhận nối ⇒ qua Kế toán + Giám đốc ⇒ Đồng ý ⇒ Demo sang Ký số; và gửi email cho công ty ngoài ⇒ Trả lại có lý do ⇒ Demo nhánh Trả lại.

## 11. Không làm
Không thay Ký số (xác nhận ≠ chữ ký số); không sửa chung một HĐ hai bên (đàm phán từng dòng); không tự xác minh MST qua API thuế (v1 tay); không chuyển tệp ngoài PDF; không đụng DLC của Rowan; không mạng đối tác Community (khác khái niệm `ext_org` của Community).

## 12. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Rò dữ liệu chéo tenant | hộp thư không SELECT, chỉ hàm DEFINER kiểm tenant; bản chia sẻ chỉ trường đã chọn; test NFR-01; Opus soát |
| Công ty giả (MST người khác) | dấu Xác minh do nền tảng cấp; cảnh báo chưa xác minh; nối một lần phía nhận; MST duy nhất trong danh bạ |
| Spam | danh bạ tự nguyện; nối một lần + Chặn; hạn mức gửi/ngày; email có "Báo lạm dụng" |
| Giá trị pháp lý | ghi rõ "xác nhận, không phải chữ ký số"; lưu băm PDF + nhật ký; HĐ cần pháp lý ⇒ nối tiếp node Ký số |
| Link email bị chuyển tiếp | token có hạn, hạn mức mở, ghi tên/chức vụ + IP; nội dung chỉ những gì A chọn gửi |

## 13. Kiểm an ninh
☐ Hộp thư không policy SELECT cho role gói/người dùng ☐ Mọi hàm DEFINER: `search_path` cố định, `REVOKE … FROM PUBLIC`, kiểm `app.tenant_id` ☐ Token 256-bit, lưu băm, so sánh thời gian hằng ☐ Rate limit mở/gửi ☐ Trang email `noindex`, CSP chặt, không id nội bộ ☐ PDF quét virus/kiểu MIME trước khi chép sang B ☐ Audit cả hai phía ☐ Danh bạ chỉ cột công khai (test hợp đồng) ☐ Không dữ liệu cá nhân trong URL ngoài token.

## 14. Chia lát (sau video demo CR-122/123)
| Lát | Nội dung | Model | Migration |
|---|---|---|---|
| q1 | Lõi liên công ty: `hub.partner_mailbox`, `partner_send/reply/mailbox_mine`, bộ chuyển, sự kiện, test cách ly + idempotent | **Opus** | hub `01xx` (giao số khi bắt đầu) |
| q2 | Danh bạ: cột "cho phép tìm thấy" + "đã xác minh" ở `admin.tenants`, hàm tìm, màn duyệt xác minh | **Opus** (RLS) + Sonnet UI | admin `00xx` |
| q3 | Node manifest + tool `contracts-partner-send`, HĐ nhận `source='partner_inbox'`, OutcomeHandler, sự kiện `contract.received`, mẫu Thư viện 2 flow nhận | Opus phần chạy, Sonnet manifest/editor | contracts `00xx`, hub `01xx` |
| q4 | UI: panel node, thẻ 3 dòng hai bên, lời mời nối, ngưỡng mức ở Công ty › Quy trình, thông báo, i18n | Sonnet | — |
| q5 | Đường email: token, trang xem, rate limit, mời, nhật ký | Opus token/rate limit, Sonnet trang + email | hub `01xx` |
| q6 | e2e hành trình §10 (một lần) + review/security cuối | Sonnet qc, Opus review | — |

## 15. Câu hỏi mở (mặc định đề xuất)
1. **Nối một lần phía nhận?** — Có (§5); tắt được bởi B ("nhận mọi HĐ từ công ty đã xác minh").
2. **Mức cuối do ai quyết?** — B: max(gợi ý A, luật B); B không thấy cách A tính.
3. **Hạn trả lời mặc định?** — 7 ngày, tối đa 30; nhắc khi còn 1 ngày; hết hạn ⇒ nhánh Hết hạn, B không trả lời được nữa.
4. **B có thấy bước/tên người duyệt của A, và A có thấy của B?** — Không; chỉ "bước x/y" và kết quả + lý do.
5. **Sau khi B Đồng ý, HĐ có bị khoá ở A?** — Không tự khoá; A nối node Ký số hoặc Kết thúc · Đã duyệt (khoá theo OutcomeHandler hiện có).
