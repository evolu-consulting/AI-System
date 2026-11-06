# CR-122 — điểm dừng (2026-11-06, người dùng đổi tài khoản)

gd0 đã đẩy: f0077f82b. Đã gộp: F0, U1, E2, E1 (+ CLAUDE.md Luật 0d.8). Opus low đã soát E1 và E2: không có Blocker.

Luật cho brief agent: `docs/specs/CR-122/agent-rules.txt`. Tasks, bản đồ file và readiness nằm trong thư mục này.

## Lát đang dở (agent đã dừng; code CHƯA commit, còn nguyên trên đĩa trong worktree)
| Lát | Worktree `F:\workspace\evolu-wt\…` | File dở | Việc |
|---|---|---|---|
| E1b | cr122-e1b-company-flows | 5 | LÀM TRƯỚC: 0109 `hub.emit_flow_event` SECURITY DEFINER (journal when 1805800000000) + int chéo tenant. Sửa theo soát E1: (1) sự kiện kẹt khi attempts≥5 ⇒ `lease_exhausted`; (2) join `d.tenant_id = cf.tenant_id OR d.tenant_id IS NULL` + kiểm ở service; (3) isUnique chỉ nhận `process_runs_flow_event_uq`. Sau đó: API company-flows (danh sách/bật/tắt/thứ tự, chặn tắt flow duy nhất của event required), sao chép thay thế + Quay về bản gốc (1 tx), flow Thư viện chạy không cần bản sao, int launch thật qua engine, perf p95 1000 event. |
| E2b | cr122-e2b-approve-node | 25 | Node Duyệt độc lập (duyệt/từ chối/trả lại qua back.effects.ts, nhắc, chuyển cấp; thêm khoá FE_NODES ở admin-web, để tắt), Chạy lại từ Nếu (run-control.service, thêm `facts_changed` vào DECISION_REASONS), kiểm vế `fact` theo AppEventDecl.facts khi lưu. Sửa theo soát E2: `loadJoin` đọc `status` (lượt cancelled/done không gọi lại handler, không ghi đè) + int test; JSDoc FactsReader tự lọc tenant; actorId. Migration nếu cần: 0110 (when 1805900000000). |
| A1 | cr122-a1-contracts | 1 | contracts bắn contract.submitted/uploaded/approved trong tx ghi, sau cờ flowTriggersOn; registerFactsReader + registerOutcomeHandler idempotent (runId,outcome). Cần 0109 của E1b. |
| A2 | cr122-a2-community | 1 | community bắn post.created/partner.join_requested/report.created (decides), tương tự A1. Cần 0109. |

## Sau đó
U2 (agent UI: bật Duyệt/Ký số/fact trong Nếu, next_step, trigger/Kết thúc thành node trên canvas, danh sách flow công ty; chụp + soát căn mép một lần) · E3 ký số · M1 backfill 0111 (+ STRICT_DEFAULT_FLOW=true) · Q1 e2e G1–G3 trên Demo prod (cần người dùng đăng nhập + xác nhận deploy) · R1 gỡ cũ 0108 (người dùng xác nhận).

Cách nối lại: mỗi lát mở agent mới trỏ vào worktree, bảo nó `git -C <wt> status` và `diff` để xem phần dở, rồi làm tiếp theo bảng trên. Gộp xong thì `git reset -q; bun run slice:merge <lát> --no-test`, `test:lock:verify`, push github, rồi `slice:rm`.
