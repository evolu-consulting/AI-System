# CR-106 · Kế hoạch test (mô tả, chưa viết test)

Thuộc `index.md`. Mức mô tả: AC → loại test gợi ý. Luật 0b: chỉ unit logic thuần + một int đường chính mỗi endpoint mới + một test chặn đọc chéo tenant mỗi bảng/endpoint mới; e2e viết nhưng chạy một lần cuối đợt. Ký hiệu: U = unit, I = int (cần DB), E = e2e Playwright (`e2e/community-web/…`), M = kiểm tay/CSS.

| Phần | AC | Loại | Mô tả ngắn |
|---|---|---|---|
| P0 | AC01 | I+E | HT-75/HT-76 hiện có phải xanh; E: đối tác không có link SHT |
| P0 | AC02 | U | lint/import-boundary: `community-web` không import `contracts-web` |
| P0 | AC03 | M | rà diff: không endpoint/bảng nối ngoài brand + Lưu báo giá |
| P0 | AC04 | U | `canView` từng nhóm độc lập |
| P0 | AC05 | U+E | accent lấy từ brand, không còn UI đổi màu cá nhân |
| P1 | AC01-03 | E | topbar: brand công ty, không navtab/gear/logout; chuông + tìm còn chạy |
| P1 | AC04-05 | E+M | sidebar sticky ở feed/profile, giữ trạng thái khi chuyển view |
| P1 | AC06-07 | U+E | xổ/gập + nhớ `localStorage`; 4 href SHT đúng |
| P1 | AC08-09 | E | đối tác: DOM không nhóm SHT; chủ quản thiếu quyền contracts: ẩn |
| P1 | AC10-11 | E | user-menu 3 mục, Esc/ngoài đóng, Đăng xuất |
| P1 | AC12-14 | U+E | `parseHash` (`#/settings` → feed + dialog; `#/profile/<id>`); dialog giữ route |
| P2 | AC01-02, 07, 08 | E | tab, composer thu gọn, bỏ `.wsside`, đổi VI↔EN |
| P2 | AC03 | U | `dealStrip` (đã có test; thêm ca Liên hệ nếu thiếu) |
| P2 | AC04 | I+E | đối tác không thấy Lưu báo giá/callout (tái dùng HT mục 5) |
| P2 | AC05-06 | E | màu pill theo brand; rail theo vai |
| P3 | AC01-02, 04, 07 | E | hero, 4 tab, `#/profile/<id>/files`, Composer chỉ hồ sơ mình |
| P3 | AC03 | U | registry section: `canView=false` ⇒ không render |
| P3 | AC05-06 | I | `partners`/`media` endpoint mới: đường chính + chặn đọc chéo tenant / media bài "Chỉ chủ quản" |
| P4a | AC01-05, 07 | E | dialog, nhóm theo vai, href `?sec=`, công tắc lưu ngay |
| P4a | AC06 | E (contracts-web) | `?sec=rep` chọn sẵn mục; `sec` lạ ⇒ cũ |
| P4a | AC08 | U | `canView` mỗi nhóm |
| P4b | AC01-04, 06 | U+E | không còn ô màu; `HOST_ONLY`; ngôn ngữ lưu |
| P4b | AC05 | I | client cũ gửi `accent` không 422 |
| P4c | AC01-06 | E+I (contracts-web, đã có) | không viết lại; chỉ kiểm thẻ/href (AC08) |
| P4c | AC07 | M | màu `rose` trong CSS |
| P4d | AC01-09 | E | thẻ/href đúng; sơ đồ readonly ở contracts-web (test đã có); "Chưa gán quy trình duyệt." (U/E contracts-web) |
| P5 | AC01-03 | E+I | link đúng, đối tác chặn HT-76, không endpoint thừa |
| P5 | AC04 | E | fallback: chưa có phiên SHT ⇒ đăng nhập rồi vào đúng trang |
| P5 | AC05-07 | I+U | `GET /pack/community/brand`: đường chính + user ngoài chỉ nhận 4 trường (chặn đọc chéo); fallback chữ cái đầu + `indigo` |
| P5 | AC08-09 | U | không còn chuỗi VI cứng (lint/grep), thiếu khoá EN ⇒ VI |
| P5 | `caps.contracts` | I | đối tác luôn `none`; chủ quản theo group |

Ghi chú: e2e liên quan cần sửa khi code (`sht-link`, bánh răng) — nằm trong lát implement, không ở đây.
