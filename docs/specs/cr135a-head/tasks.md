---
id: cr135a-head
lát: cr135a-head — đầu trang HĐ đợt 2 (Q2, Q12, icon loại)
cr: CR-135
làn: nhanh
migration: không
---
## Plan (ngắn)
| # | Việc | File chính |
|---|---|---|
| 1 | Q2: nháp lần đầu — ngoài chỉ «Gửi duyệt» (chính) + «Thao tác ▾» (Lưu nháp · Huỷ · … · Xoá đỏ cuối); thanh dính nền nhấn (`bg-act-soft` + viền) | `contract-review/lib/head-rule.ts` (`headActs`), `HeadActions.tsx`, `ContractHead.tsx`, `contract-form/components/FormBar.tsx` |
| 2 | Q12: bấm tên HĐ nháp ⇒ ô sửa (Enter/blur lưu, Esc huỷ, rỗng ⇒ lỗi giữ tên cũ); `headRule.rename` = chỉ DRAFT + người sửa được | `TitleEdit.tsx`, `ContractBody.tsx`, `head-rule.ts` |
| 3 | Icon loại HĐ có màu cạnh tên (aria-label + tooltip); bỏ nhãn chữ loại ở dòng thông tin | `DocTypeIcon.tsx`, `components/icons.tsx` (`IconFramework`), `DetailLead.tsx` |

## Quyết định trong lúc làm
- Không có nút chính nào (chưa gửi duyệt được, vd công ty chưa có quy trình) ⇒ «Lưu nháp» lên làm nút chính, menu còn «Huỷ».
- Nhãn nút chính thanh nháp = «Gửi duyệt» khi thẻ duyệt giữ nút Xác nhận; tenant tắt duyệt vẫn «Xác nhận và lưu» (không có bước gửi).
- Đổi tên: form đang có sửa dở ⇒ chỉ đổi ô tên trong form (lưu cùng «Lưu nháp»/«Gửi duyệt», một nguồn, không mất sửa dở); chưa sửa gì ⇒ `PATCH /contracts/:id/fields {title}` rồi tải lại. Không thêm API.
- Câu `draftHint` đã gỡ từ trước (chỉ còn e2e tham chiếu). Icon ở cột danh sách: không làm (chưa gọn).
- Nút chính dùng `Btn` (CR-134); menu cùng cỡ sm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED web/web-hop-nhat.md
#### Yêu cầu: Đầu trang HĐ nháp gọn (CR-135 Q2)
Thanh nháp có một nút chính nổi («Gửi duyệt») và «Thao tác ▾» chứa «Lưu nháp», «Huỷ», «Xoá hợp đồng» (đỏ, cuối).
- Kịch bản: nháp lần đầu ⇒ chính = Gửi duyệt, menu = Lưu nháp, Huỷ, Xoá [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » CR-135 Q2: nháp lần đầu — chính = Xác nhận/Gửi duyệt, Lưu nháp + Huỷ + Xoá trong menu]
- Kịch bản: không gửi duyệt được ⇒ Lưu nháp là nút chính [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » CR-135 Q2: nháp chưa gửi duyệt được ⇒ Lưu nháp là nút chính, menu còn Huỷ]

### ADDED web/web-hop-nhat.md
#### Yêu cầu: Đổi tên HĐ nháp tại chỗ (CR-135 Q12)
Bấm tên HĐ nháp để sửa tại chỗ; chỉ nháp và chỉ người sửa được nháp; rỗng ⇒ báo lỗi, giữ tên cũ. Icon loại HĐ có màu cạnh tên, có nhãn đọc màn hình.
- Kịch bản: chỉ DRAFT + người ghi đổi tên được [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » CR-135 Q12: chỉ DRAFT + người ghi mới đổi tên được]

## Việc còn lại
- e2e khoá vỡ (qc sửa): `cr127/j05-tam-khoa` (act-hold vào menu), `j10-phien-ban-chuyen-moc` + `contracts-web/k2-versions.cw.ts` (act-newVersion có thể vào menu), `j16-xoa-hop-dong-nhap` + `v2m-delete.cw.ts` (nút «Thao tác»), `contract-flow.cw.ts` (return/reject trong menu), `cr120-intake-flow.cw.ts:25` (`draft-hint` đã gỡ), chỗ bấm «Lưu nháp»/«Huỷ» trên thanh nháp (nay trong menu: `act-saveDraft`/`act-cancel`), «Xác nhận và lưu» ở nháp có thẻ duyệt nay «Gửi duyệt», `doc-type-tag` (nay `doc-type-icon`).
