# ADR-0040 · Dùng `elkjs` (ELK `layered`) làm bố cục sơ đồ flow (CR-123 u13)

Trạng thái: **Accepted** (người dùng chốt 2026-11-07: "dùng thư viện powerful"). Liên quan: ADR-0013 (canvas lazy chunk), FLOW3-FR-04.

## Bối cảnh
Bố cục `columns` tự viết (mỗi bước một cột 320 px, làn cho nhánh Nếu) không gập hàng: flow 8–9 bước dài ~2 500 px, ở chữ đọc được (zoom ≥ 0.75) chỉ thấy 3–4 bước, phần còn lại phải kéo ngang; đầu ra nhiều nhánh (Ký số: Ký xong / Từ chối / Hết hạn, Nếu: Đúng / Sai) chỉ là dây vẽ chéo; nhánh dài đè lên node. Mỗi lần thêm kiểu node là thêm luật làn.

## Quyết định
Dùng **`elkjs` 0.12.0** (ghim chính xác, `packages/flow-canvas`; bản phát hành ≥ 2 tuần), thuật toán **`layered`**, hướng trái → phải:
- **Cổng (port)** ở mép phải cho node nhiều đầu ra, thứ tự cố định (`portConstraints: FIXED_ORDER`, `port.index`): ELK biết dây nào ra từ cổng nào nên bớt giao cắt.
- **Cạnh vuông góc** (`edgeRouting: ORTHOGONAL`; vẽ bằng smoothstep của xyflow).
- **Gập hàng** (`layered.wrapping.strategy: MULTI_EDGE` + `aspectRatio` ≈ khung nhìn 2.4): flow dài thành 2–3 hàng, vừa khung 1100×458 ở zoom ≥ 0.75.
So với `dagre`: dagre không có cổng, không gập hàng, cạnh chỉ đi thẳng/cong; `elkjs` là cổng của Eclipse ELK (Java → JS), cùng bộ layered đã dùng ở nhiều trình soạn sơ đồ.

## Chi phí và giảm thiểu
- `elkjs` nặng (~1.4 MB, ~400 KB gzip) — **chỉ tải lười trong trình soạn flow**: `elkjs/lib/elk-api` (vài KB) nằm trong chunk `canvas`; engine `elk-worker.min.js` phát như tệp tĩnh (`?url`, không đóng gói) và chạy trong **web worker** ⇒ không chặn giao diện, không vào chunk khởi đầu / chunk trang khác (`check:bundle` giữ nguyên).
- Lỗi worker ⇒ toạ độ dự phòng (lưới 4 node/hàng), canvas không bao giờ trống.
- Bố cục tính khi mở lần đầu, khi cấu trúc đổi, "Sắp xếp"; node người dùng kéo tay giữ `ui.x` + `ui.y` (contracts, tuỳ chọn, tương thích ngược).

## Hệ quả
- Xoá bố cục cột (`layout/columns.ts`, tiêu đề cột, nút gộp); đồ thị cạnh còn ở `layout/graph.ts`, vị trí chỉ do ELK. Thứ tự bước vẫn do mũi tên quyết định (u12).
- Kéo node theo chiều ngang không còn đổi "cột" (bước); đổi thứ tự = kéo mũi tên.