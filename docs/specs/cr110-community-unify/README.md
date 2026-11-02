# CR-110 — Community hợp nhất lớp vỏ với Sổ Hợp Tác (COM-FR-26..46)

Spec chính cho dev. Nguồn: `docs/intake/2026-11-02-community-unify/` (`intake.md` = phân tích 56 ý R1..R56 + mục "Chốt (2026-11-02)"; `spec-community-hop-nhat.txt`/`.pdf` = spec gốc 29 trang, ghi nhầm "CR-106"; đổi thành **CR-110** vì CR-106 đã dùng cho canvas quy trình duyệt). Người dùng chốt cả 13 câu theo mặc định (2026-11-02). Trạng thái: đã chốt, chưa code. Làm theo Luật 0b (lát nhỏ, một agent/lát); chỉ ports và profile-api chạy readiness 1 vòng.

Mockup (tham chiếu giao diện, KHÔNG sao chép CSS ẩn vai):
- `docs/intake/2026-11-02-community-unify/mockup-community-hop-nhat.html`
- `docs/intake/2026-11-02-community-unify/dac-ta-ui-man-moi.html`

## 1. Mục tiêu
Chủ quản thấy MỘT giao diện thống nhất giữa Community và Sổ Hợp Tác (SHT): cùng topbar brand công ty, sidebar, user-menu, Cài đặt. Hai app, hai cookie phiên, hai bộ dữ liệu vẫn tách (hợp nhất ở lớp vỏ, không trộn nghiệp vụ/dữ liệu). Đối tác vẫn cách ly hoàn toàn khỏi SHT.

## 2. Phạm vi
Trong: topbar/sidebar/user-menu/routing (COM-FR-27..31); feed bar + composer thu gọn, PostCard, rail (32..34); hồ sơ kiểu Facebook (35..37); Cài đặt chung dạng dialog theo nhóm quyền (38..42); deep-link SHT + caps + SSO hand-off + brand + i18n (43..46); bỏ màu theo người; thêm màu rose vào CSS community; contracts-web hỗ trợ `/settings?sec=`.

Ngoài phạm vi: nhúng màn SHT vào community; migration/bảng mới nối Community↔SHT; App switcher trên topbar community (Câu 13); Sáng/Tối theo công ty (Câu 8, bản đầu chỉ light); kết bạn SĐT, Zalo/SMS, giao hàng, công nợ (như `docs/current/community/nghiep-vu.md`); sửa engine/gói contracts ngoài việc thêm adapter đọc.

## 3. Actor và luật cách ly (bất biến I1..I4)
| Actor | Nhìn thấy |
|---|---|
| Chủ quản (tenant chủ) + quyền gói contracts (`caps.contracts` ≠ none) | Toàn bộ community + nhóm SHT ở sidebar + mục SHT trong Cài đặt (theo cấp quyền từng mục) |
| Chủ quản không có quyền contracts | Community đầy đủ; KHÔNG nhóm SHT, KHÔNG mục SHT trong Cài đặt |
| Đối tác (external) | Community mức đối tác; Cài đặt chỉ nhóm Cá nhân |

- **I1 Đối tác không thấy SHT:** DOM không chứa nhóm SHT, `sht-link`/link contracts, route SHT, câu nhắc "Số liệu kinh doanh… nằm trong Sổ Hợp Tác". **Không render** (điều kiện trong code/server quyết), tuyệt đối không ẩn bằng CSS (`body.role-partner .adm-only` trong mockup chỉ là minh hoạ, cấm bắt chước). Không request API contracts từ vai đối tác. Giữ HT-75/76.
- Đối tác không thấy: giá vốn BQ (callout), điểm uy tín, bạn bè/hstat "Bạn bè", "Lưu báo giá"/"Đã lưu".
- **I2 Một điểm nối:** không bảng/endpoint nối mới; chỉ thêm PORT đọc (brand, caps, uy tín) theo ADR-0031 — "Lưu báo giá" vẫn là điểm nối nghiệp vụ duy nhất.
- **I3 Quyền theo nhóm:** `canView` độc lập từng nhóm (Cá nhân / Công ty / SHT); thiếu quyền ⇒ không render.
- **I4 Ẩn UI không thay kiểm quyền server:** guard pack + RLS (`ext_deny`) vẫn là lớp quyết định; mọi port mới phải có test chặn đọc chéo tenant và test vai đối tác.

## 4. Quyết định đã chốt
| D | Quyết định |
|---|---|
| D1 | Nguồn chuẩn = PDF + intake này (thư mục `docs/specs/CR-106-community-unify/` của PDF không tồn tại); mã CR-110, COM-FR-26..46 (Câu 1, 2) |
| D2 | SSO: dùng hand-off có sẵn (`web-kit/auth/sso.ts` `handOffUrl`, `POST /auth/sso/code`, `contracts-web/routes/sso.tsx`), rơi về đăng nhập khi lỗi; đối tác bị chặn (Câu 3) |
| D3 | Host deep-link do server cấp: `viewer.contractsUrl` từ `CONTRACTS_WEB_URL` (cùng nguồn `shtUrl` hiện có); không `VITE_CONTRACTS_URL`; bỏ/đổi tên `shtUrl` (Câu 4) |
| D4 | Brand = công ty chủ quản cho mọi account trong tenant, kể cả đối tác (đối tác không có `/company`) (Câu 5) |
| D5 | Sidebar Community = Bảng tin · Bài đăng của tôi; "Đối tác" ở tab hồ sơ + rail (chỉ chủ quản) (Câu 6) |
| D6 | Hồ sơ đối tác 3 tab (Giới thiệu, Bài đăng, Ảnh & tệp); tab Đối tác + hstat Bạn bè chỉ chủ quản (Câu 7) |
| D7 | Bản đầu community chỉ light; bỏ qua `theme` công ty (Chưa rõ) (Câu 8) |
| D8 | Bỏ `accent` khỏi `CommunitySettings`; server bỏ qua `accent` cũ do client cũ gửi, không 422 |
| D9 | I2/P0-AC03 sửa thành "không bảng mới; chỉ thêm port đọc" (Câu 9) |
| D10 | Tab Đối tác dùng lại `GET /pack/community/partners` + `HostBookReader`; chỉ thêm `/profile/:orgId/media` (Câu 10) |
| D11 | Nhãn EN dùng ngay, duyệt ở UAT (Câu 11) |
| D12 | "Áp dụng cho cả công ty" chỉ ở nhóm Công ty/SHT; nhóm Cá nhân không dùng tiêu đề này (Câu 12) |
| D13 | Không App switcher ở topbar community (Câu 13) |
| D14 | Mâu thuẫn nội bộ nguồn đã xử lý: (1) P3-AC02 → D6; (2) thẻ "Hoạt động" bỏ bạn bè + câu SHT cho đối tác; (3) ẩn CSS → không render; (4) G2 → D5; (5) D5 gốc → D4; (6) D13 gốc → D7; (7) P0-AC03 → D9; (8) trạng thái "READY" nhưng còn mở shape → shape chốt ở §6 này; (9) Uy tín = 4 nhóm × vai (P4d); (10) → D12 |

## 5. FR và tiêu chí chấp nhận (AC)
Mã AC gốc (Pn-ACnn) ở ngoặc để truy vết.

**COM-FR-26 Bất biến lớp vỏ** (P0). Không trộn nghiệp vụ/dữ liệu.
- Community không có route/link/nút nào dẫn tới SHT với đối tác (P0-AC01).
- Diff không thêm import chéo community↔contracts (luật depcruise mới, COULD) (P0-AC02); không bảng/endpoint nối mới ngoài port đọc (P0-AC03).
- `canView` từng nhóm độc lập, thiếu quyền ⇒ không render (P0-AC04).

**COM-FR-27 Topbar thương hiệu công ty** (P1).
- Topbar hiện tên + logo công ty chủ quản; không logo "Sổ Hợp Tác" (P1-AC01).
- Không navtab "Bảng tin", không bánh răng, không nút Đăng xuất riêng (P1-AC02).
- Ô tìm (debounce 250ms) và chuông/badge hoạt động như trước (P1-AC03).

**COM-FR-28 Sidebar cố định ở Shell** (P1).
- Sidebar hiện ở Bảng tin và Hồ sơ, sticky; ≤900px thành drawer; không link Cài đặt (P1-AC04).
- Chuyển Bảng tin↔Hồ sơ không mất trạng thái xổ/gập (P1-AC05).

**COM-FR-29 Nhóm xổ/gập: Community + SHT** (P1).
- Mỗi nhóm xổ/gập bằng chuột và bàn phím; trạng thái nhớ trong localStorage (P1-AC06).
- Chủ quản đủ quyền thấy nhóm SHT đúng 4 mục (Uy tín `?sec=rep`, Kinh doanh `?sec=biz`, Dò giá `?sec=scout`, Quy trình duyệt `?sec=flow`), href = `contractsUrl` + đường dẫn, mở cùng tab (P1-AC07).
- Đối tác: DOM không có nhóm SHT/`sht-link` (P1-AC08); chủ quản thiếu quyền contracts: không thấy nhóm SHT (P1-AC09).

**COM-FR-30 User-menu từ avatar** (P1).
- Bấm avatar mở dropdown đúng 3 mục (Tường nhà · Cài đặt chung · Đăng xuất), `role=menu`, Esc/bấm ngoài đóng; đầu menu có tên + công ty (P1-AC10).
- "Tường nhà" mở hồ sơ của mình; "Đăng xuất" gọi logout community, không đăng xuất SHT (cookie `ai_rt_community`) (P1-AC11).

**COM-FR-31 Routing feed/profile + dialog Cài đặt** (P1).
- "Cài đặt chung" mở dialog; không còn view `settings`; đóng dialog giữ route nền (P1-AC12).
- `#/settings` (link cũ) hiện Bảng tin + dialog (P1-AC13); `#/profile`, `#/profile/<orgId>` hoạt động như trước (P1-AC14).

**COM-FR-32 Feedbar + Composer** (P2).
- 5 tab sticky đúng thứ tự (Tất cả · Cần bán · Cần mua · Thông báo · …) kèm số đếm khớp (P2-AC01).
- Composer mặc định thu gọn (prompt + 3 nút loại); bấm mở form đầy đủ; đăng xong có toast (P2-AC02).
- Không còn `.ws/.wsside`; sidebar Shell là duy nhất; ≤900px rail xuống dưới (P2-AC07). Đổi VI↔EN đổi mọi nhãn, không đổi dữ liệu bài (P2-AC08).

**COM-FR-33 PostCard** (P2).
- Cần bán không giá ⇒ "Giá chào: Liên hệ"; deal strip đúng (P2-AC03).
- Đối tác không bao giờ thấy "Lưu báo giá"/"Đã lưu"/callout giá vốn (P2-AC04).
- Màu vạch/pill theo màu công ty (brand accent), không theo người (P2-AC05).

**COM-FR-34 Rail** (P2).
- Rail chủ quản: Bộ lọc + Đối tác; rail đối tác: Bộ lọc (không Đối tác) (P2-AC06).

**COM-FR-35 Hero + số liệu hồ sơ** (P3).
- Hồ sơ hiện cover, logo lớn, tên, dòng phụ, chỉ số (hstats); cover/logo theo brand; đối tác không thấy hstat Bạn bè (P3-AC01, D6).

**COM-FR-36 Mô hình section + hàng tab** (P3).
- Section registry `{id, labelVi, labelEn, canView, source}`; chủ quản 4 tab, đối tác 3 tab (P3-AC02 sửa theo D6).
- Thêm section = thêm khai báo + component; `canView=false` ⇒ không render (P3-AC03).
- `#/profile[/orgId][/section]`; `#/profile/<id>/files` mở đúng mục; section lạ về Bài đăng (P3-AC04).

**COM-FR-37 Nội dung 4 mục** (P3).
- Giới thiệu chỉ đọc, không chứa HĐ hoa hồng; Bài đăng: Composer chỉ ở hồ sơ của mình (P3-AC07).
- Đối tác (chỉ chủ quản): liệt kê bạn bè công ty; cột "Điểm uy tín" chỉ khi `caps.contracts` ≠ none (P3-AC05).
- Ảnh & tệp: chỉ media của bài người xem được thấy, giữ che liên hệ; không lộ media "Chỉ chủ quản" cho đối tác (P3-AC06).

**COM-FR-38 Khung dialog Cài đặt + nav + quyền** (P4a).
- Dialog từ user-menu; Esc đóng; 3 nhóm theo quyền (Cá nhân/Công ty/SHT); không đủ quyền ⇒ không render (P4a-AC01..02, 08).
- Đối tác chỉ nhóm Cá nhân và không gọi API contracts (P4a-AC03); công tắc lưu ngay (P4a-AC05).
- Mục SHT là thẻ + "Mở trong Sổ Hợp Tác" → `contractsUrl/settings?sec=<id>`, Thành viên → `/settings/members` (P4a-AC04).

**COM-FR-39 Cá nhân [Community]** (P4b).
- Tài khoản: Họ tên, Công ty (chỉ đọc), Ngôn ngữ (`community.lang`); không còn ô chọn màu; màu + logo công ty chỉ đọc (P4b-AC01..04).
- Thông báo 8 công tắc, 5 HOST_ONLY ẩn với đối tác (P4b-AC06).
- Client cũ gửi `accent` ⇒ server bỏ qua, không 422 (P4b-AC05, D8).

**COM-FR-40 Công ty + Thành viên [SHT]** (P4c). Màn đích đã có ở contracts-web.
- Mục Công ty (`?sec=co`) và Thành viên (`/settings/members`) deep-link đúng; đối tác không thấy (P4c-AC01..06,08).
- CSS community có màu rose (P4c-AC07, đi với COM-FR-45).

**COM-FR-41 Uy tín / Kinh doanh / Dò giá** (P4d). Deep-link `?sec=rep|biz|scout`; thẻ + href đúng; chỉ chủ quản đủ quyền (P4d-AC01..03, 07).

**COM-FR-42 Quy trình duyệt + Ký số** (P4d). Deep-link `?sec=flow`; thẻ chỉ xem (sơ đồ readonly ở SHT); chưa gán ⇒ "Chưa gán…"; Ký số ở contracts-web (P4d-AC04..09).

**COM-FR-43 Deep-link + cách ly + caps** (P5).
- 4 link SHT trỏ đúng 4 đường dẫn contracts-web (P5-AC01).
- Đối tác: DOM không link SHT; gõ tay URL SHT ⇒ bị chặn (HT-76, `external-deny`) (P5-AC02).
- Không endpoint/bảng nối mới ngoài port đọc (P5-AC03); `viewer.caps.contracts` ∈ none|read|write|admin, đối tác luôn none.

**COM-FR-44 SSO hand-off** (P5). Bấm link SHT: nếu chưa có phiên contracts ⇒ đi qua hand-off (`/auth/sso/code` + `handOffUrl`) vào đúng trang; lỗi ⇒ rơi về màn đăng nhập rồi vào đúng trang (P5-AC04). Đối tác không hand-off.

**COM-FR-45 Brand dùng chung từ `/company`** (P5, contract MỚI).
- Brand account = `{name, appName?, logo, accent}` từ công ty chủ quản (P5-AC05).
- `GET /pack/community/brand` trả đúng 4 trường kể cả cho đối tác; có test đường chính + chặn đọc chéo tenant (P5-AC06).
- Chưa có brand ⇒ chữ cái đầu + indigo; app vẫn chạy (P5-AC07).

**COM-FR-46 Hạ tầng i18n VI/EN** (P5, làm trước).
- `locales/community/{vi,en}`; không còn chuỗi VI viết thẳng (lint/grep) (P5-AC08).
- Thiếu khoá EN ⇒ rơi về VI, không hiện khoá thô; chuyển ngôn ngữ đổi tức thì, lưu `community.lang` (P5-AC09).

## 6. Shape API / port (chốt; zod ở `packages/contracts/src/pack-community`)
- **Brand:** port `CompanyBrandReader.read(tenant) → {name, appName?, logo, accent}` (adapter đọc `pack-contracts/company.ts`, bảng contracts `ext_deny` nên đọc qua port bằng server). `GET /pack/community/brand` → đúng 4 trường (strict), mọi vai. `accent` ∈ 6 màu `company.ts` (gồm rose); mặc định indigo.
- **Caps:** port `ContractsCapReader.read(viewer) → 'none'|'read'|'write'|'admin'` (mẫu `packActionsFor(packAccessInput(...))` ở `community-wire.mount.ts`). `CommunityViewer.caps = { contracts }`; đối tác luôn `none`.
- **Host:** `viewer.contractsUrl` từ server `CONTRACTS_WEB_URL` (bỏ `shtUrl`; chỉ trả cho chủ quản có quyền, đối tác nhận null/không có).
- **Tab Đối tác:** dùng lại `GET /pack/community/partners` (`org.routes.ts`) + `HostBookReader.read().partners`; cột Điểm uy tín chỉ khi `caps.contracts` ≠ none (điểm đọc qua port có sẵn). Không thêm `/profile/:orgId/partners`.
- **Media:** MỚI `GET /pack/community/profile/:orgId/media` → `ProfileMediaSchema` (chỉ attachment của bài người xem được thấy theo visibility; che liên hệ như feed). Int: đường chính + chặn chéo tenant + đối tác không thấy bài "Chỉ chủ quản".
- **Settings:** `CommunitySettings` bỏ `accent` (`viewer.ts` strictObject hiện bắt buộc), server nhận-và-bỏ-qua `accent` cũ.
- Không migration.

## 7. Lát (slice)
| Lát | FR | Phụ thuộc | Làn | Ghi chú |
|---|---|---|---|---|
| cr110-docs | — | — | nhanh (Haiku) | Tài liệu này, ghi CR-110, chốt 13 câu |
| cr110-i18n | 46 | — | nhanh (Sonnet) | Làm trước; loader + vi/en + `community.lang`; luật grep chuỗi VI |
| cr110-ports | 43 (caps), 45 | — | **đầy đủ** (Opus medium BE+int; Sonnet contract hiển thị) | `CompanyBrandReader`, `ContractsCapReader`, `GET /brand`, `viewer.caps`/`contractsUrl`; int: đường chính, đối tác (4 trường), chéo tenant |
| cr110-profile-api | 37 (media) | ports | **đầy đủ** (Opus medium) | `GET /profile/:orgId/media`; dùng lại partners/HostBookReader |
| cr110-sht-sec | 40..42 (tiền đề) | — | nhanh (Sonnet) | contracts-web `/settings?sec=co\|rep\|biz\|scout\|flow` (`routes/_authed/settings/index.tsx`, `features/settings/lib/bus.ts`); song song |
| cr110-shell | 27..31, 43 (UI) | i18n, ports (mock được) | nhanh (Sonnet) | Topbar, Sidebar, UserMenu, routing; viết e2e, không chạy |
| cr110-feed | 32..34 | shell | nhanh (Sonnet) | Composer thu gọn, bỏ `.wsside`, accent theo brand |
| cr110-profile-ui | 35..37 | shell, profile-api | nhanh (Sonnet) | registry section + tab; `Profile.tsx` → `features/profile/*` |
| cr110-settings | 38..42, rose | shell, sht-sec | nhanh (Sonnet; phần server bỏ `accent`: Sonnet) | dialog + bỏ màu theo người + thêm rose vào `globals.css` |
| cr110-sso | 44 | shell | nhanh (Sonnet) | `handOffUrl` + `/auth/sso/code` |
| cuối đợt | — | tất cả | — | qc (Haiku) sửa e2e khoá + relock; review + security Opus medium; gộp `docs/current/community/{hien-thi,nghiep-vu}.md`, `pack-boundary.md`, ADR-0031, CODEMAP; `test:all` + e2e một lần |

**e2e khoá — chỉ qc sửa/relock:** `e2e/community-web/feed.cm.ts` (bánh răng/Đăng xuất/composer/bước Settings) và `e2e/community-web/roles.cs.ts` (`sht-link`, nhóm SHT, hồ sơ 3/4 tab). Lát chỉ viết e2e MỚI (file mới), không sửa file khoá; việc sửa 2 file này gom cho qc cuối đợt. Test int mới cần: `community.routes.int.test.ts` (settings bỏ accent), brand, caps, media.
