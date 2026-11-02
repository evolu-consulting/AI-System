# Intake Đầy đủ — Community hợp nhất (CR-110; trong tài liệu gốc ghi CR-106)

Ngày 2026-11-02 · intake-analyst · Nguồn: `spec-community-hop-nhat.txt` (PDF 29 trang), `mockup-community-hop-nhat.html`, `dac-ta-ui-man-moi.html` (cùng thư mục). Đánh số FR giữ COM-FR-26..46: số cuối hiện có là COM-FR-25 (`docs/intake/community/2026-10-28-intake.md:66`, CR-102), nên **không trùng**. CR-106 đã dùng cho canvas quy trình duyệt (`docs/CHANGE-REQUESTS.md:10`) ⇒ dùng **CR-110**.

## Tóm tắt: 56 ý · Đã có 18 · Mâu thuẫn 6 · Mới 26 · Mơ hồ 6 · Ngoài phạm vi 0

## Bảng ý
| R | Trích | Loại | Đối chiếu (mã / file:dòng) | Ghi chú |
|---|---|---|---|---|
| R1 | "Hợp nhất ở lớp vỏ; giữ 2 app riêng" (Q1) | Mới | `docs/platform/modules.md` (2 app riêng) | COM-FR-26, MUST |
| R2 | I1 "Đối tác không thấy SHT: không link/route/API" | Đã có | `current/community/hien-thi.md:126-127` HT-75/76; `org.routes.ts:52` chỉ chủ quản có shtUrl | UI mới phải giữ |
| R3 | I2 "nối nhau một điểm: Lưu báo giá"; P0-AC03 "không endpoint mới ngoài Lưu báo giá" | Mơ hồ | ADR-0031; `community/application/pack-ports.ts:47-104` | Chính spec thêm brand, caps, đọc uy tín ⇒ P0-AC03 sai nghĩa đen (Câu 9) |
| R4 | I3 "community-owner vs contracts-owner; kiểm theo từng nhóm" | Mới | `pack-community/viewer.ts:17-27` chỉ có `role` | Cần caps (R44) |
| R5 | I4 "Ẩn UI không thay kiểm quyền server" | Đã có | pack guard + RLS `ext_deny` (`current/community/nghiep-vu.md:122`) | — |
| R6 | P0-AC02 "lint import-boundary: community không import contracts" | Mới | `.dependency-cruiser*` không có luật community | Luật depcruise mới, COULD |
| R7 | Topbar: logo/tên = công ty, bỏ logo "Sổ Hợp Tác", navtab, bánh răng, nút Đăng xuất (T2–T4, T7, T9) | Mới | `community-web/ui/TopBar.tsx:141` (bánh răng), `:156` (Đăng xuất) | COM-FR-27; đổi hiện trạng |
| R8 | Ô tìm debounce 250ms + chuông/badge giữ (T5, T6) | Đã có | `TopBar.tsx` | — |
| R9 | Sidebar Shell mọi view, sticky, ≤900px drawer, bỏ link Cài đặt (S1–S5) | Mới | `ui/App.tsx`, `Profile.tsx:87` (.wsside có "Cài đặt") | COM-FR-28 |
| R10 | Nhóm xổ/gập, nhớ localStorage (G1) | Mới | không có | COM-FR-29 |
| R11 | Nhóm Community: "Bảng tin · Bài đăng của tôi · (chủ quản) Đối tác" (G2) | Mơ hồ | mockup ghi "Đối tác rời sidebar vào hồ sơ" (Q4) | Câu 6 |
| R12 | Nhóm SHT 4 deep-link, chỉ chủ quản + quyền gói contracts (G3, G4, P1-AC07/09) | Mới | `Profile.tsx:51-52` hiện chỉ 1 link `sht-link` | COM-FR-29/43 |
| R13 | "Host = VITE_CONTRACTS_URL (build-time); không đặt ⇒ /contracts" (D4) | Mâu thuẫn | server đã cấp `shtUrl` từ `CONTRACTS_WEB_URL` (`hub-api/.../community.mount.ts:89`, `viewer.ts:64-65`) | Câu 4 |
| R14 | Đối tác: DOM không có nhóm SHT/sht-link (G6, P1-AC08) | Đã có | HT-75/76; e2e `e2e/community-web/roles.cs.ts` | Mockup ẩn bằng CSS, code không được làm vậy |
| R15 | User-menu avatar: Tường nhà · Cài đặt chung · Đăng xuất; Esc; role=menu; đầu menu tên + công ty (U1–U5) | Mới | không có | COM-FR-30 |
| R16 | Bỏ route settings → dialog; `#/settings` cũ ⇒ Bảng tin + dialog (R1–R4, D11) | Mới | `ui/ctx.tsx:19,48` có route `settings` | COM-FR-31 |
| R17 | "Mọi nhãn EN … là đề xuất dịch, chờ duyệt" | Mơ hồ | — | Câu 11 |
| R18 | 5 tab sticky kèm đếm; chip lọc ở Hồ sơ (F1, F2) | Đã có | `docs/specs/community-feed-redesign/tasks.md:10`; `hien-thi.md` mục 0 | — |
| R19 | Composer thu gọn: prompt + 3 nút loại (F3) | Mới | `ui/Composer.tsx` (chưa thu gọn; spec tự ghi "kiểm") | COM-FR-32 |
| R20 | Form đầy đủ: người xem, điền sẵn từ SHT, ≤10 ảnh/≤2 video, toast (F4) | Đã có | `ui/Composer.tsx`, `nghiep-vu.md` | — |
| R21 | Bỏ `.ws/.wsside`; sidebar Shell là duy nhất; ≤900px rail xuống dưới (F5, P2-AC07) | Mới | `ui/App.tsx:13`, `Profile.tsx` | COM-FR-32 |
| R22 | PostCard C1–C7 (vạch/pill, dải deal, callout, Lưu báo giá, bình luận, nhãn, ⋯) | Đã có | `community-feed-redesign/tasks.md:12`; `hien-thi.md:19` | Chỉ đổi nguồn accent (R47) |
| R23 | Rail theo vai (R1–R3) | Đã có | `ui/FeedRail.tsx`; tasks.md:11 | Nhãn hiện tại "Đối tác trong chợ" ≠ "Đối tác" |
| R24 | Đối tác không thấy "Lưu báo giá"/callout (P2-AC04) | Đã có | `hien-thi.md` HT-6x | — |
| R25 | Hero: cover, biglogo, tên, dòng phụ, "đối tác đã rời", hstats (H1–H3) | Đã có | `viewer.ts:55-66` ProfileSchema.stats | Biglogo brand + cover theo accent (H4) là phần mới, đi với R47 |
| R26 | Section registry `{id,labelVi,labelEn,canView,source}`; URL `#/profile[/orgId][/section]`; section lạ ⇒ Bài đăng (S1–S4) | Mới | không có | COM-FR-36 |
| R27 | Tab Giới thiệu chỉ đọc; không chứa HĐ hoa hồng (D17) | Mới | `ProfileSchema.org.blurb` | COM-FR-37 |
| R28 | Tab Bài đăng; Composer chỉ ở hồ sơ mình (P3-AC07) | Đã có | `ui/Profile.tsx` (FeedList) | — |
| R29 | Tab Đối tác: bạn bè công ty; cột "Điểm uy tín" chỉ chủ quản có quyền contracts; `GET /profile/:orgId/partners` | Mới | đã có `GET /pack/community/partners` (`org.routes.ts:75`) + `HostBookReader.read().partners` (`pack-ports.ts:88-93`) | Câu 10: dùng lại thay vì endpoint mới |
| R30 | Tab Ảnh & tệp: media bài người xem được thấy, giữ che liên hệ; `GET /profile/:orgId/media` | Mới | không có | Rủi ro lộ media "Chỉ chủ quản" ⇒ làn đầy đủ |
| R31 | P3-AC02 "Chủ quản & đối tác đều thấy 4 tab" | Mâu thuẫn | trong chính spec: mockup `adm-only` ẩn tab Đối tác; P3 việc còn mở "đối tác … bạn bè (đề xuất: ẩn)" | Câu 7 |
| R32 | Dialog Cài đặt từ user-menu; tiêu đề "Áp dụng cho cả công ty"; Esc; giữ route (P4a) | Mới | contracts-web có mẫu `SettingsDialog.tsx` | Tiêu đề sai với nhóm Cá nhân (Câu 12) |
| R33 | 3 nhóm theo quyền; không đủ quyền ⇒ không render; đối tác chỉ Cá nhân, không gọi API contracts | Mới | — | COM-FR-38 |
| R34 | Mục SHT = thẻ + "Mở trong Sổ Hợp Tác" → `/settings?sec=<id>`; Thành viên → `/settings/members` | Mới | — | COM-FR-41/42 |
| R35 | Tiền đề contracts-web: `/settings?sec=co\|rep\|biz\|scout\|flow` | Mới | `contracts-web/routes/_authed/settings/index.tsx:6` redirect members; dialog mở qua bus `features/settings/lib/bus.ts:2`, `types.ts:13` | Việc nền contracts-web |
| R36 | Tài khoản: Họ tên, Công ty chỉ đọc + Ngôn ngữ (`community.lang`) | Mới | `ui/Settings.tsx` | COM-FR-39 |
| R37 | Giao diện: bỏ 5 ô màu; màu + logo công ty chỉ đọc (Q3, P0-AC05) | Mâu thuẫn | hiện màu theo người: `ctx.tsx:53` (`community.accent`), `viewer.ts:81-84` (`CommunitySettings.accent`), `hien-thi.md:19` | Thay luật đã gộp current ⇒ cập nhật current |
| R38 | D13 "Sáng/Tối theo công ty" | Mơ hồ | P2 việc còn mở: "bảng tin bản đầu chỉ light"; `company.ts:8` có theme auto/light/dark | Câu 8 |
| R39 | Thông báo 8 công tắc, 5 HOST_ONLY ẩn với đối tác, lưu ngay | Đã có | `viewer.ts:69-78`; `nghiep-vu.md:99` | — |
| R40 | Bỏ accent khỏi CommunitySettings; server bỏ qua accent cũ, không 422 (D8, P4b-AC05) | Mới | `viewer.ts:81` strictObject bắt buộc `accent` | Đổi contract `@ai/contracts` |
| R41 | Màn Công ty (tên, tên app, logo ≤1MB, 6 màu, giao diện, MST, duyệt, kho, pháp lý) + Thành viên ở contracts-web | Đã có | `pack-contracts/company.ts:6,35-50`; `settings/members.tsx` | — |
| R42 | "Thêm rose vào CSS community" | Mới | `viewer.ts:14` thiếu rose; `company.ts:6` có rose; `styles/globals.css:16-40` | COM-FR-45 |
| R43 | Uy tín/Kinh doanh/Dò giá/Quy trình duyệt (chỉ xem) + Ký số ở contracts-web | Đã có | `SettingsDialog.tsx:24`; `FlowCurrentPane.tsx:109` (EsignSetting); CR-105/106/108 | Spec ghi "5 ô nhóm×vai" ở phần nghiệp vụ, "4 nhóm" ở P4d |
| R44 | `CommunityViewer.caps.contracts` (none/read/write/admin) qua port `ContractsCapReader`; đối tác luôn none | Mới | không có (`viewer.ts:17-27`); mẫu `packActionsFor(packAccessInput(...))` ở `community-wire.mount.ts:32-33` | Quyền ⇒ làn đầy đủ |
| R45 | "SSO fallback cho bản đầu … SSO liền mạch = CR sau" (Q11, COM-FR-44) | Mâu thuẫn | đã có hand-off SSO: `web-kit/auth/sso.ts:68` `handOffUrl` (tự rơi về đăng nhập), `POST /auth/sso/code` (`admin-api/.../sso.routes.ts:17`), `contracts-web/routes/sso.tsx`, đối tác bị chặn (`external-deny.int.test.ts:93-97`) | Câu 3: liền mạch gần như không tốn thêm |
| R46 | Đăng xuất community không đăng xuất SHT | Đã có | cookie riêng `ai_rt_community` (`community-web/api/session.ts:1`) | — |
| R47 | Brand `GET /pack/community/brand` `{name, appName?, logo, accent}` từ `/company`, port `CompanyBrandReader`, đúng 4 trường | Mới | không có; nguồn `pack-contracts/company.ts` | Đối tác đọc bảng contracts (đang `ext_deny`) ⇒ làn đầy đủ |
| R48 | D5 "mỗi account hiện brand công ty mình" | Mơ hồ | trái T2/COM-FR-45 "brand từ công ty chủ quản"; công ty đối tác (`admin.external_orgs`) không có brand | Câu 5 |
| R49 | Chưa có brand ⇒ chữ cái đầu + indigo; app vẫn chạy (P5-AC07) | Mới | — | COM-FR-45 |
| R50 | i18n VI/EN community: `locales/community/{vi,en}`, thiếu EN ⇒ VI, `community.lang`, không chuỗi VI viết thẳng | Mới | chỉ có `community-web/ui/login-i18n.ts:1`; contracts-web dùng react-i18next | COM-FR-46, làm trước |
| R51 | "READY … Nguồn chuẩn = docs/specs/CR-106-community-unify/" (+ P6-truy-vet.md, P3/P5 §5.1) | Mâu thuẫn | thư mục và file không có trong repo; chưa ghi readiness | Câu 1 |
| R52 | Mã "CR-106" | Mâu thuẫn | `CHANGE-REQUESTS.md:10` CR-106 = canvas quy trình duyệt | Đã chốt CR-110 |
| R53 | Nghiệp vụ Community/SHT, actor, UC-CM-01..14, UC-SHT | Đã có | `current/community/nghiep-vu.md`, `current/sht/*` | Chỉ là bối cảnh |
| R54 | Quy trình duyệt + Ký số (approval_enabled, esign_enabled, neo ký, approval_settings_audit) | Đã có | `current/sht/duyet-ky-so.md`; CR-105/106/108 | — |
| R55 | Ngoài phạm vi (kết bạn SĐT, Zalo/SMS, giao hàng, công nợ…) | Đã có | `nghiep-vu.md` mục ngoài phạm vi | — |
| R56 | (không nhắc) App switcher trên topbar community | Mơ hồ | admin/contracts/chat-web có `AppSwitcher` (`web-kit/ui/AppSwitcher.tsx`), community-web không có | Câu 13 |

## Ảnh hưởng
| R | Spec | Đã qua Gate? | Test khoá | Artboard | Code | Mốc |
|---|---|---|---|---|---|---|
| R1,R4,R6 | tạo `docs/specs/cr110-*/tasks.md` | Không (Luật 0b) | — | — | depcruise config | Đợt CR-110 mới |
| R7–R16 | cr110-shell | Không | `e2e/community-web/feed.cm.ts`, `roles.cs.ts` (sht-link, bánh răng) ⇒ qc sửa + relock | mockup đã có (P1) | `community-web/ui/{TopBar,App,ctx,Profile}.tsx` + Sidebar/UserMenu mới | — |
| R13 | cr110-shell | Không | — | — | bỏ `shtUrl` hoặc thêm `contractsUrl` vào viewer | — |
| R19,R21 | cr110-feed | Không | `feed.cm.ts` | — | `ui/{Composer,Feed}.tsx`, `styles/feed.css` | — |
| R26–R30 | cr110-profile-ui + cr110-profile-api | Không | `roles.cs.ts` (hồ sơ) | mockup P3 | `ui/Profile.tsx` → `features/profile/*`; hub `org.routes.ts` | — |
| R31 | sửa spec/mockup | — | — | mockup sửa hstat/tab | — | — |
| R32–R36 | cr110-settings | Không | `feed.cm.ts`/`roles.cs.ts` nếu có bước Settings | dac-ta P4 | `ui/Settings.tsx` → dialog | — |
| R35 | cr110-sht-sec | Không | e2e contracts-web settings (mở dialog) | — | `contracts-web/routes/_authed/settings/index.tsx`, `features/settings/lib/bus.ts` | — |
| R37,R40,R42 | cr110-settings + contract | Không | int `community.routes.int.test.ts` (settings) | — | `packages/contracts/src/pack-community/viewer.ts`, `ctx.tsx`, `globals.css` | — |
| R44,R47,R49 | cr110-ports | Không (làn đầy đủ: readiness 1 vòng) | int mới + chặn đọc chéo tenant + đối tác | — | `pack-ports.ts`, `community-wire.mount.ts`, `contracts/*` adapter đọc company, `org.routes.ts` | — |
| R45 | cr110-sso | Không | — | — | `community-web` gọi `/auth/sso/code` + `handOffUrl` | — |
| R50 | cr110-i18n | Không | — | — | `community-web/src/locales/*`, i18n loader | Làm trước |
| R37,R39 | `docs/current/community/hien-thi.md:19`, `nghiep-vu.md` | Gộp cuối đợt | — | — | — | — |
| R51,R52 | `docs/CHANGE-REQUESTS.md` (CR-110) | — | — | — | — | — |

## CR đề xuất
| CR | R | Tóm tắt thay đổi | Tài liệu cần sửa |
|---|---|---|---|
| CR-110 (trong tài liệu gốc ghi CR-106) | R1–R50 | Community hợp nhất lớp vỏ: Shell topbar brand + sidebar 2 nhóm (Community, SHT deep-link) + user-menu; hồ sơ kiểu Facebook (registry section, partners/media); Cài đặt chung dạng dialog phân quyền theo nhóm; brand chung từ `/company`; `viewer.caps.contracts`; i18n VI/EN; bỏ màu theo người; contracts-web `?sec=`. COM-FR-26..46. | `CHANGE-REQUESTS.md`, `docs/specs/cr110-*/tasks.md` (mỗi lát), `current/community/{hien-thi,nghiep-vu}.md` (cuối đợt), `pack-boundary.md` (port mới), ADR-0031 (liệt kê port), CODEMAP |

## Đề xuất chia lát
| Lát | FR | Làn | Model | Phụ thuộc | Ghi chú |
|---|---|---|---|---|---|
| cr110-docs | — | — | Haiku | — | Ghi CR-110, khung `docs/specs/cr110-*/tasks.md` từ PDF; sửa chỗ mâu thuẫn theo câu trả lời |
| cr110-i18n | 46 | nhanh | Sonnet | — | loader + vi/en + `community.lang`; luật grep chuỗi VI |
| cr110-ports | 43(caps), 45, (49) | đầy đủ | Opus medium (BE+int); Sonnet cho contract hiển thị | — | `CompanyBrandReader`, `ContractsCapReader`, `GET /brand`, `viewer.caps`; int: đường chính, đối tác (chỉ 4 trường), chặn chéo tenant; không migration |
| cr110-profile-api | 37 (partners/media) | đầy đủ | Opus medium | ports | media chỉ bài người xem được thấy; ưu tiên dùng lại `GET /partners` + HostBookReader |
| cr110-sht-sec | 41/42 tiền đề | nhanh | Sonnet | — | contracts-web `/settings?sec=`; chạy song song |
| cr110-shell | 27–31, 43(UI) | nhanh | Sonnet | i18n, ports (mock caps/brand được) | Topbar, Sidebar, UserMenu, routing; viết e2e, không chạy |
| cr110-feed | 32–34 | nhanh | Sonnet | shell | Composer thu gọn, bỏ .wsside |
| cr110-profile-ui | 35–37 | nhanh | Sonnet | shell, profile-api | registry section + 4 tab |
| cr110-settings | 38–40, D8, rose | nhanh (phần server accent: Sonnet) | Sonnet | shell, sht-sec | dialog + bỏ accent + server bỏ qua accent cũ |
| cr110-sso | 44 | nhanh | Sonnet | shell | dùng `handOffUrl` có sẵn (nếu Câu 3 = mặc định) |
| cuối đợt | — | — | Haiku (e2e/relock), Opus medium (review+security), Sonnet (gộp current) | tất cả | qc sửa `feed.cm.ts`/`roles.cs.ts`; e2e + `test:all` một lần |

## Chỗ tài liệu gốc mâu thuẫn nội bộ
1. P3-AC02 "đối tác thấy 4 tab" ↔ mockup ẩn tab Đối tác (`adm-only`) ↔ việc còn mở P3 "đề xuất ẩn bạn bè".
2. Mockup hồ sơ, thẻ "Hoạt động" không `adm-only` (dòng 439): đối tác thấy "38 bạn bè" và câu "Số liệu kinh doanh (doanh thu, lãi, kho) nằm trong Sổ Hợp Tác". Trái P3-AC02 ("không chữ nào về SHT") và trái `ProfileSchema.stats.friends` (chỉ chủ quản).
3. Mockup chỉ ẩn bằng CSS (`body.role-partner .adm-only{display:none}`): callout giá vốn BQ (dòng 363), nhóm SHT, Lưu báo giá vẫn có trong DOM. Trái P1-AC08 và I1. Đây là chỗ cách ly hay sai nhất; code phải không render.
4. G2 (sidebar có "Đối tác" cho chủ quản) ↔ Q4 và ghi chú mockup ("Đối tác rời sidebar vào hồ sơ").
5. D5 (brand công ty mình cho đối tác) ↔ T2/COM-FR-45 (brand công ty chủ quản).
6. D13 (Sáng/Tối theo công ty) ↔ P2 ("bảng tin bản đầu chỉ light").
7. I2/P0-AC03 (không endpoint nối mới ngoài Lưu báo giá) ↔ P5-AC03 (thêm brand) và thêm caps + cột uy tín qua port.
8. Trạng thái "READY, đã chốt 4 shape" ↔ "Việc còn mở (trước khi code): backend-lead chốt shape …" (trang 29). Bảng trạng thái vẫn ghi "Mặc định D3/L7/D6/D7".
9. Uy tín: phần nghiệp vụ ghi "5 ô nhóm×vai", còn P4d ghi "4 nhóm × vai".
10. P4a tiêu đề "Áp dụng cho cả công ty" ↔ nhóm Cá nhân là tuỳ chọn riêng từng người (ngôn ngữ, thông báo).

## Câu hỏi (một lượt)
1. Repo không có `docs/specs/CR-106-community-unify/` (P3/P5 §5.1, P6-truy-vet.md). Lấy PDF làm nguồn và tạo `docs/specs/cr110-*/tasks.md` theo Luật 0b? — mặc định: có; chỉ lát ports/profile-api chạy readiness 1 vòng.
2. Giữ COM-FR-26..46 (không trùng; số cuối là COM-FR-25)? — mặc định: giữ.
3. SSO: dùng luôn hand-off có sẵn (`/auth/sso/code` + `handOffUrl`, tự rơi về màn đăng nhập khi lỗi) thay cho "fallback, liền mạch để CR sau"? — mặc định: dùng hand-off ngay trong CR-110.
4. Host deep-link: biến build `VITE_CONTRACTS_URL` hay URL do server cấp (`CONTRACTS_WEB_URL`, như `shtUrl` hiện có)? — mặc định: server cấp qua viewer (`contractsUrl`), không cần build riêng mỗi môi trường.
5. Brand đối tác: brand công ty chủ quản hay brand công ty đối tác? — mặc định: mọi account trong tenant hiện brand chủ quản (đối tác không có `/company`).
6. "Đối tác" ở sidebar hay chỉ ở hồ sơ? — mặc định: sidebar Community = Bảng tin · Bài đăng của tôi; "Đối tác" ở tab hồ sơ + rail (chủ quản).
7. Hồ sơ của đối tác có bao nhiêu tab? — mặc định: đối tác thấy 3 tab (Giới thiệu, Bài đăng, Ảnh & tệp); tab Đối tác và hstat Bạn bè chỉ chủ quản; bỏ câu nhắc SHT ở thẻ "Hoạt động".
8. Sáng/Tối theo công ty trong community? — mặc định: bản đầu chỉ light, bỏ qua `theme` công ty (ghi Chưa rõ).
9. Sửa I2/P0-AC03 thành "không bảng mới; chỉ thêm port đọc: brand, caps, uy tín (ADR-0031)"? — mặc định: có.
10. Tab Đối tác: dùng lại `GET /pack/community/partners` + `HostBookReader` thay cho `GET /profile/:orgId/partners`? — mặc định: dùng lại; chỉ thêm `/profile/:orgId/media`.
11. Nhãn EN: dùng bản đề xuất ngay rồi duyệt ở UAT? — mặc định: có.
12. Tiêu đề "Áp dụng cho cả công ty" — mặc định: chỉ hiện ở nhóm Công ty/SHT.
13. Thêm App switcher (như admin/contracts/chat) vào topbar community? — mặc định: không làm trong CR-110.
