# P1 · Khung & điều hướng

Thuộc `index.md` (CR-106). Tuân P0 (Q1–Q3, I1–I3). Mã: **COM-FR-27…31**.

## 1. Mục tiêu
Một vỏ chung cho `community-web`: topbar mang thương hiệu công ty chủ quản, sidebar trái cố định cao hết trang với nhóm xổ/gập (Community, Sổ Hợp Tác), user-menu từ avatar, Cài đặt thành dialog.

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục Topbar (brand = công ty chủ quản: logo + tên + phụ đề "Chủ quản"; search; chuông; avatar → dropdown) và Sidebar (nhóm Community [Bảng tin, Bài đăng của tôi]; nhóm Sổ Hợp Tác [4 mục]).

## 3. Nghiệp vụ (từng mục: nhãn + nguồn)

### 3.1 Topbar — COM-FR-27
| # | Nội dung | Nhãn | Nguồn / cách đổi |
|---|---|---|---|
| T1 | Topbar cao 60px, sticky, nền trắng, viền dưới | Giữ | `ui/TopBar.tsx:82`, `styles/mockup.css:27-37` |
| T2 | Logo/tên = **công ty chủ quản** (không phải logo chữ "S" + "Sổ Hợp Tác / Community"); bấm = về Bảng tin | Đổi | hiện `TopBar.tsx:83-94` (`aria-label="Về bảng tin"`). Mỗi account hiện brand **công ty mình** (đối tác: công ty đối tác; chưa có brand ⇒ accent `indigo` + chữ cái đầu; P0 D5). Phụ đề: "Chủ quản" (mock) cho chủ quản |
| T3 | Bỏ logo app "Sổ Hợp Tác" khỏi topbar community | Đổi | `TopBar.tsx:89-93` |
| T4 | Bỏ navtab "Bảng tin" (trùng với logo và mục sidebar Community › Bảng tin) | Đổi | `TopBar.tsx:122-129` (nhãn "Bảng tin", `IconHome`) |
| T5 | Ô tìm kiếm bo tròn, debounce 250ms, placeholder cũ | Giữ | `TopBar.tsx:95-104`, `:75-78` |
| T6 | Chuông thông báo + badge số chưa đọc + popover "Thông báo" ("Đánh dấu đã đọc", "Chưa có thông báo.") | Giữ | `TopBar.tsx:130-138`, `:10-60` |
| T7 | Bỏ nút bánh răng "Cài đặt" và nút chữ "Đăng xuất" khỏi topbar (chuyển vào user-menu) | Đổi | `TopBar.tsx:139-146`, `:155-159` |
| T8 | Chọn persona dev chỉ khi mock | Giữ | `TopBar.tsx:106-121` |
| T9 | Màu nhấn của vỏ lấy từ brand công ty (xem P0 Q3, P0 §9) | Đổi | hiện theo người: `ui/ctx.tsx:55-65`, `ui/Settings.tsx:14-20` |

### 3.2 Sidebar trái cố định — COM-FR-28
| # | Nội dung | Nhãn | Nguồn / cách đổi |
|---|---|---|---|
| S1 | Sidebar có ở **mọi view** (Bảng tin, Hồ sơ), không chỉ Hồ sơ/Cài đặt; là thành phần của `Shell`, không của từng trang | Đổi | hiện `ui/App.tsx:13-24` (không sidebar), `.wsside` chỉ trong `Profile.tsx:35`, `Settings.tsx:57` |
| S2 | CỐ ĐỊNH, cao hết trang: `position: sticky; top: 60px; height: calc(100vh - 60px)`, tự cuộn bên trong nếu dài | Giữ kiểu / Đổi phạm vi | `styles/mockup.css:221-232` (đã sticky, rộng 252px); chuyển từ `.ws` per-page ra Shell |
| S3 | Khối đầu `mini`: avatar + tên công ty + "tên người · vai" (Admin / Thành viên / Đối tác) | Giữ | `Profile.tsx:36-46` |
| S4 | Nội dung cột chính bên phải sidebar, cuộn độc lập; ≤ 900px sidebar thu thành nút mở drawer (P0 D12) | Mới | `styles/mockup.css` (breakpoint 900px dùng ở `hien-thi.md` §0) |
| S5 | Chân sidebar (`.sidegroup.bottom`): bỏ link "Cài đặt" (đã có trong user-menu) | Đổi | `Profile.tsx:84-91` |

### 3.3 Nhóm xổ/gập — COM-FR-29
| # | Nội dung | Nhãn | Nguồn / cách đổi |
|---|---|---|---|
| G1 | Mỗi nhóm có tiêu đề bấm để xổ/gập (chevron), trạng thái nhớ trong phiên (`localStorage`, khoá mới `community.nav.<nhóm>`) | Mới | hiện `.sidecap` là nhãn tĩnh `Profile.tsx:47,61,73` |
| G2 | Nhóm **Community**: Bảng tin (route `feed`) · Bài đăng của tôi (route `profile` của chính mình) · (chủ quản) danh sách công ty Đối tác | Giữ nội dung / Đổi vị trí | `Profile.tsx:59-70` ("Bài đăng của tôi"), `:71-84` ("Đối tác" → `go({name:"profile",orgId})`) |
| G3 | Nhóm **Sổ Hợp Tác** — chỉ chủ quản (`isHostViewer`, và theo I3: đủ quyền gói `contracts`); 4 mục deep-link sang `contracts-web` | Mới (thay link đơn) | hiện `Profile.tsx:46-58` ("Mở Sổ Hợp Tác", `data-testid="sht-link"`, `href = p.shtUrl ?? "/contracts"`) |
| G4 | 4 mục SHT, nhãn verbatim từ `contracts.nav.*` và đường dẫn `contracts-web`: **Tổng quan** `/overview` · **Hợp đồng & giao dịch** `/contracts` · **Đối tác** `/partners` · **Sản phẩm & Giá** `/products` | Mới | `contracts-web/src/features/shell/lib/nav.ts:12-17`; `packages/i18n/locales/contracts/vi.json:202-207`. Tiền tố host `contracts-web` = `VITE_CONTRACTS_URL` (build-time), rơi về `/contracts` khi không đặt (P0 D4); không dùng `shtUrl` của server |
| G5 | Mở deep-link trong cùng tab (rời community); không iframe/nhúng. Phiên: bản đầu **fallback** (có thể phải đăng nhập lại ở SHT; Q11, P5 COM-FR-44) | Đổi | `ui/App.tsx:26-41`; Q2 |
| G6 | Đối tác (`!isHostViewer`): **không render** nhóm SHT, không có route/link (I1) | Giữ | `Profile.tsx:46` (`isHostViewer &&`), HT-75/76 |
| G7 | Mục đang chọn có `aria-current`/class `sidelink on` (Community); mục SHT không có "on" (đang ở app khác) | Giữ kiểu | `Profile.tsx:62-66` |

### 3.4 User-menu từ avatar — COM-FR-30
| # | Nội dung | Nhãn | Nguồn / cách đổi |
|---|---|---|---|
| U1 | Bấm avatar (bên phải topbar) mở dropdown, không điều hướng trực tiếp | Đổi | hiện `TopBar.tsx:147-154` (`go({name:"profile"})`, `aria-label="Hồ sơ {orgName}"`) |
| U2 | Dropdown có đúng 3 mục theo thứ tự: **Tường nhà** (→ route `profile` của chính mình) · **Cài đặt chung** (mở dialog, xem 3.5) · **Đăng xuất** (`logout()`) | Mới | "Đăng xuất": `TopBar.tsx:155-159` + `api/auth.ts`. Nhãn "Tường nhà", "Cài đặt chung": lấy từ brief; nhãn EN: đề xuất dịch, chờ duyệt (§7) |
| U3 | Đóng khi bấm ngoài / `Esc`; trả focus về avatar; `role="menu"` | Mới | chuẩn truy cập (như popover `TopBar.tsx:27` dùng `role="dialog"`) |
| U4 | "Đăng xuất" chỉ hiện khi `apiMode === "http"` (mock không có phiên) | Giữ | `TopBar.tsx:155` |
| U5 | Hiển thị đầu menu: tên người + công ty (read-only) | Mới | `viewer.name`, `viewer.orgName` |

### 3.5 Routing & Cài đặt dạng dialog — COM-FR-31
| # | Nội dung | Nhãn | Nguồn / cách đổi |
|---|---|---|---|
| R1 | Route: `feed` (mặc định) và `profile` (+ `orgId` tuỳ chọn); hash `#/feed`, `#/profile[/orgId]` | Giữ | `ui/ctx.tsx:19,46-51` |
| R2 | **Bỏ** route `settings` (view riêng, `SettingsPage` trong `Shell`); Cài đặt chung là **dialog** mở từ user-menu, không đổi hash, không `?settings=` (P0 D11) | Đổi | hiện `ui/App.tsx:20`, `ctx.tsx:19,48`, `ui/Settings.tsx:34-144` |
| R3 | Hash cũ `#/settings` vẫn vào được: mở Bảng tin + bật dialog (tương thích đường link cũ) | Mới | `parseHash` `ctx.tsx:46-50` |
| R4 | Khi dialog mở, nền (Shell) giữ nguyên route; đóng dialog không đổi route; `Esc`/bấm nền đóng | Mới | — |
| R5 | `ChatDock` giữ ở Shell | Giữ | `ui/App.tsx:21` |
| R6 | Nội dung dialog = P4 (không viết ở P1). P1 chỉ cung cấp "khung dialog": tiêu đề, nút đóng, vùng nav + vùng nội dung | Ranh giới | P4 |

## 4. Điều hướng & trạng thái
| Trạng thái | Nguồn | Ghi chú |
|---|---|---|
| `route` (`feed` · `profile`+`orgId`) | `ctx.tsx` | bỏ `settings` |
| `settingsOpen: boolean` | mới trong `ctx` | mở từ user-menu/hash cũ |
| `userMenuOpen`, `notifOpen` | cục bộ `TopBar` | chỉ một popup mở cùng lúc |
| `navCollapsed[nhóm]` | `localStorage` | G1 |
| Tải · rỗng · lỗi · không quyền | Sidebar chờ `viewer` (có sẵn trong `AppProvider`); nhóm Đối tác rỗng ⇒ ẩn nhóm; nhóm SHT không quyền ⇒ không render (không hiện bản khoá) | — |

## 5. Dữ liệu / Contract
- **Brand (đã quyết Q9)**: thêm `brand` `{ name, appName?, logo, accent }` lấy từ `/company` của contracts, dùng chung nguồn với SHT; chi tiết và trạng thái "MỚI, chờ backend-lead" ở `P5-tich-hop-sht.md` §3.3 (COM-FR-45). Phụ đề topbar: "Chủ quản" (mock). Các thay đổi khác của P1 không đổi API/DB.
- Deep-link: chuỗi URL, không có contract. `shtUrl` hiện ở `viewer.ts:65`.
- `CommunitySettings.accent` (`Settings.tsx:5-9`, contract community): bỏ khỏi UI theo Q3; việc xoá khỏi contract/DB để P4 quyết (tránh phá dữ liệu).

## 6. Quyền & cách ly
| Phần tử | Điều kiện hiện | Nguồn |
|---|---|---|
| Nhóm Community | mọi người dùng community (chủ quản + đối tác) | `nghiep-vu.md` §2 |
| Danh sách công ty "Đối tác" | `isHostViewer && partners.length > 0` | `Profile.tsx:71` |
| Nhóm Sổ Hợp Tác | chủ quản **và** quyền gói contracts (không dùng chung cờ community; I3). Đối tác: không bao giờ (I1) | `Profile.tsx:46`; `cai-dat-va-quyen.md` §1 |
| "Cài đặt chung" mục menu | mọi người (nội dung dialog tách quyền ở P4) | — |
Server vẫn là nguồn quyết (I4): link SHT đối với user không đủ quyền gói contracts bị 403 `PACK_FORBIDDEN`/RLS `ext_deny`.

## 7. Nhãn VI / EN verbatim
| Vị trí | VI (verbatim) | EN | Nguồn |
|---|---|---|---|
| Menu avatar | Tường nhà · Cài đặt chung · Đăng xuất | My wall · General settings · Sign out (đề xuất dịch, chờ duyệt) | brief CR-106; `TopBar.tsx:158` ("Đăng xuất") |
| Nhóm sidebar | Community · Sổ Hợp Tác | giữ nguyên (tên riêng) | `Profile.tsx:48,62` |
| Mục Community | Bảng tin · Bài đăng của tôi · Đối tác | News feed · My posts · Partners (đề xuất, chờ duyệt) | `TopBar.tsx:128`, `Profile.tsx:66,74` |
| Mục SHT | Tổng quan · Hợp đồng & giao dịch · Đối tác · Sản phẩm & Giá | Overview · Contracts & transactions · Partners · Products & Prices (đề xuất; kiểm SHT có EN sẵn không) | `contracts/vi.json:203-206` |
| Tìm | Tìm bài đăng, hàng hoá, đối tác… (placeholder); `aria-label` "Tìm kiếm" | Search posts, goods, partners… · Search (đề xuất) | `TopBar.tsx:99-100` |
| Thông báo | Thông báo · Đánh dấu đã đọc · Chưa có thông báo. | Notifications · Mark all as read · No notifications yet. (đề xuất) | `TopBar.tsx:27-42` |
| aria | "Về bảng tin" (logo) · "Thông báo" (chuông) | Back to feed · Notifications (đề xuất) | `TopBar.tsx:87,134` |
Ghi chú: EN là đề xuất dịch, chờ duyệt. Phụ đề topbar "Chủ quản" / "Host" (mock). community-web hiện chuỗi VI cứng (Q8) ⇒ cần hạ tầng i18n, `P5-tich-hop-sht.md` §3.4 (COM-FR-46); dùng khoá, không viết chuỗi thẳng.

## 8. Tiêu chí chấp nhận
| AC | Nhóm | Nội dung |
|---|---|---|
| P1-AC01 | Topbar (27) | Topbar hiển thị tên/logo công ty chủ quản; không còn chữ "Sổ Hợp Tác" hay "Community" làm logo; bấm logo về Bảng tin. |
| P1-AC02 | Topbar (27) | Topbar không có navtab "Bảng tin", không có nút bánh răng, không có nút "Đăng xuất" riêng. |
| P1-AC03 | Topbar (27) | Chuông thông báo và ô tìm hoạt động như trước (badge, "Đánh dấu đã đọc", debounce 250ms). |
| P1-AC04 | Sidebar (28) | Sidebar hiện ở Bảng tin và Hồ sơ, sticky dưới topbar cao `calc(100vh - 60px)`; cuộn trang không làm sidebar trôi. |
| P1-AC05 | Sidebar (28) | Chuyển Bảng tin ↔ Hồ sơ không làm sidebar tải lại/mất trạng thái xổ-gập. |
| P1-AC06 | Nhóm (29) | Mỗi nhóm xổ/gập được bằng bấm tiêu đề và bàn phím (Enter/Space); trạng thái giữ khi reload. |
| P1-AC07 | Nhóm (29) | Chủ quản đủ quyền contracts thấy nhóm Sổ Hợp Tác với đúng 4 mục, mỗi mục là liên kết tới đường dẫn tương ứng của `contracts-web` (`/overview`, `/contracts`, `/partners`, `/products`). |
| P1-AC08 | Nhóm (29) | Đối tác: DOM không chứa nhóm Sổ Hợp Tác, không có `data-testid="sht-link"` (I1; khớp HT-75/HT-76). |
| P1-AC09 | Nhóm (29) | Chủ quản thiếu quyền gói contracts (có `community-owner`, không có `contracts-*`) không thấy nhóm SHT (I3). |
| P1-AC10 | User-menu (30) | Bấm avatar mở dropdown đúng 3 mục theo thứ tự Tường nhà · Cài đặt chung · Đăng xuất; Esc/bấm ngoài đóng. |
| P1-AC11 | User-menu (30) | "Tường nhà" mở hồ sơ công ty của chính mình; "Đăng xuất" gọi `logout()` (chỉ ở `apiMode=http`). |
| P1-AC12 | Routing (31) | "Cài đặt chung" mở dialog; không còn view `settings` chiếm trang; đóng dialog giữ nguyên route nền. |
| P1-AC13 | Routing (31) | Mở `#/settings` (link cũ) hiển thị Bảng tin + dialog Cài đặt chung. |
| P1-AC14 | Routing (31) | `#/profile` và `#/profile/<orgId>` hoạt động như trước (`parseHash`). |

## 9. Mã truy vết
| FR | Phạm vi | Chức năng |
|---|---|---|
| COM-FR-27 | P1 §3.1 | Topbar thương hiệu công ty, bỏ navtab/gear/logout rời |
| COM-FR-28 | P1 §3.2 | Sidebar cố định ở Shell |
| COM-FR-29 | P1 §3.3 | Nhóm xổ/gập: Community + Sổ Hợp Tác (deep-link 4 trang) |
| COM-FR-30 | P1 §3.4 | User-menu từ avatar |
| COM-FR-31 | P1 §3.5 | Routing feed/profile + Cài đặt dialog |

## 10. Việc còn mở
Đã chốt: brand đối tác (P0 D5), host deep-link (D4), SSO fallback (Q11), `?settings=` (D11), sidebar ≤ 900px (D12). Còn lại:
1. Duyệt nhãn EN (§7) — người dùng.
2. "Đối tác" ở nhóm Community: danh sách công ty bạn bè dạng cuộn trong sidebar (mặc định, Q4); trang riêng là P3.
3. e2e hiện có (`e2e/community-web/*`) dùng `sht-link`/bánh răng — cập nhật khi code (ngoài spec này).
