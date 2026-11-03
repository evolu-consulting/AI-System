---
id: tool-verify
lát: tool-verify
cr:
làn: nhanh
migration: không
phụ thuộc: tool-affected
---
## Plan (ngắn)
Bốn script `verify:*` thay việc giao agent chạy test/smoke: slice, wave, predeploy, prod (chỉ đọc với prod). Luật thuần ở `verify.rules.ts` (có unit test); I/O ở `verify-*.ts`.

## Làm
- `tests/known-red.json`: thay 2 id int đoán bằng id thật (migrate-hub 2 ca HUB-FR-75, chat-gate beforeAll timeout, V2-G perf p95); hạn 2026-11-17.
- `verify:slice`, `verify:wave`, `verify:predeploy`, `verify:prod` + mục ngắn ở `docs/WORKFLOW.md`.

## Không làm / Chạm
Không deploy, không ghi lên prod (ssh chỉ `head`/`select`/`logs`); không sửa `deploy/*`.

## Test tối thiểu
`verify.test.ts`, `known-red.test.ts` (unit thuần). `verify:predeploy` chạy thật một lần (chỉ đọc).

## Quyết định trong lúc làm
- Id known-red int ghi theo định dạng bộ so khớp: `<file> › <describe> > <ca>` hoặc tiêu đề ca; chat-gate khoá cả file (beforeAll treo ⇒ mọi ca đỏ).
- `verify:wave` dùng tiền tố thư mục chỉ khi mọi file int bên dưới thuộc cổng ta (bỏ đóng băng + của rowan), ngược lại liệt kê từng file.
- Log nhạy cảm (token/mật khẩu/Bearer) bị che trước khi in; không in đường dẫn khoá ssh.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ dev, không đổi hành vi sản phẩm)

## Việc còn lại
- Chạy `verify:prod` lần đầu sau deploy kế tiếp để chỉnh ngưỡng nếu health root trả 3xx/401.
