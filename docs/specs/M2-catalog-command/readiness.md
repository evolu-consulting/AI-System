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
