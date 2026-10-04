# Readiness — H1-hub-core

## Lần 1 · 2026-10-04 · spec-readiness (Opus) · **NOT READY**
Phạm vi: spec, plan, plan-db, plan-runtime, test-plan, tasks; ADR-0007/0008/0009; CR-019/020/021/025/028/029/030; 82 mã + HUB-H1-AC-01…12. Điều phối ghi lại (agent chỉ đọc).

| # | Mức | Vị trí | Lỗ hổng | Mặc định đề xuất |
|---|---|---|---|---|
| 1 | Chặn | plan §5.1↔§3.5, §5.7 E9 | E12 khoá `flows → messages → runs → conversations`, E9 khoá `conversations → flows` ⇒ deadlock; A37 thiếu E9 | E12: `UPDATE conversations … RETURNING id` (0 dòng → 404) → flows → runs → messages; thêm E9 vào A37 |
| 2 | Chặn | test-plan R8↔Q-T5 | Hết hạn sự kiện: "600 s → false" ↔ `now ≥ finishedAt+retention` | Theo mock C1: hết hạn khi `now − finishedAt > retention` |
| 3 | Cao | plan §5.2, §5.7, §5.8 | Nhiều instance: kết thúc run không có `WHERE status='running' AND owner=$me`; instance huỷ XADD trùng id không có luật thử lại ⇒ 2 sự kiện kết thúc / mất `CANCELLED` | Điều kiện trên, 0 dòng → không XADD; bên không phải chủ gặp lỗi id → `XREVRANGE` + thử lại ≤ 3 |
| 4 | Cao | plan §2.3, A26 | `job.failed.message` có thể lộ provider/agent/đường dẫn ra `run.failed`; nguồn `hint` chưa định | Hub không chuyển `message` của Runtime; ánh xạ `code` → câu + hint tĩnh vi/en (`modules/runs/run-errors.ts`); bản gốc chỉ vào `run_steps.detail`/log |
| 5 | Cao | plan §5.3 | `parseLastEventId` không tồn tại trong `@ai/contracts/chat` | Thêm vào `runs/runs.rules.ts` (§6.4) + ca test |
| 6 | Cao | test-plan §2 | DB `ai_system_test_h1` vi phạm `resetTestDb` (tên phải kết thúc `_test`); Python thiếu env DB test | `ai_system_h1_test`; `HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL` |
| 7 | Cao | tasks PY-04/06/07/11 | Phụ thuộc kết quả spike [CX] nhưng chỉ PY-08 gắn PY-02 | Gắn PY-02; spike blocked → code theo dự phòng đã ghi, ghi §13 |
| 8 | Cao | tasks PY-02, I1 | Spike cần WSL2 sẵn + đăng nhập `claude` thật + dùng quota (hard stop); không task nào giao | Task tiền đề W0 cho người dùng; chưa sẵn → PY-02 `blocked`, PY-08 dùng SDK giả, AC-02 dời I2 |
| 9 | Cao | tasks Q1/Q2, Q-T2 | Thời điểm khoá test so với BUILD không rõ; QW-R chờ code | Task B0 sau Gate: stub chữ ký §6.4 + module Python rỗng → QW-R → QW-A → QW-P → QW-S → Q2 khoá → mới B2+/PY-04+ |
| 10 | Cao | tasks B1, PY-03, I1 | Chạm secret/auth nhưng ghi `thường` | Đổi `cao` |
| 11 | Cao | plan-runtime §5.3↔Q-T4 | `HOME` cố định ↔ test cần HOME tạm | HOME con = HOME cha (`Settings.home`); `forbidden_roots` tính từ đó |
| 12 | Cao | plan-runtime §7↔Q-T8, K-R1 | fake-cli echo cả prompt (lộ agents/history); "đủ dài" chưa có số | Chỉ echo `<message>`/`prompt`; `"echo: "+msg` + câu cố định ≥ 120 ký tự (≥ 3 `delta`) |
| 13 | Trung | plan §6.1 | `visibleAgents` tính từ cache sống hay snapshot | Snapshot của run (HUB-BR-06) |
| 14 | Trung | H1-R07, plan §6.1 | Token cache làm cạn `token_budget` sau 1 delegate | tokens = in+out; PY-02 đo, > 20 000 thì nâng seed; `agents.token_budget`, `on_no_match` → H2 |
| 15 | Trung | plan §3.6, D3 | Seed không nhận thư mục yaml; profile `assistant` chưa ghi | `runHubSeed({url, dir, appEnv})`, `HUB_SEED_DIR`, `HUB_SEED_PROFILE` |
| 16 | Trung | PY-04, plan-runtime §1.1 | Sweeper Runtime hết hạn `max_wait` ↔ R11 | Sweeper Runtime chỉ quét orphan |
| 17 | Trung | plan §5.7/5.8 | INSERT tin assistant sau UPDATE jobs, trái §3.5 | Đưa lên trước |
| 18 | Trung | spec §1/§9 | Lệch BA (WRK-FR-03 delta từ Runtime, WRK-NFR-04 log stdout) chưa ghi spec/CR | Ghi "Không làm" + §9; mở CR |
| 19 | Trung | Q-T3, Q-T7 | `#fake:tool`, `HUB_CONFIG_POLL_S`, `AGENT_RT_CLEANUP_S` chưa vào plan | Thêm (60/3600), giao PY-09/B3/PY-13 |
| 20 | Trung | plan-runtime §4 | `disallowed_tools=["*"]` chưa xác minh | Gắn [CX] vào PY-02; dự phòng danh sách tên |
| 21 | Trung | spec §8↔test-plan §7.1↔plan-runtime §10 | Ba bản Lệnh xong; typecheck toàn repo đỏ do code dở của Chat | Chuẩn = test-plan §7.1, script `done:h1`, lọc theo package Hub; đỏ do Chat = combine |
| 22 | Trung | tasks Q1 | QW-A (cách ly/quyền) ghi `thường` | Tách nhóm auth/isolation = `cao` |
| 23 | Trung | plan-runtime §7 | `#fake:badjson` đếm ở đâu khi mỗi job một process | `AGENT_RT_WORK_DIR/.fake-state/<run_id>.json` |
| 24 | Thấp | spec frontmatter | Thiếu HUB-FR-62, HUB-BR-04, CR-030; HUB-FR-31 hoãn | Thêm; ghi HUB-FR-31 "1 bước, fallback H2" |
| 25 | Thấp | BA WRK-FR-02, HUB-FR-42 | Heartbeat 15↔10 s, TTL 24 h↔600 s | Theo plan; CR sửa chữ BA |
| 26 | Thấp | plan-db §3.3 | `tenant_sub_limit` EXECUTE mặc định cho PUBLIC | REVOKE PUBLIC, GRANT `agent_runtime` |
| 27 | Thấp | plan §7 | `HUB_CORS_ORIGINS`, `LOG_LEVEL`, `HUB_LIVE` | Cổng chat-web, `info`; `HUB_LIVE` chỉ là cờ smoke |
| 28 | Thấp | D1, D3, B1, PY-01 | Thiếu file trong danh sách (`migrate.ts`, `package.json`, `bunfig*.toml`, `test-lock.ts`); BR-08 chưa có chủ | Bổ sung; BR-08 → B3 |
| 29 | Thấp | plan §4 | `config_changed` không có `tenant_id` | Nạp lại toàn bộ |
| 30 | Thấp | plan §5.3 | 410 nhầm khi run đang chạy chưa có key `sse:` | 410 chỉ khi `eventsExpired`; còn lại chờ `XREAD` |
| 31 | Thấp | plan-runtime §4 | Lần thử lại định dạng vẫn bật tool (WRK-BR-04) | Lần thử lại `tools=[]` |
| 32 | Thấp | kích thước | spec 25 560/25 600 B, plan-runtime 30 431/30 720 B | Tách spec §9 sang `spec-decisions.md` |
| 33 | Thấp | câu treo | Q-a, Q-b, RQ2–RQ5, Q-T1, Q-T6, Q-T9 đều có mặc định hợp lý | Ghi vào spec §9 "đã chấp nhận (mặc định)" |

**Mâu thuẫn tài liệu (giữ theo plan, CR sửa chữ):** ADR-0007 #4 + BA WRK-FR-20/24 "khoá theo provider" ↔ P5 khoá toàn cục; BA HUB-FR-62 "mặc định `llm`" ↔ Q1 CLI (H1 tạm thời); BA WRK-NFR-06 "dùng sandbox Claude Code" ↔ Q10 chỉ hook.

**Phụ thuộc phiên khác (không chặn H1):** `/auth/*` admin-api lệch contract chat (K-A1…A7); typecheck/test toàn repo đỏ do code dở của Chat.

**Câu hỏi cho người dùng:** (1) chuẩn bị WSL2 + đăng nhập `claude` dưới user `worker`, cho spike dùng quota thật? (2) Gate có ADR-0008/0009 Proposed → phải trình người dùng.

## Lần 2 · 2026-10-04 · spec-readiness (Opus) · **NOT READY** (chỉ phần đổi `f33100a..HEAD`)
Đóng: #1–#20, #22–#31, #33 (#32 tách spec §9 xong; phần kích thước chuyển #43). Không có câu hỏi mới cho người dùng; Gate phải trình người dùng vì ADR-0008/0009 Proposed.

| # | TT | Mức | Vị trí | Lỗ hổng | Mặc định (áp dụng, Luật 2) |
|---|---|---|---|---|---|
| 21 | Còn | Trung | spec §8 ↔ test-plan §7.1 ↔ tasks I1 | Ba bản Lệnh xong; `tsc -p tsconfig.tests.json` nằm trong chuỗi `&&` nhưng ghi "không chặn" | spec §8 một dòng trỏ test-plan §7.1; I1 dùng đúng §7.1; tách `tsc -p tsconfig.tests.json` ra khỏi `&&`, chỉ báo cáo |
| 34 | Mới | **Chặn** | plan §6.4 ↔ R15d | Regex `parseLastEventId` tối đa 15 chữ số ↔ test 16 chữ số | `^(0\|[1-9]\d*)$` + `Number.isSafeInteger`, không an toàn → 0 |
| 35 | Mới | Cao | plan §6.4 ↔ contract chat `hint: z.string()` | `hint: string\|null`; chưa có câu nguyên văn vi/en 7 mã | `hint: string` (`""` khi không có); vi lấy nguyên văn `tools/mocks/src/chat/scenarios.ts`, bổ sung vi/en còn thiếu, bảng ở plan §6.4/phụ lục |
| 36 | Mới | Cao | test-plan-cases A54 | Given không dựng được hộp đen | Lease A lùi quá khứ, sweeper B chiếm ∥ A nhận `job.result`; đúng 1 sự kiện kết thúc |
| 37 | Mới | Cao | test-plan-cases A37b | Thiếu nhánh run đã kết thúc trước E9 (chập chờn); "E9 đổi tên" sai | Runtime kịch bản giữ job suốt ca; "E8 (đổi tên) ∥ E9 (xoá)" |
| 38 | Mới | Cao | tasks QW-R/A2/P cột Đọc | Không trỏ `test-plan-cases §1` ⇒ thiếu 13 ca | Thêm vào Đọc; QW-A2 "A8–A52 + A37b, A54–A57, P45b(A)" |
| 39 | Mới | Cao | tasks QW-A2 | Test khoá/lease/huỷ/quyền DB ghi `thường` | `cao` |
| 40 | Mới | Thấp | test-plan §8 ↔ tasks | Một nhóm QW-A; A48–A51 ghi "đỏ" dù D1 làm trước; B1 "không đổi kết quả test" | Tách QW-A1/A2; A48–A51 (+A3) "xanh trước khoá, chấp nhận, ghi §10"; bỏ cụm ở tasks |
| 41 | Mới | Thấp | plan §5.7 E9 | "0 dòng → 200 + Run" là phản hồi E15 | E9: 0 dòng → bỏ qua run đó |
| 42 | Mới | Thấp | spec-decisions | Ghi thứ tự khoá cũ | Thêm "(đã thay bởi plan §3.5, readiness #1)" |
| 43 | Mới | Thấp | tasks Q1; plan-runtime 30 694/30 720 B | Q1 `≤ 30 KB` sai; plan-runtime sát trần | Q1 `≤ 25 600 B`; tách plan-runtime §12 thành một dòng trỏ plan-db §8 |
| 44 | Mới | Thấp | tasks B1 | "(nếu cần preload Hub)" không có tiêu chí | B1 sửa `bunfig.int.toml` `pathIgnorePatterns` cho `tests/acceptance/H1/stack/**`; không sửa `bunfig.contract.toml` |
