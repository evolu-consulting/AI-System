# cr162-manual-ui — CR-162 (UI nhập tay: 2 cột, cụm nút «Không đọc được», bỏ vạch thừa, nút icon «Xem hợp đồng gốc»)

Nền: `docs/specs/cr157-manual-fallback/`. Chỉ web (`workspace-web` `features/contract-review`, `components/shared/pop-menu.tsx`); không đổi API/luật.
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Màn nhập tay 2 cột full chiều rộng (CR-162)
Màn rộng: form | tệp gốc, hai cột ngang nhau, không chừa khoảng trống; màn hẹp xếp dọc.
- Kịch bản: khi mở màn nhập tay ở màn rộng thì form và tệp gốc nằm 2 cột chiếm hết chiều rộng [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · màn nhập tay: form và tệp gốc 2 cột full chiều rộng]

#### Yêu cầu: Thẻ «Không đọc được hợp đồng này» gom lựa chọn (CR-162)
Nút chính «Nhập tay»; nút menu «⋯» chứa «Thử lại» và «Tải tệp khác».
- Kịch bản: khi AI đọc lỗi thì thẻ có một nút chính Nhập tay và một menu chứa Thử lại, Tải tệp khác [test: apps/workspace-web/src/features/contract-review/components/FailedActions.test.tsx » FailedActions; e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · thẻ Không đọc được]

#### Yêu cầu: Menu không có vạch kẻ thừa (CR-162)
Mục có vạch mà đứng đầu menu thì không vẽ vạch (sửa chung ở menu dùng chung).
- Kịch bản: khi menu Thao tác chỉ có một mục thì không có vạch kẻ phía trên [test: apps/workspace-web/src/components/shared/pop-menu.test.tsx » showDivider; e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · menu Thao tác chỉ một mục thì không có vạch kẻ]

#### Yêu cầu: «Xem hợp đồng gốc» là nút icon (CR-162)
Chỉ icon, chú thích khi rê chuột hoặc focus, có nhãn đọc màn hình; chữ không còn emoji.
- Kịch bản: khi rê chuột lên icon thì hiện chú thích Xem hợp đồng gốc [test: apps/workspace-web/src/features/contract-review/components/FileLink.test.tsx » FileLink; e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-162 · Xem hợp đồng gốc là nút icon có chú thích khi rê chuột]

## Quyết định trong lúc làm
- «Thử lại» và «Tải tệp khác» thành mục menu (`testid` `reextract`, `replace-file-item`; input tệp ẩn giữ `testid=replace-file`); «AI đọc lại» ở ManagePanel giữ nguyên.
- Chú thích icon tự dựng (`role=tooltip`, hiện khi hover/focus) vì chưa có Tooltip dùng chung.
- e2e cũ đổi theo: gapa1-manage (mở menu ⋯ trước), hd2-flow, scenes (selector link).
