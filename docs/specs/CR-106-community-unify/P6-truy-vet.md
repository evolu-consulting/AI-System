# P6 · Ma trận truy vết

Thuộc `index.md` (CR-106). Bảng FR ↔ phần ↔ mục mock ↔ nguồn (file/khoá i18n) ↔ AC. Cột Code/Test điền khi làm (`bun run trace COM-FR-xx`); hiện trống vì chưa code.

Mock = https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ.

| FR | Phần | Chức năng | Mục mock | Nguồn (file / khoá i18n) | AC | Code | Test |
|---|---|---|---|---|---|---|---|
| COM-FR-26 | P0 | Bất biến + quyết định lớp vỏ | cả bộ | `hien-thi.md:126-127`; `nghiep-vu.md` §1,8,13; `cai-dat-va-quyen.md` §1 | P0-AC01…05 | — | — |
| COM-FR-27 | P1 | Topbar thương hiệu công ty | Topbar | `TopBar.tsx:82-159`; `mockup.css:27-37` | P1-AC01…03 | — | — |
| COM-FR-28 | P1 | Sidebar cố định ở Shell | Sidebar | `App.tsx:13-24`; `Profile.tsx:35`; `mockup.css:216-232` | P1-AC04…05 | — | — |
| COM-FR-29 | P1 | Nhóm xổ/gập Community + SHT | Sidebar (nhóm) | `Profile.tsx:46-84`; `nav.ts:12-17`; `contracts/vi.json:202-207` | P1-AC06…09 | — | — |
| COM-FR-30 | P1 | User-menu avatar | Topbar (avatar) | `TopBar.tsx:147-159` | P1-AC10…11 | — | — |
| COM-FR-31 | P1 | Routing feed/profile + Cài đặt dialog | Topbar/Cài đặt | `ctx.tsx:19,46-51`; `App.tsx:18-20` | P1-AC12…14 | — | — |
| COM-FR-32 | P2 | Feedbar + Composer | Bảng tin (feedbar, Composer) | `Feed.tsx:11-15,150`; `Composer.tsx:142-302` | P2-AC01,02,07,08 | — | — |
| COM-FR-33 | P2 | PostCard (vạch/deal/callout/Lưu báo giá) | Bảng tin (PostCard) | `PostCard.tsx:196,301,331`; `format.ts:42,78-87` | P2-AC03…05 | — | — |
| COM-FR-34 | P2 | Rail | Bảng tin (Rail) | `FeedRail.tsx:24-80`; `Feed.tsx:26-86` | P2-AC06 | — | — |
| COM-FR-35 | P3 | Hero + số liệu hồ sơ | Hồ sơ (hero, hstats) | `Profile.tsx:92-127` | P3-AC01 | — | — |
| COM-FR-36 | P3 | Mô hình section + tab | Hồ sơ (hàng tab) | `Profile.tsx:130-135`; `ctx.tsx:46-51` | P3-AC02…04 | — | — |
| COM-FR-37 | P3 | Nội dung Giới thiệu/Bài đăng/Đối tác/Attachment | Hồ sơ (4 mục) | `viewer.ts:55-67`; `hien-thi.md` §6 | P3-AC05…07 | — | — |
| COM-FR-38 | P4a | Khung dialog + nav nhóm + lưu + quyền | Cài đặt chung | `SettingsDialog.tsx`; `v2l.vi.json:4-28`; `nav.ts:25-31` | P4a-AC01…08 | — | — |
| COM-FR-39 | P4b | Cá nhân: Tài khoản/Giao diện/Thông báo | Cài đặt › Cá nhân | `Settings.tsx:14-139` | P4b-AC01…06 | — | — |
| COM-FR-40 | P4c | Công ty + Thành viên | Cài đặt › Công ty | `company.ts:35-51`; `v2l.vi.json:37-63`; `members.tsx`; `org.vi.json:4-7` | P4c-AC01…07 | — | — |
| COM-FR-41 | P4d | Điểm uy tín/Điểm kinh doanh/Dò giá | Cài đặt › Sổ Hợp Tác | `rep3.vi.json:91-111`; `v2l.vi.json:67-75`; `v2j2.vi.json:97-133` | P4d-AC01…03,07 | — | — |
| COM-FR-42 | P4d | Quy trình duyệt (readonly) + Ký số | Cài đặt › Sổ Hợp Tác | `v2l.vi.json:166-179`; `FlowEditorLink.tsx`; `esign.vi.json:4,33` | P4d-AC04…07 | — | — |
| COM-FR-43 | P5 | Deep-link 4 trang + cách ly | Sidebar nhóm SHT | `nav.ts:12-17`; `viewer.ts:65` | P5-AC01…03 | — | — |
| COM-FR-44 | P5 | SSO giữa hai app | (phụ thuộc) | `App.tsx:26-41`; `routes/sso.tsx` | P5-AC04 | — | — |
| COM-FR-45 | P5 | Brand dùng chung nguồn `/company` | Topbar brand | `company.ts:35-40`; `viewer.ts:17-26` | P5-AC05…07; P2-AC05; P4b-AC02 | — | — |
| COM-FR-46 | P5 | Hạ tầng i18n VI/EN (nền) | mọi nhãn | `login-i18n.ts`; `packages/i18n/locales/contracts/` | P5-AC08…09; P2-AC08 | — | — |

## Kiểm tra phủ
| Kiểm | Kết quả |
|---|---|
| Mỗi FR có ≥ 1 AC | đạt (26–46) |
| Mỗi AC thuộc 1 FR | đạt (AC không ghi FR trong P0/P1/P4b/P4c được ánh xạ ở bảng trên) |
| Bất biến I1…I4 có AC | I1: P0-AC01, P1-AC08, P2-AC04, P3-AC02, P4a-AC03, P5-AC02 · I2: P0-AC03, P5-AC03 · I3: P0-AC04, P1-AC09, P4a-AC08 · I4: P4d-AC07, P5 §6 |
| HT-75/HT-76 | giữ ở P0-AC01, P1-AC08, P4c-AC06, P5-AC02 |

## Thứ tự làm đề xuất
COM-FR-46 (i18n nền) → 45 (brand, cần backend-lead) → 27–31 (khung) → 32–34 → 35–37 → 38–39 → 40–42 (phụ thuộc quyết định P4a §5) → 43–44.

## Trạng thái quyết định (thay "Câu hỏi chặn")
| Điểm | Trạng thái | Chủ |
|---|---|---|
| Mục SHT trong Cài đặt = deep-link | Đã chốt Q10 | — |
| Tiền đề `?sec=` ở contracts-web | Việc nền, mô tả ở P4a §5 | frontend-lead |
| SSO community→SHT | Đã chốt Q11 (fallback); SSO liền mạch = CR sau | — |
| Tiền tố host deep-link | Đã chốt D4 (`VITE_CONTRACTS_URL`, rơi về `/contracts`) | — |
| Brand đối tác | Đã chốt D5 | — |
| Shape `GET /pack/community/brand` + port `CompanyBrandReader` | **Đã chốt (backend-lead)** — P5 §5.1 | backend-lead |
| Shape `viewer.caps.contracts` + port `ContractsCapReader` | **Đã chốt (backend-lead)** — P5 §5.1 | backend-lead |
| `profile/:orgId/partners`, `media` (shape) + danh sách bạn bè đối tác thấy | **Đã chốt (backend-lead)** — P3 §5.1 (ẩn với đối tác) | backend-lead |
| Tên port đọc điểm uy tín | **Đã chốt (backend-lead)** — port có sẵn `HostBookReader.read` (P3 §5.1) | backend-lead |
| i18n namespace | Đã chốt D9 | — |
| Nhãn EN | Đề xuất dịch | người dùng duyệt |
| Mã COM-FR-24/25 | Không thấy trong repo; dùng từ 26 | — |
4 mục backend-lead (brand, caps, partners/media, port uy tín) **đã chốt** (P5 §5.1, P3 §5.1); còn 1 mục thuộc người dùng (duyệt EN).
