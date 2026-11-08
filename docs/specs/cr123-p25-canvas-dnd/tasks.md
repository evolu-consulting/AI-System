---
id: cr123-p25-canvas-dnd
lát: cr123-p25-canvas-dnd
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: cr123-p22 (đã gộp), cr123-u1 (bảng node theo vai trò)
---
## Plan (ngắn)
FLOW3-FR-04..08 trên canvas `@xyflow/react` của trình soạn quy trình. Phần chung nằm ở `@ai/flow-canvas` (prop `editing`, mặc định TẮT ⇒ workspace-web không đổi): chọn nhiều + chọn cạnh, phím tắt (Delete, Ctrl+C/V, Ctrl+Z/Y), thả từ bảng mẫu (`FLOW_PALETTE_MIME`), nối lại đầu đích của cạnh (`onReconnectEnd`), minimap, Ctrl+lăn chuột. Luật hợp lệ KHÔNG viết lại: nối / nối lại dùng `lib/canvas-connect` (p22), giới hạn bước + cột đầy dùng `lib/step-ops`.

## Làm
- `lib/canvas-edit.ts` (thuần): `removeStages` (xoá có nối liền A→B→C ⇒ A→C, Nếu không được nối liền vào bước thật), `resetEdge(s)` (xoá cạnh = về "Bước tiếp theo"), `pasteStages` (mã/tên mới, cạnh giữa các bản sao nối với nhau, vượt giới hạn ⇒ từ chối), `moveGroup`, `placeFresh` (thả vào cột), `hasConfig` (chỉ hỏi xác nhận khi bước đã có cấu hình).
- `lib/edit-history.ts` + `use-draft`: hoàn tác/làm lại theo phiên sửa, tối đa 100 bước, gõ liên tiếp cùng ô gộp một bước; `load` xoá lịch sử.
- `lib/jump-edges.ts`: bước có "đi tiếp" khác bước kế được vẽ cạnh tới đúng bước đó (để kéo nối / xoá cạnh nhìn thấy kết quả).
- `hooks/use-canvas-edit.ts` + `components/canvas/use-canvas-editing.tsx`: nối canvas với bản nháp; lỗi ⇒ không đổi + toast (aria-live) nêu lý do; xong ⇒ aria-live.
- Menu "Thêm bước" kéo thả được (không modal khi đang xem sơ đồ): thả lên chỗ trống = thêm vào cột dưới con trỏ, thả lên mũi tên = chèn giữa (Nhánh Đúng/Sai không nhận bước hành động thật). Nút Hoàn tác/Làm lại + bảng phím tắt "?" cập nhật.

## Không làm / Chạm
- Không đụng hub-api, engine chạy flow, DLC, workspace-web (prop `editing` mặc định tắt). Luật "Ký số cần bước duyệt ngay trước" không nằm ở canvas-connect (p22) nên chưa chặn lúc thả — kiểm khi lưu như cũ.
- Thả từ bảng mẫu chỉ có ở canvas có bảng node (trình soạn flow có "Bắt đầu khi"); flow mẫu showcase không có bảng ⇒ e2e showcase không kéo bảng mẫu (unit `placeFresh` + `insertOnEdge`).

## Test tối thiểu
unit: `canvas-edit.test.ts`, `edit-history.test.ts`, `jump-edges.test.ts`, `flow-canvas/src/editing.test.ts`; e2e: `e2e/fnr-showcase/canvas-dnd.fnr.ts` (một lần) + P-b2 (hồi quy canvas).

## Quyết định trong lúc làm
- Chọn nhiều: Shift+nhấn / Shift+kéo khung (kéo nền vẫn là kéo khung nhìn như cũ). Kéo nhóm: cả nhóm dời cùng số cột; cột đầy ⇒ từ chối.
- Phím tắt chỉ nhận khi canvas đang giữ focus (không cướp Ctrl+Z của ô nhập chữ).
- Xoá bước bằng Delete trên canvas hỏi xác nhận CHỈ khi bước đã có cấu hình; Ctrl+Z hoàn tác được.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Nối lại đầu cạnh trên canvas dùng cùng luật với kéo cổng ra
Kéo đầu đích của một cạnh (tiến thường hoặc Đúng/Sai) sang node khác thì đặt lại "Sau đó đi tiếp" / Đúng / Sai theo đúng luật của kéo cổng ra: đích phải ở bước sau, nhánh Nếu không tới bước hành động thật. Sai luật thì không đổi gì và hiện lý do bằng toast (đọc được bằng aria-live).
- Kịch bản: khi nối lại nhánh Đúng của Nếu sang bước sau thì hợp lệ, sang bước hành động thật hoặc bước trước thì bị từ chối kèm mã lỗi [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » nối lại nhánh Đúng: bước sau hợp lệ, bước thật ⇒ ifReal, bước trước ⇒ notLater]
- Kịch bản: khi kéo đầu cạnh trên canvas thật thì ô đích đổi, kéo về bước trước thì có toast lý do và không đổi gì [test: e2e/fnr-showcase/canvas-dnd.fnr.ts » CR-123 · p25 · nối lại đầu cạnh: Sai sang bước sau đổi đích, cạnh tiến kéo về bước trước ⇒ toast lý do, không đổi gì]

#### Yêu cầu: Xoá bước nối liền các cạnh; xoá cạnh đặt lại về bước tiếp theo
Chọn bước rồi nhấn Delete thì bước bị xoá và các cạnh vào/ra được nối liền (A→B→C xoá B ⇒ A→C); không nối liền hợp lệ được (nhánh Nếu sẽ tới bước hành động thật) thì từ chối. Chọn cạnh rồi Delete thì đích của cạnh về mặc định "Bước tiếp theo". Chỉ hỏi xác nhận khi bước đã có cấu hình.
- Kịch bản: khi xoá bước B giữa A và C thì C dồn lên sát A và đích cũ vào B chuyển sang C [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » A→B→C xoá B ⇒ C dồn lên sát A, đích 'đi tiếp' vào B chuyển sang C]
- Kịch bản: khi nối liền sẽ đưa nhánh Nếu vào bước hành động thật thì bị từ chối [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » nối liền sang bước thật mà nhánh Nếu đang trỏ tới ⇒ từ chối, không đổi gì]
- Kịch bản: khi xoá cạnh Sai/Đúng thì về mặc định, cạnh thường bỏ "đi tiếp", đã mặc định thì báo [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » Sai → null (bước kế), Đúng → bước kế nếu có]
- Kịch bản: khi nhấn Delete trên canvas thật rồi Ctrl+Z thì bước trở lại [test: e2e/fnr-showcase/canvas-dnd.fnr.ts » CR-123 · p25 · Delete xoá cạnh/bước, Ctrl+Z và nút Hoàn tác khôi phục, Ctrl+Y làm lại]

#### Yêu cầu: Hoàn tác / làm lại trong phiên sửa, tối đa 100 bước
Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) và hai nút trên thanh công cụ hoàn tác / làm lại các thao tác sửa quy trình trong phiên mở trình sửa (đóng là mất); tối đa 100 bước; gõ liên tiếp vào cùng một ô gộp thành một bước.
- Kịch bản: khi ghi 3 bước rồi lùi 2 và tiến 1 thì về đúng trạng thái [test: apps/admin-web/src/features/processes/lib/edit-history.test.ts » ghi 3 bước, lùi 2, tiến 1]
- Kịch bản: khi ghi quá 100 bước thì bước cũ nhất rớt [test: apps/admin-web/src/features/processes/lib/edit-history.test.ts » tối đa 100 bước: bước cũ nhất rớt]
- Kịch bản: khi bấm tổ hợp phím thì ra đúng lệnh [test: packages/flow-canvas/src/editing.test.ts » Ctrl+Z hoàn tác, Ctrl+Y và Ctrl+Shift+Z làm lại (cả Cmd)]

#### Yêu cầu: Chọn nhiều, kéo nhóm, nhân đôi bằng Ctrl+C / Ctrl+V
Shift+nhấn hoặc Shift+kéo khung chọn nhiều bước; kéo một bước đã chọn thì cả nhóm dời cùng số cột (luật cột giữ nguyên). Ctrl+C rồi Ctrl+V nhân đôi các bước đã chọn (tên "(bản sao)", mã mới, cạnh giữa các bản sao nối với nhau) đặt ngay sau bước đang chọn; vượt số bước tối đa của nền tảng thì từ chối bằng câu cũ.
- Kịch bản: khi dán thì bản sao có tên + mã mới, đặt sau bước chọn, cạnh giữa bản sao nối với nhau [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » bản sao đặt ngay sau bước chọn, tên + mã mới, cạnh giữa các bản sao nối với nhau]
- Kịch bản: khi dán vượt giới hạn bước thì từ chối [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » vượt giới hạn bước ⇒ từ chối bằng câu cũ, không đổi gì]
- Kịch bản: khi kéo nhóm thì cả nhóm dời cùng số cột [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » dời cả nhóm cùng số cột, giữ thứ tự, cột bỏ trống bị nén]
- Kịch bản: khi chọn hai bước bằng Shift+nhấn rồi Ctrl+C/V trên canvas thật thì có hai bản sao [test: e2e/fnr-showcase/canvas-dnd.fnr.ts » CR-123 · p25 · Shift+nhấn chọn nhiều, Ctrl+C / Ctrl+V nhân đôi (tên + mã mới), bảng phím tắt]

#### Yêu cầu: Thả bước từ menu "Thêm bước" vào sơ đồ
Kéo một mục của menu "Thêm bước" thả lên chỗ trống thì bước mới nằm cuối cột dưới con trỏ (đúng độ cao thả); thả lên một mũi tên thì chèn giữa hai bước (nhánh Đúng/Sai không nhận bước hành động thật). Đủ số bước hoặc cột đầy thì báo lý do và không đổi gì.
- Kịch bản: khi thả vào cột có sẵn thì nằm cuối cột và lưu độ cao thả [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » thả vào cột có sẵn ⇒ nằm cuối cột, lưu y điểm thả]
- Kịch bản: khi thả ra ngoài cột cuối thì thành bước mới ở cuối [test: apps/admin-web/src/features/processes/lib/canvas-edit.test.ts » thả ra ngoài cột cuối ⇒ bước mới ở cuối]
- Kịch bản: khi chèn trên nhánh Đúng của Nếu thì bước mới nằm trên nhánh Đúng [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » chèn trên nhánh Đúng của Nếu ⇒ bước mới nằm trên nhánh Đúng, nhánh Sai giữ đích]

#### Yêu cầu: Canvas vẽ cạnh tới bước "đi tiếp" khi khác bước kế
Bước có "Sau đó đi tiếp" trỏ khác bước kế thì canvas vẽ cạnh tới đúng bước đó thay cho cạnh tới bước kế (bước đứng một mình trong cột).
- Kịch bản: khi bước a đi tiếp tới bước 2 thì có cạnh a→c thay a→b [test: apps/admin-web/src/features/processes/lib/jump-edges.test.ts » a đi tiếp tới bước 2 ⇒ cạnh a→c thay a→b]

## Việc còn lại
- Thả từ menu lên canvas chưa có e2e hành trình (flow mẫu showcase không có bảng node); cần chạy trên trình soạn flow công ty (journey-approval) khi có lượt e2e chung.
