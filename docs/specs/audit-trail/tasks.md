# audit-trail — «Ai duyệt làm gì đều phải có record»

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Mọi quyết định duyệt HĐ có một dòng lịch sử
Quyết bước duyệt HĐ qua thẻ HĐ hoặc qua «Việc của tôi»/chuông đều ghi `stage_decided` (Hồ sơ duyệt) bằng cùng một hàm; thiếu dòng thì vòng quét ghi bù đúng lúc quyết, idempotent theo task, chèn một câu theo tập. Hồ sơ ghi rõ «duyệt thay người được giao» khi Toàn quyền quyết. Hồ sơ trống ghi «Chưa ai duyệt — đang chờ <người> duyệt bước «<bước>»».
- Kịch bản: khi người được giao quyết qua Việc của tôi thì HĐ có đúng một dòng lịch sử [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-decided.int.test.ts » người được giao]
- Kịch bản: khi run của công ty khác gửi tới thì không ghi gì [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-decided.int.test.ts » chéo tenant]
- Kịch bản: khi Toàn quyền duyệt thay thì hồ sơ có cờ duyệt thay [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-decided.int.test.ts » hồ sơ: có approval_override]
- Kịch bản: khi engine đã quyết mà HĐ thiếu dòng thì vòng quét ghi bù đúng lúc quyết [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-decided.int.test.ts » đường bù]

#### Yêu cầu: Duyệt hợp lệ thì giữ, lỗi bước sau hiện riêng
Điều kiện của chính quyết định (quyền, bằng chứng, đua) kiểm trước khi đóng task — lỗi thì không quyết. Bước kế khởi động lỗi sau khi quyết đã commit ⇒ không trả lỗi cho người bấm; lượt sang «Cần xử lý» (start_failed, có lý do, Thử lại / Huỷ).
- Kịch bản: khi kick bước kế ném lỗi sau khi quyết thì task vẫn đóng và lượt vào «Cần xử lý» [test: apps/hub-api/src/modules/processes/gates/decision-after-commit.int.test.ts » Đạt qua đường chung]
- Kịch bản: khi quyết từ thẻ gói thì không báo gói hai lần và không ném [test: apps/hub-api/src/modules/processes/gates/decision-after-commit.int.test.ts » quyết từ thẻ gói]

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
- Lượt đã đóng > 1 ngày không được đối soát lịch sử; `decisionRuns` chưa có index thời gian (TECH-DEBT #266).
- Kick lỗi sau quyết: đã xác nhận vòng quét hub `sweeps.ts` `orphanCands` kick lại stage `queued` ≥ 60 s (nếu cờ start_failed chưa ghi được), và stage `running` bị ngắt (`interrupted`) được xử lý; khi đã cờ start_failed thì chờ người dùng Thử lại / Huỷ (đúng ý: lỗi bước sau hiện ở thẻ riêng). Không cần TECH-DEBT.
- e2e hành trình: Việc của tôi duyệt HĐ ⇒ Hồ sơ duyệt có dòng.
