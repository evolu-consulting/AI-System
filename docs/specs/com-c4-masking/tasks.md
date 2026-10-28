# com-c4-masking — Dò và che liên hệ lúc ghi (D4)

Đọc: `docs/current/community/nghiep-vu.md` §7; `hien-thi.md` mục 4 (HT-51…55).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C4 | **Đầy đủ** (lộ danh tính = rủi ro lõi; security review riêng) | Opus | community **0002** | C3 |

## Phạm vi
Dò SĐT (VN: 0xx, +84, có dấu cách/chấm), email, link Zalo/Facebook, website, MST (10/13 số), tên công ty khác (so danh sách `external_orgs`/đối tác, trừ chính công ty người viết). Ghi **raw + masked** lúc ghi (`posts`, `comments`); đường đọc của user ngoài chỉ select cột masked (không có raw trong JSON/SQL); chủ quản đọc raw. Nhắc người đăng (cờ `contactDetected` ở phản hồi ghi, không chặn). Dò theo tập (thuần, không gọi mạng). Không làm kiểm ảnh (C11).

## Xong khi
Unit: bảng mẫu dò/che (đa dạng định dạng, false-positive cơ bản như số lượng/giá không bị che). Int: HT-51…55 (một int tham số). Không e2e.

## Quyết định trong lúc làm
<!-- agent điền; chốt Chưa rõ nghiep-vu #4 (nguồn danh sách tên công ty) -->
**C4a (lát com-c4a-mask-rules, luật thuần — xong):** `apps/hub-api/src/modules/packs/community/domain/mask.rules.ts` (+ `.test.ts`, 97 ca, 10k ký tự ≈ vài ms). API: `scanContacts(text,{otherCompanies}) → Hit[]`, `maskText`, `stripContacts(text,hits)` (bỏ cả nhãn "SĐT:/Zalo" + dọn dấu câu), `maskContacts` → `{masked,hits,contactDetected}`. C4 (DB/route) chỉ gọi các hàm này.
- Offset tính trên `normalizeText` = NFKC (gộp NFC + chữ số full-width để không lách); mọi hàm tự chuẩn hoá lại. Trần `MAX_TEXT_LENGTH=100000`: quá ⇒ `RangeError` (đường ghi phải từ chối 4xx trước, không che nửa vời).
- Hit chồng nhau ⇒ gộp thành khoảng hợp (không lọt phần dư), kind theo thành phần dài nhất. Placeholder cố định `[đã ẩn: số điện thoại|email|liên kết|mã số thuế|tên công ty]`; che idempotent.
- SĐT: 10–11 số bắt đầu 0 / +84 / 84, phân cách dấu cách . - và ngoặc vùng; không dò khi số đứng sau `\d.`/`\d,`/`\d/` (giá, ngày), loại chuỗi có dạng ngày dd.mm.yyyy; hotline 1800/1900. MST: có nhãn (MST, mã số thuế/doanh nghiệp, tax code…) 10 hoặc 10-3/13 số — hit gộp cả nhãn; không nhãn chỉ khi dạng `10 số-3 số` hoặc 13 số liền bắt đầu 0. **10 số liền không nhãn bắt đầu 0 ⇒ coi là SĐT** (mơ hồ, vẫn che); 10 số không bắt đầu 0 không nhãn **không che** (đụng mã đơn/giá). Link: http(s)/www, zalo.me, facebook.com, fb.com/fb.me, m.me, t.me, wa.me, messenger, tiktok, instagram, linkedin, tên miền trần (.com .vn .com.vn .net .org .io …). Email có dạng `(at)/[at]`, `[dot]`.
- Tên công ty khác: danh sách do caller truyền (Chưa rõ #4 — nguồn danh sách: C4 quyết; thư viện chỉ nhận mảng, caller loại tên chính công ty người viết); khớp nguyên từ, không dấu/không phân biệt hoa thường, tên dài trước; bỏ tên < 3 ký tự (tránh che từ thường). Cache regex theo identity mảng (đừng mutate mảng, tạo mảng mới khi đổi).
- Không làm: số đọc bằng chữ ("không chín một…"), ký tự lạ thay chữ số (O thay 0), đọc ảnh (C11). Che theo luật là chặn lỡ tay/đi tắt thông thường, không chống cố ý lách tuyệt đối.

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §7 cuối đợt.
