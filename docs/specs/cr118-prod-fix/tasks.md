---
id: cr118-prod-fix
lát: cr118-prod-fix
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-flow-web (đã gộp)
---
## Plan (ngắn)
e2e `e2e/deployed` trên prod (3c66d953) có 2 ca đỏ:
1. `02-contracts-pages` (danh sách / chi tiết / HĐ đã xác nhận): console `Failed to load resource … 404`. Nguyên nhân: danh sách HĐ gọi `POST /pack/contracts/flow/contracts.approval/summary`
   (huy hiệu flow) mà route kit chỉ gắn khi `HUB_FLOW_RUNTIME=on` (prod tắt) ⇒ 404 mỗi phiên. Sửa: Hub báo cờ trong `/pack/me.flags["flow.runtime"]`; web đọc cờ (ảnh đã nạp, không thêm mạng) và KHÔNG gọi `/flow/*` khi tắt. Không bật runtime.
2. `15-user-bugs:432` tìm heading «Quy trình duyệt hợp đồng»: heading đó đã bỏ từ CR-105 L4 (mục Cài đặt › Quy trình duyệt chỉ đọc, tiêu đề «Quy trình duyệt đang dùng: <tên> · v<N>»,
   `data-testid=flow-current-title`). Không phải hồi quy app ⇒ **Tranh chấp test** (test khoá, không sửa).

## Làm
- [x] hub-api `capabilities.{rules,service,mount}`: cờ `flow.runtime` trong `/pack/me.flags` (env `HUB_FLOW_RUNTIME`, cùng hàm `flowRuntimeOn` với route kit)
- [x] sohoptac-web `platform/features` xuất `featureFlag`; `platform/flow/adapters/http.ts`: `view`/`summary` bỏ qua mạng khi cờ tắt (import động, không đụng bundle đầu)
- [x] unit: `capabilities.rules.test.ts`, `platform/flow/adapters/http.test.ts`; e2e mới `e2e/contracts-web/flow-runtime-off.cw.ts`

## Không làm / Chạm
- Không bật `HUB_FLOW_RUNTIME`. Không đổi contract `ShellMeResponse` (cờ nằm trong `flags` có sẵn). Không sửa `e2e/deployed/**`.
- ApprovalTimeline/FlowPanel dùng `view` truyền sẵn (controlled) ⇒ không gọi `/flow/<slot>/<ref>`; đã kiểm.

## Test tối thiểu
- unit: hub-api capabilities rules; sohoptac-web flow adapter
- e2e (evotest, một lần): `-Filter contracts-web,sohoptac-web-stack`

## Quyết định trong lúc làm
- Khoá cờ `flow.runtime` (không trùng `<gói>`/`<gói>.<action>`); mặc định false khi vắng ⇒ máy chủ cũ/lỗi tải `/pack/me` cũng không gọi flow.
- Tranh chấp test (15-user-bugs.deployed.ts:447): heading mới = «Quy trình duyệt đang dùng: …» (`flow-current-title`), mở bằng nút «Quy trình duyệt» trong hộp Cài đặt; test cần khớp /^Quy trình duyệt đang dùng/.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/nang-luc.md
#### Yêu cầu: Ảnh năng lực của người dùng (`GET /pack/me`) (nguồn: cr118-capabilities)
`flags["flow.runtime"]` báo flow runtime của kit (`HUB_FLOW_RUNTIME=on`) bật hay tắt; web chỉ gọi route `/pack/<k>/flow/*` khi cờ bật, tắt ⇒ không có yêu cầu nào (không 404 ở console).
- Kịch bản: khi runtime tắt thì `flags["flow.runtime"]` = false, bật thì true [test: apps/hub-api/src/modules/capabilities/capabilities.rules.test.ts » cờ flow.runtime: mặc định tắt (false), bật theo đầu vào ⇒ web biết có gọi route "/flow/*" hay không]
- Kịch bản: khi cờ tắt thì adapter flow của web không gửi yêu cầu nào [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
- Kịch bản: khi cờ tắt thì danh sách HĐ không gọi /flow/* và không có 404 ở console; bật thì đúng một POST tóm tắt [test: e2e/contracts-web/flow-runtime-off.cw.ts » cờ TẮT ⇒ không yêu cầu /flow/* nào, không 404 ở console]

## Việc còn lại
- `15-user-bugs.deployed.ts:447` cần qc cập nhật heading (Tranh chấp test).
- qc ghi lock cho `e2e/contracts-web/flow-runtime-off.cw.ts`.
