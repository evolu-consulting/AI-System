# Readiness — H2a-dify-command

## Lần 1 · 2026-10-05 · spec-readiness (Opus) · **NOT READY**
23 lỗ hổng (2 Chặn, 7 Cao, 14 Thấp), không có câu hỏi cho người dùng (ADR-0010 Proposed ⇒ Gate trình người dùng). Mặc định đề xuất áp dụng (Luật 2).

| # | Mức | Vị trí | Lỗ hổng | Mặc định | Giao |
|---|---|---|---|---|---|
| 1 | Chặn | spec R12 ↔ plan P13, R09 | `job.progress` → step SSE hay chỉ nhịp sống | Theo P13: đúng 1 step `workflow`; `job.progress` không phát SSE; sửa R12; A31 assert 1 cặp step | BE + qc |
| 2 | Chặn | plan credential 409 "workflow tắt", A83 ↔ HUB-BR-06/AC-H05/R08 | Tắt workflow khi job async đang queued làm run fail | Credential không xét `workflows.enabled`, chỉ 409 khi secret thiếu/giải mã lỗi; sửa A83; thêm ca async tắt giữa chừng → `finished` | BE + qc |
| 3 | Cao | plan-db requeue `$1`, X1 ↔ code H1 Hub hằng 60 s | `$1` phía Hub không có nguồn; env `ORPHAN_S` không tồn tại | Hub `$1 = 60`; A37 lùi 61 s; Runtime dùng `AGENT_RT_ORPHAN_S=5` | BE + qc |
| 4 | Cao | tasks Thứ tự, PY-03 | Thiếu QW-P → Q3 trong thứ tự; PY-03 không phụ thuộc Q3 | `PY-00, PY-S1 → C2 → PY-01 → PY-02 → QW-P → Q3 → PY-03…06`; PY-03 phụ thuộc Q3 | BE |
| 5 | Cao | plan-runtime §3.1, dify; cases P28–P30 | Hàm thuần Python thiếu chữ ký; QW-P sau PY-01 trái "test trước" | `ErrKind` Literal + chữ ký đủ kiểu `retry_delay`, `map_failure`, `usage_row`, `reduce`; tách P28–P30 thành nhóm viết sau C2, trước PY-01 | BE + qc |
| 6 | Cao | plan `maskInputs`, R20, A55 | Không có chữ ký/luật che | `maskInputs(inputs, secret)`: `String()`, cắt ≤ 200, `maskSecret`; A55 giá trị 250 ký tự | BE + qc |
| 7 | Cao | plan §2.4 test-run ↔ plan-errors, A74 | Contract test-run thiếu 409 (secret thiếu) và 503 (`HUB_INTERNAL_TOKEN` vắng) | Thêm 409 `NOT_CONFIGURED` vào plan §2.4 + spec §3; `UNAVAILABLE: 503` vào `HUB_INTERNAL_ERRORS` | BE |
| 8 | Cao | tasks B2, B3, B5, B7 | Chạm quyền/secret nhưng ghi `thường` | Đổi `cao` | BE |
| 9 | Cao | plan-runtime "dự phòng argv — chấp nhận" | Token MCP qua argv lộ cho tiến trình cùng user (tenant khác) — quyết định bảo mật | Spike #1/#10 thất bại → PY-04 `blocked`, báo người dùng; không tự chuyển argv | BE |
| 10–23 | Thấp | nhiều | R18 theo P4; spec credential đủ `{base_url, api_key, app_type}`; AC-H22 `create-trello-card`; HUB-FR-33 phạm vi; kiểu `WorkflowJobInput`/`CatalogCommand`; `ClaimedJob.token` default `""`; `NO_PROXY` luôn đặt; đường dẫn test H1 sai; ma trận FR-24→R61, FR-80→A10/A15/A56/A70/P02; M03 (spike) không blocked W1; fixture `/hoi`, `/so`; `levenshtein` trên NFC; test-plan > 25 600 B; ghi TLS `/internal/*`, `/mcp` vào PRODUCTION-NOTES (→ ghi `spec-decisions` mục combine, không sửa file dùng chung) | Theo bảng của readiness | BE / qc |

**Mâu thuẫn tài liệu (sửa trước Gate):** HUB-BR-11 tên tool vs key có `-` (giữ key, CR sửa BA); HUB-FR-24 "payload gồm token MCP" vs P4 (giữ P4, CR sửa BA); Q1 người dùng chấp nhận GRANT cột vs P1 hàm SECURITY DEFINER (giữ P1, nêu ở Gate); ROADMAP H2a còn `chat-ext` (sửa).

## Lần 2 · 2026-10-05 · spec-readiness (Opus) · **NOT READY** (phần đổi `637f337..HEAD`)
Đóng: #1–#23 + 4 mâu thuẫn (Q1 ↔ P1 còn trình ở Gate). Mới do sửa song song:

| # | Mức | Vị trí | Lỗ hổng | Mặc định (áp dụng) |
|---|---|---|---|---|
| N1 | Cao | plan-runtime §3.1 `retry_delay(…, sent)` ↔ -dify §3.4 ↔ cases §1.9 | `sent` chưa định nghĩa | Bỏ `sent`: `connect` = chưa gửi; còn lại theo §3.4 (`side_effect` ∧ ≠`connect` ⇒ `None`) |
| N2 | Cao | tasks QW-PU ↔ Q3 | Test QW-PU khoá sau PY-01 | Task `Q-PU` khoá `test_dify_rules.py` ngay sau QW-PU; PY-01 phụ thuộc Q-PU |
| N3 | Cao | plan §7 `maskInputs` | Cắt rồi mới che ⇒ lộ một phần key | Che trước rồi cắt; A55 thêm key bắt đầu ở vị trí 190 |
| N4 | Cao | cases P30; tasks QW-PU Đọc | P30 không có bảng ca, trỏ sai mục | Trỏ -dify §3.2, §3.4, §3.5, §3.7; thêm vào Đọc QW-PU; ca tối thiểu `map_failure` 7 `ErrKind`, `usage_row`, `reduce` |
| N5 | Cao | tasks PY-01 Đọc | Thiếu plan-runtime §3.1 | Thêm |
| N6–N11 | Thấp | cases §1.9 nhãn `ErrKind` + hàng `read`/`empty`; Q-T3 đóng (CR-035); tổng số ca 197, QW-A1 40; plan-errors thêm `UNAVAILABLE` 503, A71 ghi mã; plan §5.3 thời điểm `step.started` async + bỏ qua `job.started` lặp; sinh lại `ba-*.html` ở I3 | Theo readiness |

## Lần 3 · 2026-10-05 · spec-readiness · NOT READY
M1 (Cao) `retry_delay` 5 tham số > `max-args=4` → `RetryFlags`; M2 (Cao) Q-PU sau Q2 + điều kiện một dòng UNLOCKED; M3 (Cao) A55 đo được; M4–M8 Thấp. Sửa một lượt `052ed49` + R13 `dbda02e`.

## Lần 4 · 2026-10-05 · spec-readiness · NOT READY → điều phối sửa → READY
Đóng M1–M8. Còn N1 (Cao) QW-PU phải chờ Q2 (nếu không Q2 `test:lock:write` khoá luôn file QW-PU); N2–N4 Thấp (mô tả `x`/`y` cho A52; Lệnh xong PY-01 chạy test khoá P28–P30; ca `node_finished`). Điều phối sửa trực tiếp 4 chỗ (sửa chữ, đúng mặc định readiness): `tasks.md` (QW-PU phụ thuộc Q2, thứ tự `C2 → (Q2) → QW-PU → Q-PU → PY-01`, Lệnh xong PY-01), `test-plan-cases.md` §5/§7, `test-plan.md` A52, `test-plan-py.md`. Không còn Chặn/Cao, không câu hỏi mới ⇒ **READY**. Gate trình người dùng: ADR-0010 Proposed + Q1 thực hiện bằng hàm SECURITY DEFINER (P1).
