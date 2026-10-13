# Quyết định trong lúc làm — K1-knowledgehub

Agent tự quyết theo Luật 2 (spec → BA → ADR → CONVENTIONS → code → đơn giản nhất). Mỗi quyết định một dòng: `ngày · task · quyết định · lý do`.

- 2026-10-13 · T4 · `AgentSchema.knowledge_connection_ids` và `AgentListItemSchema.knowledge_count` khai `.optional()` (T5d luôn trả) · bắt buộc ngay làm vỡ typecheck hub-api (`agents.map.ts`) và fixture `apps/studio-web/**/agents.test.ts`, `e2e/studio/_support.ts` (không thuộc quyền sửa của BE); tiền lệ `model` CR-054. FE đọc `?? []` / `?? 0`.
- 2026-10-13 · T4 · `KhCheckItemSchema` từ chối `level` không khớp nhóm của `code` (lỗi ⇔ `error`) · spec §3.1 chia 7 lỗi + 5 cảnh báo; chặt hơn, khớp test R81/R82.
- 2026-10-13 · T4 · Thêm `KhConnectionUpdateSchema` (Write + `version`), `KhConnectionListQuery/ListResponse/DeleteQuery`, `AgentKnowledgeRequestSchema` (≤ 5, duy nhất ⇒ 400 path `connection_ids`), schema `details` lỗi, `KH_TOOL_ERRORS`, `KH_CHECK_ERROR_CODES`/`KH_CHECK_WARNING_CODES` (`KH_CHECK_CODES = {error, warning}`) · spec §3.2 nêu bảng, cần tên export cho route/FE.
- 2026-10-13 · T4 · `StageKnowledgeSchema` đặt ở `hub-admin/kh.ts`, `chat/processes-entities.ts` import thẳng `../hub-admin/kh` (không qua index) · spec §3 chỉ định file; không vòng phụ thuộc.
- 2026-10-13 · T4 · 0029 thêm index `kh_writes_run_idx (process_run_id)` ngoài plan §5 · FK CASCADE từ `process_runs` + đọc theo run.
- 2026-10-13 · T4 · `hub.ts` (400 dòng) nhận audit qua `EXT_AUDIT_*` của `hub-kh.ts` (= secret + K1) thay vì import `hub-secrets` · giữ trần 400 dòng.
- 2026-10-13 · T4 · `migrate-hub.int.test.ts` `HUB_TABLES` thêm `secrets`, `sources`, `source_job_reads` (đỏ sẵn từ P-b/H4b-1) + 5 bảng K1.
- 2026-10-13 · T5a · `khUrlPolicy`: scheme khác http(s) và chuỗi có `?`/`#`/khoảng trắng (kể cả `?` rỗng) ⇒ `invalid`; allowlist so theo `URL.origin` (mục rác bị bỏ); loopback = `localhost`, `127.0.0.1`, `[::1]` · spec §3.4 chỉ nêu https/userinfo/query/fragment; chặt nhất, đơn giản.
- 2026-10-13 · T5a · `evaluateKhCheck`: bước có giá trị `null` = chưa chạy ⇒ dừng gom; lỗi ở bước 6 (`/projects`) giữ `kh_version` đã đọc (chỉ "dừng sớm" trước bước 5 mới `null`); `kh_unreachable` do network không có `params.status`; `/projects` body sai ⇒ `{status}` = mã HTTP nhận được · plan §3.1/G7.
- 2026-10-13 · T5a · `kh_version` = chuỗi gốc KH (≤ 64) kể cả khi quá cũ; không phải chuỗi ⇒ `null` · G5 chỉ chốt `found`.
- 2026-10-13 · T5a · `khToolDescription` không có mặc định ⇒ bỏ đoạn "Default: …"; cắt nhãn ⇒ "…, …." (giữ Default) · plan §2.3 chỉ nói ca có mặc định.
- 2026-10-13 · T5a · `summaryForWorklog` dùng lại `sectionMap`/`normSection` (`processes/runs/template.rules.ts`: heading cấp 2, NFC + hoa thường); `clipWords` giữ xuống dòng giữa các từ · bắt chước kiểm template; `ensureSummary` so chuẩn hoá.
- 2026-10-13 · T5a · env `HUB_KH_ALLOWED_ORIGINS` (url http/https) optional + `khConfigOf(env)` (mặc định dev/test mock loopback, production `[]`, chuẩn hoá origin) trong `config/env.ts`; nối `AppDeps.kh` + `server.ts` để T5c (cùng route `GET C`) · G1 chia T5a/T5c.
