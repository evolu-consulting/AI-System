# ADR-0035 · App chạy theo flow tại khe (FlowRuntime + FlowSlotAdapter)

Trạng thái: **Accepted** (người dùng, 2026-11-04 — CR-118 PHẦN B, 26 câu theo mặc định: câu 13 = mức 2, câu 14 = chỉ `contracts.approval`, câu 17 = node `form` do người của phòng ban bước làm, đối tác không bao giờ là người làm). Liên quan: ADR-0017 (engine bền), ADR-0030 (duyệt HĐ trên engine — bổ sung, không đảo), ADR-0031 (cổng gói↔gói), `docs/current/engine/thu-vien-quy-trinh.md` (khe, gán, snapshot).

## Bối cảnh
Engine + thư viện quy trình đã cho cấu hình bước, người làm, hạn/nhắc/chuyển cấp, điều kiện. Nhưng web chỉ dùng flow ở MỘT chỗ (thẻ duyệt HĐ) và rẽ cứng theo 3 loại bước; thêm loại bước hay khe mới phải sửa module app. Cần một hợp đồng view model chung để màn hình vẽ theo loại bước, không theo mã module.

## Quyết định
1. **Contract** `@ai/contracts/flow` (zod): `FlowView` (khe, ref, lượt + `snapshot_version` của SNAPSHOT run, trạng thái chung, bước theo `FLOW_STEP_KINDS` = review|dify|esign|form|wait|system, task đang mở của người xem + hành động có đầu vào định kiểu), `FlowActionRequest/Result`, `FlowSummary` (lô ≤ 100 ref), `FlowForm` (tập con cố định text|textarea|number|date|select|checkbox|file_ref, ≤ 20 trường, nhãn text thuần, không HTML/biểu thức; server dựng validator từ form trong snapshot — `flowFormValuesSchema`). `FlowStepRenderers<R>` bắt đủ mọi loại ⇒ thiếu renderer là lỗi typecheck.
2. **Kit** (`packs/kit`): cổng `FlowSlotAdapter` (gói cung cấp: view/act/summary theo ref, trong tx tenant của gói) + `flowRuntime(packKey, adapters)` (chọn khe; đối tác ⇒ chặn trước khi gọi gói) + route `GET /pack/:k/flow/:slot/:ref`, `POST /pack/:k/flow/:slot/:ref/tasks/:id/actions/:action`, `POST /pack/:k/flow/:slot/summary` sau `packGuard` (read/write). Cờ `HUB_FLOW_RUNTIME=on`, mặc định tắt.
3. **Khe đầu tiên** `contracts.approval`: adapter bọc nguyên use case thẻ duyệt (`getApproval`/`actApproval`) — không đổi hành vi, quyền bước vẫn do `canAct` engine/máy trạng thái; chỉ thêm kiểm task id khớp task đang mở.
4. Thêm loại bước = schema contract + executor hub `nodes/<kind>` + editor admin-web + renderer web; thêm khe = hàng `process_slots` + def mặc định + `FlowSlotAdapter` của gói + `<FlowPanel>` ở điểm gắn. Không mở route đóng băng của `processes`.

## Hệ quả
- Trạng thái vòng đời thực thể và màn hình giữ trong mã (mức 2); chỉ phần trong khe cấu hình được.
- Summary theo lô một câu SQL (Luật 4c); view một request/thực thể.
- Node `form` (executor) làm ở lát sau (`cr118-node-form`); contract đã có trước để web/editor làm song song.
