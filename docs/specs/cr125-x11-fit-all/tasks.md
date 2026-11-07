---
id: cr125-x11-fit-all
lát: cr125-x11-fit-all
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: x10 (đã gộp)
---
## Plan (ngắn)
Shot demo `c3-ba-dau-ra-ky-so.png` (Công ty › Quy trình, 1440×900): bấm "vừa khung" vẫn cắt cột Kết thúc ở bên phải vì luật fit có SÀN zoom "đọc được" (0.75 → 0.55) — flow dài hơn sàn thì neo trái và cắt đuôi; mỗi nơi (mở lần đầu, nút, khung đổi cỡ, canvas thư viện / showcase) lại có sàn riêng (`fitMin`).

## Làm
1. MỘT luật vừa khung thuần `flow-canvas/src/fit.ts` (`fitViewport`): cả flow nằm trọn trong vùng thấy được (khung trừ ngăn chi tiết), chỉ dừng ở mức zoom tối thiểu của canvas (0.15, chung với `minZoom` của khung xyflow); chỉ khi flow lớn hơn cả mức đó mới neo trái/trên.
2. `view-fit.ts`: mở lần đầu, nút "vừa khung", "Sắp xếp", khung đổi cỡ, chế độ compact đều gọi cùng `runFit` → `fitViewport`; bỏ `fitBesideDrawer`/sàn `fitMin` khỏi fit. `fitMin` chỉ còn là sàn khi THEO node (thả / nối / chọn) và không bao giờ phóng to hơn zoom hiện tại (flow đã fit nhỏ không bị kéo to lên khi thả node mới).
3. Mọi trình sửa dùng chung: canvas thư viện (`fitMin` 0.7), flow công ty (0.55), showcase compact — cùng một rule.

## Không làm / Chạm
- Không đổi bố cục (x10) hay định tuyến cạnh (x9); chữ node nhỏ khi flow dài (người dùng zoom tay) — đổi lấy "thấy cả flow".

## Test tối thiểu
Unit `flow-canvas/src/fit.test.ts`; e2e `cr123-arrow-drag.spec.ts` (mở lần đầu và sau nút vừa khung, Ngang + Dọc: hộp mọi node trong khung canvas) chạy MỘT lần trên evotest; tsc flow-canvas + admin-web.

## Quyết định trong lúc làm
- Mức zoom tối thiểu 0.15 thay 0.3 (canvas) để flow ~12 node vẫn vừa một khung 1100px; kéo/zoom tay như cũ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: "Vừa khung" luôn đưa cả flow vào khung, ở mọi trình sửa (nguồn: CR-125 x11)
Khi mở flow lần đầu, bấm nút vừa khung, "Sắp xếp" hoặc khung đổi cỡ thì mọi node của sơ đồ — kể cả cột Kết thúc cuối cùng — nằm trọn trong vùng thấy được; một luật duy nhất cho mọi canvas.
- Kịch bản: khi flow demo rộng hơn khung thì fit thu nhỏ để mọi node nằm trong khung [test: packages/flow-canvas/src/fit.test.ts » flow demo rộng hơn khung: thu nhỏ tới mức cần, TOÀN BỘ node (kể cả cột cuối) nằm trong khung]
- Kịch bản: khi ngăn chi tiết mở thì fit vào phần còn lại bên trái ngăn [test: packages/flow-canvas/src/fit.test.ts » ngăn chi tiết mở: fit vào phần còn lại bên trái ngăn]
- Kịch bản: khi mở flow thật và bấm vừa khung ở cả Ngang và Dọc thì hộp mọi node nằm trọn trong khung canvas [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]

## Việc còn lại
- Không.
