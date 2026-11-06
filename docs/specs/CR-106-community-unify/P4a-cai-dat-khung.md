# P4a · Cài đặt chung: khung dialog, nav nhóm, lưu và quyền

Thuộc `index.md` (CR-106); P4b–P4d là nội dung các nhóm. Mã: **COM-FR-38**. Q7: gộp một màn, phân quyền theo từng nhóm (I3).

## 1. Mục tiêu
Một dialog "Cài đặt" thay `SettingsPage` của community (`ui/Settings.tsx`). Nav chia 3 nhóm xổ/gập. Theo **Q10**: nhóm Cá nhân làm trong dialog; các mục nhóm Công ty / Sổ Hợp Tác là **deep-link** sang `contracts-web` (không nhúng, không gọi API contracts từ community-web).

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục: Cài đặt chung (head "Cài đặt" + "Áp dụng cho cả công ty", nav nhóm, footer lưu).

## 3. Nghiệp vụ
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| D1 | Mở từ user-menu "Cài đặt chung" (P1 U2/R2); Esc/nền đóng | Đổi | P1 §3.4-3.5 |
| D2 | Head: tiêu đề "Cài đặt" + phụ đề "Áp dụng cho cả công ty" | Giữ (chuỗi SHT) | `contracts.settings.title`, `.scope` (`v2l.vi.json:4-5`); kích thước tham chiếu `SettingsDialog.tsx:105-110` (lưới `250px + 1fr`) |
| D3 | Nav 3 nhóm xổ/gập (cùng cơ chế P1 G1): **Cá nhân** [CM] · **Công ty** [SHT] · **Sổ Hợp Tác** [SHT]; mục: Cá nhân = Tài khoản, Giao diện, Thông báo; Công ty = Công ty, Thành viên; Sổ Hợp Tác = Điểm uy tín, Điểm kinh doanh, Dò giá thị trường, Quy trình duyệt | Mới (gộp) | community `Settings.tsx:50-54`; SHT `SECTIONS` co/rep/biz/scout/flow (`cai-dat-va-quyen.md` §2) |
| D4 | Nhóm không đủ quyền: **không render** nhóm và mục (không bản khoá). Nếu không có quyền SHT nào ⇒ dialog chỉ còn nhóm Cá nhân | Mới | I1, I3 |
| D5 | Mục SHT (Công ty, Thành viên, Điểm uy tín, Điểm kinh doanh, Dò giá thị trường, Quy trình duyệt): vùng nội dung hiện thẻ ngắn (tên mục + gợi ý + nút "Mở trong Sổ Hợp Tác") dẫn tới `contracts-web`; footer "Lưu cài đặt" / "Bỏ thay đổi" / "Khôi phục tất cả" và chỉ báo "Có thay đổi chưa lưu"/"Đang dùng mặc định"/"Đã tuỳ chỉnh" nằm **trong màn SHT** (hiện có), không nhân bản. Nhóm Cá nhân lưu ngay từng công tắc (toast "Đã lưu cài đặt"). Footer trong mock chỉ minh hoạ phần SHT | Đổi (Q10) | SHT `SettingsHeader.tsx`, `v2l.vi.json:19-26`; community `Settings.tsx:44-48` |
| D6 | Quyền sửa do `contracts-web` quyết (banner "Chỉ chủ sở hữu hợp đồng được sửa cài đặt" hiện ở đó, `contracts.settings.readOnly`). Dialog community chỉ quyết **hiện/ẩn** mục theo quyền xem (D4, §6) | Đổi | `v2l.vi.json:28` |
| D7 | Rời khi còn thay đổi chưa lưu: hỏi xác nhận, dùng chuỗi "Có thay đổi chưa lưu" (P0 D15). Dialog Cá nhân lưu ngay nên không có bản nháp; quy tắc áp cho SHT (đã có) và mọi bản nháp thêm sau | Mới | `v2l.vi.json:19` |
| D8 | Community-web **không gọi API contracts**; mục SHT chỉ tạo URL `${VITE_CONTRACTS_URL}/settings?sec=<id>` (`id` ∈ `co`, `rep`, `biz`, `scout`, `flow`) và `/settings/members` cho Thành viên | Mới (Q10) | `routes/_authed/settings/index.tsx:6` |

## 4. Điều hướng & trạng thái
`settingsOpen` + `settingsSection` (id mục) trong context. Mở trực tiếp mục: `ctx.openSettings(id)` (dùng cho deep-link nội bộ). Trạng thái: tải · lỗi ("Không tải được cài đặt." + Thử lại) · không quyền (nhóm ẩn) · đang lưu · đã lưu (toast).

## 5. Dữ liệu / Contract
| Nhóm | Đọc/ghi | Quyền |
|---|---|---|
| Cá nhân | `api.getSettings/saveSettings` của community (`CommunitySettings.notify`; `accent` optional/bỏ qua, P0 D8) | người dùng, chỉ của mình |
| Công ty / Sổ Hợp Tác | **không có trong community-web**: deep-link; dữ liệu và ghi nằm ở `contracts-web` (`GET/PUT /company`, `/approval-settings`, scoring, scout, `/esign/*`) | `contracts-owner` ghi (kiểm ở contracts-web + server) |
| Quyền xem để hiện/ẩn mục SHT | `viewer.caps.contracts` (`none`, `read`, `write`, `admin`) — **Contract MỚI** qua port gói↔gói (P5 L7), shape chờ backend-lead | MỚI, backend-lead chốt shape |

**Việc nền tiền đề (mô tả, chưa code):** `contracts-web` cần hỗ trợ `?sec=co|rep|biz|scout|flow` ở `/settings`. Hiện `/settings` redirect sang `/settings/members` (`routes/_authed/settings/index.tsx:6`) và section chọn bằng `useState` trong `SettingsDialog.tsx`. Cần: đọc `sec` từ search params (zod enum), mở đúng section; thiếu/không hợp lệ ⇒ hành vi hiện tại. Gắn vào COM-FR-38 (tiền đề) và P5 L8. Chưa có tiền đề này thì deep-link vẫn mở được nhưng rơi về `/settings/members`.

## 6. Quyền & cách ly
| Nhóm | Hiện khi | Sửa | Nguồn |
|---|---|---|---|
| Cá nhân | mọi user community (đối tác chỉ thấy loại thông báo không `HOST_ONLY`) | chính user | `Settings.tsx:31,49` |
| Công ty / Sổ Hợp Tác | chủ quản **và** `viewer.caps.contracts` đủ mức cho mục đó (xem/`canSeeSettings` `nav.ts:30-31`) | do `contracts-web` + server quyết (`contracts-owner` ghi; "Chỉnh quy trình duyệt" chỉ `platform_admin`) | `cai-dat-va-quyen.md` §1; `FlowEditorLink.tsx:1` |
Không dùng một cờ chung: mỗi nhóm có `canView` riêng (community-owner khác contracts-owner, I3). Ẩn UI chỉ phản chiếu; chặn thật ở server (I4). Đối tác: chỉ nhóm Cá nhân; contracts-web trả 0 hàng/403 (`ext_deny`).

## 7. Nhãn VI / EN (EN đề xuất dịch, chờ duyệt)
| VI (verbatim) | EN đề xuất |
|---|---|
| Cài đặt · Áp dụng cho cả công ty | Settings · Applies to the whole company |
| Cá nhân · Công ty · Sổ Hợp Tác | Personal · Company · Sổ Hợp Tác (tên riêng giữ) |
| Chọn phần cài đặt (aria nav) | Choose a settings section |
| Lưu cài đặt · Bỏ thay đổi · Khôi phục tất cả | Save settings · Discard changes · Reset all |
| Có thay đổi chưa lưu · Đang dùng mặc định · Đã tuỳ chỉnh | Unsaved changes · Using defaults · Customised |
| Đã lưu cài đặt · Không lưu được cài đặt · Không tải được cài đặt. | Settings saved · Could not save settings · Could not load settings. |
| Chỉ chủ sở hữu hợp đồng được sửa cài đặt | Only the contract owner can change settings |
Nguồn VI: `packages/i18n/locales/contracts/v2l.vi.json:4-28`.

## 8. Tiêu chí chấp nhận
| AC | Nội dung |
|---|---|
| P4a-AC01 | "Cài đặt chung" mở dialog với head "Cài đặt" + "Áp dụng cho cả công ty"; Esc đóng; nền giữ route (P0 D11). |
| P4a-AC02 | Chủ quản có quyền contracts thấy 3 nhóm; chủ quản không có quyền contracts chỉ thấy nhóm Cá nhân. |
| P4a-AC03 | Đối tác chỉ thấy nhóm Cá nhân; DOM không chứa tên nhóm/mục SHT; community-web không phát sinh request nào tới API contracts. |
| P4a-AC04 | Nhóm xổ/gập bằng chuột và bàn phím; nhớ trạng thái. |
| P4a-AC05 | Mỗi mục SHT hiện thẻ + nút "Mở trong Sổ Hợp Tác" với href `${VITE_CONTRACTS_URL}/settings?sec=<id>` đúng id (Thành viên: `/settings/members`). |
| P4a-AC06 | (tiền đề) Mở `contracts-web/settings?sec=rep` chọn sẵn Điểm uy tín; `sec` lạ ⇒ hành vi cũ. |
| P4a-AC07 | Công tắc Thông báo (Cá nhân) lưu ngay + toast, không cần footer. |
| P4a-AC08 | `canView` của từng nhóm có unit test độc lập (không một cờ chung). |

## 9. Mã truy vết
COM-FR-38 Khung dialog + nav nhóm + deep-link mục SHT + quyền theo nhóm (kèm tiền đề `?sec=` ở contracts-web).

## 10. Việc còn mở
Đã chốt: kiến trúc deep-link (Q10), footer thuộc SHT, hỏi khi rời (P0 D15). Backend-lead chốt khi code: shape `viewer.caps.contracts` (P5 L7). Frontend contracts-web: tiền đề `?sec=`.
