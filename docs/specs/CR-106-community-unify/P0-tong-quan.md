# P0 · Tổng quan, từ điển, nguyên tắc bất biến, quyết định

Thuộc `index.md` (CR-106). Mã: **COM-FR-26** (bất biến + quyết định lớp vỏ).

## 1. Mục tiêu
Chốt ranh giới "hợp nhất" để P1–P6 không lệch: chỉ hợp nhất **vỏ** (giao diện, điều hướng, thương hiệu, cài đặt), không trộn nghiệp vụ/dữ liệu.

## 2. Hiện trạng (code thật)
| Điểm | Hiện trạng | Nguồn |
|---|---|---|
| Hai app riêng | `apps/community-web` (gói `community`) và `apps/contracts-web` (gói `contracts`) | `docs/platform/modules.md`, `docs/current/community/README.md` |
| Topbar community | Logo chữ "S" + "Sổ Hợp Tác / Community" (cứng) | `apps/community-web/src/ui/TopBar.tsx:89-93` |
| Sidebar | Không có sidebar toàn cục; `.wsside` chỉ nằm trong Hồ sơ và Cài đặt | `ui/App.tsx:13-24`, `ui/Profile.tsx:35`, `ui/Settings.tsx:57`, `styles/mockup.css:221-232` |
| Màu chủ đạo | Theo **người** (5 màu, lưu `localStorage` `community.accent` + `saveSettings`) | `ui/Settings.tsx:14-20,96-117`, `ui/ctx.tsx:55-65` |
| SHT từ community | Chỉ một link "Mở Sổ Hợp Tác" cho chủ quản (`href = shtUrl ?? "/contracts"`) | `ui/Profile.tsx:46-58`, `packages/contracts/src/pack-community/viewer.ts:65` |
| Menu SHT | 4 mục: Tổng quan · Hợp đồng & giao dịch · Đối tác · Sản phẩm & Giá | `apps/contracts-web/src/features/shell/lib/nav.ts:12-17`, i18n `contracts.nav.*` (`packages/i18n/locales/contracts/vi.json:202-207`) |
| Cài đặt SHT | 5 mục `SECTIONS` = co, rep, biz, scout, flow + Thành viên | `features/settings/components/SettingsDialog.tsx`, `docs/current/sht/cai-dat-va-quyen.md` §2 |

## 3. Quyết định đã chốt (người dùng, 2026-11-02)
| # | Quyết định | Nhãn |
|---|---|---|
| Q1 | Hợp nhất ở **lớp vỏ**; **giữ 2 app riêng**, không gộp thành 1 app | Đổi |
| Q2 | SHT mở bằng **deep-link** sang `contracts-web`, **không nhúng** code SHT vào community | Giữ (đã có link, mở rộng) |
| Q3 | Màu chủ đạo theo **công ty (brand)**; bỏ chỉnh màu theo từng người | Đổi |
| Q4 | "Đối tác" trong hồ sơ = danh sách công ty bạn bè (như rail "Đối tác") | Đổi (mặc định) |
| Q5 | "Attachment" trong hồ sơ = tổng hợp ảnh/tệp từ bài đã đăng | Mới (mặc định) |
| Q6 | Hồ sơ kiểu Facebook cho cả chủ quản và đối tác, **đối tác không có mục SHT** | Mới (mặc định) |
| Q7 | Cài đặt gộp **một màn**, phân quyền theo **từng nhóm** | Đổi (mặc định) |
| Q8 | **Song ngữ VI/EN**: mọi nhãn có cả VI (verbatim nguồn) và EN (đề xuất dịch, chờ duyệt). Phụ thuộc nền: community-web hiện hardcode tiếng Việt, chưa có i18n ⇒ thêm hạ tầng i18n (COM-FR-46, P5) | Mới |
| Q9 | **`brand`** (logo + màu chủ đạo, tên) trong phạm vi CR-106: lấy từ `/company` của contracts, dùng chung nguồn với SHT; áp cho chủ quản lẫn đối tác (mỗi account hiện brand công ty mình). Contract/dữ liệu MỚI, chờ backend-lead (COM-FR-45, P5 §3.3) | Mới |
| Q10 | **Mục SHT trong Cài đặt chung = DEEP-LINK** sang `contracts-web` (không nhúng, không gọi API contracts từ community-web). Hệ quả: P4c/P4d mở đúng section. **Tiền đề (việc nền, chưa code):** `contracts-web` hỗ trợ `?sec=co\|rep\|biz\|scout\|flow` — hiện `/settings` redirect về `/settings/members` (`routes/_authed/settings/index.tsx:6`) và section chọn bằng `useState` | Mới |
| Q11 | **SSO community→SHT: chấp nhận FALLBACK** cho bản đầu: deep-link vẫn chạy, người dùng có thể phải đăng nhập lại ở SHT. SSO liền mạch là CR sau | Đổi (hoãn) |

### Mặc định đã chốt để đóng lỗ hổng readiness
| # | Chủ đề | Mặc định | Ở đâu |
|---|---|---|---|
| D4 | Tiền tố host deep-link | `VITE_CONTRACTS_URL` build-time, rơi về `/contracts` | P1 G4, P5 L3 |
| D5 | Brand đối tác | mỗi account hiện brand **công ty mình**; chưa có ⇒ accent `indigo` + chữ cái đầu | P1 T2, P5 B3 |
| D6 | Endpoint hồ sơ mới | `GET /pack/community/profile/:orgId/partners` và `.../media`; shape chờ backend-lead | P3 §5 |
| D7 | Cột uy tín P3 | đọc qua port gói contracts đã có; user ngoài ⇒ 0 hàng; tên port chốt khi code | P3 A3 |
| D8 | Tương thích `accent` | server để `accent` optional và bỏ qua khoá lạ (không 422 client cũ) | P4b |
| D9 | i18n | namespace `packages/i18n/locales/community/{vi,en}.json`, loader như contracts-web; thiếu EN ⇒ rơi về VI | P5 COM-FR-46 |
| D10 | Gợi ý SHT trên bài | đúng nhãn source `lib/quote.ts:146-155`; không thêm khối mới | P2 C3 |
| D11 | Dialog cài đặt | state nội bộ + tương thích `#/settings`; không `?settings=` | P1 R2 |
| D12 | Sidebar ≤ 900px | nút mở drawer | P1 S4 |
| D13 | Sáng/Tối | theo công ty (P4c), không theo người | P4b N3 |
| D14 | Attachment | VI "Ảnh & tệp"; rỗng "Chưa có ảnh hay tệp." | P3 |
| D15 | Rời khi chưa lưu | hỏi xác nhận, dùng "Có thay đổi chưa lưu" | P4a D7 |
| D16 | Tenant chưa gán quy trình | "Chưa gán quy trình duyệt." (khoá i18n mới) | P4d |
| D17 | Sửa mô tả "Giới thiệu" | chỉ đọc trong CR-106; sửa ngoài phạm vi | P3 A1 |
| D3 | Endpoint brand | `GET /pack/community/brand` qua port gói↔gói, `{name, appName, logo (data URL), accent}`; shape chờ backend-lead | P5 B4 |

## 4. Nguyên tắc bất biến (không được phá; mọi phần P1–P6 phải tuân)
| # | Bất biến | Nguồn |
|---|---|---|
| I1 | Đối tác **không thấy** SHT: không link, không route, không API. Giữ HT-75/HT-76, policy `ext_deny`, ADR-0031. "Mọi thông tin chảy về chủ quản; người bán/mua không thấy nhau." | `docs/current/community/hien-thi.md:126-127`, `nghiep-vu.md` §1, §13, `docs/current/sht/cai-dat-va-quyen.md` §1 |
| I2 | Community ↔ SHT nối nhau **một** điểm nghiệp vụ: nút **"Lưu báo giá"** (ghi vào Sản phẩm & Giá). Nghiệp vụ SHT giữ nguyên; community chỉ là nơi mở nó. Không thêm điểm nối dữ liệu thứ hai | `nghiep-vu.md` §8 |
| I3 | Phân quyền KHÁC nhau: community = Group `community-owner`; SHT = `contracts-owner`. Kiểm theo **từng nhóm**, không dùng một cờ chung (ví dụ `isHostViewer` không đủ để mở mục SHT) | `cai-dat-va-quyen.md` §1 |
| I4 | Ẩn UI không thay thế kiểm quyền server; mọi hiển thị chỉ là phản chiếu của RLS/guard | `nghiep-vu.md` §13 |

## 5. Từ điển (mỗi từ 2 nghĩa → quy ước)
| Từ | Nghĩa A | Nghĩa B | Quy ước dùng trong spec/UI |
|---|---|---|---|
| Đối tác | Bạn bè công ty trong Community (rail "Đối tác") | Doanh nghiệp giao dịch của SHT (NCC / Khách / Bên trả hoa hồng) | Hồ sơ/rail Community: "Đối tác" (A). Trong SHT giữ "Đối tác" (B) nhưng spec ghi rõ "đối tác SHT" khi nhắc B. Hai tập không đồng nhất |
| Giới thiệu | Mục About trong hồ sơ | Hướng hợp đồng hoa hồng (SHT) | Hồ sơ: "Giới thiệu" (A). Hoa hồng: viết "hợp đồng hoa hồng" (B), không dùng "giới thiệu" trần |
| Attachment | Ảnh/tệp đính kèm bài đăng | File ký hợp đồng (SHT) | Hồ sơ: "Ảnh & tệp" (A, tổng hợp từ bài đã đăng; nhãn VI chốt: "Ảnh & tệp"). SHT: "tệp hợp đồng" (B) |
| Uy tín | Nhãn trên bài (Community) | Điểm 0–100 theo đối tác × vai trò (SHT) | Nhãn bài: "nhãn uy tín" (A); "Điểm uy tín" chỉ là cài đặt SHT (B) |
| Cài đặt | Tùy chọn người dùng | Cấu hình công ty | "Cài đặt chung" = một dialog, hai nhóm: **Cá nhân** (người dùng) và **Công ty** (cấu hình, chỉ owner) |

## 6. Phạm vi P0
**Làm:** chốt khung/quyết định/bất biến/từ điển. **Không làm:** thiết kế màn (P1+), đổi API/DB, đổi nghiệp vụ.

## 7. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục áp dụng: cả bộ . Tên mục mock dùng để trỏ: Topbar · Sidebar · Bảng tin · Hồ sơ · Cài đặt chung (P1–P5 trỏ đúng các tên này).

## 8. Tiêu chí chấp nhận
| AC | Nội dung |
|---|---|
| P0-AC01 | Không có route/link/nút nào trong `community-web` dẫn sang SHT khi người xem là đối tác (HT-75/HT-76 vẫn xanh). |
| P0-AC02 | Diff của CR-106 không thêm package/import chéo giữa `apps/community-web` và `apps/contracts-web`; chỉ liên kết bằng URL. |
| P0-AC03 | Không có endpoint/bảng mới cho việc "nối" Community ↔ SHT ngoài luồng Lưu báo giá hiện có. |
| P0-AC04 | Mục cấu hình SHT trong Cài đặt chung chỉ hiện khi có quyền `contracts-owner`/`admin` gói contracts; mục Community theo `community-owner` (kiểm riêng, có test mỗi nhóm). |
| P0-AC05 | Màu chủ đạo lấy từ cấu hình công ty; không còn nơi nào cho người dùng đổi màu cá nhân. |

## 9. Việc còn mở
- Brand: đã quyết (Q9, D3); chỉ còn shape endpoint — backend-lead chốt khi code.
- Mã COM-FR-24/25: không thấy trong repo; spec dùng từ 26 (xem `index.md`).
- (Đã quyết Q8) Chuỗi community cứng tiếng Việt ⇒ làm i18n nền, COM-FR-46.
