# Test plan · H3a-subscription (qc)

Chế độ **TEST-PLAN** (task QW-T) · 2026-10-06. Chưa có file test, chưa khoá; viết + "đỏ đúng lý do" sau Gate (§7), rồi Q2 → Q-PU → Q3 như H2c. Bảng ca TS (R, A, K, M) + T1 → [`test-plan-cases.md`](test-plan-cases.md); Python (P), stack (S), smoke (SM) → [`test-plan-py.md`](test-plan-py.md).
"Đúng" = spec §2 (H3a-R01…R20), §6, [`spec-ac.md`](spec-ac.md) (AC-W02 vế subscription + HUB-H3a-AC-01…13); chữ ký + câu `plan.md` §4; SQL/khoá `plan-db.md` §1–4, `plan.md` §5; Runtime `plan-runtime.md` §2–8; quyết định U1–U5, Spike S1, PL1–PL14 (`spec-decisions.md`). BA chỉ ở mã được trỏ.

## 1. Quy ước
Như H2c §1 (tên test, hộp đen, chờ theo điều kiện không `sleep`, cấm `skip/only/todo`, id ngẫu nhiên TC-3, ca tự dọn TC-6), thêm:

| Mục | Quy ước H3a |
|---|---|
| Tên test | TS `"<mã BA> · <ID> · mô tả [H3a-Rxx · HUB-H3a-AC-yy]"`; Python `test_<mã_snake>_…` + docstring mã |
| Mã đầu tên | câu lỗi / reason Hub → `HUB-BR-04`; Hub không tạo job, Runtime không claim, không thử lại → `WRK-FR-15` (+ `WRK-FR-20` ở ca chờ `queued`); probe, `provider_state` mới → `WRK-FR-22`; AC-W02 → `AC-W02` |
| Loại | **R** unit TS · **A** int hub-api (DB/Redis thật, `ScriptRuntime`) · **P** Python (unit thuần + int Runtime thật `fake-cli`) · **S** stack (Hub host + Runtime container) · **K** khoá có sẵn · **M** thủ công · **SM** smoke `HUB_LIVE=1` |
| Vị trí | R `tests/acceptance/H3a/rules/*.test.ts` · A `tests/acceptance/H3a/*.int.test.ts` · S `tests/acceptance/H3a/stack/*.test.ts` · P `apps/agent-runtime/tests/acceptance/{test_quota_rules.py,probe_int_test.py,quota_int_test.py}` · SM `tests/smoke/h3a-live.test.ts` |
| Thời gian | Không đồng hồ treo tường cho "không xảy ra": so mốc DB (`last_probe_at ≥ X`, `db_now`). Ngưỡng hiệu năng nới (memory "perf ưu tiên thấp"): int ≤ 3 s (spec 1 s), stack ≤ 5 s theo AC (nới 10 s nếu chập chờn, ghi §10); in ms thực |
| Provider state | Mọi ca đổi `hub.provider_state` khôi phục ở `finally` (`ok`, `cooldown_until`/`last_*` NULL); Python: `reset_data` mỗi ca + xoá hàng `provider_state` của `fake-cli` (`_h3a.py` helper, không sửa `_rt.py` khoá) |
| Log | Python: đọc JSON log Runtime (mẫu `startup_int_test`); TS: `setSink` H1. Assert **vắng** PII (`@`, `organization`, token, prompt/câu trả lời probe) |

## 2. Hạ tầng và giả lập
| Mục | Đề xuất | Ai |
|---|---|---|
| DB | DB riêng qc như H2c §2 (`ai_system_h3a_<nhóm>_test` + `_hub_test`); `0008` áp qua `db:migrate`/`ensure_schema` | qc |
| `fake-cli` probe | `AGENT_RT_FAKE_PROBE_FILE` (đọc mỗi lượt; vắng ⇒ `ok`) + `<file>.calls` (`rt` §5); **thêm** `ok:<ms>` (G2) | backend-lead PY-03 |
| `fake-cli` job | `#fake:ratelimit=<ts>[,<type>]`, `#fake:ratewarn=<util>[,<ts>]` (`rt` §5); có sẵn `#fake:is-error=rate\|auth`, `#fake:sleep`, `#fake:crash` | backend-lead PY-02 |
| Env Python int | `ctx.runtime(AGENT_RT_PROBE_S=…, AGENT_RT_PROBE_LOGGED_OUT_S=1, AGENT_RT_PROBE_TIMEOUT_S=2, AGENT_RT_FAKE_PROBE_FILE=<tmp_path>/probe.txt)` — biên dev PL6 | qc |
| Fixture `_proc.py`/`_rt.py` (khoá H1) | **Không sửa**: test khoá chạy với `AGENT_RT_PROBE_S` mặc định 1200 (probe bật, file vắng ⇒ `ok`) — đúng điều kiện production để bắt K6 | — |
| Stack | `test:h3a:stack` (MK): env Runtime như trên + file probe trong thư mục bind-mount host↔container (G6) | backend-lead MK |
| Smoke | `HOME` tạm + symlink (PL10); không chạm file credential; tối đa 2 lượt haiku | backend-lead I2, qc duyệt |
| Lock | `tests/acceptance/H3a/**`, `H2b/direct.int.test.ts` (T1, CHANGED), `apps/agent-runtime/tests/acceptance/{test_quota_rules.py,probe_int_test.py,quota_int_test.py,_h3a.py}`. `tests/smoke/**` không khoá | qc |

### 2.1 Helper mới
| File | Nội dung |
|---|---|
| `tests/acceptance/H3a/_h3a.ts` | `setProvider(sql, key, status, cooldownUntil)` (owner, `finally` gọi lại `ok`) · `startH3a(k, {jobMaxWaitS?})` (bọc `startHubX`) · `jobsOfRun(sql, runId)` · `R08` = bảng câu nguyên văn `plan §4.3` (một chỗ, dùng ở R/A/S) |
| `apps/agent-runtime/tests/acceptance/_h3a.py` | `state(ctx)` · `set_state(conn, **cols)` · `probe_file(box, text)` · `calls(box) -> list[str]` · `log_lines(box, event)` · `clear_state(conn)` |

## 3. Ma trận AC → test
| AC | Test | Loại |
|---|---|---|
| **AC-W02** (vế subscription) | S01; P48; K07 `provider_int_test::ac_w02` | S, P, K |
| **HUB-H3a-AC-01** (R02 biên) | P01–P03; P42 | P |
| **AC-02** (R01 thứ tự) | P08 (vế thuần); P48 + K07 `refusal_int_test` (vế job) — G1 | P, K |
| **AC-03** (R03 `allowed_warning`) | P04; P40, P41, P36 | P |
| **AC-04** (R06) | A01–A05, A10–A13; P21, P43; S03; K03 A30 | A, P, S |
| **AC-05** (R07) | A14; P47; S02 | A, P, S |
| **AC-06** (R08/R09) | R01–R18; A01–A07, A14–A17; T1 | R, A |
| **AC-07** (R10) | A18, A19 | A |
| **AC-08** (R11/R15) | P20–P26, P38 | P |
| **AC-09** (R12/R13) | P06; P27–P32, P39; S04 | P, S |
| **AC-10** (R15 chống ghi đè) | P09; P33, P34 | P |
| **AC-11** (R04/R17) | P05; P35, P44; SM4 | P, SM |
| **AC-12** (smoke) | SM1–SM4, M01 | SM, M |
| **AC-13** (hồi quy) | K01–K12, R20, R21, A20–A25 | K, R, A |

**Luật → ca** (mỗi luật ≥ 1 ca):

| Luật | Ca | Luật | Ca |
|---|---|---|---|
| R01 | P08, P48, K07 | R11 | P26, P37–P39, `test_config.py` (PY-00) |
| R02 | P01–P03, P42, P46 | R12 | P06, P27, P28 |
| R03 | P04, P36, P40, P41 | R13 | P06, P20, P29, P30, P32, S04 |
| R04 | P05, P44, SM4 | R14 | P07, P08, P25 |
| R05 | A20–A22, P45 | R15 | P09, P20–P24, P33, P34 |
| R06 | A01–A05, A10–A13, P21, P43, S03 | R16 | P20, P29, P48, P49 (G5) |
| R07 | A14, P47, S02 | R17 | P31, P35 |
| R08 | R10–R17, A01–A04, A14–A17, S01, T1 | R18 | P10, §2 |
| R09 | R01–R05, A01–A05, A10, A11 | R19 | R20, R21, A24, A25, T1, K01–K07 |
| R10 | A18, A19 | R20 | A23, K08 |

§6 hiệu năng: tín hiệu → `run.failed` ≤ 5 s (S01) · cooldown → `run.failed` (A01 ghi ms, S03) · probe không chờ `K_CLAIM` (P37) · probe thật ≤ 60 s (SM1).

**Không phủ ở H3a:** chuyển tài khoản (Q1) · fallback API (H2d) · UI trạng thái provider (H4) · NOTIFY admin (Q7) · tín hiệu hết quota **thật** (S2 — không ép hết gói; chỉ log R04 chờ gặp) · `auth status` CLI thật đọc PII (unit `test_auth.py` của backend-lead + SM4).

## 4. Ca tranh chấp T1
H2b `direct.int.test.ts:225–231` (A25) so `run.failed.message` với `runErrorText("ALL_PROVIDERS_EXHAUSTED","vi")` trong khi job fail reason `quota` ⇒ trái R08 (BA HUB-BR-04). Theo R19/`plan` P11: **BA thắng**, qc sửa ở QW (cases §2.7), ghi lý do vào §10 + spec §11, `test:lock:verify` ở Q2 phải ra đúng **1 `CHANGED tests/acceptance/H2b/direct.int.test.ts`** + các `UNLOCKED` H3a. Rà toàn bộ test khoá còn lại: không ca nào khác so nguyên văn câu `ALL_PROVIDERS_EXHAUSTED` kèm reason `quota`/`provider_unavailable` (cases §2.7).

## 5. Rủi ro chập chờn
| # | Rủi ro | Cách giữ |
|---|---|---|
| F1 | **Probe khởi động đua với test khoá H1** (K6): `_proc.py` không đặt `AGENT_RT_PROBE_S` ⇒ probe bật trong mọi test Python khoá; lượt khởi động spawn con Python + UPSERT `last_ok_at` song song với claim/Kết thúc. Ca nhạy: `orphan_int_test::three_crashes_marks_error` (probe khoẻ không được reset `consecutive_errors` — PL4), `restart_resets_provider_state` (nay phụ thuộc lượt probe khởi động xong ≤ 10 s, con Python trong container chậm), `restart_keeps_cooldown` (PL3), `provider_int_test::r18_cooldown_blocks_then_expires` (probe hết hạn ∥ claim — rào `updated_at`), `fr_15_…_30min` (mặc định từ env mới), claim ≤ 2 s (CPU con probe), test quét process/env (`sandbox_int_test`, `kill_job_hosts` — cmdline `probe.child` không được khớp mẫu job host) | Không sửa fixture khoá. PY-04 + QW-P chạy `pytest -m int` toàn bộ **3 lần liên tiếp**; đỏ không ổn định ⇒ lỗi code (K6/PL2/PL4), backend-lead sửa; chỉ qc phân xử nếu BA nói test sai |
| F2 | Hub int đổi `provider_state` dùng chung (`claude-sub`) với H1 `runner.int` A30/A31 | `finally` khôi phục; DB nhóm riêng; không chạy song song file |
| F3 | Mốc thời gian dev nhỏ (1–2 s) trên Windows/container | So mốc DB, hạn chờ 15 s; ngưỡng ms chỉ báo cáo trừ AC |
| F4 | P26 hai Runtime: thứ tự khởi động không tất định | Kỳ vọng chỉ là tổng `.calls` = 1 `auth` + 1 `turn` và ≥ 1 `probe.skipped` (`locked` **hoặc** `recent`) |
| F5 | Stack: `provider_state` `cooldown` rò sang suite H1/H2 stack | `finally` SQL về `ok`; `test:h3a:stack` chạy **sau** các stack cũ trong `done:h3a` |
| F6 | Log file chưa flush khi đọc | `wait_until` theo dòng log cần có |
| F7 | Smoke: tài khoản thật đang `cooldown`/gần hạn mức | SM không chặn; ghi trạng thái thật vào `smoke.md` |

## 6. Lệnh — `bun run done:h3a` (`tools/scripts/src/done-h3a.ts`, mẫu `done-h2c.ts`: `extend`/`byTitle` từ `h2cSteps()`)
| # | Bước | Chặn |
|---|---|---|
| 1–N | **mọi bước `done:h2c`** (typecheck, unit, int H1/H2a/H2b/H2c, `contracts:check`, Python, stack H1/H2a/H2b/H2c, `test:contract:chat` 41, hubdev) | ✓ |
| + | `bun test tests/acceptance/H3a/rules` (gộp bước unit) | ✓ |
| + | int `tests/acceptance/H3a/` cùng bước int (bỏ qua `H3a/stack/**` trong `bunfig.toml`/`bunfig.int.toml`) | ✓ |
| + | Python: bước sẵn có đã gồm `test_quota_rules.py`, `probe_int_test.py`, `quota_int_test.py` | ✓ |
| + | `bun run test:h3a:stack` (S01–S04) — **sau** stack cũ | ✓ |
| cuối | `test:lock:verify` · `trace --check` · `check:size --all` · `depcruise` | ✓ |
| báo cáo | `tsc -p tsconfig.tests.json` | — |

Không thuộc `done:h3a`: `HUB_LIVE=1 bun run test:smoke:live` (I2, AC-12). `done-h3a.test.ts` (MK): mọi tiêu đề `done:h2c` có mặt, thứ tự, stack H3a sau stack cũ.

## 7. Nhóm WRITE · đợt khoá (sau Gate)
| Nhóm | Khi | File | Ca | Phải đỏ đúng lý do vì |
|---|---|---|---|---|
| QW-R | sau B0 | `rules/blocked-reason`, `run-errors-h3a`, `contracts-h3a` | R01–R21 (16 ID, ~60 dòng bảng) | `blockedReason` stub ném `not implemented`; `runErrorTextFor` trả câu H1 ⇒ `expect` lệch. **Xanh trước code chấp nhận**: R14–R16, R18 (hồi quy), R20, R21 |
| QW-A | sau QW-R, D1, MK | `blocked`, `queue-wait`, `job-reason`, `command`, `db`, `compat` + **T1** | A01–A25 (~30) | câu H1 thay câu R08; reason `provider_unavailable` thay `quota` (A01, A05, A10). Xanh trước code: A06 vế trạng thái, A08, A12, A13, A18, A19, A20–A25 (D1 có), T1 **đỏ** (đúng: câu H1) |
| **Q2** | sau QW-A | khoá TS | — | verify: chỉ `UNLOCKED` H3a + đúng 1 `CHANGED` T1 |
| QW-PU | sau Q2, PY-00, **trước PY-01** | `test_quota_rules.py` | P01–P11 (~110 dòng bảng) | `NotImplementedError` (P11 xanh trước code — hằng có trong stub) |
| **Q-PU** | sau QW-PU | đúng 1 `UNLOCKED` | — | — |
| QW-P | sau PY-02 | `_h3a.py`, `probe_int_test.py`, `quota_int_test.py`, `stack/quota.stack.test.ts` | P20–P49 (30), S01–S04 | P40–P49: phần lớn xanh (PY-02 xong) — đỏ: P43 (vòng probe chưa có ⇒ `last_probe_at` NULL, hết hạn chờ — đỏ đúng); P20–P39: chưa có vòng probe (PY-03/04) ⇒ hết hạn `wait_until` có thông điệp; S01–S03 đỏ ở câu R08 nếu B1 chưa vào. Fixture/DB/Runtime boot phải xanh |
| **Q3** | sau QW-P, **trước PY-03** | khoá P int + stack | — | verify chỉ `UNLOCKED` QW-P |
| SM | I2 | `tests/smoke/h3a-live.test.ts` | SM1–SM4 | không khoá |

Tổng mới ≈ **101** ca: R 16 ID (~60 dòng bảng) · A 25 · P unit 11 ID (~110 dòng bảng) · P int 30 · S 4 · SM 4 · K 12 · M 4 · sửa T1 1. Model: QW-R/QW-A/QW-PU/QW-P = Opus (`cao` — `provider_state`, khoá, PII), Q2/Q-PU/Q3/I1 = Sonnet.

## 8. Chỗ hở cho readiness (mặc định dùng nếu không trả lời)
| # | Hở | Mặc định đề xuất | Agent |
|---|---|---|---|
| G1 | AC-02 vế job ("429 + chữ not logged in → cooldown") nằm ở `mapping.result_signal` (H1), **không** có chữ ký trong `rt §3`; `fake-cli` không có chỉ thị 429 + chữ tuỳ ý | P08 phủ thứ tự R01 trên `probe_result`; vế job = K07 `refusal_int_test` + P48. Muốn phủ đúng ca 429+auth: backend-lead thêm `#fake:result=<status>:<text>` hoặc công bố chữ ký `classify_result(api_error_status, text)` trong `rt §3` | backend-lead |
| G2 | AC-10 cần probe **ok nhưng chậm** để job ghi chen giữa; `rt §5` chỉ có `hang` (⇒ lỗi, không ok) | thêm chỉ thị `ok:<ms>` (chờ rồi như `ok`) vào `parse_fake_probe` + `FakeProvider.probe` | backend-lead (PY-03, sửa `rt §5`) |
| G3 | §6 "0 lần chờ `K_CLAIM`" (P37) cần giá trị khoá | qc import hằng `K_CLAIM` từ module SQL Runtime (tên đã công bố H1 `plan-db` §5.4) | backend-lead xác nhận đường import |
| G4 | `spec-ac` AC-12 còn chữ "`CLAUDE_CONFIG_DIR` trỏ thư mục trống" — PL10 đổi sang symlink `HOME` | sửa chữ AC-12 theo PL10 | docs-architect / backend-lead |
| G5 | R16 "chuyển trạng thái do probe/**job**: log `provider.recovered`" — theo `plan-db` §2 job thành công không đổi `status` ⇒ đường job không bao giờ phát `recovered` | `recovered` chỉ từ probe; ghi PL15 hoặc sửa chữ R16 | backend-lead |
| G6 | Stack: Runtime ở container ⇒ `AGENT_RT_FAKE_PROBE_FILE` phải nằm trong bind-mount; `plan §7`/MK chưa nêu | MK thêm mount `<tmp>/probe:/probe` + env | backend-lead MK |
| G7 | `rt §5` "vắng file ⇒ `ok`" ⇒ mọi test khoá Python cũ sẽ có probe `ok` thật chạy (F1) — chấp nhận có chủ đích (PL2) | giữ; F1 chạy 3 lần | — |

## 9. Cần bổ sung (agent: việc)
- backend-lead: G1, G2, G3, G5, G6 trước QW-P (G2/G6 chặn P33/P34/S04 nếu không có — khi thiếu ⇒ ca đó ghi "chờ" không khoá).
- docs-architect: G4.

## 10. Đỏ đúng lý do · nhật ký
(trống — ghi theo từng nhóm §7; > 25 KB thì tách `test-plan-log.md` như H2c.)
