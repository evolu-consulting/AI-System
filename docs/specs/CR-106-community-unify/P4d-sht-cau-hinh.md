# P4d · Cài đặt chung › nhóm Sổ Hợp Tác [SHT]

Thuộc `index.md` (CR-106), khung ở `P4a`. Mã: **COM-FR-41** (Điểm uy tín, Điểm kinh doanh, Dò giá thị trường) và **COM-FR-42** (Quy trình duyệt + Ký số). Nguồn dữ liệu và quyền: **SHT**; nghiệp vụ giữ nguyên, phần lớn **deep-link editor**.

## 1. Mục tiêu
Theo **Q10**: bốn mục trong dialog (Điểm uy tín, Điểm kinh doanh, Dò giá thị trường, Quy trình duyệt) là **deep-link** `${VITE_CONTRACTS_URL}/settings?sec=rep|biz|scout|flow`; không viết lại nghiệp vụ. Các bảng R/F là **màn đích** ở contracts-web (kể cả sơ đồ READONLY của Quy trình duyệt hiển thị ở đó). Tiền đề `?sec=`: P4a §5.

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục: Cài đặt chung › Sổ Hợp Tác [SHT] (Điểm uy tín · Điểm kinh doanh · Dò giá thị trường · Quy trình duyệt).

## 3. Nghiệp vụ

### 3.1 Điểm uy tín / Điểm kinh doanh / Dò giá — COM-FR-41
| # | Mục | Nội dung | Nhãn | Nguồn |
|---|---|---|---|---|
| R1 | Điểm uy tín | 4 nhóm (Dịch vụ có hạn · Hàng hoá · Giới thiệu · Chung) × vai (Nhà cung cấp · Khách hàng), mỗi ô 3 tab **Tiêu chí · Thời gian · Loại việc**, thêm "Mức & đánh giá" và "Công thức & thử tính". Ô khoá khi không phải chủ sở hữu | Giữ | `rep3.vi.json:91-111` (`group`, `role`, `tab`); `v2l.vi.json:11`, `:25-30`; `doi-tac-uy-tin.md`; `ScoringPane`/`ScoringV2EPane` |
| R2 | Điểm uy tín | Nhóm "Giới thiệu" ở đây là **hướng hợp đồng hoa hồng** (từ điển P0), không phải mục About hồ sơ | Ghi chú | P0 §5 |
| R3 | Điểm kinh doanh | Trọng số (Tốc độ bán · Biên lãi · Xu hướng) + Ngưỡng đề xuất mua thêm/giữ/xả | Giữ | `v2l.vi.json:67-75` (`biz`), `BizPane.tsx` |
| R4 | Dò giá thị trường | Mặc định theo nhóm (Dịch vụ có hạn · Hàng hoá): từ khoá, trang ưu tiên/bỏ qua, lịch (Tắt / Hằng tuần / Hằng tháng), "Trần mỗi tháng" | Giữ | `v2j2.vi.json:97-133`, `ScoutPane.tsx` |
| R5 | Cách hiện | Thẻ trong dialog (tên mục + gợi ý `sec.<id>Hint`) + nút "Mở trong Sổ Hợp Tác" ⇒ `?sec=rep`, `biz`, `scout` | Mới (Q10) | P4a |

### 3.2 Quy trình duyệt + Ký số — COM-FR-42
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| F1 | Hiển thị **sơ đồ READONLY** quy trình đang dùng: "Quy trình duyệt đang dùng: {name} · v{version}"; lead "Công ty đang chạy quy trình này cho mọi hợp đồng. Quy trình chỉ xem được ở đây." Không có form sửa trong Cài đặt (CR-105) | Giữ | `v2l.vi.json:166-171`; `cai-dat-va-quyen.md` §3b; `FlowCurrentPane.tsx` |
| F2 | Mỗi bước: tên, phòng ban, hạn xử lý, nhãn "Có điều kiện"; bước ký số nhãn "Ký số" | Giữ | `v2l.vi.json:173-174` |
| F3 | Nút **"Chỉnh quy trình duyệt"**: mở editor ai-admin (Canvas/Form) ở tab/trang mới; **chỉ `platform_admin`**; lỗi "Không mở được trang chỉnh quy trình." | Giữ (deep-link) | `FlowEditorLink.tsx:1-31`; CR-105 |
| F4 | Khối **Ký số**: bật/tắt ký số hợp đồng (`esign_enabled`) và neo ký (`PUT /esign/settings`, `/esign/anchors`) — quyền `admin` | Giữ | `cai-dat-va-quyen.md` §2, `duyet-ky-so.md`; `esign.vi.json:4,33` ("Ký số hợp đồng") |
| F6 | Tenant chưa gán quy trình: hiện "Chưa gán quy trình duyệt." (không có nút sửa) | Mới | P0 D16 |
| F5 | Quy trình áp dụng gán theo tenant bởi platform admin (onboarding), chủ quản không đổi ở đây | Giữ | `cai-dat-va-quyen.md` §3b |

## 4. Điều hướng & trạng thái
Mục con trong nhóm "Sổ Hợp Tác" của nav. Trạng thái: tải · lỗi ("Không tải được quy trình duyệt.") · không quyền (ẩn) · chưa gán quy trình: "Chưa gán quy trình duyệt." (khoá i18n mới ở contracts, P0 D16) · đang chỉnh (ở ai-admin, ngoài dialog).

## 5. Dữ liệu / Contract
Không có contract mới; dùng API contracts hiện có (scoring/biz/scout settings, `/approval-settings`, engine `contracts.approval`, `/esign/*`). Ràng buộc tiền đề: cách gọi từ community-web (P4a §5, P5 §4 SSO).

## 6. Quyền & cách ly
| Mục | Xem | Sửa |
|---|---|---|
| Điểm uy tín / Điểm kinh doanh / Dò giá | gói contracts `read` và chủ quản | `contracts-owner` (ô khoá với người khác) |
| Quy trình duyệt (sơ đồ) | `owner`/`editor` (`cai-dat-va-quyen.md` §2) | không sửa tại đây; nút "Chỉnh quy trình duyệt" = `platform_admin` |
| Ký số | như trên | `admin` gói contracts |
Đối tác: không thấy gì trong nhóm này (I1, `ext_deny`).

## 7. Nhãn VI / EN (EN đề xuất dịch, chờ duyệt)
| VI (verbatim) | EN đề xuất |
|---|---|
| Điểm uy tín | Reputation score |
| Tiêu chí, thời gian, mức đánh giá | Criteria, time, rating levels |
| Dịch vụ có hạn · Hàng hoá · Giới thiệu · Chung | Time-limited services · Goods · Referral · General |
| Nhà cung cấp · Khách hàng | Supplier · Customer |
| Tiêu chí · Thời gian · Loại việc · Mức & đánh giá | Criteria · Time · Job types · Levels & ratings |
| Công thức & thử tính | Formula & trial calculation |
| Điểm kinh doanh · Trọng số, ngưỡng đề xuất | Business score · Weights, recommendation thresholds |
| Tốc độ bán · Biên lãi · Xu hướng · Ngưỡng | Sales velocity · Margin · Trend · Thresholds |
| Dò giá thị trường | Market price scouting |
| Mặc định theo nhóm, trần lượt dò/tháng | Defaults by group, monthly scan cap |
| Tắt (chỉ dò tay) · Hằng tuần · Hằng tháng | Off (manual only) · Weekly · Monthly |
| Trần mỗi tháng | Monthly cap |
| Quy trình duyệt | Approval flow |
| Quy trình duyệt đang dùng: {{name}} · v{{version}} | Approval flow in use: {{name}} · v{{version}} |
| Công ty đang chạy quy trình này cho mọi hợp đồng. Quy trình chỉ xem được ở đây. | Your company runs this flow for all contracts. It is view-only here. |
| Chỉnh quy trình duyệt | Edit approval flow |
| Không mở được trang chỉnh quy trình. | Could not open the flow editor. |
| Ký số · Có điều kiện | E-signature · Conditional |
| Không tải được quy trình duyệt. | Could not load the approval flow. |
| Chưa gán quy trình duyệt. | No approval flow assigned yet. |
Nguồn VI: `rep3.vi.json:91-111`, `v2l.vi.json:7-17,67-75,166-179`, `v2j2.vi.json:124-133`.

## 8. Tiêu chí chấp nhận
| AC | FR | Nội dung |
|---|---|---|
| P4d-AC01 | 41 | Chủ quản `contracts-owner` thấy 3 mục Điểm uy tín / Điểm kinh doanh / Dò giá thị trường và mở đúng màn SHT tương ứng. |
| P4d-AC02 | 41 | Người chỉ đọc thấy ô khoá và "Chỉ chủ sở hữu hợp đồng được sửa cài đặt"; không lưu được. |
| P4d-AC03 | 41 | Số tab/nhóm/vai và công thức không đổi so với SHT (cùng engine, không viết lại). |
| P4d-AC04 | 42 | Quy trình duyệt hiển thị sơ đồ readonly; không có ô nhập/nút lưu sửa bước trong dialog. |
| P4d-AC05 | 42 | "Chỉnh quy trình duyệt" chỉ hiện với `platform_admin` và mở editor ai-admin; người khác không thấy nút. |
| P4d-AC06 | 42 | Khối Ký số bật/tắt `esign_enabled` và lưu được với `admin`; người khác bị khoá. |
| P4d-AC08 | 42 | Tenant chưa gán quy trình hiển thị "Chưa gán quy trình duyệt." |
| P4d-AC09 | 41-42 | Thẻ trong dialog có href `?sec=rep`, `biz`, `scout`, `flow` đúng; community-web không gọi API contracts. |
| P4d-AC07 | 41-42 | Đối tác: DOM không có nhóm này; API SHT trả chặn (HT-76). |

## 9. Mã truy vết
COM-FR-41 Điểm uy tín · Điểm kinh doanh · Dò giá · COM-FR-42 Quy trình duyệt (readonly) + Ký số.

## 10. Việc còn mở
Đã chốt: deep-link (Q10), chưa gán quy trình (D16). Tiền đề `?sec=` ở contracts-web (P4a §5). Nhãn EN của màn SHT thuộc contracts-web (ngoài CR-106).
