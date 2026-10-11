# P-b-sources · readiness (spec-readiness)

Luật 1: ghi mỗi lần chạy spec-readiness. Spec Gate đã được **người dùng duyệt** 2026-10-11 (`../P-b-sources-gate.md`, D2/D4/D7). PLAN + reconcile (C1–C23) xong trước khi chạy readiness.

## Lần 1 — 2026-10-11 · NOT READY
Sau reconcile 24 điểm (commit `12001096`). Kết quả: **NOT READY** — 1 Chặn + 5 nhỏ. Không có câu hỏi nghiệp vụ/chi phí mới (mọi điểm có mặc định rõ).
- **Chặn (S4):** `mapTeamError`/PB-R17/TM-08 đòi `NOT_CONFIGURED` nhưng `MemberOutcome` thiếu reason `not_configured`; plan §6.1 dùng ternary chỉ ra TIMEOUT/UPSTREAM_ERROR ⇒ TM-08 (test khoá) đỏ.
- Nhỏ: §8 lệnh e2e sai (`P-b-sources` thay vì `-c …pb.config.ts`) + `done:pb` chưa định; C14 route copy `:key`→`:id`; PB-R10 lớp ép options.py mơ hồ; S2-7 `#fake:read` thiếu `=`; test-plan §2 ghi chú stale.
- **Vá:** commit `580646f2` (plan §6.1/§3.4 thêm `not_configured` + `mapTeamError`; spec §8/C14/PB-R10; tasks S2-7; test-plan §2; + note seed acme+evolu theo người dùng).

## Lần 2 — 2026-10-11 · READY
Sau vá (commit `580646f2`). Kết quả: **READY**. 6 chỗ vá đã xác minh đối chiếu code thật (`team-member.ts`, `defs.routes.ts:47`, `options.py:90-102`). Còn 5 điểm **Thấp** tự giải quyết theo thứ tự thẩm quyền (spec PB-R17 → test khoá), KHÔNG buộc hỏi lại:
1. plan §3.4 comment `mapTeamError` lệch câu chữ vs PB-R17/RF-33 (`expired`⇒TIMEOUT, còn lại⇒INTERNAL_ERROR) — **đã sửa** (commit cleanup).
2. test-plan P-05 route `:key`→`:id` — **đã sửa**.
3. test-plan §0 ghi chú lệnh e2e lỗi thời — **đã sửa**.
4. plan §6.1 `error_message`/`error_hint` chưa có câu chữ cụ thể — BUILD suy từ reason như đường fail agent đơn.
5. `readiness.md` chưa tồn tại — **tạo file này**.

**Kết luận:** READY → vào BUILD (Luật 2b: Gate đã được người dùng duyệt; readiness READY; mọi lỗ hổng Chặn/Cao đã có câu trả lời chấp nhận; không ADR/thư viện mới; không hard stop). Thứ tự lát: **PF-S4 → S1 → S2 → S3 → S5** (test khoá trước mỗi lát).
