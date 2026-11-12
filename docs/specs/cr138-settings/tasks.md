---
id: cr138-settings
lát: cr138-settings — Cài đặt công ty: ẩn tab chỉ đọc, 12 màu + màu tự chọn, ảnh bìa công ty
cr: CR-138
làn: nhanh
migration: 0110_cr138_company_cover (pack-contracts)
---
## Plan (ngắn)
| # | Việc | File chính |
|---|---|---|
| Q6 | Người KHÔNG phải chủ sở hữu: nhóm Sổ Hợp Tác chỉ còn «Quy trình duyệt» (chỉ xem); 4 mục chỉ đọc bị ẩn. Link cũ `?sec=co…` ⇒ mục đầu tiên được phép, không lỗi | `lib/section-key.ts` (`allowedSections`, `pickNav(…, owner)`), `components/SettingsNav.tsx`, `SettingsDialog.tsx` |
| Q8 | `accent` = khoá 1 trong 12 màu đặt sẵn HOẶC `#rrggbb` (một cột, một nguồn). Kiểm AA: tương phản với chữ trắng ≥ 4.5 (vừa nền nút chính vừa chữ/liên kết trên nền sáng) — luật thuần dùng chung web + server. Nhạt ⇒ báo + gợi ý màu gần nhất đạt chuẩn, chặn Lưu | `packages/contracts/src/pack-contracts/company-accent.ts`, `company.ts`, `lib/brand.ts` (`customPalette`, tối suy ra tự động), `lib/accent-input.ts`, `AccentPicker.tsx`, migration 0110 |
| Q9 | Ảnh bìa công ty: cột `contracts.company_settings.cover` (cạnh `logo`), PNG/JPG/WebP ≤ 3 MB, chỉ chủ sở hữu (PUT `/company` đã `contracts-admin` ⇒ 403). `GET /company` chỉ trả `has_cover`; ảnh ở `GET /company/cover` (contracts) và `GET /pack/community/brand/cover` (mọi account trong tenant, kể cả đối tác; ETag + private cache). Hiện ở đầu hồ sơ công ty chủ quản Bảng tin; chưa có ⇒ nền màu chủ đạo | `company.routes.ts`, `company.repo.ts`, `brand.mount.ts`, `org.routes.ts`, `CoverField.tsx`, `ProfileCover.tsx`, `Profile.tsx` |

## Quyết định trong lúc làm
- Tương phản: «chữ trắng/đen tự chọn» luôn đạt 4.5 với một trong hai (toán học) nên luật vô nghĩa; chọn luật có ý nghĩa: màu nhấn phải đọc được khi làm NỀN nút (chữ trắng) và khi làm CHỮ/liên kết trên nền sáng ⇒ cùng điều kiện «tương phản với trắng ≥ 4.5». Giao diện tối: tự sáng dần tới khi ≥ 4.5 trên nền thẻ tối (chữ nút tối ≥ 4.5 theo đó).
- 6 màu cũ giữ nguyên bảng màu mockup (cam/hồng… vài màu < 4.5 với chữ trắng — không đổi ngoài phạm vi); 6 màu thêm (tím, tím hồng, vàng đất, xanh chanh, xanh da trời, xám than) đều ≥ 4.5. Thứ tự hiển thị theo sắc độ.
- Community `/brand` giữ ĐÚNG 4 trường: màu ngoài 6 khoá gốc/hex ⇒ `indigo` (= dùng `--primary` do brand toàn app đặt, vì `data-accent` chỉ là bảng token gốc). Ảnh bìa tách endpoint riêng để không kéo ảnh ≤ 4 MB vào mỗi lần tải app (`/pack/me`, `/brand`, `/company` đều không kèm ảnh).
- `has_cover` nằm trong `company` của GET (hiển thị), bị bỏ khỏi thân PUT (strict); PUT vắng `cover` ⇒ giữ, `null` ⇒ xoá. Nháp sau Lưu: `settledCompany()` bỏ `cover`, cập nhật `has_cover`.
- Mục bị ẩn theo quyền chỉ ở menu; các nút khoá (`reason`, CR-134) của Dò giá/Điểm uy tín vẫn có cho mục còn hiện (không còn mục nào hiện cho người thường ngoài «Quy trình duyệt» + Thông báo).
- Nhập mã màu sai/nhạt giữ nguyên chữ người gõ trong nháp (nên xem trước tạm về chàm khi mã chưa đủ); Lưu bị chặn bằng `firstIssue` → `co.accentBad`.
- Ảnh bìa chỉ cho hồ sơ công ty CHỦ QUẢN (`org.isHost`); hồ sơ công ty đối tác và trang «Hồ sơ của tôi» (cá nhân) giữ nền cũ — ảnh bìa cá nhân để sau (theo CR).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/web-hop-nhat.md
#### Yêu cầu: Cài đặt công ty theo quyền, màu chủ đạo mở rộng và ảnh bìa (CR-138)
Người không phải chủ sở hữu chỉ thấy mục «Quy trình duyệt» (chỉ xem) và Thông báo trong Cài đặt; link cũ tới mục đã ẩn mở mục đầu tiên được phép. Màu chủ đạo: 12 màu đặt sẵn + màu tự chọn `#RRGGBB` (tương phản với chữ trắng ≥ 4.5:1, không đạt thì báo, gợi ý màu gần nhất và không cho lưu). Chủ sở hữu tải ảnh bìa công ty (PNG/JPG/WebP ≤ 3 MB) cạnh logo; ảnh hiện ở đầu hồ sơ công ty chủ quản trên Bảng tin cho mọi người xem được hồ sơ (kể cả đối tác), chưa có thì nền màu chủ đạo.
- Kịch bản: không phải chủ sở hữu chỉ còn mục Quy trình duyệt [test: apps/workspace-web/src/features/settings/components/SettingsNav.test.ts » CR-138 Q6 · không phải chủ sở hữu ⇒ nhóm Sổ Hợp Tác chỉ còn «Quy trình duyệt» (chỉ xem)]
- Kịch bản: link cũ tới mục bị ẩn mở mục đầu tiên được phép [test: apps/workspace-web/src/features/settings/lib/section-key.test.ts » link cũ tới mục bị ẩn ⇒ mục đầu tiên được phép, không lỗi]
- Kịch bản: có đủ 12 màu đặt sẵn [test: apps/workspace-web/src/features/settings/lib/accent-input.test.ts » đủ 12 màu, mỗi màu có bảng sáng + tối 5 phần tử và mã hex hợp lệ]
- Kịch bản: màu tự chọn nhạt không cho lưu [test: apps/workspace-web/src/features/settings/lib/cover-data.test.ts » màu tự chọn nhạt/sai ⇒ co.accentBad, preset và hex đạt ⇒ không lỗi, không đổi công ty ⇒ bỏ qua]
- Kịch bản: kiểm tương phản có gợi ý màu đạt chuẩn [test: packages/contracts/src/pack-contracts/company-accent.test.ts » màu đậm đạt AA với chữ trắng, màu nhạt không đạt và có gợi ý đạt chuẩn]
- Kịch bản: ảnh bìa — nháp giữ/thay/xoá [test: apps/workspace-web/src/features/settings/lib/cover-data.test.ts » chưa có ảnh ⇒ null, có ảnh đã lưu ⇒ ảnh lưu, nháp thay ⇒ ảnh nháp, nháp xoá (null) ⇒ null]
- Kịch bản: ảnh bìa chỉ nhận PNG/JPG/WebP ≤ 3 MB [test: packages/contracts/src/pack-contracts/company-accent.test.ts » ảnh bìa: PNG/JPG/WebP nhận, SVG và > 3 MB từ chối, vắng/null nhận]
- Kịch bản: hồ sơ chỉ nhận data URL ảnh hợp lệ [test: apps/workspace-web/src/modules/community/domain/brand.test.ts » safeCover: chỉ nhận data URL PNG/JPG/WebP, SVG/URL lạ/rỗng ⇒ null]
- Kịch bản: ảnh bìa lưu bởi chủ sở hữu, đối tác đọc được, không phải chủ ⇒ 403, chéo tenant không thấy [test: apps/hub-api/src/modules/packs/contracts/company-cover.int.test.ts » chéo tenant: B không thấy ảnh bìa của A, user A mang tenant B ⇒ 403]

## Việc còn lại
- e2e khoá có thể vỡ (chưa chạy, Luật 0d.5): `e2e/contracts-web/approval-current.cw.ts` (mở Cài đặt › Quy trình duyệt, hiện chấm/ghi chú «chỉ xem» — vẫn đúng với người thường; nếu bước nào mở mục Công ty/Điểm uy tín bằng người không phải chủ sở hữu sẽ không còn thấy), e2e settings/brand (`e2e/**/settings*`, `e2e/**/brand*`: chọn màu «Chàm/Xanh dương…» bằng nhãn — còn; số lượng nút `radio` màu 6 ⇒ 12), test mở `/contracts/settings?sec=co` bằng người thường (nay vào Quy trình duyệt).
- Ảnh bìa cá nhân («Hồ sơ của tôi») để sau theo CR.
- Docs: `docs/current/web/` gộp Delta cuối đợt; `docs/current/community` mô tả `/brand/cover` khi gộp.
- Ảnh chụp dùng mock route (stack chính :4000 chưa có migration 0110/endpoint mới); int đã chạy trên evotest (xanh).
