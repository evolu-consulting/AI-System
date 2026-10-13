# Test plan · P-c-autofix (P-c1 diff-only) · qc

Chế độ **WRITE + LOCK** (T3) · 2026-10-13. "Đúng" = spec §2 (PC-R01…R15), §3–§4, §6 (hàng rào), §9 (D/E/B, B9, "Trong lúc làm" 1–3) · plan §1–§5 (chữ ký §4) · plan-frontend §0–§5 (nhãn nguyên văn) · ADR-0011 #1–#5 · BA HUB-FR-119/126…130, HUB-BR-32…34, WRK-FR-28/29, WRK-BR-08. Hộp đen: không đọc code implementation (chỉ contract hiện có + test khoá cũ làm mẫu).

## 1. Quy ước
| Mục | P-c |
|---|---|
| Tên test | `"<mã BA> · [PC-Rxx ·] <ID> · mô tả"`; Python: `test_<mã>_<id>_…` + docstring có mã |
| Loại | **R** hàm thuần + contract (`bun test`, nạp động — vắng ⇒ đỏ ở `fn()/schema()`) · **A** int Hub thật + DB tag riêng (`bun run test:int`) · **P** pytest Runtime không hạ tầng · **S** container thật (tách riêng) · **E** Playwright (stack P-b2 + `page.route`) |
| Vị trí | R `tests/acceptance/P-c/rules/` · A `tests/acceptance/P-c/*.int.test.ts` (+ `_support/pc.ts`) · P `apps/agent-runtime/tests/acceptance/pc/test_pc_*.py` (+ `_pc.py`) · S `…/pc/sandbox_check.py` · E `e2e/P-c/{admin,chat}/*.pc.ts` (config `e2e/P-c/playwright.pc.config.ts`, `_pc-support.ts`) |
| Id cố định | R `c0c0…`, A db `c0c1…`, e2e `c0e2…`; fixture P-b (`b3b3…`, nguồn `app-repo`/`other-repo`/`docs-lib`/`beta-repo`) + `local-app` (SQL) |
| Chưa có 0031 | `needPc(c)` đầu mỗi ca A ⇒ đỏ ở expect `{migration0031:true}`; fixture def tự-sửa chỉ chạy khi 0031 có (không đỏ ở `beforeAll`) |
| Chuỗi quét | bí mật `AKIAQCQCQCQCQCQCQCQC`, token host `qc-ghtoken-Zx9Pq7Lm` (không được xuất hiện trong prompt/argv/env/UI) |
| Cấm | `skip/only/todo`, `sleep` cố định (chờ theo điều kiện), dữ liệu ngẫu nhiên |

## 2. Hạ tầng
- **A** (`_support/pc.ts`): `start3()` P-b PF-S3 (Hub in-process, kho file local, `ScriptRuntime`, `resolver`) + `seedSources` + `local-app` (`insertSource`). `mkAf/afStage/afDefBody` (stage `hd-read`, review Kế toán, `autofix`), `mkPlain` (đối chứng), `startAf` (resolver ok C1 → job stage → token job như Runtime claim), `postReport` (`POST /internal/jobs/:id/autofix-result`), `reportAndDone` (báo 201 rồi `jobDone` MD_AUTO — đúng thứ tự plan §1 bước 7), `afRows/attRow/stageView/content/internalGet/waitDecision`, `settlePc`. B9 dùng `startK1({seed:"full"})` + nguồn/def qua API + resolver P-b.
- Fixture SQL `db.int` chạy thử trên DDL nháp plan §2 trong tx ROLLBACK (DB qc): `ok | status_ck | diff_ck | round_ck | sha_ck | job_uq | branch_ck | ok` — đúng tên constraint. Máy móc flow (def thường → resolve → job → token → POST) chạy thử: route báo cáo 404, view/content beta 404.
- **P/S**: nạp `agent_runtime.autofix.rules` trong thân ca (`importlib`). S dùng `rules.container_args` + CLI `RUNTIME_SANDBOX` (docker/podman) + `RUNTIME_SANDBOX_IMAGE`; KHÔNG khớp `python_files` ⇒ chỉ chạy bằng đường dẫn tường minh.
- **E**: stack P-b2 (cổng `PC_E2E_PORT_BASE`=4900, Redis DB 12, env `.env.test-pc_e2e.local`); `patchStage` vá `GET /process-runs/:id` thêm `autofix`; `serveAttachment` vá `/attachments/:id/content`; `seedEditor` chèn nguồn `pc-repo`/`pc-lib` + def `pc-edit`/`pc-bad`/`pc-libsrc` (SQL jsonb); `setDecision` đổi lý do decision sang `autofix_*` CHỈ khi 0031 có.
- DB: `bun run db:test:create pc_qc` (int) · `pc_e2e` (e2e).

## 3. Ma trận luật → ca
| Luật / FR | R | A | P / S | E |
|---|---|---|---|---|
| PC-R01 nguồn git_remote/local_path, library 422, ∈ def.sources | C04 | V01–V04 | — | E01, E02b |
| PC-R02 AUTOFIX_EXECUTOR/REVIEW/MAX, thêm cuối | C05, I01–I06 | V05–V07 | — | E02 |
| PC-R03 / D8 mẫu `fixbug-apply` tắt sẵn, `fixbug-evolu` không đổi | — | V08–V09 | — | — |
| PC-R04 resolve toàn repo (`allowlist_union=[]`, `caps=autofix`) | C09, H03 | F01 | — | — |
| PC-R05 / E1 / B1 nhánh `ai/<run>/<stage_key>` (STAGE_KEY_RE) | C06–C07, H01, H04 | D03, F01, E05 | — | — |
| PC-R06 / WRK-BR-08 không container ⇒ `sandbox_unavailable` | H05 | F08 | S01–S08 | E08 |
| PC-R07 công cụ ép `[]`/R-G-G; hook chặn tool gốc ở workspace/git | H02 | F02 | P20–P23 | — |
| PC-R08 kiểm diff: đường dẫn → kích thước → bí mật → test | C10–C12 | E05–E06, E09, F11 | P06–P12, P04 | E05–E06 |
| PC-R09 `no_changes` vẫn qua gate | C10 | F05, E09 | — | E07 |
| PC-R16 ghi diff/log không bị chặn hạn mức tenant, vẫn cộng `quotaUsed` | — | A-E10 | — | — |
| PC-R10 thiếu báo cáo/check_failed ⇒ decision chỉ add_attempt/cancel; ghi chú làm lại không bí mật | C14, H05–H08, H06b | F06–F07 | — | E05, E08 |
| PC-R11 Chưa đạt ⇒ vòng k+1 cùng nhánh, `base_patch` cộng dồn; `apply_patch` ⇒ base null | H04 | F09–F10 | — | E04 |
| PC-R12 audit `autofix_results` append-only, log che | — | D02, D06, E08–E09 | P12, P16 | — |
| PC-R13 trần 200k | — | F12 | — | — |
| PC-R14 cách ly tenant / token job theo job | H09 | D05, E01, T01–T04, V04 | — | E09 |
| PC-R15 pha cài có mạng, không secret | C12 (`install`) | F01 (install_cmd) | P03, P05 | E01 (ghi chú mạng) |
| HUB-BR-32 không ghi ngoài workspace / repo thật / `sources/` | — | — | P02, P15, P21, S02, S06 | — |
| HUB-BR-33 container `--network none`, cap-drop, read-only, non-root, trần, không secret | H02 | D07 | P01–P05, P13–P14, S01–S08 | — |
| B9 KH `kh-query` cạnh `ws_*` | — | K01–K02 | — | — |
| plan §3.3 endpoint (401 một thân, 409×2, 400, 413, no-store) | C13 | E01–E07 | — | — |
| plan §3.4 view (`pin_sha`, `diff_file`, `test_log_file`, file tải) | C15–C16 | F03–F04, F10–F11, T02 | — | E03, E-E10–E13 |

FR trong phạm vi P-c1 (tất cả **COULD**, không có MUST): HUB-FR-119 ✓, 126 ✓, 127 ✓ (F08, S*), 128 ✓ (trừ rebase), 130 ✓ (trừ `apply_mode`), WRK-FR-28 ✓ (F01, P*, S*), WRK-FR-29 ✓, HUB-BR-32/33/34 ✓, WRK-BR-08 ✓. Ngoài phạm vi (P-c2): HUB-FR-129, HUB-BR-34 phần PR/`apply_mode`, rebase E4.

## 4. Danh sách ca
| Nhóm | File | Ca |
|---|---|---|
| R | `rules/contracts-pc.test.ts` | C01–C16 (16) |
| R | `rules/autofix-issues.test.ts` | I01–I06 (6) |
| R | `rules/autofix-rules.test.ts` | H01–H10 (11; H06b, H10 thêm ở T3b) |
| A | `db.int.test.ts` | D01–D08 (8) |
| A | `defs.int.test.ts` | V01–V09 (9) |
| A | `report.int.test.ts` | E01–E10 (10; A-E10 = PC-R16, T3b) |
| A | `flow.int.test.ts` | F01–F12 (12) |
| A | `tenant.int.test.ts` | T01–T04 (4) |
| A | `kh.int.test.ts` | K01–K02 (2) |
| P | `pc/test_pc_rules.py` | P01–P16 (42 ca sau parametrize) |
| P | `pc/test_pc_hook.py` | P20–P23 (9 ca) |
| P-int | `pc/autofix_int_test.py` (+ `pc/_af.py`) | AF01–AF11 (12 ca sau parametrize; R2b, `-m int`) |
| S | `pc/sandbox_check.py` | S01–S08 (8) |
| E | `e2e/P-c/admin/editor.pc.ts` | E01, E02, E02b (3) |
| E | `e2e/P-c/chat/diff.pc.ts` | E03, E04, E07, E-E10, E11, E12, E13 (7) |
| E | `e2e/P-c/chat/decision.pc.ts` | E05, E06, E08, E09 (4) |
**Tổng 152** = R 33 · A 45 · P 51 · S 8 · E 14 (+ 1 ca E02b tách từ plan-frontend (2)); **+ 12 P-int (R2b) ⇒ 164**. 11 ca e2e plan-frontend §5: (1) E01 · (2) E02/E02b · (3) E03 · (4) E04 · (5) E05 · (6) E06 · (7) E07 · (8) E08 · (9) E09 · (10) E-E10 · (11) E12; thêm E11 (lỗi tải) + E13 (thẻ thread).

### Ca chính (kỳ vọng rút gọn)
| ID | Dữ liệu → kỳ vọng |
|---|---|
| C07 | nhánh nhận `ai/<uuid>/{fix,a,fix-2,x×32}`; chặn `main`, `feature/…`, hoa, khoảng trắng, `../main`, `fix/x`, 33 ký tự, không-uuid, rỗng, `;rm` |
| C11 | `diff≠null ⇔ ok`, `diff_stats≠null ⇔ ok` (cả 2 chiều) |
| C12 | diff 2 097 152 nhận / +1 chặn; failures 51; check lạ; detail 501; commands 301; tool `bash`; arg 501; log_tail 65 537; sha hoa/`HEAD`; files 301 |
| H05 | `container` thắng mọi kết quả ⇒ sandbox; `null`/`timeout`/`check_failed` ⇒ check; ok/no_changes ⇒ continue |
| H07 | ghi chú làm lại có `secrets src/cfg.ts:7 aws_key`, KHÔNG `AKIA…` |
| D03 | branch_ck nhận khoá STAGE_KEY_RE (1…32 `[a-z0-9-]`), chặn `..`/hoa/không-uuid/`a/b` |
| D06 | hub_rw INSERT ok; UPDATE/DELETE 42501 · D07 agent_runtime 42501 |
| E01 | không token / token job khác / token rác ⇒ 401 cùng thân, 0 hàng |
| E06 | diff 2 MiB+1 ⇒ 413 `PAYLOAD_TOO_LARGE`; thân 3,2 MB ⇒ 413 |
| E08 | hàng: job, round 1, nguồn, nhánh, ok, exit 0, 12 400 ms, 1 lệnh, pin.sha C1; attachments `output`/`text/plain`/`fix-r1.diff.txt`/`fix-r1-test.log.txt` của job |
| F01 | `payload.autofix` = {source app-repo git C1 allowlist [], `bun install`, `bun test`, `["src/**"]`, `ai/<run>/fix`, 1, null}; resolve item `caps:"autofix"`, `allowlist_union:[]` |
| F06 | `decision={reason:autofix_check_failed, options:[add_attempt,cancel]}`; `use_current` ≥ 400, giữ `needs_decision`; add_attempt ⇒ job vòng 2, prompt có `src/cfg.ts:7`, không `AKIA…`, `base_patch` null |
| F10 | Chưa đạt ⇒ job 2: vòng 2, cùng nhánh, `base_patch.id` = diff vòng 1, tải qua `/internal/jobs/:id/attachments/:aid` = DIFF; view vòng 2 `fix-r2.diff.txt` |
| T01 | beta: view 404, diff/log 404, thân như uuid không tồn tại |
| K01 | `mcp.tools ∋ kh-query` cạnh `payload.autofix`; KH không thành nguồn job |
| P02 | đúng 1 mount `<host_ws>:/workspace:rw`; không `--mount`, socket, `sources`, `git`, privileged, host ns |
| P03 | env container = `CI=1, HOME=/tmp, LANG=C.UTF-8` ở cả 3 pha; token host không lọt |
| P06–P07 | tên cấm PB-R07 thắng allowlist `**` (mọi độ sâu, hoa-thường); CI workflow cần ghi rõ; `.gitignore` được |
| P10–P11 | 10 mẫu §5.4 trên dòng `+` ⇒ `secrets` path:line(file mới)=`src/cfg.ts:2`, rule ≤ 64, không giá trị; dòng `-`/ngữ cảnh/gán < 12 ⇒ không; thêm `.env` ⇒ lỗi |
| S01–S08 | chỉ `lo`, connect ra ngoài lỗi; rootfs RO, /workspace ghi về host; uid 1000, CapEff 0, NoNewPrivs 1; memory.max 2 GiB, pids.max 512; env không token; /proc/mounts không sources/git/socket; xoá theo nhãn; fork bomb bị trần |
| E03 | đầu khối: `Vòng 1`, `pc-repo@a1b2c3d`, `+3`, `−1`, `3 file`, `Test đạt · 12,4 giây`; list 3 file (1 `nhị phân`); `autofix-diff-file-0` có dòng sửa; tải `ra-soat-r1.diff.txt`; Đạt ⇒ 200 |
| E05 | heading `Kiểm bản sửa không đạt`; nhóm `Bí mật (không hiện giá trị)` dòng `src/cfg.ts:7 · quy tắc aws_key`; `AKIA…` không có trên trang; 2 nút |

## 5. Rủi ro chập chờn
| Rủi ro | Giảm |
|---|---|
| `prepareDb` `ALTER ROLE` cấp cụm ⇒ `tuple concurrently updated` khi nhiều file/session | chạy từng file (như K1 §5) |
| Resolver nền P-b sống qua ca | `settlePc` dừng resolver + huỷ run/job mở + xoá `autofix_results` (owner) |
| E2E thứ tự nhóm lỗi đo bằng `boundingBox().y` | chỉ so trước/sau, không toạ độ tuyệt đối |
| S chạy trên máy không có Docker/ảnh | đỏ có thông báo `qc: cần CLI …` / `RUNTIME_SANDBOX_IMAGE` (không skip) — chạy ở bước R4/`done:pc` |

## 6. Chỗ hở spec (mặc định qc đã dùng) · Cần bổ sung
| # | Hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1 | `SandboxSpec` chưa khai báo trường | kwargs `job_id, image, host_workspace, engine, cpus, memory_mb, pids, tmp_mb` (`_pc.py`) | backend-lead (R1) |
| G2 | `DiffStats`/`Limits`/`Failure` chưa khai báo | `DiffStats(files, insertions, deletions, bytes)`; `Limits()` mặc định 2 MiB/300/4 GiB; `Failure` có `check/path/line/rule/detail` (thuộc tính hoặc khoá) | backend-lead (R1) |
| G3 | Tên export contract | `StageAutofixSchema` (hub-admin), `JobAutofixSchema` (hub), `AutofixReportSchema` (hub-internal), `AutofixStageViewSchema` (chat); `HUB_INTERNAL_ERRORS.AUTOFIX_*` = 409 | backend-lead (B1) |
| G4 | plan §2 `branch_ck` = `[a-z0-9][a-z0-9_-]{0,63}` ≠ STAGE_KEY_RE `[a-z0-9-]{1,32}` | contract + DB theo **STAGE_KEY_RE** (C07 chặn 33 ký tự; D03 nhận 32) — đề xuất CHECK `^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$` | backend-lead (B2) |
| G5 | Nhãn hook | `HookDecision.label == "workspace"` cho tool gốc dưới `workspace/` hoặc `git/`; symlink trong `out/` trỏ vào workspace ⇒ deny (P23) | backend-lead (R3) |
| G6 | Nhãn nút: plan-frontend §5 ghi "Thêm lượt"/"Huỷ quy trình"/"Chưa đạt, làm lại", §3 cuối ghi "giữ khoá sẵn có" | e2e dùng nhãn SẴN CÓ chat: `Đạt`, `Thêm 1 lần làm lại`, `Huỷ lượt chạy`, không `Dùng bản hiện có` | frontend-lead (ghi "Quyết định trong lúc làm") |
| G7 | Thẻ thread không có role/nhãn | `article` chứa "Tự sửa mã" + nút/link "Xem diff" | frontend-lead |
| G8 | "Tải .diff"/"Tải log đầy đủ" là button hay link | chấp nhận cả hai (`or`) | — |
| G9 | Mã lỗi khi chọn `use_current` cho decision `autofix_*` | chỉ kiểm ≥ 400 + run giữ `needs_decision` | backend-lead |
| G10 | `PAYLOAD_TOO_LARGE` không nằm trong `HUB_INTERNAL_ERRORS` | kiểm `error.code` trong thân 413 | backend-lead |
| G11 | (đã làm R2b, §9) Runtime đầu-cuối (`AutofixHost` + `RUNTIME_SANDBOX=fake` + `#fake:ws_*` + mock Hub) chưa có chữ ký (`host.py`, `fake_oci.py`, `check.py`, `workspace.py`) | KHÔNG khoá ở T3; phủ bằng P/S + A (Hub) + UAT D2. **Đề xuất**: qc viết bổ sung `pc/autofix_int_test.py` sau R2 khi có chữ ký (mở khoá có chủ đích, ghi §9) | backend-lead (khai báo chữ ký `check.run_checks`, `workspace.prepare`) · qc |
| G12 | (đã làm R2b AF09) PC-R04 trần `RUNTIME_AUTOFIX_MAX_MB/_FILES` phía Runtime (snapshot `caps=autofix`) | chỉ kiểm phía Hub (`caps`, F01); Runtime theo G11 | backend-lead |
| G13 | E2E không có persona tenant beta | cách ly tenant ở int T01; e2e E09 dùng người lạ cùng tenant (S) | — |
| G14 | `test:pc:sandbox` chưa có script | `uv run pytest tests/acceptance/pc/sandbox_check.py` trên Linux có CLI + ảnh (R4) | backend-lead (R4) |
| G15 | AUTOFIX_EXECUTOR không e2e (cần stage nhóm trên canvas) | phủ R I02 + A V06 | — |

## 7. Lệnh xong mốc — `bun run done:pc` (D1, mẫu `done-k1`)
| # | Bước | Lệnh |
|---|---|---|
| 1 | typecheck | `bun run typecheck` |
| 2 | R + unit | `bun test packages/contracts apps/hub-api/src/modules/processes tests/acceptance/P-c/rules` |
| 3 | A (từng file) + hồi quy P-a/P-b/P-b2/K1 | `bun --env-file=.env.test-pc_qc.local --config=bunfig.int.toml test --timeout 60000 tests/acceptance/P-c/<file>.int.test.ts` · `bun run test:int` |
| 4 | P | `bun apps/agent-runtime/scripts/run.ts "uv run pytest tests/acceptance/pc -q"` + int đầu-cuối `… "uv run pytest -m int tests/acceptance/pc/autofix_int_test.py -q"` (DB/Redis Runtime `ai_system_h1_test`) |
| 5 | S | `bun run test:pc:sandbox` (Linux + Docker/Podman + ảnh) |
| 6 | E | `bunx playwright test -c e2e/P-c/playwright.pc.config.ts --reporter=line` (cần `bun run db:test:create pc_e2e`) |
| 7 | khoá + vết | `bun run test:lock:verify && bun run trace --check` |

## 8. Đỏ đúng lý do · chạy 2026-10-13 (main `8a90aaea`, chưa B1; DB `ai_system_pc_qc_test`, e2e `ai_system_pc_e2e_test`)
| Nhóm | File | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|---|
| R | 3 file rules | 31 | 31 đỏ | `qc: <hàm> chưa có (plan §4)` / `qc: <Schema> chưa có (plan §3)`; C03–C05, C08–C09, C13–C14, C16, I06 đỏ ở `expect` (trường/mã chưa có) |
| A | db, defs, report, flow, tenant, kh | 44 | 44 đỏ | `needPc`: `{migration0031:false}`; 0 `PostgresError`/`TypeError` trong `beforeAll` (chạy từng file) |
| P | `test_pc_rules.py` | 42 | 42 đỏ | `ModuleNotFoundError: agent_runtime.autofix` |
| P | `test_pc_hook.py` | 9 | 7 đỏ · 2 xanh | P20 (6) + P23: `(True, None) != (False, 'workspace')` (hook chưa có nhãn workspace). **Xanh sẵn (đối chứng, đúng):** P21 Write/Edit (tool không cấp) + P22 `sources/` đọc được |
| S | `sandbox_check.py` | 8 | 8 lỗi fixture | `qc: cần CLI docker (RUNTIME_SANDBOX)` — container dev `uv` không có CLI; trên máy có Docker sẽ đỏ ở `ModuleNotFoundError` tới R1 |
| E | `e2e/P-c` (stack P-b2 lên đủ, seed + đăng nhập OK) | 14 | 14 đỏ | E01/E02b: panel mở, `switch "Tự sửa mã"` chưa có; E02: `alert` AUTOFIX_* chưa có; E03/E04/E07/E-E10–E12: `region "Kết quả tự sửa mã"`/`"Autofix result"` chưa có; E05/E06/E08: lý do giữ `team_calls` (0031 vắng ⇒ `setDecision` không đổi) ⇒ heading/nhóm chưa có; E09: `pcReady()` false; E13: thẻ `article` "Tự sửa mã" chưa có |

`tsc -p tsconfig.tests.json` sạch phần P-c; `biome check` sạch; `ruff check` + `ruff format --check` + `pyright` (tests/acceptance/pc) sạch.

## 9. Khoá
Khoá lần 1: 2026-10-13 (T3) — `tests/acceptance/P-c/**`, `apps/agent-runtime/tests/acceptance/pc/**`, `e2e/P-c/**`. `bun run test:lock:write` + `bun run test:lock:verify` OK; `bun run trace --check` OK.

Khoá lần 2: 2026-10-14 (T3b, mở khoá có chủ đích theo readiness lần 2). Đổi H06 ⇒ `autofixDecisionOptions` (autofix_* ⇒ `[add_attempt, cancel]`; khác ⇒ `[...DECISION_OPTIONS]` theo yêu cầu điều phối); thêm H06b (core `decisionOptionsFor(hasOutput, autofix_*)`, cả `hasOutput=true`), H10 (`basePatchOf`), A-E10 (PC-R16: chèn 52×20 MiB `upload` text/plain cho acme ⇒ vượt 1 GiB; report ⇒ 201; tổng `size` sau = trước + diff + log; dọn hàng chèn).
Đỏ đúng lý do T3b: H06/H10 `qc: <hàm> chưa có (plan §4)`; H06b đỏ ở `expect` (core chưa trả sớm); A-E10 đỏ ở `needPc` (0031 vắng; SQL chèn đã chạy thử trong tx rollback trên DB qc: tổng 1,090,519,040 B).

Khoá lần 3: 2026-10-14 — phân xử Tranh chấp test B4: test sai (so `name` trên hàng SQL thô; cột DB là `filename`, `name` chỉ có ở view `AutofixFileSchema`). Sửa A-E08 sang `filename`; lock ghi lại.

Khoá lần 4: 2026-10-14 (R2b, mở khoá có chủ đích theo tasks R2b / G11–G12) — thêm `apps/agent-runtime/tests/acceptance/pc/autofix_int_test.py` + helper `pc/_af.py` (không sửa file khoá cũ). Runtime đầu-cuối, `pytestmark=int` (DB/Redis Runtime như `outputs_int_test.py`; chạy `uv run pytest -m int …`): Runtime thật + `RUNTIME_SANDBOX=fake` + `RUNTIME_ENV=test` (`APP_ENV=test` sẵn) + nguồn `local_path` (`HUB_SOURCE_LOCAL_ROOTS`, `RUNTIME_SOURCE_CACHE_DIR`, pin `snapshot_id` cố định — snapshot dựng lười PB-R16) + mock Hub `AfHub` (`POST /internal/jobs/:id/autofix-result` xác thực token bằng DB ⇒ 201 chứng minh báo cáo TRƯỚC khi job rời `running`; GET attachments cho `base_patch`).
| Ca | Kỳ vọng |
|---|---|
| AF01 ok | `install_cmd` `touch .installed` → `ws_edit` sửa `a-b`→`a+b` → test xanh ⇒ `ok`, diff có `src/sum.js` ±1, KHÔNG có `.installed` (base sau pha cài), stats (1,1,1) + `bytes`=len(diff), test exit 0, `commands ∋ edit`, job `succeeded`, repo thật không đổi, `work/<job>` bị dọn |
| AF02 no_changes | `ws_exec=ls`, test `true` ⇒ `no_changes`, diff/stats null, failures [], commands exec `("ls",0)` |
| AF03 paths | ghi `docs/note.md` ngoài `src/**` ⇒ `check_failed` paths `docs/note.md`, test null |
| AF04 secrets | `ws_secret=src/cfg.js` ⇒ secrets path+line, rule 1..64, test null; `AKIA[0-9A-Z]{16}` không có trong báo cáo/log/hàng job; token job không trong log |
| AF05 tests | file mới hợp lệ + test `echo AKIA…; sh test.sh` exit 1 ⇒ tests, `log_tail` có `1 fail: sum` + `[REDACTED]`, không lộ khoá |
| AF06 install | `install_cmd` exit 7 ⇒ install, test null |
| AF07 apply_patch | vòng 2 `base_patch` lệch (đã tải qua GET) ⇒ apply_patch, test null; làm lại vòng 3 `base_patch=null` cùng nhánh ⇒ `ok`, diff 1 file |
| AF08 cộng dồn | `base_patch` thêm `src/extra.js` + agent sửa ⇒ `ok`, diff 2 file |
| AF09 PC-R04 | `RUNTIME_AUTOFIX_MAX_FILES=2` (repo 4 file) / `_MAX_MB=1` (file 1,5 MiB) ⇒ `check_failed{size}` (kể cả khi trần chặn ở snapshot `caps=autofix`), test null, job không `container` |
| AF10 upstream | Hub 503 mọi lần ⇒ đúng 4 POST (1 + 3 retry) rồi job `failed`/`error_reason=upstream` |
| AF11 container | `RUNTIME_SANDBOX=off` ⇒ job vẫn được nhận, `failed`/`error_reason=container`, không báo cáo `ok`, repo không đổi |

**Chữ ký/hành vi giả định cho R3** (theo plan-runtime §5.1, §5.5–5.8 + R2 e0b5d130): (1) module `agent_runtime.autofix.host` có `AutofixHost`; module `agent_runtime.autofix.ws_tools` tồn tại (`need_r3()` — đỏ tới R3). (2) `dispatch`: job `agent.cli` có `payload.autofix` ⇒ `AutofixHost`; sandbox `None` (off/tự kiểm hỏng) ⇒ vẫn claim, kết thúc `failed` `error_reason="container"` (không treo `queued`). (3) `fake-cli`: `#fake:ws_write=<path>|<base64>`, `#fake:ws_edit=<path>|<old>|<new>`, `#fake:ws_exec=<cmd>`, `#fake:ws_secret=<path>` (ghi dòng khớp `AKIA[0-9A-Z]{16}`); giá trị là `\S+` (cú pháp `#fake:` sẵn có, không khoảng trắng); mỗi lệnh ghi một phần tử `commands` (`edit`/`write`/`exec` + `exit_code` cho exec, `arg` của exec = lệnh nguyên văn). (4) Thứ tự: snapshot `caps=autofix` → `copy_workspace` → pha cài (`install_cmd`, lỗi ⇒ `install`) → `init_git` (+ tải `base_patch` bằng token job, lỗi áp ⇒ `apply_patch`) → agent → `check.run_checks` → test (chỉ khi các nhóm trước qua) → `report.build_report` → `report.post_result` → kết thúc job → dọn `work/<job>`. (5) Trần PC-R04 vượt (ở `snapshot_for` hay `prepare`) ⇒ BÁO CÁO `check_failed{size}` (không chỉ lỗi job). (6) Trượt trước agent (install/apply_patch/size) vẫn POST báo cáo, `test=null`, `diff=null`, job không `container`/`upstream`. (7) `post_result` False ⇒ `failed` `error_reason="upstream"`. (8) `ok`/`no_changes`/`check_failed` ⇒ job kết thúc như cũ (`ok`/`no_changes` = `succeeded`).
Đỏ đúng lý do R2b (main `50030cb6`): 12/12 đỏ `ModuleNotFoundError: agent_runtime.autofix.host` (`need_r3`). Chạy thử tạm bỏ `need_r3` (đã khôi phục): 12/12 đỏ ở `expect` (không báo cáo / không GET `base_patch` / `succeeded` thay vì `container`), mọi job được claim và kết thúc — 0 `PostgresError`/`TypeError` ở dựng dữ liệu. `ruff check` + `ruff format --check` + `pyright` (tests/acceptance/pc) sạch. `bun run test:lock:write` + `test:lock:verify` OK; `bun run trace --check` OK.

## 10. Kết quả `bun run done:pc` lần đầu · 2026-10-14 (backend-lead D1)

Chạy: `bun run done:pc` (bước 1–2) → `--from=3` (int, 63,8 phút) → `--from=5` → `--from=9`. DB int `pc_done`, e2e `pc_e2e`, pytest `ai_system_h1_test`.

| # | Bước | Kết quả |
|---|---|---|
| 1 | typecheck | xanh |
| 2 | bun test | 3664 pass · 14 skip · 6 đỏ (xem dưới) |
| 3 | `db:test:create pc_done` | xanh |
| 4 | test:int | 3156 pass · 3 skip · 6 đỏ (xem dưới) |
| 5 | Runtime pytest `pc` (51) + `-m int autofix_int_test.py` (12) | xanh |
| 6 | `test:pc:sandbox` | xanh (8 ca, Docker) |
| 7 | `db:test:create pc_e2e` | xanh |
| 8 | e2e P-c (14 ca) | 13 pass · 1 đỏ (E03) |
| 9 | `trace --check` | xanh |
| 10 | `test:lock:verify` | xanh |

**Đỏ bước 2 (bun test)**

| Ca | Loại | Ghi chú |
|---|---|---|
| H2c R48 (`JOB_FAIL_REASONS.at(-1)` = `container`, test chờ `attachment`) · H2c R49 (`SourceResolveJob.git.json` không có schema) | đã biết (R49 contracts-h2c) | test H2c cũ lệch contract P-c; cần qc cập nhật |
| P-b2 C-02 · P-a R-K01 (`DECISION_REASONS` dài 18, test chờ 16) · P-b2 C-07 (`PROCESS_DEF_RULES` +3 `AUTOFIX_*`) | mới do P-c (test khoá cũ chưa theo contract P-c) | contract đúng spec P-c; **qc** cập nhật 3 test (không sửa ở đây) |
| H2a `requeue.stack` S03 | flake | chạy lại file: xanh |

**Đỏ bước 4 (int)**

| Ca | Loại | Ghi chú |
|---|---|---|
| SC-2 hoá đơn ×3 (`P-a/scenario/hoa-don.int`) | mới do P-c — **đã sửa** | `seed.processes.ts` (HUB-FR-130, commit 5676e7b0) ghi `sources` bằng `JSON.stringify` + `::jsonb` ⇒ jsonb là chuỗi `"[]"` ⇒ `keys.map is not a function` (500). Sửa: `tx.json(t.sources)`. Chạy lại: 3/3 xanh. Bản chép tenant dev đã có từ trước lần seed lỗi giữ `sources` hỏng tới khi xoá/chép lại (`UPDATE hub.process_defs SET sources='[]' WHERE jsonb_typeof(sources)='string'`) |
| `hub-rls.int` ×2 (WRK-FR-24, RLS đúng 5 bảng) | đã biết (TD #148) | danh sách bảng RLS cũ |
| M3 `concurrency` C7 (<5 s: 5,15 s) | flake (tải) | chạy lại file: 13/13 xanh |

**Đỏ bước 8 (e2e)** — `chat/diff.pc.ts:44` **E03** (diff đầy đủ + Tải .diff + Đạt): mọi assertion UI qua; lỗi `apiResponse.json: Response has been disposed` tại `e2e/P-c/_pc-support.ts:113` (`patchStage`: `route.fetch()` còn bay khi `u.close()` đóng context sau POST decision ⇒ rejection chưa bắt ⇒ ca đỏ; lặp lại 2/2). Nghi **test support** (thiếu try/catch quanh `route.fetch/json`), không phải FE/Hub. Việc cho **qc**: bọc handler trong `try { … } catch { return }` hoặc `await page.unrouteAll({behavior:'ignoreErrors'})` trước `close`.

