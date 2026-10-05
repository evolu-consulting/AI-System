# Readiness — H3a-subscription

## Lần 1 · 2026-10-06 · spec-readiness (Opus) · **NOT READY** → sửa một lượt
Đọc hết thư mục spec (10 file, lớn nhất `plan-runtime.md` 16 861 B, `spec.md` 16 351 B — mọi file ≤ 25 600 B) tới `bfd3161` + đối chiếu code: hub-api `runner/runner.rules.ts` (`providerBlocked` :126), `runner/job/runner.repo.ts` (`providerStateOf` :12, `readJob.queueExpired`, `slotCounts`, `expireQueued(tx, id, reason: string)` :145), `runner/job/job-follow.ts` `#poll` (:107–125), `runner/job/job-agent-runner.ts` (:220–224 hằng `provider_unavailable`), `runs/runs.rules.ts` `queueTimeoutReason` (:37), `runs/run-errors.ts` `runErrorTextFor(code, locale, reason: string | null)` (:84); agent-runtime `db/jobs_sql.py` (`K_CLAIM` :19), `db/finish_sql.py`, `providers/claude/mapping.py` (`rate_limit_event` :143, `result_signal` :151), `providers/patterns.py` (`RATE_RE`/`AUTH_RE`/`classify_text`), `providers/fake/provider.py` (`IS_ERROR_TEXT`, `_ratelimit`, `_early_end`), `runtimes/cli/refusal.py`; test khoá Python `_proc.py` (`APP_ENV=test`, `AGENT_RT_PROVIDERS=fake-cli`), `_rt.py` `CLEAN_SQL`, `conftest.py` (Runtime mỗi ca), `provider_int_test`, `orphan_int_test`, `refusal_int_test`; stack `tests/acceptance/H1/stack/_stack.ts` `startRuntimeBox`, `apps/agent-runtime/scripts/run.ts` `dockerArgs`; seed `fake-cli kind='subscription'`; `.gitignore`; BA HUB-FR-86/89, HUB-BR-04, WRK-FR-15/20/22. Mọi symbol plan trỏ tới đều có thật. Quét từ mơ hồ: 13 kết quả, đều là câu mô tả (vô hại); "backend-lead chốt…"/"PLAN xác nhận…" ở R05/R06/R08/R18 đã được plan §3/§4.3, PL12, rt §5 trả lời.

11 lỗ hổng (0 Chặn, 5 Cao, 3 Thường, 3 Thấp); G1–G7 của qc: đều nhận, G1/G3/G6 **có sửa mặc định** theo code thật, thêm N1–N4. **Không câu hỏi mới cho người dùng** (U1–U5, Q1–Q7 đã chốt/mặc định; G5 là quyết định kỹ thuật có mặc định an toàn).

| # | Mức | Vị trí | Lỗ hổng | Mặc định đề xuất | Ai sửa |
|---|---|---|---|---|---|
| G1 | Cao | spec-ac AC-02 · rt §3/§8 · test-plan-py P08 | AC-02 vế job (429 + "not logged in" ⇒ `cooldown`; 401 ⇒ `logged_out`) không có test: `fake` không đi qua `mapping.result_signal` (chỉ `RateLimit`+429 cố định, `is-error` chỉ chữ); P08 chỉ phủ `probe_result` | **Không thêm chỉ thị fake.** `result_signal(msg: ResultMessage)` (H1, `mapping.py:151`) đã là hàm thuần: qc thêm **P12** unit gọi trực tiếp với `ResultMessage` SDK: `is_error=True, api_error_status=429, result="Not logged in · Please run /login"` ⇒ `RateLimit(rejected)`; `401` ⇒ `logged_out`; `None` + "You've hit your usage limit" ⇒ `rejected`; `is_error=False` ⇒ `None`. backend-lead ghi `result_signal` vào bảng rt §8 (lớp unit thuần) | backend-lead (rt §8) + qc (P12, ma trận §3) |
| G2 | Cao | rt §5 · test-plan-py P33/P34 · AC-10 | Không có probe "ok nhưng chậm" ⇒ AC-10 (job ghi chen giữa lúc probe chạy) không dựng được tất định; `hang` ⇒ lỗi | Chỉ thị `ok:<ms>` (số nguyên 1–60 000): `FakeProvider.probe` `await asyncio.sleep(ms/1000)` rồi như `ok`; ngoài khoảng/không số ⇒ `error`; thêm vào `parse_fake_probe` + P10 | backend-lead (rt §5, PY-03) + qc (P10) |
| N1 | Cao | test-plan §2 "Env Python int" ↔ P33/P34 | Env int chung `AGENT_RT_PROBE_TIMEOUT_S=2` nhưng P33/P34 dùng `ok:3000` ⇒ (b) quá hạn ⇒ kết quả `error`, không phải `ok` ⇒ AC-10 sai lý do; 2 s cũng sát thời gian spawn con Python trong container (F3) | Env int mặc định `AGENT_RT_PROBE_TIMEOUT_S=10`; chỉ ca `hang` (P22, P38) đặt `2`; P33/P34 `ok:3000` < 10 s | qc (test-plan §2, P22/P33/P34/P38) |
| G5 | Cao | spec §1 #3 + R16 ("probe/**job** … `provider.recovered`") ↔ `plan-db` §2 `PROVIDER_OK` (không đổi `status`) | Hai tài liệu nói khác: spec cho job thành công đưa provider hỏng về `ok`; SQL plan chỉ ghi `last_ok_at` ⇒ đường job không bao giờ `recovered` | **Chỉ probe đưa về `ok`** (`PROBE_RECOVER`); job thành công chỉ ghi `last_ok_at`, không đổi `status` — job chạy từ trước khi hỏng có thể xong sau, không chứng minh hạn mức đã mở lại (cùng lý do PL3). Ghi **PL15**; sửa chữ spec §1 #3 và R16 thành "probe"; P49 giữ | backend-lead (PL15) + docs-architect (spec §1, R16) |
| G6 | Cao | test-plan §2 "Stack", test-plan-py §3 ↔ H1 `stack/_stack.ts` `startRuntimeBox` | Env Runtime container **cố định trong helper H1 (khoá)**, không nhận env thêm ⇒ script `test:h3a:stack` (MK) không truyền được `AGENT_RT_PROBE_*`/`AGENT_RT_FAKE_PROBE_FILE` | qc viết `tests/acceptance/H3a/stack/_stack.ts` `startRuntimeBoxH3a(name, worker, env)` (mẫu H2a `stack/_stack.ts` đã viết lại vì cùng lý do; dùng `dockerArgs`). File probe **không cần mount mới**: repo đã mount `/work` (`scripts/run.ts` `dockerArgs`) ⇒ host `<REPO>/.data/h3a-stack/probe.txt` ⇔ container `/work/.data/h3a-stack/probe.txt` (`.data/` đã trong `.gitignore`). MK chỉ thêm script + bỏ qua `H3a/stack/**` | qc (helper) · backend-lead (MK) |
| G3 | Thường | test-plan-py P37 | Đường import `K_CLAIM` | `from agent_runtime.db.jobs_sql import K_CLAIM` (`jobs_sql.py:19`, là **câu SQL** `SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim'));`) ⇒ owner `async with conn.transaction(): await conn.execute(K_CLAIM)` sau khi Runtime sẵn sàng, rồi chờ `last_probe_at ≥ mốc` (`PROBE_S=2`) | qc (P37); backend-lead không cần sửa |
| G4 | Thường | spec-ac AC-12 ↔ PL10 | AC-12 còn "`CLAUDE_CONFIG_DIR` trỏ thư mục trống" — env con không mang biến này (danh sách trắng) | Sửa chữ AC-12: "`HOME` tạm có symlink `.claude`/`.claude.json` → đổi sang thư mục rỗng ⇒ `logged_out` ⇒ trả lại ⇒ `ok` (PL10)". Spec §7 S1 + Q1 nhắc `CLAUDE_CONFIG_DIR` là ghi chép spike/tương lai — giữ | docs-architect |
| G7 | Thường | rt §5 · test-plan §5 F1 | Test khoá Python chạy với probe bật (1200, file vắng ⇒ `ok`) | Giữ (có chủ đích, PL2); đã kiểm: test khoá chèn `provider_state` **trước** `ctx.runtime()` (`provider_int:68`, `orphan:123,143`) ⇒ không đụng PK với UPSERT probe; `refusal_int` chấp nhận hàng `ok`. Thêm một câu rt §5: `.calls` **chỉ** ghi khi `AGENT_RT_FAKE_PROBE_FILE` được đặt (vắng env ⇒ không tạo file nào). F1 chạy `pytest -m int` 3 lần | backend-lead (chữ rt §5) |
| N2 | Thấp | test-plan-cases R14 ↔ `run-errors.ts:84` | Gọi `runErrorTextFor(…, undefined)` trái kiểu `reason: string \| null` ⇒ lỗi `tsc -p tsconfig.tests.json` | Bỏ `undefined` khỏi R14 | qc |
| N3 | Thấp | spec front-matter `requirements` | HUB-FR-86 (slot tenant), HUB-FR-89 (AgentRunner) có trong danh sách nhưng không luật nào trỏ | Giữ làm bối cảnh (A12 `tenant_slots` chạm HUB-FR-86); ghi "(bối cảnh, không đổi)" để `trace --check` không đòi test riêng | docs-architect |
| N4 | Thấp | spec R11 "60–3 600", R17 "`=0` (dev)" ↔ rt §6 (production cho `0`) | Chưa rõ production được tắt probe | Theo rt §6: `0` hợp lệ mọi môi trường (= tắt, giữ reset mù H1 — PL2); sửa chữ R17 bỏ "(dev)" | docs-architect |

**Không câu hỏi cho người dùng.** Bối cảnh giữ: API key chỉ ở Dify, Hub chạy `claude-sub` (U1); không chạm Dify thật — AC-07 dùng mock Dify H2a (U2); chu kỳ probe 20 phút `AGENT_RT_PROBE_S=1200` (U5); smoke tối đa 2 lượt haiku, không đụng file credential (PL10).

**Checklist:** A Phạm vi Đạt (spec §1 + "Không làm"); B Contract Đạt (không đổi — plan P2, §2; câu R08 nguyên văn §4.3); C Dữ liệu Đạt (plan-db §1, 6 cột NULL + 2 CHECK, RLS/GRANT không đổi); D Nghiệp vụ **Mâu thuẫn** (G5); E UI Đạt (không UI — spec §5); F Kiểm chứng **Thiếu** (G1, G2, N1); G Phụ thuộc **Thiếu** (G6); H2 Vai trò Đạt (không còn placeholder; chữ ký thuần plan §4.1, rt §3); H Task Đạt (tasks.md có File/Phụ thuộc/Lệnh xong/Rủi ro, task chạm `provider_state`/khoá/PII đều `cao`); I Nhất quán **Mâu thuẫn** (G4, G5, N4); J Độ chính xác Đạt trừ các mục trên.

Chạy lại sau khi áp: chỉ đọc `git diff bfd3161 -- docs/specs/H3a-subscription/` + G1–G7, N1–N4.

## Lần 2 · 2026-10-06 · spec-readiness (Opus) · **READY**
Chỉ đọc `git diff 785364a -- docs/specs/H3a-subscription/` (17952b0 backend-lead, 06da618 docs-architect, 7cb943b qc; 9 file, +32/−27) + G1–G7, N1–N4 lần 1 + đúng mục được trỏ. Đối chiếu code: `providers/claude/mapping.py` `result_signal` (:151 — `is_error=False`⇒None; 429⇒`rejected` trước 401⇒`logged_out`; còn lại `classify_text`, `RATE_RE` trước `AUTH_RE`) khớp đúng 4 ca P12; `rt §6` biên test `PROBE_TIMEOUT_S` 1–300 chứa 10 và 2 (N1); `tools/scripts/src/trace.ts` `parseSpecs` lấy mã bằng regex nên front-matter có chú thích vẫn đọc được HUB-FR-86/89 (đã "có test" từ H1 trong `docs/TRACE.md`, `checkGaps` không đỏ). Trần kích thước: lớn nhất `plan-runtime.md` 17 442 B, `spec.md` 16 673 B, `test-plan.md` 15 653 B — đều trong trần.

| # | Lần 1 | Lần 2 | Bằng chứng |
|---|---|---|---|
| G1 | Cao | **Đóng** | test-plan-py P12 (import `result_signal`, 4 ca); rt §8 dòng "Hàm thuần H1"; test-plan §3 AC-02 → P12; QW-PU P01–P12 |
| G2 | Cao | **Đóng** | rt §5 `ok:<ms>` 1–60 000, ngoài khoảng ⇒ `error`; P10 (`ok:1/3000/60000` ok; `ok:0/60001/abc/` ⇒ error); test-plan §2 |
| N1 | Cao | **Đóng** | test-plan §2 + test-plan-py §2: mặc định `PROBE_TIMEOUT_S=10`; P22/P38 đặt `2`; P33/P34 `ok:3000` < 10 s |
| G5 | Cao | **Đóng** | spec §1 #3, R16 "chỉ probe"; sd PL15; plan-db §2 `PROVIDER_OK` ghi chú; P49 giữ — không còn chỗ nào nói job đưa về `ok` (grep `recovered`) |
| G6 | Cao | **Đóng** | test-plan §2 "Stack" + test-plan-py §3: `startRuntimeBoxH3a(name, worker, env)` (qc), file `/work/.data/h3a-stack/probe.txt`; tasks MK chỉ thêm script |
| G3 | Thường | **Đóng** | P37 đường import + cách giữ khoá |
| G4 | Thường | **Đóng** | spec-ac AC-12 theo PL10 (`HOME` tạm + symlink) |
| G7 | Thường | **Đóng** | rt §5 "`.calls` chỉ ghi khi có `AGENT_RT_FAKE_PROBE_FILE`" (khớp P31) |
| N2 | Thấp | **Đóng** | test-plan-cases R14 bỏ `undefined` |
| N3 | Thấp | **Đóng** | spec front-matter "(bối cảnh, không đổi)" — `trace` vẫn đọc được mã (xem trên) |
| N4 | Thấp | **Đóng** | spec R17 "`=0` hợp lệ mọi môi trường", khớp rt §6 |

Lỗ hổng mới do bản sửa (0 Chặn, 0 Cao, 0 Thường, 2 Thấp — không đổi hành vi):

| # | Mức | Vị trí | Lỗ hổng | Mặc định đề xuất | Ai sửa |
|---|---|---|---|---|---|
| L1 | Thấp | test-plan §8 hàng G1, G2, G3, G6 | Bảng "Chỗ hở" vẫn giữ mặc định cũ (G1 `#fake:result`/`classify_result`; G6 "MK thêm mount `<tmp>/probe:/probe`") trái với cách đã chốt; chỉ đoạn ghi chú dưới bảng nói "đã xử lý" | Thêm "→ đã xử lý: …" vào cột Mặc định từng hàng hoặc gạch hàng; nguồn đúng là test-plan §2 / test-plan-py §1–3 | qc (khi chạm file lần tới) |
| L2 | Thấp | test-plan:107 QW-PU · :113 | Cột "phạm vi" nói "P11, P12 xanh trước code **nếu** … có sẵn", cột "đỏ đúng lý do" chỉ nêu P11; tổng "~110" vs "~115 dòng" | `result_signal` có sẵn từ H1 (đã kiểm) ⇒ ghi chắc "P11, P12 xanh trước code"; thống nhất ~115 | qc |

**Mâu thuẫn giữa tài liệu:** không còn (spec ↔ plan-db ↔ sd ↔ test-plan về G5; rt §5 ↔ P10/P33/P34 về `ok:<ms>`; test-plan §2 ↔ test-plan-py §2 về timeout; tasks MK ↔ test-plan §2 về helper stack).

**Không câu hỏi mới cho người dùng.**

**Checklist (thay đổi so với lần 1):** D Nghiệp vụ Đạt (spec R16 + PL15); F Kiểm chứng Đạt (P12, P10, test-plan §2); G Phụ thuộc Đạt (test-plan-py §3); I Nhất quán Đạt (AC-12, R16, R17); các mục còn lại giữ Đạt như lần 1. **Quét từ mơ hồ** trên dòng thêm: 6 kết quả — "…" (đường dẫn/SQL rút gọn), "ngoài khoảng" (= ngoài miền giá trị), "có thể xong sau" (PL15, lý do) vô hại; "nếu … có sẵn" (QW-PU) ghi L2.

**Chưa kiểm:** phần không đổi từ `785364a` (đã kiểm ở lần 1).
