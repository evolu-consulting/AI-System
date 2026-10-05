# Gate H3a — Subscription `claude-sub`: probe định kỳ + xử lý hết quota

Ngày: 2026-10-06 · Trạng thái: **ĐÃ DUYỆT 2026-10-06 — Tự duyệt theo Luật 2b** · Readiness: READY (`H3a-subscription/readiness.md`, 2 lần; còn L1, L2 mức Thấp do qc sửa khi chạm file)

**Vì sao tự duyệt:** spec-readiness READY. Mọi lỗ hổng Chặn/Cao của lần 1 (G1, G2, G5, G6, N1) đã đóng theo mặc định trong readiness. Không có câu hỏi mới ngoài U1–U5 và Q1–Q7. Người dùng đã xem Q1–Q7 kèm mặc định (2026-10-05) và chỉ đổi Q3 = 20 phút (U5). Không ADR, không thư viện/dịch vụ mới, không hard stop.

## 1. Phạm vi (`H3a-subscription/spec.md`)
- Probe `claude-sub` là vòng lặp trong Agent Runtime (Q4), không phải job, khoá advisory theo provider. Chu kỳ `AGENT_RT_PROBE_S=1200` (20 phút, U5). Bỏ lượt khi trong chu kỳ đã có job thành công (R12). Probe ngay khi khởi động hoặc khi hết cooldown. Khi `logged_out` thì probe mỗi 60 s, chỉ chạy tầng (a).
- Cách probe (Spike S1): (a) `claude auth status --json` của CLI đi kèm SDK, không gọi model, chỉ đọc khoá `loggedIn`, stdout/stderr không log (có email/orgId). Sau đó (b) một lượt haiku tối thiểu, quy đổi ≈ 0,004 USD.
- Hết quota hoặc bị giới hạn: giữ 3 tín hiệu H1, ghi thêm `rate_limit_type`, `utilization`, cảnh báo, kiểm biên `resets_at` ≤ 8 ngày. Câu lỗi cho user phân biệt "hết hạn mức gói" với "cần đăng nhập lại" (R08). Contract không đổi.
- Chỉ probe đưa provider về `ok`; job thành công chỉ ghi `last_ok_at` (PL15).
- **Không làm:** chuyển sang tài khoản subscription khác (Q1), UI xem trạng thái (Studio H4, Q7), Model Gateway/API (H2d hoãn, CR-041), chạm Dify thật (U2).

## 2. Dữ liệu / contract
Migration `0008_h3a_provider_state.sql`: thêm 6 cột NULL vào `hub.provider_state` cùng 2 CHECK; idempotent, không đổi RLS/GRANT. Contract chat/hub/hub-internal không đổi, chỉ chữ `message`/`hint` của `run.failed`. Thứ tự khoá: `K_CLAIM → jobs → provider_state` khi provider chuyển sang hỏng (PL8); probe khoẻ là một UPSERT, không lấy `K_CLAIM`.

## 3. Test (`test-plan*.md`)
≈ 101 ca mới (unit TS 16 ID, int Hub 25, unit Python 12 ID, int Python 30, stack 4, smoke 4 với 2 lượt haiku thật). Tranh chấp dự kiến T1: test khoá H2b `direct.int.test.ts:225–231` (R19, BA thắng) do qc sửa ở QW. Rủi ro chập chờn F1: probe bật trong các test khoá H1, chạy `pytest -m int` 3 lần để kiểm.

## 4. Lệch BA, ghi CR khi đóng mốc (I3)
BA-W §3 ghi `maint.probe` là job và chu kỳ 5 phút; H3a dùng vòng lặp Runtime (Q4) và chu kỳ 20 phút (U5).

## 5. Thứ tự BUILD
Theo `H3a-subscription/tasks.md`: D1 ∥ PY-00 ∥ B0 ∥ MK → qc QW (+ T1) → Q2 → QW-PU → Q-PU → B1 ∥ PY-01 → PY-02 → qc QW-P → Q3 → PY-03 → PY-04 → I1 `done:h3a` → review ≤ 2 vòng → I2 smoke → I3 docs. Trên `main`, không push.
