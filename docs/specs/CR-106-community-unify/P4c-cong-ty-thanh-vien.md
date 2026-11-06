# P4c · Cài đặt chung › Công ty [SHT]

Thuộc `index.md` (CR-106), khung ở `P4a`. Mã: **COM-FR-40**. Nguồn dữ liệu và quyền: **SHT** (`contracts-owner`); chỉ chủ quản. Đây cũng là **nguồn của `brand`** (P5 COM-FR-45).

## 1. Mục tiêu
Theo **Q10**: hai mục Công ty và Thành viên trong dialog chung là **deep-link** sang `contracts-web` (`/settings?sec=co`, `/settings/members`); nghiệp vụ giữ nguyên ở đó. Bảng C1–C7 mô tả nội dung **màn đích** (nguồn chân lý để P5 brand tham chiếu), không phải UI dựng lại trong community-web.

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục: Cài đặt chung › Công ty [SHT] (Công ty · Thành viên).

## 3. Nghiệp vụ
| # | Mục | Nội dung | Nhãn | Nguồn |
|---|---|---|---|---|
| C1 | Công ty | Tên công ty (≤ 60) · Tên ứng dụng (≤ 40) · Logo (PNG/JPG/SVG/WebP, vuông, ≤ 1 MB; Tải/Đổi/Xoá logo; trống ⇒ chữ cái đầu) · Màu chủ đạo · Giao diện (Theo hệ thống / Sáng / Tối) | Giữ | `CompanyPane.tsx`; `v2l.vi.json:37-50`; `pack-contracts/company.ts:35-40` |
| C2 | Công ty | Màu chủ đạo: 6 giá trị `indigo, blue, teal, green, orange, rose`. Community cần thêm `rose` vào biến CSS (hiện 5 màu) | Đổi (community) | `company.ts:6`; `styles/globals.css:17-38` |
| C3 | Công ty | **Pháp nhân của mình**: "Tên pháp nhân (mỗi dòng một tên)" ≤ 10, "Mã số thuế (mỗi dòng một mã)" 10 hoặc 13 số (`MST_RE`) | Giữ | `v2l.vi.json:51-56`; `company.ts:33,42-43` |
| C4 | Công ty | **Duyệt hợp đồng**: "Bước duyệt hợp đồng" bật/tắt (`approval_enabled`) | Giữ | `v2l.vi.json:57-60` |
| C5 | Công ty | **Kho & giao hàng**: "Cho phép giao vượt tồn kho" (`allow_negative_stock`, mặc định tắt) | Giữ | `v2l.vi.json:61-63` |
| C6 | Công ty | **Pháp lý**: Ngưỡng cảnh báo pháp lý (`legal_warn_threshold`, mặc định 5.000.000, 0 = tắt). Nhãn VI nằm trong `packages/i18n/locales/contracts/legal.vi.json` (giữ ở contracts-web) | Giữ | `cai-dat-va-quyen.md` §2 |
| C7 | Thành viên | Trang `/settings/members`: thành viên, cấp quản lý, phòng ban, chế độ thấy (M1D). Quyền: quản trị công ty (`tenant_admin`/`platform_admin`); viewer không | Giữ | `routes/_authed/settings/members.tsx:1`; `nav.ts:25-31`; `org.vi.json:4` ("Thành viên & phòng ban"), `ownerOnly` |
| C8 | Cách hiện | Thẻ trong dialog + nút "Mở trong Sổ Hợp Tác" ⇒ `${VITE_CONTRACTS_URL}/settings?sec=co` (Công ty) và `/settings/members` (Thành viên). Tiền đề `?sec=`: P4a §5 | Mới (Q10) | P4a |
| C9 | Đổi brand | Lưu `PUT /company` ⇒ brand của **mọi** account community cùng chủ quản đổi (topbar, accent, logo hồ sơ) ngay lần tải sau | Mới | P5 COM-FR-45 |

## 4. Điều hướng & trạng thái
Nằm trong dialog (P4a). Trạng thái: tải · lỗi ("Không tải được cài đặt.") · không quyền (nhóm ẩn) · lỗi logo ("Ảnh lớn hơn 1 MB") · lỗi MST (`taxBad`, `taxInvalid`: "Mã số thuế phải gồm 10 hoặc 13 số") · phiên bản (`version`, tránh ghi đè) — theo SHT hiện có.

## 5. Dữ liệu / Contract
Giữ nguyên `CompanySchema`/`CompanyOut` (`GET|PUT /company`, lỗi `COMPANY_INVALID` 422). **MỚI** chỉ ở phía đọc brand cho community (P5). Nhật ký ghi: `approval_settings_audit` (hiện có).

## 6. Quyền & cách ly
Ghi `PUT /company`: `admin` gói contracts (`contracts-owner`). Đọc: theo `read`. Đối tác (`kind=external`): không thấy nhóm; `/company` bị chặn (`ext_deny`). Brand công khai cho đối tác chỉ qua endpoint brand tối thiểu (P5), không lộ pháp nhân/MST/cờ duyệt/ngưỡng pháp lý.

## 7. Nhãn VI / EN (EN đề xuất dịch, chờ duyệt)
| VI (verbatim) | EN đề xuất |
|---|---|
| Công ty · Thành viên | Company · Members |
| Tên công ty · Tên ứng dụng · Logo | Company name · App name · Logo |
| Tải logo lên · Đổi logo · Xoá logo | Upload logo · Change logo · Remove logo |
| PNG, JPG, SVG hoặc WebP, ảnh vuông, tối đa 1 MB. Chưa có logo thì dùng chữ cái đầu tên công ty. | PNG, JPG, SVG or WebP, square image, up to 1 MB. Without a logo, the first letter of the company name is used. |
| Ảnh lớn hơn 1 MB | Image larger than 1 MB |
| Màu chủ đạo · Giao diện · Theo hệ thống · Sáng · Tối | Brand colour · Theme · Follow system · Light · Dark |
| Pháp nhân của mình | Our legal entities |
| Để biết hợp đồng là Mua hay Bán: bên nào trong hợp đồng là công ty mình. | To tell whether a contract is Purchase or Sale: which party is our company. |
| Tên pháp nhân (mỗi dòng một tên) · Mã số thuế (mỗi dòng một mã) | Legal entity names (one per line) · Tax IDs (one per line) |
| Mã số thuế phải gồm 10 hoặc 13 số | A tax ID must have 10 or 13 digits |
| Duyệt hợp đồng · Bước duyệt hợp đồng | Contract approval · Contract approval step |
| Bật: hợp đồng đi qua lượt duyệt rồi mới có hiệu lực. | On: contracts go through approval before taking effect. |
| Tắt: lưu hợp đồng là có hiệu lực ngay. | Off: a saved contract takes effect immediately. |
| Kho & giao hàng · Cho phép giao vượt tồn kho | Stock & delivery · Allow delivery beyond stock |
| Thành viên & phòng ban | Members & departments |
| Cần quyền quản trị công ty để quản lý thành viên và phòng ban. | Company admin rights are required to manage members and departments. |
Nguồn VI: `packages/i18n/locales/contracts/v2l.vi.json:37-63`, `org.vi.json:4-7`. Bảng này mô tả màn đích; EN của màn SHT do contracts-web sở hữu (ngoài CR-106). Dialog community chỉ cần nhãn thẻ: "Công ty" / "Thành viên" + gợi ý "Tên, logo, màu, giao diện" (`sec.coHint`).

## 8. Tiêu chí chấp nhận
| AC | Nội dung |
|---|---|
| P4c-AC01 | Chủ quản `contracts-owner` sửa Tên công ty/Logo/Màu và lưu ⇒ `GET /company` trả giá trị mới; community đổi brand ở lần tải sau (topbar + accent). |
| P4c-AC02 | Logo > 1 MB bị từ chối với "Ảnh lớn hơn 1 MB"; MST sai bị từ chối với thông báo 10 hoặc 13 số. |
| P4c-AC03 | Tắt "Bước duyệt hợp đồng" và lưu ⇒ `approval_enabled=false` ghi vào `approval_settings_audit`. |
| P4c-AC04 | Người không phải `contracts-owner` thấy form khoá; PUT trực tiếp bị 403. |
| P4c-AC05 | Thành viên: quản trị công ty vào được `/settings/members`; viewer thấy "Cần quyền quản trị công ty…". |
| P4c-AC06 | Đối tác không thấy nhóm Công ty và không lấy được `/company` (HT-76). |
| P4c-AC07 | Màu `rose` render đúng trong community (biến `--accent*` đủ 6 màu). |
| P4c-AC08 | Thẻ Công ty/Thành viên trong dialog có href `${VITE_CONTRACTS_URL}/settings?sec=co` / `/settings/members`; community-web không gọi `/company` cho thẻ này (brand đi qua `GET /pack/community/brand`, P5). |

## 9. Mã truy vết
COM-FR-40 Công ty (+ Thành viên) trong nhóm Công ty.

## 10. Việc còn mở
Đã chốt: deep-link (Q10), theme theo công ty (D13). Ghi nhận: theme tối cho community ngoài phạm vi bản đầu (bảng tin chỉ light); tiền đề `?sec=` ở P4a §5.
