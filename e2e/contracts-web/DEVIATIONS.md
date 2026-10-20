# Lệch so với mgmt-app — đã hết hiệu lực (nav-v2, 2026-10-20)

Người dùng chốt 2026-10-20: cấu trúc trang và giao diện contracts-web theo **mockup NITI** (`docs/platform/ba-v2/mockup-niti.html`, §4 của
`so-hop-tac-ba-v2.pdf`), thay quy tắc D-02 "giống hệt mgmt-app" cho điều hướng và bố cục. Vì vậy:

- Các cảnh `scenes.cw.ts`, `cks.cw.ts`, `hd78-partners.cw.ts` không còn so với web mgmt-app; chúng so với **baseline của chính contracts-web**
  (`baseline/<platform>/`, 3 lớp chữ / khung ±2 px / ảnh ≤ 0,5 %). Chụp lại: `bun run e2e:contracts:capture` (Windows) hoặc
  `deploy/evotest/run-tests.ps1 -Step e2e -Capture cw` (bản Linux dùng ở CI/evotest), rồi commit baseline.
- Bỏ chế độ `CW_MODE=ref`, `capture-ref.ts`, `HIDE` các lệch có chủ ý (menu thêm, ô "Mã công ty", khối duyệt…): UI thật nay là chuẩn.
  Chỉ còn ẩn `[data-hd5]` (khối phụ lục gọi API không giả trong cảnh S05).
- Menu 4 mục (Tổng quan · Hợp đồng · Đối tác · Sản phẩm & Giá), `/` ⇒ `/overview`, `/my-work` `/prices` `/cks` `/sourcing` là chuyển hướng:
  hành vi kiểm ở `e2e/N1/shell.n1.ts` và `overview.cw.ts`.
- Dữ liệu giả: `dataset.ts` (`asHub()`), `dataset-overview.ts` (Tổng quan). Các hàm `*AsMgmt` còn trong `dataset*.ts` không còn dùng.