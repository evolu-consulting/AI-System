# P4b · Cài đặt chung › Cá nhân [CM]

Thuộc `index.md` (CR-106), khung ở `P4a-cai-dat-khung.md`. Mã: **COM-FR-39**. Nguồn dữ liệu và quyền: community (người dùng tự chỉnh của mình).

## 1. Mục tiêu
Giữ ba mục của `Settings.tsx` (Tài khoản, Giao diện, Thông báo), đổi "Giao diện" từ màu theo người sang **hiển thị màu công ty** (Q3).

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục: Cài đặt chung › Cá nhân (Tài khoản · Giao diện · Thông báo).

## 3. Nghiệp vụ
| # | Mục | Nội dung | Nhãn | Nguồn |
|---|---|---|---|---|
| N1 | Tài khoản | Tiêu đề "Tài khoản"; lead "Thông tin đăng nhập của bạn trong {orgName}."; ô chỉ đọc "Họ tên", "Công ty" | Giữ | `Settings.tsx:80-94` |
| N2 | Giao diện | Bỏ 5 ô màu "Màu chủ đạo" (Chàm, Xanh dương, Xanh ngọc, Xanh lá, Cam). Thay bằng: hiển thị chỉ đọc màu + logo công ty đang áp dụng, kèm ghi chú "Màu do công ty thiết lập" (nhãn chốt). Chủ quản `contracts-owner` có link tới Công ty › Màu chủ đạo (P4c) | Đổi | cũ `Settings.tsx:14-20,96-117`; `ctx.tsx:55-65` (`community.accent`) |
| N3 | Giao diện | Chỉ hiển thị màu + logo công ty và dòng "Màu do công ty thiết lập"; **không hiển thị theme** Sáng/Tối (endpoint brand không trả `theme`; theme tối ngoài phạm vi bản đầu, P0 D13). Nếu sau muốn hiển thị theme: thêm `theme` vào `GET /pack/community/brand` (ngoài phạm vi bản đầu) | Đổi | `pack-contracts/company.ts:8`; P5 §5.1 |
| N6 | Tài khoản | Hàng "Ngôn ngữ" (Tiếng Việt · English), lưu `localStorage` `community.lang`; mặc định theo `navigator.language`, rơi về VI (P5 I4) | Mới | P5 COM-FR-46 |
| N4 | Thông báo | 8 công tắc, mỗi công tắc lưu ngay + toast "Đã lưu cài đặt"; đối tác chỉ thấy các loại không phải chủ quản | Giữ | `Settings.tsx:21-31,49,119-139` |
| N5 | Dọn dẹp | Bỏ `accent` khỏi `CommunitySettings` và `localStorage community.accent`; dữ liệu cũ bỏ qua khi đọc (không migrate) | Đổi | `Settings.tsx:37`; contract `CommunitySettings` |

## 4. Điều hướng & trạng thái
Mục mặc định khi mở dialog: Tài khoản. Trạng thái: tải (`getSettings`) · lỗi tải (giữ mặc định, `Settings.tsx:39-43`) · lưu (optimistic + toast).

## 5. Dữ liệu / Contract
`CommunitySettings = { notify: Record<NotifyKind, boolean>, accent }` → bỏ `accent` (mặc định P0 D8: server để `accent` optional và bỏ qua khoá lạ, không 422 client cũ; backend-lead hiện thực khi code). `NOTIFY_KINDS` = comment, reply, newSell, newBuy, matchBuy, priceEdited, expiring, digest. Brand: P5 §3.

## 6. Quyền & cách ly
Mọi user community, chỉ chỉnh của chính mình. `HOST_ONLY` = newSell, newBuy, matchBuy, priceEdited, digest ẩn với đối tác (`Settings.tsx:31`). Không nhìn thấy/đặt cấu hình công ty ở nhóm này.

## 7. Nhãn VI / EN (EN đề xuất dịch, chờ duyệt)
| VI (verbatim `Settings.tsx`) | EN đề xuất |
|---|---|
| Tài khoản · Giao diện · Thông báo | Account · Appearance · Notifications |
| Thông tin đăng nhập của bạn trong {orgName}. | Your sign-in details in {orgName}. |
| Họ tên · Công ty | Full name · Company |
| Chọn khi nào bạn muốn nhận thông báo (chỉ trong ứng dụng). | Choose when you want to be notified (in-app only). |
| Có người bình luận bài của tôi / Thông báo ngay khi có bình luận mới. | Someone comments on my post / Get notified as soon as a new comment arrives. |
| Có người trả lời bình luận của tôi / Theo dõi các cuộc trao đổi đang diễn ra. | Someone replies to my comment / Follow ongoing conversations. |
| Nhà cung cấp đăng bài Cần bán mới / Chỉ chủ quản. | A supplier posts a new For-sale post / Host only. |
| Người mua đăng bài Cần mua mới / Chỉ chủ quản. | A buyer posts a new Wanted post / Host only. |
| Bài Cần mua khớp hàng đang có / Chỉ chủ quản. | A Wanted post matches stock you have / Host only. |
| Nhà cung cấp sửa giá bài đã lưu / Chỉ chủ quản. | A supplier edits the price of a saved post / Host only. |
| Bài sắp tự hết hạn (3 ngày) / Hỏi gia hạn hay lưu trữ. | A post is about to expire (3 days) / Ask to extend or archive. |
| Tổng hợp hằng ngày 8:00 / Bài mới, Cần bán chưa lưu. | Daily digest at 8:00 / New posts, unsaved For-sale posts. |
| Màu do công ty thiết lập | Colour is set by your company |
| Ngôn ngữ · Tiếng Việt · English | Language · Tiếng Việt · English |

## 8. Tiêu chí chấp nhận
| AC | Nội dung |
|---|---|
| P4b-AC01 | Mục Giao diện không còn ô chọn màu; không còn đọc/ghi `community.accent`. |
| P4b-AC02 | Màu giao diện của hai user cùng công ty giống nhau; user công ty khác thấy màu công ty họ. |
| P4b-AC03 | Bật/tắt công tắc Thông báo gọi `saveSettings` đúng loại, toast "Đã lưu cài đặt"; reload giữ giá trị. |
| P4b-AC04 | Đối tác chỉ thấy các loại không thuộc `HOST_ONLY`; chủ quản thấy cả 8. |
| P4b-AC05 | Hồ sơ cũ có `accent` trong DB vẫn đọc được (bỏ qua); client cũ gửi `accent` không bị 422. |
| P4b-AC06 | Đổi Ngôn ngữ ở Tài khoản đổi toàn bộ nhãn ngay, giữ sau reload. |

## 9. Mã truy vết
COM-FR-39 Cá nhân: Tài khoản · Giao diện (theo công ty) · Thông báo.

## 10. Việc còn mở
Đã chốt: N3 theo công ty (D13), tương thích `accent` (D8), ghi chú màu. Còn lại: duyệt nhãn EN — người dùng.
