# com-c5-feed-ui — App web Community: bảng tin và bài (CR-102)

Đọc: `docs/current/community/nghiep-vu.md` §3–5; `hien-thi.md`; UI: **bám đúng mockup** `docs/design/community/mockup-main.dc.html` (người dùng 2026-10-28: "làm lại UI như mockup"; nguồn https://claude.ai/artifact/NoueMJ9vMPSos621T3jbHt, board "Community · Bảng tin, Hồ sơ, Cài đặt", 1440×1200). Ngôn ngữ thiết kế: Roboto; nền `#f4f4f9`, thẻ `#fff`, viền `#e5e5ec`, chữ `#0f1020`/`#6b6c80`, nhấn chàm `#4f46e5` (hover `#4338ca`, nền nhạt `#eef2ff`), đỏ `#c81e1e`/`#fde8e8`, cam `#8a4306`/`#fdf0df`, xanh `#05603f`; thanh trên 60px (logo "S Sổ Hợp Tác · Community", ô tìm bo tròn, Bảng tin / chuông / cài đặt / avatar), bảng tin một cột giữa, ô soạn "Điền sẵn từ Sổ Hợp Tác", thẻ bài có menu ⋯ (Sửa / Lưu trữ / Xoá + xác nhận đỏ), thông báo dạng thả xuống, nút nổi "Hỏi trợ lý giá" mở khung chat có nguồn, Cài đặt chọn màu chủ đạo (Chàm, Xanh dương, Xanh ngọc, Xanh lá, Cam). Template `{{…}}` trong file là ô dữ liệu của canvas (mở bằng trình duyệt sẽ thấy khung, không có dữ liệu).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C5 | Nhanh | Sonnet | — | C3 |

## Phạm vi
App mới `apps/community-web` (Rsbuild + React + Tailwind, Câu 6; build + `check:bundle` trong lát). Màn: bảng tin (chủ quản = cung cầu tổng hợp; đối tác = bài chủ quản chia sẻ + bài mình), tạo/sửa (nhãn "đã sửa") / lưu trữ / bỏ lưu trữ / đánh dấu xong / xoá (xác nhận) / ẩn bài đối tác, form theo loại bài (trường bắt buộc), chọn người xem (D2), ≤ 10 ảnh + 2 video (Filebox), lọc chữ thường (loại, nhóm hàng, khu vực, khoảng giá, người đăng) + tìm tên SP, trang công ty (chủ quản: Bài của tôi + nút mở SHT sang contracts-web; đối tác: hồ sơ + bài), tự hết hạn 30 ngày + hỏi trước 3 ngày (vòng nền theo mẫu `esign-sweep`, theo tập, không sleep). COULD: gợi ý cập nhật bài cũ khi đăng trùng.

## Xong khi
Unit logic thuần (hạn, lọc). Một int mỗi endpoint mới (đường chính). e2e **viết, không chạy**. Typecheck + build + check:bundle của community-web.

## Quyết định trong lúc làm
Đợt 1 (2026-10-28, **contract-first, backend C3 chưa có**):
- Contract zod ở `packages/contracts/src/pack-community/*` (import `@ai/contracts/community`, không export từ root để khỏi trùng tên): `PostView` (server tính `actions[]`: edit/archive/unarchive/done/delete/hide/unhide/saveQuote; **saveQuote/hidden/hits/audience không có trong JSON user ngoài**), `FeedQuery/Response` (tab all|sell|buy|note|archived + cat/area/authorOrgId/q/mine, counts + facets), `Thread` theo (bài × công ty), `CommunityNotification`, `PartnerOrg`, `CommunityViewer` {role host_admin|host_member|partner, orgId, labels, cats}, settings (accent + bật/tắt thông báo).
- Route đề xuất cho C3 ghi ở `apps/community-web/src/api/client.ts` (mỗi hàm một route `/pack/community/*`). Adapter `http` là stub; `mock` (in-memory, seed demo, đổi persona A/M/S1/S2/B1/X ở thanh trên) chọn bằng `PUBLIC_COMMUNITY_API=mock|http` (mặc định mock).
- UI bám mockup: CSS chép nguyên từ `mockup-main.dc.html` (`styles/mockup.css`; màu nhấn → biến `--accent*`), 5 màu chủ đạo (Chàm, Xanh dương, Xanh ngọc, Xanh lá, Cam; bỏ Hồng của mockup công ty theo yêu cầu), Tailwind chỉ nạp theme + utilities (không preflight, giữ reset của mockup). Định tuyến hash (`#/feed|profile[/orgId]|settings`), không dùng TanStack Router (3 màn).
- Không i18n (chuỗi tiếng Việt trực tiếp) và không đăng nhập thật ở đợt này: "auth shell" = `getViewer()` của adapter; HTTP adapter sẽ dùng phiên cookie giống contracts-web (C3).
- Quy tắc hiển thị của mock ở `lib/visibility.ts` + `api/mock.ts` theo hien-thi.md; HT-30 (đối tác thấy bài mình bị ẩn) và HT-46 (bình luận bị ẩn không còn thấy) theo mặc định đề xuất. Che liên hệ (`lib/mask.ts`) chỉ là bản mô phỏng; C4 cài thật.
- Chưa rõ #5 (SSO sang contracts-web): nút "Mở Sổ Hợp Tác" là liên kết `shtUrl` do API trả (mock: `/contracts`, cùng origin ⇒ chung cookie); chốt cơ chế khi C3/C7 có.
- Soạn bài: người đăng sửa trên nội dung API trả; với đối tác đó là bản đã che (HT-52) ⇒ **vấn đề mở cho C3/C4**: cần endpoint trả raw cho chính tác giả khi sửa, hoặc chỉ sửa trường không bị che.
- Ảnh/video: chỉ nhãn giữ chỗ (≤ 10 ảnh, 2 video đã kiểm); Filebox nối ở lát sau.
- Placeholder "sắp có": nút Lưu báo giá (C7), gợi ý Sổ Hợp Tác dưới bài (C8), Trợ lý giá (C10; đối tác không có). Chưa làm: tự hết hạn 30 ngày/hỏi gia hạn (server C3, UI chỉ hiện nhãn "Hết hạn sau N ngày"), gợi ý đăng trùng (COULD), nút gia hạn.
- Việc còn lại: nối adapter http khi C3 xong; chạy `e2e/community-web/feed.cm.ts` một lần cuối đợt (đã viết, chưa chạy); int mỗi endpoint thuộc C3.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-28 (đợt Community)
Gộp vào `current/community/nghiep-vu.md` §4–5 cuối đợt. Đợt 1: thêm app `apps/community-web` (cổng dev 3400) + contract `@ai/contracts/community`; mock chạy được toàn bộ luồng; chưa nối backend.
