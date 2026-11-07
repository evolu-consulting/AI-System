---
id: cr123-u4-canvas-ux
lát: cr123-u4-canvas-ux
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u3b (đã gộp)
---
## Plan (ngắn)
Hàng chờ UX canvas (docs/specs/CR-122/resume.md): giám đốc / sale mở flow không thấy chữ kỹ thuật, không bị nhắc sai, không gõ "true".

## Làm
1. Lỗi "tool chưa bật" trên node nói câu nghiệp vụ + cách sửa (khoá `process.admin.flow.toolOff` thiếu ⇒ hiện nguyên khoá).
2. Cạnh vàng "bước trước không có Hợp đồng" là cảnh báo giả: `edgeProblems` nay nhận đầu ra của Bắt đầu khi (`startOutputsOf`) — có ở mọi bước sau.
3. Điều kiện Nếu trên dữ kiện Có/Không: chỉ "là / không là" + chọn Có/Không (`opsForType("boolean")`, `CondValue`).
4. Bỏ loại kỹ thuật ("set", "form", "Chuẩn bị dữ liệu", "Agent") dưới tên bước.
5. Nhãn Đúng/Sai không lặp trên cạnh (cổng IfPort đã có nhãn); bỏ tiền tố "Bước N:" trong ô bước của khe/DLC.
6. Luật "bước hành động thật (Ký số) cần bước duyệt ngay trước" cho picker (chèn trên cạnh / thêm), kéo thả (thả từ menu) — một nguồn `realActionAllowed` ở `domain/tool-rules` (lưu dùng chính hàm đó), thêm `newRealViolation`; sai ⇒ lý do `process.admin.canvas.err.realNeedsReview`.
7. e2e hành trình kéo-thả: `e2e/journey-approval/cr123-palette-drop.spec.ts` (+ khai trong playwright.journey.config.ts).

## Không làm / Chạm
- Không CR-124 (đối tác / packs-contracts), không depcruise/tooling của slice arch, không DLC, không hub-api/engine/migration.
- Luật bước duyệt chưa chặn khi KÉO node đã có sang chỗ khác (chỉ thả mới / chèn) — ghi hàng chờ.
- `PlainBody` ("Giai đoạn n: …") giữ nguyên: e2e P-b2 đóng băng so chuỗi đó.

## Test tối thiểu
`lib/u4-canvas-ux.test.ts` (khoá dịch, cạnh vàng, Có/Không, newRealViolation, không lộ "set"); e2e journey 1 ca (xanh trên evotest).

## Quyết định trong lúc làm
- Stack UAT cục bộ: `uat-stack.ts` đã có `UAT_PORT_BASE/UAT_DB/UAT_REDIS_DB` (u3b).
- E2E không kéo "Ký số" vì công ty hành trình chưa bật tính năng ký số (menu không có mục) — luật được unit kiểm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Canvas flow nói chữ nghiệp vụ, không nhắc sai, chặn thả sai chỗ (nguồn: CR-123 u4)
Node trên canvas flow không hiện loại kỹ thuật dưới tên bước; lỗi "tính năng chưa bật" nói bằng câu nghiệp vụ kèm cách sửa; cạnh vàng không nhắc thứ mà "Bắt đầu khi" đã có ở mọi bước sau;
điều kiện Nếu trên dữ kiện Có/Không chỉ có "là / không là" + chọn Có/Không; nhãn Đúng/Sai hiện một lần; thả / chèn bước hành động thật (Ký số) mà bước ngay trước chưa phải bước duyệt thì bị chặn kèm lý do.
- Kịch bản: khi node có lỗi "tính năng chưa bật" thì câu lỗi có bản dịch vi và en [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » u4 · câu lỗi trên node có bản dịch (vi + en)]
- Kịch bản: khi flow bắt đầu từ hợp đồng thì bước Ký số không bị nhắc thiếu Hợp đồng [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » có đầu ra trigger (HĐ) ⇒ không báo]
- Kịch bản: khi điều kiện Nếu trên dữ kiện Có/Không thì chỉ có phép là hoặc không là [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » opsForType boolean chỉ eq / ne, kiểu số vẫn đủ 6]
- Kịch bản: khi thả bước Ký số sau bước không phải duyệt thì bị chặn [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » sau bước tự động ⇒ trả uid của bước hành động thật]
- Kịch bản: khi bước Ghi giá trị hay Điền thông tin thì không hiện chữ kỹ thuật dưới tên [test: apps/admin-web/src/features/processes/lib/u4-canvas-ux.test.ts » u4 · bước Ghi giá trị / Điền thông tin không lộ chữ kỹ thuật dưới tên bước]
- Kịch bản: khi kéo mục Thông báo từ menu Thêm bước thả vào canvas công ty thì thêm một node [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]

## Việc còn lại
- Luật bước duyệt khi kéo node đã có; e2e kéo "Ký số" khi công ty đã bật tính năng ký số.
- Relock `tests/.lock` cho e2e mới (qc / `bun run test:lock:write`).