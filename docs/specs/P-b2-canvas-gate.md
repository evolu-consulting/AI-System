# Gate P-b2 — Canvas quy trình + bước song song + quay lại + Bàn giao

Ngày: 2026-10-12 · **Người dùng duyệt** (có thư viện mới).

- Quyết định người dùng G-1…G-7 (`P-b2-canvas/spec-decisions.md`): ADR-0013 `@xyflow/react` 12.11.6 Accepted + trần chunk `canvas*` 80 KB gz; D11 stage sau chạy phiên mới (cả quy trình cũ); quá 3 vòng quyết như `redo_limit`; UI đếm bước từ 1; team không tự thêm `## Bàn giao`; plan-frontend là nguồn BUILD (mockup chỉ đối chiếu UAT); resume tối đa 24 giờ + UAT bắt buộc 1 ca Claude thật.
- spec-readiness lần 3 READY (`readiness.md`); mặc định lần 1–2 do điều phối chấp nhận.
- Thứ tự: P-b2 trước X2b-2 (X2b-2 dừng sau B1 `8b90e0fc`).
- Kế tiếp: qc T2 WRITE + LOCK (đỏ đúng lý do, sửa test khoá cũ có chủ đích theo test-plan §5) → T4 (contract + 0024) → T5a/T5b/T6/T7 ∥ FB-* → T11 `done:pb2` + `done:pa` + `done:pb` → reviewer + security review → qc-uat (gồm resume Claude thật).
