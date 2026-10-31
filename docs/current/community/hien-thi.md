# Community — ma trận hiển thị (R8) thành ca test

Nguồn: PDF 28/10/2026 bảng "Quy tắc hiển thị" + "Các case và ngoại lệ", D1–D5, `nghiep-vu.md`. Mỗi dòng = **một ca test** (HT-nn); C3/C4 viết **một int RLS mỗi ô** theo bảng này (nhẹ nhất: một int có tham số theo dòng). "Chưa làm" tới khi C3 merge.

## 0. Bố cục bảng tin (Phase A redesign — chỉ hiển thị, không đổi quy tắc)
Nguồn: `apps/community-web/src/ui/Feed.tsx` (FeedPage, FeedFilters, FeedList), `FeedRail.tsx`, `PostCard.tsx`, `Composer.tsx`, `useFeed.ts`, `src/lib/format.ts` (dealStrip), `src/styles/feed.css`. Quyền, che, lưu báo giá vẫn do server quyết; mục 1–7 là chuẩn.

| Vùng | Chủ quản (Admin / Thành viên) | Đối tác (NCC / người mua) |
|---|---|---|
| Cột trái (`.feedcol`) | Composer (chọn người xem) → thanh tab **sticky** (Tất cả · Cần bán · Cần mua · Thông báo · Đã lưu trữ, kèm số đếm) → danh sách bài | Composer (ghi chú thay cho người xem) → thanh tab sticky → danh sách bài |
| Cột phải (`.rail`, sticky) | Thẻ **Bộ lọc** (Nhóm hàng · Khu vực · Người đăng: tất cả / Chủ quản / từng đối tác · Xoá lọc) + thẻ **Đối tác trong chợ** (mọi đối tác; tag "đã rời") | Thẻ **Bộ lọc** (Nhóm hàng · Khu vực; không có Người đăng) + **Công ty của bạn** (chỉ khi có) + **Mẹo đăng bài** (3 mẹo tĩnh) |

- Bộ lọc dùng chung state với thanh tab (`useFeedFilters`: tab, nhóm hàng, khu vực, người đăng, ô tìm). Thẻ Bộ lọc chỉ hiện sau khi bảng tin đã tải.
- Danh sách công ty (`usePartners`): chủ quản gọi để lấy tất cả đối tác; đối tác nhận phạm vi do server trả (chỉ công ty của mình).
- Bố cục 2 cột chỉ ở `FeedPage` (route bảng tin). **Hồ sơ** dùng `FeedList`: chip lọc + ô lọc gọn (`selrow`), không có cột phải.
- Responsive: ≤ 900 px rail xuống dưới một cột; ≤ 460 px dải deal xếp dọc.

Thẻ bài (`PostCard`):
- **Vạch màu trái** theo loại: Cần bán = accent (`--accent`, indigo ở theme mặc định) · Cần mua = cam (`--buy`) · Thông báo = xám (`--note`).
- **Pill loại** cạnh nút ⋯ cùng màu. Nút **Lưu báo giá** (chủ quản, bài Cần bán của NCC) nằm trong header, sau pill; trên bình luận thì nằm trong luồng (xem mục 5–6).
- **Dải deal** (`.deal.<loại>`, dưới tiêu đề/nội dung): hero = "Giá chào" (Cần bán) hoặc "Ngân sách" (Cần mua), trống ⇒ "Liên hệ"; ô phụ: Hàng hoá (chỉ khi bài không có tiêu đề) · Số lượng / Cần · Khu vực / Giao tại · Cần trước (Cần mua, dd/mm/yyyy). Thông báo không có dải. Thay cho lưới facts cũ.
- Trạng thái lưu trữ / đã xong / hết hạn: thẻ mờ (`.muted`). Nhãn trong dòng meta dưới tên người đăng: đã sửa · Đã lưu trữ · Đã xong · Hết hạn · đã ẩn · đối tác đã rời · "Hết hạn sau N ngày" (≤ 3 ngày).
- Nhãn audience giữ nguyên: bài chủ quản "Bạn bè"; bài đối tác "Chỉ chủ quản".
- Khối "Đã lưu báo giá vào SP & Giá" và gợi ý của chủ quản: chỉ chủ quản thấy (`isHostViewer`).

Kiểm bố cục: chưa có ca HT riêng; e2e liên quan `e2e/community-web/feed.cm.ts`.

## Bộ nhân vật test (tenant `demo`)
| Ký hiệu | Là ai |
|---|---|
| **A** | Admin chủ quản (demo-owner Nguyễn Văn An) |
| **M** | Thành viên chủ quản (demo-editor Lê Quốc Cường) |
| **S1** | NCC, công ty ngoài #1 (vd Cơ sở Tân Phát), nhãn `supplier`; có 2 user S1a, S1b cùng công ty |
| **S2** | NCC, công ty ngoài #2 (vd Hãng NCCA), nhãn `supplier` |
| **B1** | Người mua, công ty ngoài #3, nhãn `buyer`, nhóm hàng quan tâm = đóng gói |
| **B2** | Người mua, công ty ngoài #4, nhóm hàng quan tâm = chữ ký số |
| **X** | Công ty nhãn `both` (vừa bán vừa mua), user X1 |
Mọi ca có hai biến thể khi nói "thành viên": A và M cho kết quả **giống nhau** trừ khi dòng ghi khác (HT-60…63). Kết quả "không thấy" = **0 hàng/404 từ API**, không phải ẩn ở UI; trường nhạy cảm **không có trong JSON**.

## 1. Bài của chủ quản (người xem được chọn — D2)
Bài P = bài chủ quản đăng, `audience` như ghi ở cột 3.
| # | Người xem | Bài / audience | Kết quả mong đợi |
|---|---|---|---|
| HT-01 | A, M | mọi bài P | Thấy (mọi trạng thái, kể cả lưu trữ) |
| HT-02 | S1 | P, audience = tất cả bạn bè | Thấy |
| HT-03 | B1 | P, audience = tất cả bạn bè | Thấy |
| HT-04 | S1 | P, audience = chỉ người mua | Không thấy |
| HT-05 | B1 | P, audience = chỉ NCC | Không thấy |
| HT-06 | B1 | P Cần bán, audience theo nhóm hàng = đóng gói | Thấy |
| HT-07 | B2 | P Cần bán, audience theo nhóm hàng = đóng gói | Không thấy |
| HT-08 | S1 | P, audience = từng công ty {S2} | Không thấy |
| HT-09 | S2 | P, audience = từng công ty {S2} | Thấy |
| HT-10 | X1 | P, audience = chỉ NCC | Thấy (công ty `both` có nhãn supplier) |
| HT-11 | X1 | P, audience = chỉ người mua | Thấy (có nhãn buyer) |
| HT-12 | đối tác bị huỷ kết bạn / vô hiệu | P, audience = tất cả | Không thấy; đăng nhập bị từ chối ở bề mặt khác (C2) |
| HT-13 | S1 | P, audience không đặt (mặc định Cần bán) | Không thấy (mặc định Cần bán = người mua nhóm hàng đó) |
| HT-14 | B1 | P Cần mua, audience mặc định | Không thấy (mặc định Cần mua = NCC nhóm hàng đó) |
| HT-15 | S1 | P, `archived` | Không thấy (lưu trữ ẩn khỏi bảng tin người khác) — kể cả khi audience gồm S1 |
| HT-16 | S1 | P, `hidden` (chủ quản ẩn) | Không thấy |
| HT-17 | S1 | P, audience gồm S1, bài **đã xoá** | Không thấy; chủ quản: bài biến mất, giá đã lưu còn |
| HT-18 | S1 | P, audience gồm S1, đã hết hạn 30 ngày (tự lưu trữ) | Không thấy |
| HT-19 | S1 | P, đã sửa | Thấy với nhãn "đã sửa" |

## 2. Bài của đối tác
| # | Người xem | Bài | Kết quả mong đợi |
|---|---|---|---|
| HT-20 | A, M | bài Cần bán của S1 | Thấy (kèm raw) |
| HT-21 | S1 (cả S1a, S1b) | bài Cần bán của chính S1 | Thấy (cả hai user cùng công ty) |
| HT-22 | S2 | bài Cần bán của S1 | Không thấy |
| HT-23 | B1 | bài Cần bán của S1 | Không thấy |
| HT-24 | B1 | bài Cần mua của B1 | Thấy |
| HT-25 | B2 | bài Cần mua của B1 | Không thấy |
| HT-26 | S1 | bài Cần mua của B1 | Không thấy |
| HT-27 | X1 | bài Cần bán của S1 | Không thấy |
| HT-28 | X1 | bài Cần bán / Cần mua của chính X (cả hai loại) | Thấy (vai theo bài) |
| HT-29 | A, M | bài của S1 đã `hidden` | Thấy (có nhãn "đã ẩn", có thể bỏ ẩn) |
| HT-30 | S1 | bài của chính S1 bị chủ quản `hidden` | Thấy theo chính sách C5: **chưa rõ** (xem Chưa rõ #1) |
| HT-31 | S1 | bài của chính S1 `archived` bởi S1 | Thấy ở "Bài của tôi/Lưu trữ", không ở bảng tin chung |
| HT-32 | S1 | bài của S1 sau khi S1 bị vô hiệu (đối tác rời) | A, M thấy nhãn "đối tác đã rời"; S1 không đăng nhập được |

## 3. Bình luận (D3 — luồng riêng bài × công ty)
| # | Người xem | Bình luận | Kết quả mong đợi |
|---|---|---|---|
| HT-40 | A, M | mọi luồng trên bài P | Thấy tất cả luồng, tách theo công ty |
| HT-41 | S1a | bình luận của S1b (cùng công ty) trên bài P | Thấy (cùng luồng) |
| HT-42 | S1 | bình luận của S2 trên bài P | Không thấy |
| HT-43 | S1 | câu trả lời của chủ quản gửi S1 | Thấy |
| HT-44 | S1 | câu trả lời của chủ quản gửi S2 (cùng bài) | Không thấy |
| HT-45 | B1 | bình luận của S1 trên cùng bài P | Không thấy (NCC/mua không thấy nhau) |
| HT-46 | S1 | bình luận `hidden` của S1 do chủ quản ẩn | Không thấy sau khi ẩn, hoặc thấy nhãn: **chưa rõ** (Chưa rõ #2) |
| HT-47 | S1 | luồng trên bài P bị `archived` | Không thấy bài ⇒ không thấy luồng (HT-15); chủ quản giữ bình luận |
| HT-48 | S1 | luồng trên bài của chính S1 | Thấy luồng của S1 với chủ quản; S2 không thấy |
| HT-49 | A | tạo bình luận trong luồng của S1 | Ghi `ext_org_id = S1`; S2 không thấy |
| HT-50 | S1 | bình luận do chính S1 xoá | Biến mất ở cả hai phía |

## 4. Che liên hệ (D4 — masked)
| # | Người xem | Nội dung | Kết quả mong đợi |
|---|---|---|---|
| HT-51 | S1 viết bài/bình luận có SĐT, email, link Zalo/FB, website, MST | A, M | Thấy **raw** (nguyên văn) |
| HT-52 | cùng nội dung HT-51 | mọi user ngoài (kể cả chính S1 đọc lại, S1b, B1 nếu bài hiển thị cho B1) | Chỉ **masked**; JSON không có trường raw |
| HT-53 | S1 viết bài có tên công ty khác (vd "Hãng NCCA") | user ngoài | Tên công ty khác bị che; tên chính công ty S1 không che |
| HT-54 | S1 ghi SĐT trong nội dung | người đăng | Nhắc che; vẫn đăng được |
| HT-55 | A viết bình luận gửi S1 có SĐT chủ quản | S1 | Không che (nội dung chủ quản) |

## 5. Dấu hiệu Lưu báo giá — không bao giờ lộ cho đối tác (R16, R29)
| # | Người xem | Đối tượng | Kết quả mong đợi |
|---|---|---|---|
| HT-60 | A, M | bài Cần bán của S1 | Có nút "Lưu báo giá" |
| HT-61 | A, M | bài Cần mua của B1; bài của chủ quản; bài Thông báo | Không có nút |
| HT-62 | A, M | bình luận của NCC trên bài chủ quản | Có nút Lưu báo giá (Q3) |
| HT-63 | A, M | bài đã lưu | Thấy dòng "Đã lưu báo giá vào SP & Giá" + "đã lưu bởi … lúc …" + nút Xem. ⚠ Lệch code: `PostCard.tsx` hiện dòng và "đã lưu bởi", **chưa có nút Xem** (có từ trước redesign; xem Chưa rõ #7) |
| HT-64 | S1 | bài Cần bán của chính S1, **đã được lưu** | Không có nút, không dòng "Đã lưu", API **không có** trường `savedQuote`/`savedBy`/cờ tương đương; JSON giống hệt bài chưa lưu |
| HT-65 | B1, S2 | bài/bình luận bất kỳ | Không có nút, không dấu hiệu |
| HT-66 | S1 | bài sau khi chủ quản thay giá hoặc gỡ giá | Không thay đổi quan sát được (không thông báo) |
| HT-67 | A, M | gợi ý dưới bài (giá vốn BQ, hàng đang có, uy tín) | Thấy |
| HT-68 | mọi user ngoài | gợi ý dưới bài / SP & Giá / điểm uy tín | Không có trong JSON |

## 6. Bạn bè, hồ sơ, trang công ty
| # | Người xem | Nội dung | Kết quả mong đợi |
|---|---|---|---|
| HT-70 | A, M | danh sách bạn bè, nhãn, ghi chú đối tác, điểm uy tín | Thấy |
| HT-71 | S1, B1 | danh sách bạn bè của chủ quản | Không thấy (0 hàng) |
| HT-72 | A, M | hồ sơ công ty đối tác bất kỳ | Thấy |
| HT-73 | S1 | hồ sơ công ty S2 hoặc B1 | Không thấy |
| HT-74 | S1, B1 | hồ sơ chủ quản | Thấy (chỉ hồ sơ chủ quản) |
| HT-75 | S1 | hồ sơ công ty S1 (trang cá nhân) | Thấy; không có SHT |
| HT-76 | S1, B1 | mở SHT / contracts-web / `/contracts` API | Từ chối (RLS `kind=external` ⇒ 0 hàng; pack guard 403) |
| HT-77 | M | xoá đối tác / xuất DS đối tác / xuất SP & Giá | Không có chức năng (R4); A xoá = vô hiệu (Câu 9) |
| HT-78 | S1 | gọi chatbot / `/directory` / catalog app khác | Từ chối (C2) |

## 7. Thành viên so với Admin
| # | Người xem | Thao tác | Kết quả mong đợi |
|---|---|---|---|
| HT-80 | M | Lưu báo giá | Được (như A) |
| HT-81 | M | Tạo công ty / user đối tác ở ai-admin | Không (chỉ Admin; ADM-FR-75) |
| HT-82 | M | Sửa nhãn / nhóm hàng / liên kết SHT ở Community › Đối tác | Không (chỉ Admin chủ quản) |
| HT-83 | M | Ẩn bài / bình luận đối tác | Được (cả chủ quản) |
| HT-84 | A, M | Hai người cùng lưu một bài | Người sau thấy "đã lưu bởi … lúc …", vẫn lưu đè được |
| HT-85 | M bị gỡ | mọi thao tác | Mất quyền ngay |

## Chưa rõ
0. Gộp C3: các ca HT-01…50, HT-70…73 đã có int RLS (`visibility.rls.int.test.ts`); #1/#2 dưới đây chốt theo mặc định đề xuất.
1. HT-30: bài của S1 bị chủ quản ẩn — S1 thấy bài của mình (kèm nhãn) hay không? PDF: "ẩn bài" không nói rõ. Mặc định đề xuất: S1 **thấy** bài của mình, không biết bị ẩn (tránh lộ hành vi chủ quản); các người xem khác không thấy.
2. HT-46: bình luận bị ẩn trong luồng riêng: đối tác còn thấy không? Mặc định đề xuất: không thấy (không để lại dấu).
3. Phần thành viên chủ quản theo "quyền được giao" (PDF: "dùng SHT theo quyền được giao"): ca test SHT theo từng quyền thuộc `current/sht/cai-dat-va-quyen.md`, không lặp ở đây.
4. Bài Thông báo audience theo nhóm hàng: nhóm hàng của Thông báo lấy từ đâu (người đăng chọn)? Mặc định: người đăng chọn tay.
5. Mockup Community chưa nhận: Phase A đặt các nhãn "đã sửa", "đã ẩn", "đối tác đã rời" trong dòng meta dưới tên người đăng (mục 0); chờ mockup xác nhận.
6. HT-62: "bình luận của NCC trên bài chủ quản" có nút Lưu báo giá. Code (`PostCard.tsx`) chỉ bật trên bình luận của đối tác khi bài là Cần mua của chủ quản, khớp D12 (`nghiep-vu.md` §8). Chốt: giữ D12 hay mở rộng sang bài khác?
7. HT-63 / `nghiep-vu.md` §8: nút "Xem" trên bài đã lưu chưa được code. Chốt: làm (nút mở form/link SP & Giá) hay bỏ khỏi nghiệp vụ?
