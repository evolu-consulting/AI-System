# Readiness · M3-permissions

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng. Câu trả lời của người dùng ở Gate ghi ở mục riêng phía dưới.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| (chưa chạy) | — | — | — | — | Spec tách 2026-10-02 (`status: draft`); chạy sau khi P1, P2, Q1 xong |

## Gate 2026-10-02 — câu trả lời người dùng

Người dùng **trực tiếp chấp nhận cả 4 câu**. Mọi đề xuất A1–A14 trong `spec.md` §9 chuyển sang **đã chấp nhận (Gate 2026-10-02)**; A1, A3, A5, A7–A10, A12–A14 là mặc định kỹ thuật đi kèm, backend-lead đã xác nhận.

1. **A2** Vế "≤ 5 giây" của AC-A03 (và A10, A11 phía Hub) ở M3 = NOTIFY `config_changed` ≤ 1 s sau commit (listener đóng vai Hub) + dữ liệu `hub_ro` đúng. Menu `/`, `CMD_NOT_FOUND`, kill switch phía Hub chuyển M5. → [CR-015](../../CHANGE-REQUESTS.md)
2. **A4** Modal xung đột: có `{user}` khi `updated_by` có (workflow, command, feature, group); user và tenant dùng câu không `{user}`; bỏ "Lịch sử vẫn giữ v{n}" tới M4. → [CR-016](../../CHANGE-REQUESTS.md), TECH-DEBT #7 cập nhật.
3. **A6** Cấp feature cho user chỉ có API ở M3; UI sau khi có artboard. → [CR-017](../../CHANGE-REQUESTS.md)
4. **A11** Ô Groups trong drawer user chỉ đọc, không đổi `PATCH /admin/users`. → [CR-017](../../CHANGE-REQUESTS.md)

Hệ quả cho tài liệu: BA (AC-A03, A10, A11, FR-32), missing-screens §12.5 và §5.2, ROADMAP (M3, đầu vào M5), TECH-DEBT #7 đã thêm ghi chú trỏ CR. Còn lại trước khi tự duyệt Gate (Luật 2b): P1, P2, Q1 rồi spec-readiness, ghi `docs/specs/M3-gate.md`.

## Đã đưa vào spec từ readiness 2026-10-01 (đã được người dùng chấp nhận)
#13 (bump + NOTIFY, sửa thành sau commit), #19 (batch grant), #30 (dán username), #34 (agent "Chưa khả dụng"), #38, #29, #16 (cascade, unique grant), #12 (AC góc Admin), #7, #17; CR-008, CR-011, CR-013.

## Lần 1 — 2026-10-02 · NOT READY → đã sửa

Agent: spec-readiness (điều phối ghi lại). 0 Chặn, 13 Cao (đều (c) kỹ thuật, có mặc định — không hỏi người dùng), 13 Thấp.
Cao: (1) R1.15–16 tách sang T4/T6; (2) helper `newField` ở `_data.ts` cho typecheck Q2–T3; (3) grants/grants-batch (T5) dùng `HUB_VISIBLE_SQL`; (4) thêm `M2/error-codes.int.test.ts` vào danh sách sửa test khoá; (5) FE1a–d phụ thuộc T2; (6) FE0 phụ thuộc Q2; (7) T1 phụ thuộc T0; (8) batch xoá trực tiếp theo `remove` + đếm bằng `returning`; (9) lệnh int dùng DB test riêng `.env.test-be.local`/`.env.test-qc.local`, e2e chỉ truyền 2 biến URL; (10) E-CF ca 1 kỳ vọng diff `name.vi` + `command_ids`; (11) số trên nút dán = số username đã tách; (12) `:user_id` không phải uuid → 404; (13) `INVALID_REFERENCE` của Grant POST luôn có `ids`.
Thấp #14–#26 đã áp (chuỗi khoá Tenant POST + E3, L10 sentinel, vị trí hook, R09/R12, xoá marker, tên file `.tsx`, tách notify, T7 chạy int modules, "x y" một phần tử, bỏ tuỳ chọn cổng e2e → TECH-DEBT #17, một request một `configWrite`, repo trả số hàng, D16 >200 group).
Commit: 65bbbd6 (qc), dec1b6f (backend), bcdcbbd (frontend), tasks.md (điều phối).
