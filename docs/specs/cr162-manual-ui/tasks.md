# cr162-manual-ui — CR-162 (UI nhập tay: 2 cột, cụm nút «Không đọc được», bỏ vạch thừa, nút icon «Xem hợp đồng gốc»)

Nền: `docs/specs/cr157-manual-fallback/`. Chỉ web (`workspace-web` `features/contract-review`, `components/shared/pop-menu.tsx`); không đổi API/luật.
Trạng thái gộp: chưa gộp

## Delta (so với docs/current)
### Kịch bản 1 — Màn nhập tay 2 cột full chiều rộng
Màn rộng (≥ lg): form | tệp gốc, hai cột ngang nhau, không chừa khoảng trống; màn hẹp xếp dọc (tệp gốc xem bằng nút icon).
`[test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · màn nhập tay: form và tệp gốc 2 cột full chiều rộng]`

### Kịch bản 2 — Thẻ «Không đọc được hợp đồng này» gom lựa chọn
Nút chính «Nhập tay»; nút menu «⋯» (nhãn «Thêm lựa chọn») chứa «Thử lại» và «Tải tệp khác». Thử lại mở hộp xác nhận cũ; Tải tệp khác mở hộp chọn tệp.
`[test: apps/workspace-web/src/features/contract-review/components/FailedActions.test.tsx » FailedActions]`
`[test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · thẻ Không đọc được: Nhập tay là nút chính, Thử lại và Tải tệp khác nằm trong một menu]`

### Kịch bản 3 — Menu không có vạch kẻ thừa
Mục đòi vạch (Xoá/divider) mà đứng đầu menu ⇒ không vạch (sửa ở `PopMenu`, mọi menu dùng chung).
`[test: apps/workspace-web/src/components/shared/pop-menu.test.tsx » showDivider]`
`[test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · menu Thao tác chỉ một mục thì không có vạch kẻ]`

### Kịch bản 4 — «Xem hợp đồng gốc» là nút icon
Chỉ icon, chú thích «Xem hợp đồng gốc» khi rê/focus, `aria-label`; chuỗi i18n `contracts.review.viewFile` không còn emoji.
`[test: apps/workspace-web/src/features/contract-review/components/FileLink.test.tsx » FileLink]`
`[test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · Xem hợp đồng gốc là nút icon có chú thích khi rê chuột]`

## Quyết định trong lúc làm
- «Thử lại» và «Tải tệp khác» thành mục menu (`testid` `reextract`, `replace-file-item`; input tệp ẩn giữ `testid=replace-file`); «AI đọc lại» ở ManagePanel giữ nguyên.
- Chú thích icon tự dựng (`role=tooltip`, hiện khi hover/focus) vì chưa có Tooltip dùng chung.
- e2e cũ đổi theo: gapa1-manage (mở menu ⋯ trước), hd2-flow, scenes (selector link).
