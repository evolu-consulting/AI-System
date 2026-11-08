# CR-125 — Kế hoạch sửa sau soát SA + CEO/sale (2026-11-08)

Nguồn: `sa-review.md` (1 Chặn · 5 Cao · 8 TB · 6 Thấp, lát SA-S1…S12) và `ux-review-ceo.md` (4 Chặn · 9 Cao · 6 TB · 3 Thấp, lát UX-S1…S8).
Luật: ≤ 4 agent code cùng lúc; lát chung file chạy nối tiếp; lát chạm quyền/RLS/trạng thái run ⇒ Opus làm hoặc soát; e2e hành trình thật một lần cuối; soát lại góc CEO/sale trước khi báo xong.

## Gộp lát trùng file
- UX-S4 (thẻ HĐ theo vai, mail) + SA-S7 (hub trả mã thay chữ, mẫu mail ký) ⇒ **một lát** (cùng `contracts-list`, `sign-invite-mail`). UX-S8 (điện thoại) gom vào đây.
- SA-S3 (sổ node phía editor) chạy **sau** UX-S3 (cùng canvas/StageForm).
- SA-S8 (khung + http dùng chung) chạy **sau** UX-S2 và UX-S6 (cùng shell/Cài đặt/chữ).

## Đợt
| Đợt | Lát (song song) | Mục | Model |
|---|---|---|---|
| 1 (đang chạy) | UX-S1 lập công ty đủ trọn · UX-S2 một nguồn "quy trình đang áp dụng" · UX-S3 lưu sơ đồ nói rõ · SA-S1 RLS hub (0127 + guard + test catalog) | C1 H3 · C2 H1 M5 · C3 H2 M1 · B1 | Sonnet high (+Opus low soát S1) · Opus medium (B1) |
| 2 | UX-S4+SA-S7+UX-S8 thẻ HĐ/nhãn mã/mail/điện thoại · UX-S6 chữ quản trị · SA-S2 sổ node engine · SA-S11 CI + cổng (+ SA-S12 sửa thẳng) | H4 H5 H6 M2 M3 M4 M6 L1 L2 · H8 L3 · H1a L3 · M5 M7 M8 L1 L2 L4 L5 | Sonnet · Sonnet · Opus medium · Sonnet |
| 3 | UX-S5 Community hàng chờ duyệt (kiểm AI thật trước) · UX-S7 bật đối tác xác nhận từ giao diện · SA-S4 luật trạng thái HĐ một chỗ · SA-S3 sổ node editor | C4 H9 · H7 · H2a · H1b | Sonnet high · Sonnet · Opus medium · Sonnet |
| 4 | SA-S5 trạng thái run → SA-S6 kick bền (outbox, kiểm sweep H3) → SA-S10 public.ts các mount (nối tiếp) · SA-S8 khung + http dùng chung · SA-S9 gộp hộp thư | H2b M1 · H3 M6 · M2 · H5 M4 L6 · M3 | Opus medium (chuỗi) · Sonnet · Sonnet high + Opus low |
| Cuối | e2e toàn bộ (chia slot) · soát lại góc CEO/sale · video 2 · push nhánh `staging` | — | qc Sonnet · Sonnet · — |

Mỗi đợt ≈ 1–1,5 giờ; tổng ≈ 5–6 giờ nếu không vướng. Không deploy prod tới khi người dùng xác nhận.
Deploy note mới: hub 0127 (RLS 9 bảng) + guard hub-api; admin 0040 (CHECK tombstone); hub 0126 (cờ flow, xem A10a).
