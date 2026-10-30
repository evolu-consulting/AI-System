# ADR-0032 · Delta kiểu OpenSpec + bộ kiểm, không dùng CLI OpenSpec

Trạng thái: **Accepted** (người dùng yêu cầu, 2026-10-28). Liên quan: `docs/current/README.md`, `docs/WORKFLOW.md` "Gộp cuối đợt", Luật 0b.

## Bối cảnh
`docs/current` là hành vi đang chạy; mỗi lát ghi `## Delta (so với docs/current)` trong `tasks.md`, cuối đợt docs-architect gộp. Đợt Community gộp tay và mất mát: có lát không có mục Delta, có lát không có thư mục spec, Delta viết tự do nên không biết trỏ file nào, kiểm cái gì.

## Quyết định
Mượn phần có ích của OpenSpec, không cài công cụ ngoài:
- **Định dạng**: `### ADDED|MODIFIED|REMOVED <file trong docs/current>`, mỗi khối có `#### Yêu cầu: <tên>` kèm ít nhất một `- Kịch bản: khi … thì …` (REMOVED chỉ cần `Lý do:`); lát không đổi hành vi ghi `Không thay đổi hành vi (lý do: …)`. Giữ dòng `Trạng thái gộp`.
- **Bộ kiểm** `tools/scripts/src/openspec.ts`: `openspec:check` (cấu trúc, file đích tồn tại, đủ Kịch bản, có trạng thái), `openspec:pending` (danh sách lát chưa gộp + file đích), `openspec:archive` (ghi sổ "đã gộp", không tự sửa `docs/current`).
- `slice:merge` chạy `openspec:check <lát>` trước, từ chối nếu đỏ; `--no-openspec` chỉ cho khẩn cấp (in cảnh báo). `slice:new` sinh khuôn `tasks.md` có mục Delta.
- Gộp văn xuôi vào `docs/current` vẫn do docs-architect (cần phán đoán, đối chiếu code).

## Lý do không dùng CLI OpenSpec
Nó giả định một thư mục `openspec/` và quy trình proposal→archive riêng, trùng với `docs/current` + `specs/` + CR đã có; thêm phụ thuộc Node/CLI cho lợi ích chỉ là định dạng và kiểm tra, mà ta làm được bằng ~250 dòng. Tiếng Việt và đường dẫn của dự án cũng không khớp mặc định của nó.

## Hệ quả
- Lát cũ (đã "đã gộp", Delta dạng cũ) không bị kiểm lại; chỉ lát đang merge bị kiểm.
- Xem lại khi có **nhiều nhóm cùng sửa spec** (cần hợp nhất tự động, xung đột Delta, kho spec riêng): lúc đó cân nhắc dùng chính OpenSpec.

## Bổ sung 2026-10-30 — Kịch bản trỏ tới test (người dùng duyệt, rút từ CR-103: e2e yếu bỏ sót lỗi nhầm nhánh)
Mỗi `- Kịch bản:` trong khối ADDED/MODIFIED kết thúc bằng `[test: <đường dẫn từ gốc repo>]` hoặc `[test: <đường dẫn> » <đoạn tiêu đề test>]` (nhiều mục cách nhau `;`); không có test tự động ghi `[test: thủ công — <lý do>]`. `openspec:check` báo lỗi khi thiếu tham chiếu, file không tồn tại hoặc đoạn tiêu đề không có trong file (tìm văn bản, phân biệt hoa/thường; **không chạy test**). Chỉ áp cho Delta "chưa gộp"; REMOVED, `Không thay đổi hành vi` và lát "đã gộp" không bị kiểm. Luật thuần ở `openspec.rules.ts` (`validateTestRefs`), đọc file ở `openspec.ts`.