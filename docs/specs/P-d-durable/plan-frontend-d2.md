# P-d-durable · plan frontend P-d2 (T14 · T20) — Gọi tool, Rẽ nhánh, tab Tool quy trình [HUB-FR-146, 147][ADM-FR-73]

Phần của [`plan-frontend.md`](plan-frontend.md) (§0 quyết định FD, §5 domain, §6 mã lỗi, §14 contract còn thiếu, §15 câu hỏi áp dụng chung; số mục §10–§13 giữ nguyên để trỏ). Spec: [`spec-d2.md`](spec-d2.md) §6, [`spec-tz-tools.md`](spec-tz-tools.md) §2 · contract: [`plan-contract.md`](plan-contract.md) §4, §6 · câu chữ: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) §4 · mockup `mockup/04`, `mockup/02` (C1–C5), `mockup/03` (D1–D2). **Điều kiện BUILD:** T17 + T18a xong; plan này rà lại sau `done:pd1` (T13/T14).

## 10. Admin · panel "Gọi tool" + "Rẽ nhánh" + canvas (mockup 04)
**"Gọi tool"** — `StageTool.tsx` (`fieldset aria-label="Gọi tool"`), `TOOL_EXECUTOR = "tool"` trong `SelectField "Người thực hiện"` (ẩn ở mẫu — FD11):
| Thành phần | Chi tiết |
|---|---|
| Tool | `SelectField "Tool"`; option `"{name} · {key}"`; nguồn `ProcessEditorContext.tools` (≤ 200; `Select` Radix đủ). Tool có tham số kiểu `file` ⇒ option disabled + chữ phụ "Tham số tệp chưa dùng được…" (G1 của plan-contract §6) |
| Huy hiệu | `Badge warn "Tác dụng phụ"` khi `side_effect`; chọn tool `side_effect` ⇒ tự `real:true` **nếu** `canRealAction`; nếu không ⇒ lỗi `TOOL_SIDE_EFFECT` live. Khối `StageGate` vẫn hiện (tool cho `after` = review hoặc auto) |
| Bản đồ tham số | mỗi `param` của tool một thẻ: tên (mono) + dấu `*` (`aria-label="bắt buộc"`) + kiểu + mô tả; hàng 2: `Select "Nguồn của tham số {name}"` (`Giá trị cố định` · `Thông tin đầu vào` · `Kết quả giai đoạn trước`) + control giá trị: `const` ⇒ `Input` (number ⇒ `type=number`; select/text ⇒ chữ); `input` ⇒ `Select` các input quy trình; `field` ⇒ `Select` trường stage **ở bước nhỏ hơn bất kỳ** (lọc theo kiểu: `number`↔`number`; `text/paragraph/select`↔`string`/`date`). ≤ 20 tham số |
| Kết quả | giữ `StageOutput` nhưng chỉ phần **Trường có cấu trúc** (`output.fields`) + tên tệp (`filename`); Hub sinh .md (PD2-R07) |
| Timeout | giữ ô `timeout_s` của stage — là timeout gọi tool (`toolInvoker.call({timeoutS})`) |
| Ẩn | Hướng dẫn, nguồn, tự sửa mã, người trả lời (`answerer`), "Điều phải biết", ngân sách token (`token_budget`), mẫu tệp + mục bắt buộc (`template`/`required_sections`) — Hub ép (PD2-R08; `plan-addendum.md` A3) |
| Trạng thái | tải `tools` ("Đang tải tool…", select disabled) · lỗi ("Không tải được danh sách tool." + Thử lại) · rỗng ("Chưa có tool nào được bật cho công ty — liên hệ quản trị nền tảng") · mẫu (câu riêng) |
`normalizeTool(s)`: bỏ tham số không còn trong tool, ép `answerer:starter`, `sources:[]`, `must_know:[]`, `autofix:null`, `token_budget:null`; gửi `output` với `template`/`required_sections:["Kết quả","Bàn giao"]` (Hub ép lại, ghi đè không báo lỗi — A3); giữ nguyên `output.fields`, `output.filename`, `timeout_s`.

**"Rẽ nhánh"** — `StageBranch.tsx` (`fieldset aria-label="Rẽ nhánh"`) dưới `StageGate` (cả `after` review/auto). Mỗi luật một hàng 5 cột (`Nếu trường` · `Phép so sánh` · `Giá trị` · `Thì tới bước` · nút `Xoá luật {n}`); trường = `fields` của **chính stage**; phép `lt/le/gt/ge` chỉ khi `number`/`date`; giá trị theo kiểu (`type=number`/`date`/chữ); "Thì tới bước" = các bước `> step` (hiện `Bước n`, UI đếm từ 1, `goto_step` 0-based — dùng `stepLabel`). ≤ 10 luật. **Khoá** (`fieldset disabled` + `Alert role="status"`) khi stage không đứng một mình trong bước (Q5). Đích có `real_action` ⇒ ép gợi ý `after = review` (lỗi live `branch.err.real`). Lưu: `after.branch: BranchRule[]` (mặc định `[]`).
**Canvas:** `layoutSteps` + cạnh mới `BranchEdge.tsx` (nét đứt, màu `primary`, nhãn chữ "Rẽ nhánh · luật n", từ stage nguồn tới `stepHeader` bước đích; phân biệt `BackEdge` nét đứt màu `warning` đi ngược); `edgesFocusable=false`. Node: huy hiệu "Rẽ nhánh · n luật", "Gọi tool", "Tác dụng phụ". `StepList` (đường a11y): dòng "Rẽ nhánh: luật n tới bước m". Bước bị nhảy ở trang Run: nhãn "Bỏ qua".

## 11. Chat-web · P-d2
`stageStatusKey("skipped")` ⇒ "Bỏ qua" (chữ + gạch ngang ở `StageStrip`; mảng `DOT` giữ `bg-border`); `join`/trạng thái run coi `skipped` là xong (server lo, FE chỉ hiển thị). Lý do `tool_failed` ("Gọi tool bị lỗi." + hint; nhãn nút mặc định; `use_current` disabled nếu không có output — sẵn có `useCurrentDisabled`). Thread: tin `RoomProcessPart.kind="branch"` ⇒ dòng "Rẽ nhánh: tới bước {{step}} (luật {{rule}})" (`step = to_step + 1`) — thêm vào bộ chọn kiểu tin thread (`ProcessThreadMessage`), nhật ký trang Run `HistoryItem.kind="branch"` cùng câu.

## 12. Admin · tab "Tool quy trình" (ADM-FR-73; mockup 02 C1–C5)
Vị trí: `TenantDetailPage` thứ tự tab **Thông tin · Feature · Agent · Tool quy trình · Quota · Users**; `TenantTab` + `TABS` ở `routes/_authed/tenants/$tenantId.tsx` thêm `"workflow-tools"`; component `tenants/components/tools/TenantToolsTab.tsx` (+ `hooks/use-tenant-tools.ts`, `api.ts` thêm 3 hook).
| Khối | Chi tiết |
|---|---|
| Khung | `Card` tiêu đề + mô tả + `SearchBox` "Tìm tool" (lọc client theo tên/key, ≤ 200) |
| Bảng (`Table aria-label="Tool quy trình"`) | cột Tên · Ký hiệu (mono) · Ghi chú · Bật bởi (`granted_by · granted_at` định dạng ngày, "—" khi null) · "Bật cho công ty" = `Switch aria-label="Bật tool {{name}}"` |
| Nhãn | `Badge warn "Tác dụng phụ"` khi `side_effect`; `Badge off "Workflow đang tắt"` + tooltip khi `enabled=false` (công tắc vẫn thao tác được) |
| Bật | `PUT …/workflow-tools/:workflow_id` `{}` ngay, toast "Đã bật tool … cho …"; không xác nhận |
| Tắt | `ConfirmDialog` (vừa, `destructive`) "Tắt tool {{name}}?" / "Lượt chạy đang chờ gọi tool này sẽ dừng ở “Cần người quyết”." / nút "Tắt tool" ⇒ `DELETE` ⇒ toast |
| Trạng thái | tải `LoadingState`; lỗi `ErrorState` (+retry); rỗng `EmptyState` ("Chưa có workflow nào trong catalog…" + nút "Mở Workflows"); lọc không khớp `EmptyState` "Không có tool nào khớp."; từng dòng `pending` ⇒ công tắc disabled; 404 ⇒ toast "Workflow này không còn trong catalog…" + refetch; 403 ⇒ `ForbiddenState` (cả trang đã chặn tenant_admin) |
Không `UnsavedGuard` (không form). Dữ liệu: `TenantWorkflowToolList.items[]` (`workflow_id, key, name, side_effect, enabled, on, granted_at, granted_by`). Công tắc hiển thị `on` (không phải `enabled`).

## 13. Domain · lỗi · e2e P-d2
Domain admin thêm `tool-rules.ts` (`paramCompatible(paramType, fieldType)`, `missingRequiredArgs(params, args)`, `isFileParam`), `branch-rules.ts` (`opsForType(t)`, `branchRuleIssues(rule, fields, step, maxStep)`, `isStandalone(stages, i)`, `branchEdges(stages)`); chữ ký theo kiểu `{key,type}` thuần. Lỗi: bảng §6 + khoá §4 file i18n (`TOOL_INVALID`, `TOOL_SIDE_EFFECT`, `BRANCH_INVALID`, ref tool). **e2e P-d2:** `combobox "Người thực hiện"` option "Gọi tool"; `group "Gọi tool"` → `combobox "Tool"`, `combobox "Nguồn của tham số so_hop_dong"`; `group "Rẽ nhánh"` → `combobox "Nếu trường"`, `"Phép so sánh"`, `getByLabel("Giá trị")`, `combobox "Thì tới bước"`, `button "Thêm luật rẽ nhánh"`, `button "Xoá luật 1"`; tenant: `tab "Tool quy trình"`, `table "Tool quy trình"`, `switch "Bật tool Gửi nhắc thanh toán"`, `alertdialog "Tắt tool Gửi nhắc thanh toán?"` + `button "Tắt tool"`/`"Huỷ"`; chat: `listitem` chứa "Bỏ qua", `region "Cần người quyết"` "Gọi tool bị lỗi.".

