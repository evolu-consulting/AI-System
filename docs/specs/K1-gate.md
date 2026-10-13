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
- 2026-10-13: người dùng OK mockup CR-073 (bố cục chuẩn). Gate chính thức sau readiness READY — mặc định Q26–Q34 trình kèm nếu còn câu hỏi mới.

## Gate K1 (CR-073) — 2026-10-13 · DUYỆT
- Người dùng OK mockup CR-073 và bảo "làm tiếp" (2026-10-13). readiness CR-073 lần 3 READY (`K1-knowledgehub/readiness.md`). ADR-0012 Accepted.
- Mặc định Q20–Q34 (giao thức `X-KH-Key` + `/vector/*`, SSO chưa hỗ trợ, KH tắt auth ⇒ chặn trừ loopback dev, ≤5 KH/agent, ≤50 project/KH, id cố định cho worklog, embedder tiếng Anh ⇒ cảnh báo, chỉ dùng kết nối kiểm `ok`) đi theo bản tối giản người dùng duyệt; báo người dùng trong tổng kết — đổi được.
- Thứ tự BUILD: T4 → T5a…T5g (T5g evolu) ∥ F4 (sau T4) → F1 (sau T5c) → F2 (sau T5d) → F3 (sau F4, T5f) → T7 (`done:k1` + review + security review; checklist thêm: `useSecret` tenant = null cho khoá nền tảng, không lấy từ input).
