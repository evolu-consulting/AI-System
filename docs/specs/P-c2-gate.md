# Gate P-c2 Push nhánh + PR / apply_mode / rebase / repo riêng — 2026-10-14

**Tự duyệt theo Luật 2b.**
- spec-readiness lần 5: READY (`specs/P-c2-pr/readiness.md`); lần 1–4 có 0 câu hỏi mới, mọi lỗ hổng đã áp mặc định (spec §9 C36–C44, `spec-decisions.md` C1–C35, C45–C52).
- Người dùng đã trả lời Q1–Q10 (2026-10-14: chỉ GitHub; Runtime nhận khoá nguồn qua kênh nội bộ, chỉ ngoài container; stage "Áp" riêng; Q4–Q10 theo mặc định) và cho đi tiếp mockup `Pc2-*.dc.html` ("đi tiếp, xem sau"). CR-075.
- Không ADR mới, không thư viện mới (Hub `fetch`, Runtime `git` CLI).
- Hard stop còn lại: S1 smoke GitHub thật (cần repo + PAT người dùng cấp). Mốc đạt bằng mock GitHub + bare repo.
- Test đã khoá: 171 ca (luật 38 · int Hub 72 · Runtime 35 + int 9 · e2e 17).

BUILD: B1 → B2 → (Hub B3 → B4 → B5 → B6 → B7 → B8) ∥ (Runtime R1 → R2 → R3) ∥ (FE F2 sau B1, F1 sau B3, F3 sau B7) → D1 → D2 → D3.
