# audit-trail — «Ai duyệt làm gì đều phải có record»

## Delta
- ADDED · Quyết bước duyệt HĐ qua đường chung `POST /review-tasks/:id/decision` (Việc của tôi, chuông) ⇒ HĐ có dòng `stage_decided` (Hồ sơ duyệt) — cùng hàm `recordDecision` của thẻ HĐ. [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-decided.int.test.ts]
- MODIFIED · Duyệt hợp lệ thì GIỮ: bước kế khởi động lỗi SAU khi quyết đã COMMIT ⇒ không trả lỗi cho người bấm (không báo như duyệt lỗi); lượt ⇒ «Cần xử lý» `start_failed` có mã lỗi (thẻ riêng: «không khởi động được — <lý do>», Thử lại / Huỷ). Kiểm điều kiện của chính quyết định (quyền, bằng chứng, đua) vẫn TRƯỚC khi đóng task ⇒ lỗi ⇒ không quyết. [test: apps/hub-api/src/modules/processes/gates/decision-after-commit.int.test.ts — đỏ khi bỏ sửa (0/2), xanh sau sửa]
- ADDED · Đường bù lịch sử: vòng quét duyệt HĐ (`sweepApprovalsOnce`) so task đã quyết ở engine (`decidedTasksOf`, 1 câu) với `stage_decided` của lượt (1 câu) ⇒ ghi bù bằng cùng `recordDecision`, giữ lúc quyết thật; idempotent theo task. Lượt còn mở hoặc đổi trong 1 ngày. [test: approval-decided.int.test.ts ca «đường bù»]
- ADDED · Hồ sơ duyệt (JSON `override`, PDF, web) ghi rõ «duyệt thay người được giao» khi Toàn quyền quyết. [test: approval-decided.int.test.ts ca 3]
- MODIFIED · Hồ sơ trống: «Chưa ai duyệt — đang chờ <người> duyệt bước «<bước>»» (biết bước đang mở), không thì «Chưa ai duyệt bước nào.»

## Bảng đường thay đổi HĐ / bước duyệt
| Đường | Ghi event? | Thiếu / đã sửa |
|---|---|---|
| Quyết từ thẻ HĐ (Đạt/Trả lại/Từ chối) | `stage_decided` sau engine nhận (tx riêng) | ĐÃ SỬA: ghi lỗi ⇒ vòng quét ghi bù |
| Quyết từ `/review-tasks` (Việc của tôi/chuông) | Không (trước) | ĐÃ SỬA: hook `onDecided.contracts` sau COMMIT + vòng quét ghi bù |
| Toàn quyền duyệt thay (thẻ) | `approval_override` write-ahead + `stage_decided` (fix 7c2360e02, đã soát: đúng) | ĐÃ SỬA: hồ sơ hiện «duyệt thay» |
| Toàn quyền duyệt thay qua `/review-tasks` | Không có `approval_override` (chỉ thẻ ghi) | `stage_decided` nay có; nhãn «duyệt thay» chưa — Việc còn lại |
| Uỷ quyền (làm thay) | `hub.evidence.on_behalf_of` (chỉ khi có bằng chứng) | Không bằng chứng ⇒ hồ sơ không nói «thay ai» — Việc còn lại |
| «Cần: tất cả» / cùng duyệt (phiếu lẻ) | Index 0088 một dòng/ task ⇒ chỉ phiếu đầu | Thiếu phiếu sau — cần đổi index (migration) — Việc còn lại |
| Nhận việc / trả việc / giao lại | Chỉ hub (`review_tasks`), không event HĐ | Thiếu — Việc còn lại |
| Quá hạn chuyển cấp | Chỉ hub (`escalated`) | Thiếu event HĐ — Việc còn lại |
| Trả lại / gửi lại (submit) | Trả lại: `stage_decided` action=return; gửi lại: event submit | Đủ |
| Huỷ lượt / Từ chối | `markRejected` (event rejected) — lỗi bị nuốt `.catch(()=>false)` | Reconcile sửa trạng thái; lịch sử có thể thiếu — Việc còn lại |
| Bước tự động (record-payment, milestone-confirm, finalize «Đã duyệt») | finalize ghi trạng thái + `contract.approved` | Chưa soát từng tool — Việc còn lại |
| Ký số (gửi/ký/từ chối) | `esign` sessions + event esign | Chưa soát — Việc còn lại |
| Đối tác xác nhận | partner-inbox decision event | Chưa soát |
| Thay/sửa file, xoá nháp | versions / delete | Chưa soát |

## Lỗi «báo lỗi mà vẫn duyệt» — nguyên nhân
`GateService.#post` (sau COMMIT quyết định) gọi `launcher.kick(runId)` KHÔNG bắt lỗi ⇒ bước kế (vd tool finalize, if/set đồng bộ) lỗi ⇒ `reviewDecision` ném ⇒ UI hiện lỗi dù task đã đóng/đã duyệt. Đường thẻ HĐ: `pass()` còn nhả chỗ SP (`pending_links`) và bỏ `noteDecision` ⇒ thiếu lịch sử. Sửa: `kickOrFlag(..., { afterDecision: true })` (`gates.audit.ts`) — log có mã + «Cần xử lý» start_failed nếu stage hiện tại chưa chạy. Các ứng viên đã loại: `refreshInputs` (đã catch), `markRejected` (catch), `publishUserEvents` (try nội bộ), `postThread` (catch), bằng chứng (cùng tx đóng task, kiểm TRƯỚC — 422 EVIDENCE_REQUIRED).

## Quyết định trong lúc làm
- Hub không ghi thẳng `contracts.contract_events` (khác role DB) ⇒ hook sau COMMIT qua cầu `packRuns.onDecided[packKey]`, scope system của tenant; thẻ HĐ vẫn tự ghi (hook chỉ gọi khi không qua thẻ).
- Thêm `override?: boolean` (tuỳ chọn) vào `ApprovalRecordItemSchema` — cộng thêm, không phá contract.

## Việc còn lại
- Nhãn «duyệt thay» khi Toàn quyền quyết qua `/review-tasks`: hub chưa biết người quyết dùng Toàn quyền (cờ `override` chỉ thẻ gói tính) — cần engine trả cờ trong `PackDecided`.
- Nhận việc / trả việc / giao lại / chuyển cấp ⇒ dòng lịch sử HĐ (hub đã có ở lịch sử lượt `loadHistory` mục `escalate`; HĐ chưa).
- Index 0088 (một dòng/task) ⇒ «Cần: tất cả»/cùng duyệt chỉ ghi phiếu đầu — để sau (migration).
- Lượt đã đóng > 1 ngày không được đối soát lịch sử.
- e2e hành trình: Việc của tôi duyệt HĐ ⇒ Hồ sơ duyệt có dòng.
