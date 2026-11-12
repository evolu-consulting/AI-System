# fix-j2-partners — «Chọn đối tác» khi duyệt đơn tham gia Bảng tin thiếu đối tác chưa có HĐ (CR-130, e2e J2 đỏ)

## Nguyên nhân
Web (`modules/community/adapters/http.ts` `listParties`) lấy danh sách từ `GET /pack/contracts/partners?role=all` = **bảng điểm uy tín** (`partners.usecase` → `partnersOf`), dựng từ HĐ đã duyệt (`partners-data.repo.ts` `factsJson`). Đối tác chỉ có hàng `partner_roles` (nhập tay, chưa HĐ — đúng như e2e J2 `makePartner`) không bao giờ có trong đó, dù RLS (0024: `created_by` = người xem) cho thấy. Không phải lỗi RLS/`partner_roles`, không do p3b/fix-join-admin. Bản chất: web gọi nhầm endpoint (bảng điểm) cho nhu cầu «sổ đối tác».

## Sửa
- Web: `listParties(q?)` gọi `GET /pack/contracts/partners/search?limit=50[&q=]` (sổ đối tác = vai ∪ danh bạ, một câu, dưới RLS M1; trần 50 theo contract). Danh sách đầy (≥ 50) ⇒ gõ từ khoá thì hỏi máy chủ theo tiền tố; chưa đầy ⇒ lọc tại máy như cũ. Không đổi API/contract/RLS.
- Test: `packs/contracts/adapters/partner-book-list.int.test.ts` (đối tác nhập tay chưa HĐ: KHÔNG có ở `GET /partners`; CÓ ở `/partners/search` cho người thêm + tìm tiền tố; tenant khác không thấy).

## Cho qc (không sửa e2e)
`e2e/community-web/cr130-journey.cs.ts:~210` `waitForResponse(r => r.url().includes("/pack/contracts/partners"))` vẫn khớp URL mới (`/pack/contracts/partners/search?...`) và đọc mảng `{party,name,…}` ⇒ không cần đổi; nếu muốn chặt hơn nên đổi thành `/pack/contracts/partners/search`. Không phát hiện chèn dữ liệu sai: `partner_roles` + `created_by` đúng như UI.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Gắn đơn tham gia với đối tác có sẵn chọn từ sổ đối tác
Ô «Gắn với đối tác có sẵn» liệt kê sổ đối tác Sổ Hợp Tác mà người duyệt được thấy, gồm cả đối tác nhập tay chưa có hợp đồng nào; không lấy từ bảng điểm uy tín.
- Kịch bản: khi đối tác nhập tay chưa có HĐ thì không có trong bảng điểm nhưng có trong sổ đối tác của người thêm [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-book-list.int.test.ts » «Chọn đối tác»]
