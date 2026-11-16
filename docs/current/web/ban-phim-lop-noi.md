# Menu, ngăn, nhóm chọn dùng bàn phím (CR-177 · nguồn: cr177-w1-overlays, fix-e2e-cw-1116)

#### Yêu cầu: Menu, ngăn và nhóm chọn dùng được bằng bàn phím
Menu nhỏ («Xuất ▾», «⋯»), menu tài khoản, chuông thông báo và nút «Ứng dụng» mở bằng Enter/↓, con trỏ vào trong, Esc đóng và trả con trỏ về nút mở. Ngăn khoang trợ lý ở màn hẹp đóng bằng Esc, con trỏ không lọt ra ngoài, trả focus về nút mở; khoang vẫn nhớ tab/hội thoại. Nhóm nút chọn một đổi bằng mũi tên (đi vòng, Home/End).
- Kịch bản: mở menu «Xuất» bằng Enter, ↓ sang mục kế, Esc trả con trỏ về nút [test: e2e/contracts-web/cr177-w1-overlays.cw.ts » CR177-W1 · menu «Xuất»]
- Kịch bản: ngăn khoang ở màn hẹp, Esc đóng, Tab không lọt ra ngoài [test: e2e/contracts-web/cr177-w1-overlays.cw.ts » CR177-W1 · khoang trợ lý ở màn hẹp]
- Kịch bản: mũi tên chuyển nút chọn một [test: e2e/contracts-web/cr177-w1-overlays.cw.ts » CR177-W1 · nhóm nút chọn một]
- Kịch bản: bước mũi tên trong nhóm nút [test: apps/workspace-web/src/components/shared/seg-button.test.ts » radioStep]
- Kịch bản: bước mũi tên trong menu tài khoản [test: apps/workspace-web/src/features/shell/components/Popover.test.ts » menuStep]
