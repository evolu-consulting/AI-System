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
