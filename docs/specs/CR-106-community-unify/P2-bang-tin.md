# P2 · Bảng tin

Thuộc `index.md` (CR-106). Tuân P0 (I1–I4), dùng khung P1. Mã: **COM-FR-32…34**. Quy tắc hiển thị/che/lưu báo giá **không đổi**: chuẩn là `docs/current/community/hien-thi.md` §0–7 và `nghiep-vu.md`.

## 1. Mục tiêu
Giữ nguyên bảng tin Phase A (commit `d209d045`); chỉ đổi phần liên quan lớp vỏ: bỏ `.wsside` riêng (thay bằng sidebar P1), accent theo brand công ty, nhãn song ngữ.

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục: feedbar tab · Composer thu gọn · PostCard · Rail.

## 3. Nghiệp vụ

### 3.1 Feedbar + Composer — COM-FR-32
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| F1 | Tab sticky: Tất cả · Cần bán · Cần mua · Thông báo · Đã lưu trữ, kèm số đếm | Giữ | `ui/Feed.tsx:11-15`, `:150`; `hien-thi.md` §0 |
| F2 | Chip lọc/ô lọc gọn ở Hồ sơ (`FeedList`, `withFilters={false}`) | Giữ | `ui/Feed.tsx:119`, `Profile.tsx:130-135` |
| F3 | Composer **thu gọn**: một dòng prompt + 3 nút loại Cần bán / Cần mua / Thông báo; bấm mới mở form đầy đủ | Đổi (cần kiểm `Composer.tsx` hiện đã thu gọn chưa) | `ui/Composer.tsx:216` (placeholder), `:302` ("Đăng bài") |
| F4 | Form đầy đủ giữ: chọn người xem (chủ quản), điền sẵn từ SHT, ảnh tối đa 10 / video tối đa 2, toast "Đã đăng bài" | Giữ | `Composer.tsx:142,153,246-253,288` |
| F5 | Bảng tin 2 cột: cột trái (`.feedcol`), rail phải sticky; không còn `.ws`/`.wsside` riêng của trang (sidebar do Shell P1) | Đổi | `hien-thi.md` §0; P1 S1 |

### 3.2 PostCard — COM-FR-33
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| C1 | Vạch màu trái + pill loại (Cần bán = accent, Cần mua = `--buy` cam, Thông báo = `--note` xám). **Accent** lấy từ brand công ty (Q3); buy/note cố định | Giữ + Đổi nguồn accent | `hien-thi.md` §0; `styles/feed.css` |
| C2 | Dải deal: hero "Giá chào" (bán) / "Ngân sách" (mua), trống ⇒ "Liên hệ"; ô phụ Số lượng/Khu vực/Cần trước… | Giữ | `lib/format.ts:42,78-87` |
| C3 | Callout chủ quản dưới bài, chỉ chủ quản, **không bao giờ lộ cho đối tác**: (1) gợi ý: `lead` là tên sản phẩm khớp (`{tên SP}:`), hoặc "Khớp hàng đang có:" (Cần mua + còn hàng), hoặc khi chưa khớp "Gợi ý từ Sổ Hợp Tác:" + "chưa có sản phẩm khớp trong danh mục."; (2) "Đã lưu báo giá vào Sản phẩm & Giá:" + tóm tắt. **Không thêm khối mới** (P0 D10) | Giữ | `lib/quote.ts:146-155` (`hintLines`), `PostCard.tsx:285-305`; `hien-thi.md` §5; I1 |
| C4 | Nút **"Lưu báo giá"** (chủ quản, bài Cần bán của NCC) — điểm nối nghiệp vụ duy nhất với SHT | Giữ nguyên (I2) | `hien-thi.md` §0, §5; `nghiep-vu.md` §8 |
| C5 | "Bình luận (n)" + luồng bình luận riêng theo đối tác | Giữ | `PostCard.tsx:331`; `nghiep-vu.md` §6 |
| C6 | Nhãn audience: bài chủ quản "Bạn bè", bài đối tác "Chỉ chủ quản"; nhãn trạng thái đã sửa / Đã lưu trữ / Đã xong / Hết hạn | Giữ | `hien-thi.md` §0 |
| C7 | Nút ⋯ "Tuỳ chọn bài đăng"; xoá vĩnh viễn có xác nhận | Giữ | `PostCard.tsx:196,220` |

### 3.3 Rail — COM-FR-34
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| R1 | Thẻ **Bộ lọc**: Nhóm hàng · Khu vực · Người đăng (chủ quản: tất cả / Chủ quản / từng đối tác) · Xoá lọc; đối tác chỉ Nhóm hàng + Khu vực | Giữ | `ui/Feed.tsx:26-86`, `FeedRail.tsx:46` |
| R2 | Chủ quản: thẻ **Đối tác** (mọi đối tác, tag "đã rời") — "Đối tác" nghĩa A (P0 từ điển) | Giữ | `FeedRail.tsx:24,55` |
| R3 | Đối tác: thẻ **Công ty của bạn** + **Mẹo đăng bài** (3 mẹo) | Giữ | `FeedRail.tsx:70,80,33-35` |

## 4. Điều hướng & trạng thái
Giữ `useFeedFilters` (tab, nhóm hàng, khu vực, người đăng, ô tìm) và refetch theo `rev`. Thẻ Bộ lọc chỉ hiện sau khi bảng tin tải. Responsive: ≤ 900px rail xuống dưới; ≤ 460px dải deal xếp dọc (`hien-thi.md` §0). Rỗng: "Không có bài đăng nào trong mục này." (`Feed.tsx:102`).

## 5. Dữ liệu / Contract
Không đổi. `brand.accent` (P5, COM-FR-45) cấp biến `--accent*` thay `localStorage community.accent`.

## 6. Quyền & cách ly
Không đổi: server quyết hiển thị (D2–D4, `hien-thi.md` §1–5). "Lưu báo giá", gợi ý SHT và "Đã lưu báo giá…" chỉ render khi `isHostViewer`; các test HT hiện có phải vẫn xanh. Không thêm link SHT vào bài/rail của đối tác.

## 7. Nhãn VI / EN (EN = đề xuất dịch, chờ duyệt; hạ tầng i18n: P5 COM-FR-46)
| VI (verbatim) | EN đề xuất |
|---|---|
| Tất cả · Cần bán · Cần mua · Thông báo · Đã lưu trữ | All · For sale · Wanted · Announcements · Archived |
| Bộ lọc · Nhóm hàng · Khu vực · Người đăng · Người đăng: tất cả · Xoá lọc | Filters · Category · Area · Posted by · Posted by: everyone · Clear filters |
| Đối tác · đã rời | Partners · left |
| Công ty của bạn · Mẹo đăng bài | Your company · Posting tips |
| Ghi rõ giá hoặc ngân sách để đối tác phản hồi nhanh hơn. | State a price or budget so partners can reply faster. |
| Thêm số lượng và khu vực giao nhận ngay trong bài. | Add quantity and delivery area in the post. |
| Đính kèm ảnh thật của hàng để tăng độ tin cậy. | Attach real photos of the goods to build trust. |
| `{orgName} đang có hàng cần bán hay nhu cầu cần mua?` | Does {orgName} have goods to sell or something to buy? |
| Đăng bài · Đã đăng bài · Không đăng được | Post · Post published · Could not publish |
| Tối đa 10 ảnh · Tối đa 2 video | Up to 10 photos · Up to 2 videos |
| Điền sẵn từ Sổ Hợp Tác… | Prefill from Sổ Hợp Tác… (tên riêng giữ nguyên) |
| Giá chào · Ngân sách · Liên hệ | Asking price · Budget · Contact |
| Lưu báo giá | Save quote |
| Đã lưu báo giá vào Sản phẩm & Giá: | Quote saved to Products & Prices: |
| Gợi ý từ Sổ Hợp Tác: · chưa có sản phẩm khớp trong danh mục. | Suggestion from Sổ Hợp Tác: · no matching product in the catalogue yet. |
| Khớp hàng đang có: | Matches stock you have: |
| Bình luận (n) | Comments (n) |
| Bạn bè · Chỉ chủ quản | Friends · Host only |
| Không có bài đăng nào trong mục này. | No posts in this section. |
| Tuỳ chọn bài đăng | Post options |

## 8. Tiêu chí chấp nhận
| AC | FR | Nội dung |
|---|---|---|
| P2-AC01 | 32 | Năm tab đúng thứ tự và nhãn; số đếm khớp danh sách; tab sticky khi cuộn. |
| P2-AC02 | 32 | Composer mặc định thu gọn (prompt + 3 nút loại); bấm mở form đầy đủ; đăng thành công hiện toast và bài lên đầu. |
| P2-AC03 | 33 | Bài Cần bán không giá hiện hero "Giá chào: Liên hệ"; Cần mua hiện "Ngân sách". |
| P2-AC04 | 33 | Đối tác không bao giờ thấy "Lưu báo giá", "Đã lưu báo giá vào Sản phẩm & Giá:" hay gợi ý SHT (HT mục 5 xanh). |
| P2-AC05 | 33 | Màu vạch/pill Cần bán đổi theo màu chủ đạo công ty; Cần mua/Thông báo không đổi. |
| P2-AC06 | 34 | Rail chủ quản có Bộ lọc + Đối tác; rail đối tác có Bộ lọc (2 ô) + Công ty của bạn + Mẹo đăng bài. |
| P2-AC07 | 32-34 | Trang không còn `.wsside` riêng; sidebar P1 là duy nhất; ≤ 900px rail xuống dưới. |
| P2-AC08 | 32-34 | Đổi ngôn ngữ VI↔EN đổi mọi nhãn ở §7, không đổi dữ liệu bài. |

## 9. Mã truy vết
COM-FR-32 Feedbar + Composer · COM-FR-33 PostCard · COM-FR-34 Rail.

## 10. Việc còn mở
Đã chốt: nhãn gợi ý theo source (C3, P0 D10); theme tối theo công ty (P0 D13) — bảng tin hiện chỉ light (`feed.css`), hỗ trợ tối ngoài phạm vi bản đầu. Còn lại: duyệt nhãn EN (§7) — người dùng; kiểm `Composer.tsx` hiện đã thu gọn chưa (F3) khi code — frontend-lead.
