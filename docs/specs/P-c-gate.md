# Gate P-c1 Tự-sửa mã (diff-only) — 2026-10-14

**Tự duyệt theo Luật 2b.**
- spec-readiness lần 3: READY (`specs/P-c-autofix/readiness.md`); 7 lỗ hổng còn lại đều Thấp, có mặc định.
- Người dùng đã trả lời mọi câu: Q1–Q7 (2026-10-13: tách P-c1/P-c2, pha cài có mạng, `local_path` chỉ trên bản sao, sandbox ADR-0011 duyệt như đề xuất), duyệt mockup `Pc-*.dc.html`, B9 KnowledgeHub như K1, readiness #1 "Mở theo quyền xem run".
- ADR-0011 (Podman rootless prod / Docker Desktop dev, ảnh `ai-autofix-sandbox`) đã được người dùng duyệt nội dung qua Q4/Q6/Q7 ⇒ Accepted; không thư viện mới.
- Hard stop còn lại: không (P-c1 không cần secret/provider thật; PR = P-c2).
- Test đã khoá: 152 ca (R 33 · A 45 · P 51 · S 8 · E 14 + R2b sau).

BUILD: B1 → (Hub B2 → B3 → B4 → B5 → B5b → B6) ∥ (Runtime R1 → R2 → R2b → R3 → R4) ∥ (FE F1 → F2, F3 sau B5 → F4) → D1 → D2 → D3.