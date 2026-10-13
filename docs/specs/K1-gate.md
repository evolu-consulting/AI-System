# Gate K1 KnowledgeHub — 2026-10-13

**Người dùng duyệt Gate 2026-10-13.** spec-readiness lần 2 READY (0 Chặn, 0 Cao, 11 Thấp, đã áp mặc định — `K1-knowledgehub/readiness.md`).
- ADR-0012 (KnowledgeHub làm RAG ngoài, Hub proxy): **Accepted**, gồm people lanes cho project riêng (Q2).
- Bố cục đề xuất (chưa có artboard) + mặc định Q1/Q4/Q5/Q7/Q9 (spec §9) đã duyệt.
- **Điều kiện: frontend (F1–F4) chờ người dùng OK mockup** https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ ; chưa OK thì F1–F4 `blocked`, không code FE.
- Backend (T4…T5g) code sau H4b-1 T5 (cần `kh_api_key` theo tenant + `useSecret`).
- Spec: `K1-knowledgehub/spec.md` (`status: approved`); plan `plan.md`, `plan-frontend.md`; test-plan `test-plan.md`.
- Thứ tự ưu tiên ai-sdlc (người dùng 2026-10-13): H4b-1 → K1 → K2.
- CR-071 2026-10-13: Gate cũ hết hiệu lực phần mô hình, Gate lại sau mockup mới https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ (CR-071 bổ sung: nhiều kết nối KH).
- CR-072 2026-10-13: K1 tối giản, thay CR-071 (kết nối KH + agent dùng trực tiếp, không kho); Gate lại sau mockup mới https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ
- CR-073 2026-10-13: K1 siêu tối giản — kết nối KH + khoá nền tảng, KH tự phân quyền; người dùng chấp nhận bỏ cách ly tenant ở Hub (hard stop bảo mật, đã xác nhận); spec §3–5/§9, plan, tasks viết lại rồi Gate lại
