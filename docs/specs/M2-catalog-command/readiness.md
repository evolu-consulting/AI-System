# Readiness — M2-catalog-command

Ghi mỗi lần chạy spec-readiness (Luật 1 điểm 4) và câu trả lời của người dùng ở Gate. Các lần chạy do điều phối bổ sung phía trên mục Gate.

## Gate 2026-10-01 — câu trả lời người dùng

Người dùng **trực tiếp chấp nhận cả 4 câu** của M2. Mọi đề xuất `ĐX` và Mơ hồ A1–A12 trong `spec.md` §9 chuyển sang **đã chấp nhận (Gate 2026-10-01)**; A3–A7 và A12 là mặc định kỹ thuật đi kèm, cũng đã chấp nhận.

1. **Gói bảo mật Secrets (A2)** = chấp nhận đúng như [plan.md §3.2](plan.md): AES-256-GCM bằng `node:crypto`; khoá 32 byte của `SECRET_MASTER_KEY` dùng thẳng; IV mới mỗi lần ghi; AAD `admin.secrets:<id>:<key_version>`; RLS chỉ cho scope `platform`; `REVOKE` trên `secrets` với `hub_ro`/PUBLIC; `admin_rw` không `SELECT` được `ciphertext`/`iv`; chưa xoay khoá (ghi nợ TECH-DEBT).
2. **AC-A03 (A1)** = M2 chỉ kiểm phía Admin. Vế "≤ 5 giây trong menu Hub" để M3 đo cùng NOTIFY FR-53. → [CR-011](../../CHANGE-REQUESTS.md).
3. **Phạm vi** = chấp nhận: A8 không làm FR-12, ẩn nút ([CR-012](../../CHANGE-REQUESTS.md)); A9 FR-24 chỉ phần tenant, phần group/quyền để M3 ([CR-013](../../CHANGE-REQUESTS.md)); A10 tab Feature của Tenant vẫn "Chưa khả dụng"; A11 M2 không ghi audit, ẩn "Lịch sử" (ghi TECH-DEBT khi đóng mốc).
4. **UI** = chấp nhận: editor Workflows và Commands là trang riêng; bỏ panel "Chạy thử"; giữ câu toast "có hiệu lực sau vài giây". → [CR-014](../../CHANGE-REQUESTS.md).

Hệ quả cho tài liệu:
- BA (`ba-admin.md` FR-12, FR-24, AC-A03) và UI (`ui-admin.md` 7.4, 7.6) đã thêm ghi chú trỏ CR-011…014.
- **G6** (test-plan §10): giữ `ADM-FR-12` trong `requirements` của `spec.md`, ghi chú "chỉ test âm, không làm ở M2"; qc giữ test âm tag `ADM-FR-12` (không có route) để `trace --check` có dấu vết.
- Còn lại trước khi tự duyệt Gate (Luật 2b): chạy lại spec-readiness sau các sửa này, rồi ghi `docs/specs/M2-gate.md`.

## Lần 1 — 2026-10-01 · NOT READY

Agent: spec-readiness (chỉ đọc; điều phối ghi lại). Không Chặn, không loại (b). 6 Cao, đều (c) kỹ thuật, có mặc định — không hỏi người dùng:
1. T4 phụ thuộc thêm T3 (fixture M2 nạp `secret-crypto.ts`; cùng sửa `app.ts`) → thứ tự T3 → T4 → T5 → T6. (điều phối, tasks.md)
2. FE2 phụ thuộc thêm Q2 (`M2/i18n-labels.test.ts`). (điều phối)
3. FE1a phụ thuộc thêm T2, FE0b (prepare-db dùng bảng danh mục; admin-api cần `SECRET_MASTER_KEY`). (điều phối)
4. Fixture: `summarize`, `report-export`, `report-tax` dùng `DIFY_INVOICE_KEY`; E-S.2 = "Tất cả 3 · Đang dùng 2 · Chưa dùng 1". (qc)
5. E-W.1 URL `?status=unattached` theo plan-frontend D13. (qc)
6. E-F.10 tạo command trong feature bằng API (không có trigger bump `version`). (qc)

Thấp: 7 R02 AAD theo plan §3.2 · 8 nhãn A2 → đã chấp nhận · 9 `NAME_TAKEN`→`SECRET_NAME_TAKEN`, `SECRET_NOT_FOUND`→`INVALID_REFERENCE {field:"secret_id"}` · 10 R26 `?status=` · 11 R17 message cố định · 12 placeholder `{names}` · 13 E-C.5 `dich-moi` · 14 ca owner SQL chỉ kiểm bất biến · 15 D1.4 băm ở HEAD · 16 Q2 lệnh xong thêm `typecheck && check` · 17 tick P2, status `ready` khi READY.

Đã kiểm sớm theo bài học M1: lệnh xong ↔ §8.1 (trừ 1–3), T1 → Q2 → T2, lệnh int `--config=bunfig.int.toml`, `SECRET_MASTER_KEY` ở `.env.local` + FE0b, khoá chỉ `FOR NO KEY UPDATE`/`FOR SHARE`, hook chỉ `appEnv=test`.
