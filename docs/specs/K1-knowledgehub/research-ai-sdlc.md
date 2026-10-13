# Khảo sát ai-sdlc cho K1/K2 (2026-10-13)

Nguồn (chỉ đọc): `D:\AI\ai-sdlc-rowan\POC\KnowledgeHub` (KH v6.4), `POC\AISDLC`, `handover-demo`. Người dùng 2026-10-13: được tham chiếu AISDLC và handover-demo. Chưa qua Intake — các điểm "Lệch" dưới đây chờ chốt.

## KnowledgeHub (KH v6.4)
- FastAPI, cổng 8000, Chroma + Kùzu + SQLite; `GET /health`, `GET /version` (`v6.4`), `GET /v1/capabilities` (semver theo capability).
- **Hai bề mặt API:**
  - Bề mặt "người" (`/vector/add|query|scroll|delete`, `/projects`, `/log/recent`, `/codegraph/import`): khoá chung `KH_API_KEY` (`X-KH-Key` hoặc Bearer), **không phân project**; hoặc OIDC claim `kh.projects{pid:[quyền]}`.
  - Bề mặt "máy" `/v1/{ns}/*`: OIDC client credentials `kh-ns-<ns>` (token 15 phút), namespace ↔ danh sách project, idempotency, rate-limit 1200/phút, mã lỗi ổn định (`docs/integration/api-contract.md`, `auth-and-tenancy.md`). KH tự khuyên dùng `/v1` cho tích hợp đa tenant.
- Mặc định **không bật auth**, **không TLS** trong app; `/vector/query` thiếu `project` ⇒ quét mọi project.
- `/vector/query`: `{text, k (mặc định 1, ≤200), project, scope, where, max_chars, min_score}` ⇒ hits không có metadata (cần `/vector/scroll {ids}` để lấy nguồn).
- Ghi: `/vector/add` đồng bộ, không trần độ dài (chunk 800/700 khi > 1800 ký tự); `/v1/{ns}/worklog` (`text ≤ 4000`, idempotent).
- `/codegraph/import {source_id, tool, nodes[], edges[], …}` đồng bộ, không trần; adapter graphify/gitnexus ở `KnowledgeHub/tools/adapters/`.
- **KH không parse PDF/DOCX.** Embedder mặc định `bge-small-en-v1.5` (chỉ tiếng Anh); `.env.example` ghi MiniLM đa ngữ — lệch với code.
- `kh-helper` (MCP) gọi với danh tính người đăng nhập, không dùng cho dịch vụ.
- Không thấy LICENSE trong KH/AISDLC; license graphify/gitnexus cần kiểm riêng.

## AISDLC (lớp "KH SDLC" ở gốc — engine DLC `line/` đã loại)
- `kh.py`: `SDLC_MEMORY_URL`, không gửi khoá; `POST /projects` (`sdlc-<slug>`), `/vector/add` scope `log`/`knowledge`, `/messages`, `GET /log/recent`.
- Ghi sau stage (`engine.py:450-460`): luôn ghi worklog `[sdlc] … DONE: summary | decisions | artifacts | tests | hand-over: next_input`; ghi `knowledge` chỉ stage **không** gate.
- Prompt (`prompts.py:184-201`): chèn 10 dòng worklog gần nhất; dạy agent tự `curl` KH — ai-system **không** làm vậy (Hub proxy).
- Bàn giao giữa stage: JSON `STEP_DONE` `{summary ≤200 từ, artifacts, decisions, risks, actions, issues, lessons, next_input}` ⇒ ánh xạ `summary` → `## Tóm tắt`, `next_input` → `## Bàn giao`.
- Quy trình mẫu tái dùng được (`seed.py`): agent PM/Architect/Dev/QA/Reviewer; stage Scope Sign-off (gate) → Setup & Plan → Blueprint/Spec (gate) → Architect Design → Implementation (chạy test) → Code Review (fail ⇒ quay lại) → Testing (fail ⇒ quay lại) → UAT (gate) → Release & Close; Bug flow (Bug Intake gate → Code Reading → Bug Fix); workflow New System / New Feature / Bug Fix / Full Delivery.
- handover-demo = tài liệu bàn giao hệ thống DLC cho khách (Keycloak, cổng) — **không** liên quan `## Bàn giao`.

## Lệch so với CR-062/066 + ADR-0012/0014 (chờ Intake)
| # | Đã chốt | Thực tế | Mặc định đề xuất |
|---|---|---|---|
| L1 | KH parse PDF/DOCX (ngoài phạm vi ai-system) | KH không parse | Phụ thuộc phía KH; K2 chỉ nạp text/markdown/code cho tới khi KH hỗ trợ (hoặc Hub trích chữ lại — CR mới) |
| L2 | Một khoá KH, Hub proxy | Khoá chung không phân project; `/v1` + client credentials theo namespace mới cách ly được | Hub dùng `/v1` + namespace theo tenant, secret `kh_client` theo tenant (H4b-1 đã chừa) |
| L3 | Allowlist + TLS | KH không TLS, auth tắt mặc định | Hub từ chối KH khi auth tắt (kiểm ở "Kiểm tra kết nối"); TLS qua reverse proxy, localhost dev ngoại lệ |
| L4 | Tóm tắt tiếng Việt vào KH | Embedder chỉ tiếng Anh | Yêu cầu phía KH bật embedder đa ngữ (bge-m3, đã ghi ADR-0012 §8) |
| L5 | Ghi `## Tóm tắt` sau gate Đạt | AISDLC ghi worklog mọi stage, knowledge chỉ stage không gate | Giữ quyết định ai-system |
| L6 | (mới) | Quy trình SDLC mẫu của AISDLC đầy đủ hơn `sdlc` seed hiện tại | Đề xuất cập nhật seed `sdlc` theo `seed.py` (tuỳ chọn) |
