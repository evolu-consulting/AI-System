---
id: V2-L
title: Hộp thoại Cài đặt (Công ty · Điểm uy tín · Điểm kinh doanh) mở từ avatar
lane: nhanh (UI) + phần ghi cấu hình công ty/cờ duyệt (bảng mới có RLS, quyền chủ sở hữu) — int + một test chéo tenant
source: docs/platform/ba-v2/intake.md (V2-L: CD-01..06) · BA v2 §3.5, §4.5 · mockup-niti.html (chỉ đọc bố cục/màu/chữ; đã render bằng Playwright)
---

> **CR-101b (2026-10-27):** Cài đặt uy tín quay lại 5 ô nhóm × vai, 3 tab (Tiêu chí · Thời gian · Loại việc) theo [`REP-v3-ui`](../REP-v3-ui/tasks.md); Cài đặt › Công ty thêm ngưỡng pháp lý ([`DOC-legal`](../DOC-legal/tasks.md)).
# V2-L — tasks

## Plan
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Migration `0034_v2l_company_settings.sql` (`when` 1796100000000): `contracts.company_settings` (một hàng/tenant: tên, tên app, logo ≤ 1 MB, màu, giao diện, tên + MST của mình) + RLS `packs.secure_table`, REVOKE DELETE | xong |
| 2 | API `GET|PUT /pack/contracts/company` (đọc: quyền đọc; ghi: quản lý = `contracts-owner`, Q3); thân strict ở `@ai/contracts` `company.ts`; cờ duyệt (V2-A `approval_settings.approval_enabled`) đọc/ghi cùng thân, đổi cờ ghi nhật ký `approval_settings_audit` | xong |
| 3 | `GET /reputation/config` thêm `defaults` (mặc định BA: 5 ô, cài đặt chung, Loại việc) để UI chấm cam + Khôi phục | xong |
| 4 | `POST /business/config/preview` (thử tính CD-06: số mẫu một SP + cấu hình đang chỉnh ⇒ điểm/đề xuất/yếu tố; hàm thuần `scoreBusiness`, không DB) | xong |
| 5 | UI `features/settings`: hộp thoại (Radix Dialog) — đầu: Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt; cột trái 3 mục cuộn riêng; chấm cam khi khác mặc định (mục, ô, tab Mức) | xong |
| 6 | Công ty: tên, tên app, logo ≤ 1 MB, 6 màu, Sáng/Tối/Hệ thống, tên + MST của mình, công tắc duyệt hợp đồng; sidebar, menu avatar, nút, tiêu đề tab đổi NGAY theo bản nháp (kho `lib/brand.ts`) | xong |
| 7 | Điểm uy tín: 5 ô × tab Tiêu chí (bật/tắt, trọng số, ≤ 8 tự thêm) · Thời gian (khoảng, bậc thang, trễ/ngày) · Loại việc; "Mức & đánh giá"; thử tính tại chỗ + "Ảnh hưởng tới đối tác" (`POST /reputation/config/preview`) | xong |
| 8 | Điểm kinh doanh: trọng số, ngưỡng, mục tiêu, báo sắp hết hạn; thử tính qua API | xong |
| 9 | Test: unit `company.usecase.test.ts` (5), `settings-lib.test.ts` (8); int `tests/acceptance/V2-L/company.int.test.ts` (4: company GET/PUT + cờ duyệt + nhật ký, chéo tenant, biz preview, rep defaults); e2e `e2e/contracts-web/v2l-settings.cw.ts` (viết, chưa chạy) | xong |

## Quyết định trong lúc làm
- Cấu hình công ty lưu ở bảng riêng `company_settings` (không nhét vào `score_configs_v2`: không phải điểm, cần cột logo/tên/MST và CHECK riêng). Không có hàng ⇒ mặc định trong code (tên rỗng ⇒ hiện tên tenant / "Sổ Hợp Tác").
- Logo lưu dạng data URL ảnh (png/jpeg/svg/webp), ≤ 1.048.576 byte ảnh gốc, kiểm cả ở zod và CHECK DB; không dùng FileBox. SVG chỉ hiện qua `<img>` (không chạy script).
- Cờ duyệt: một thân PUT với phần nhận diện; chỉ ghi `approval_settings` khi cờ đổi so với hiệu lực hiện tại (kèm nhật ký). Mặc định lấy từ `contracts.approval_default()`; "Khôi phục tất cả" đưa cờ về mặc định đó.
- Tên pháp nhân + MST của mình (≤ 10 mỗi loại, MST 10 hoặc 13 số, không trùng) chỉ GHI + trả ở `/company` — V2-G đọc `own_names`/`own_tax_ids` để đoán Mua/Bán (việc nối còn lại).
- Chỉ chủ sở hữu sửa (server: `admin` của gói); người khác mở hộp thoại xem được, mọi ô khoá (`fieldset disabled`), không có nút Lưu. Viewer không thấy mục Cài đặt (như cũ). Menu avatar: "Cài đặt" mở hộp thoại; thêm mục "Thành viên & điểm đối tác" → `/settings` (trang cũ giữ nguyên).
- Lưu = các PUT tuần tự chỉ cho phần đã đổi (công ty → từng ô → cài đặt chung → Loại việc → kinh doanh); lỗi dừng ngay, phần đã lưu giữ, báo toast theo thông điệp server; xong thì refetch.
- Trọng số tiêu chí chỉnh bằng thanh trượt tương đối (1–50), hiện % sau chuẩn hoá; khi lưu chuẩn hoá về số nguyên tổng đúng 100 (server đòi 100).
- API chỉ hỗ trợ giảm theo bậc thang theo tháng ⇒ UI có "Bậc thang" / "Không giảm" (mockup còn "Giảm đều": bỏ). Khoảng tính điểm 6/12/24/36 tháng ("Toàn bộ" = 36). Chốt điểm chỉ "Hằng tháng" (hiện, không chọn). "Nhắc đánh giá khi" (CD-05) chưa lưu — V2-K.
- Tiêu chí tự thêm áp cho MỘT ô (API cấu hình theo ô), mockup cho chọn nhiều nhóm cùng lúc.
- Giao diện: "Hệ thống" trước đây coi như sáng (CSS gốc không có media query) ⇒ `applyTheme('auto')` giờ đặt `data-theme` theo `prefers-color-scheme` (+ nghe thay đổi). Giao diện công ty là mặc định; lựa chọn riêng ở menu avatar (localStorage) vẫn thắng; trong lúc hộp thoại mở, bản nháp thắng (xem thử). `light` giờ được nhớ tường minh.
- Màu: 6 bảng của mockup (chàm = giữ nguyên theme gốc) đè token `--primary/--accent/--ring/--sidebar-*/--act-line/--grad-to` qua `<style id="brand-css">`, có bản tối.
- Bản nháp mất khi mở lại hộp thoại (dữ liệu nạp lại từ server); khác mockup giữ nháp qua đóng/mở.

## Kiểm
- unit: hub-api `company.usecase.test.ts` 5 pass; contracts-web `bun test src` 204 pass; typecheck hub-api + contracts-web sạch; `i18n:check` OK; `bun run build` contracts-web OK.
- int (evotest, `-Step int -Dirty -Filter tests/acceptance/V2-L`): 4 pass, 0 fail.
- Chưa chạy: e2e `v2l-settings.cw.ts` (chạy một lần ở cuối đợt).

## Việc còn lại
- qc: `e2e/N1/shell.n1.ts` (dòng ~147–158) còn kỳ vọng menu avatar "Cài đặt" → URL `/settings`; nay mở hộp thoại, trang cũ ở mục "Thành viên & điểm đối tác" — cần sửa + relock (lý do «V2-L»). Baseline ảnh avatar-menu (`shell-account-menu`) đổi vì thêm một mục.
- (xong trong V2-L) V2-G: `save` của lượt trích đọc `company_settings` (`ExtractionRepo.ownParties`) và `withOwnDeal` chốt Mua/Bán theo bên cung cấp/bên mua khớp MST (10 số, bỏ chi nhánh) hoặc tên (không dấu); đúng một bên khớp ⇒ đặt `ai.deal` + bỏ "deal" khỏi chưa chắc; Giới thiệu / không phân định ⇒ như cũ. Unit `own-deal.test.ts`.
- V2-F/V2-G: màn xác nhận ẩn bước duyệt khi `approval_enabled=false` đã có ở server (V2-A); UI đọc cờ từ `GET /company` nếu cần.
- Nợ nhỏ: baseline e2e/ảnh cho hộp thoại (chạy cuối đợt).
