# Quyết định trong lúc làm — K1-knowledgehub

Agent tự quyết theo Luật 2 (spec → BA → ADR → CONVENTIONS → code → đơn giản nhất). Mỗi quyết định một dòng: `ngày · task · quyết định · lý do`.

- 2026-10-13 · T4 · `AgentSchema.knowledge_connection_ids` và `AgentListItemSchema.knowledge_count` khai `.optional()` (T5d luôn trả) · bắt buộc ngay làm vỡ typecheck hub-api (`agents.map.ts`) và fixture `apps/studio-web/**/agents.test.ts`, `e2e/studio/_support.ts` (không thuộc quyền sửa của BE); tiền lệ `model` CR-054. FE đọc `?? []` / `?? 0`.
- 2026-10-13 · T4 · `KhCheckItemSchema` từ chối `level` không khớp nhóm của `code` (lỗi ⇔ `error`) · spec §3.1 chia 7 lỗi + 5 cảnh báo; chặt hơn, khớp test R81/R82.
- 2026-10-13 · T4 · Thêm `KhConnectionUpdateSchema` (Write + `version`), `KhConnectionListQuery/ListResponse/DeleteQuery`, `AgentKnowledgeRequestSchema` (≤ 5, duy nhất ⇒ 400 path `connection_ids`), schema `details` lỗi, `KH_TOOL_ERRORS`, `KH_CHECK_ERROR_CODES`/`KH_CHECK_WARNING_CODES` (`KH_CHECK_CODES = {error, warning}`) · spec §3.2 nêu bảng, cần tên export cho route/FE.
- 2026-10-13 · T4 · `StageKnowledgeSchema` đặt ở `hub-admin/kh.ts`, `chat/processes-entities.ts` import thẳng `../hub-admin/kh` (không qua index) · spec §3 chỉ định file; không vòng phụ thuộc.
- 2026-10-13 · T4 · 0029 thêm index `kh_writes_run_idx (process_run_id)` ngoài plan §5 · FK CASCADE từ `process_runs` + đọc theo run.
- 2026-10-13 · T4 · `hub.ts` (400 dòng) nhận audit qua `EXT_AUDIT_*` của `hub-kh.ts` (= secret + K1) thay vì import `hub-secrets` · giữ trần 400 dòng.
- 2026-10-13 · T4 · `migrate-hub.int.test.ts` `HUB_TABLES` thêm `secrets`, `sources`, `source_job_reads` (đỏ sẵn từ P-b/H4b-1) + 5 bảng K1.
