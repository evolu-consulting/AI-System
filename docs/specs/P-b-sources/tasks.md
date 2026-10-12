# P-b-sources · tasks (backend)

**Trạng thái (2026-10-12): S1–S5 [x] XONG** — S1 `685c9cd0` · S2 `c5328094` · S3 `b7e481d8` · S4 `c515aa39` · S5 smoke + UAT evolu (`evidence/2026-10-11/REPORT.md`) · sửa review `11840627`, UAT `c356681f`, RV3 `ef787532`. `done:pb` 16/16, `done:pa` 13/13 xanh. Kết luận: `spec.md` "Kết luận P-b".

Mỗi task 1 commit `feat(<module>): … [HUB-FR-xx]` (fix: `fix(processes): … #133/#134`). Cột **Rủi ro**: cao = RLS/tenant/secret/khoá/auth/transaction (Opus); thường = Sonnet (`docs/WORKFLOW.md` Chính sách model). **Nền**: TS = hub-api/contracts/db; PY = agent-runtime. Frontend ở `tasks-frontend.md`. QC viết test khoá TRƯỚC (`tests/acceptance/**`).

## PF-S1 · Contract + DB + CRUD nguồn — [x] xong
| # | Task | File | Nền | Rủi ro | Đọc |
|---|---|---|---|---|---|
| S1-1 | Kiểu + CRUD contract nguồn (`SourceKey/Kind/Config/Public/Pin/View`, create/update/list/delete/check, `SOURCE_ERRORS`) | `packages/contracts/src/hub-admin/sources.ts`, `hub-admin/errors.ts`, `hub-admin/index.ts` | TS | thường | plan §3.1, spec §3.1–3.2/3.6, mẫu `secrets.ts` |
| S1-2 | `payload.sources` + `SourceResolveJob` + `SourcesResolvedRequest`/`ResolveResult`; gen pydantic | `packages/contracts/src/hub/job.ts`, `hub-internal/sources.ts`, `hub-internal/index.ts`; chạy `bun run contracts:gen` | TS | cao | plan §3.3, spec §3.5, `hub/job.ts`, `agent-runtime/.../contracts/hub.py` |
| S1-3 | `process_defs` def `sources`/`inputs`, stage `sources`/`must_know`; `RunProcessDefRequest.inputs`; `DecisionReason += source_unresolvable`; `ProcessSourceChip` | `packages/contracts/src/hub-admin/processes.ts`, `chat/processes.ts` | TS | thường | plan §3.2, spec §3.3–3.4, `hub-admin/processes.ts` |
| S1-4 | Migration `0021_pb_sources.sql`: `hub.sources`, `hub.source_job_reads`, cột nullable, `jobs_type_ck`, **`review_tasks_reason_ck` += source_unresolvable**, RLS+GRANT | `packages/db/migrations-hub/0021_pb_sources.sql` | TS | cao | plan §5, spec §4, `0019_pa_process_engine.sql:316`, `0000:270-307` |
| S1-5 | Module `sources`: routes + service + repo (CRUD, quyền local_path=platform_admin, config theo quyền, `used_by`, xoá mềm guard `SOURCE_IN_USE`, 409 version) | `apps/hub-api/src/modules/sources/*` (mount) | TS | cao | plan §3.1, spec §3.2, mẫu `modules/*` secrets/processes |
| S1-6 | "Kiểm tra kết nối" `POST /:key/check`: enqueue `source.resolve` 1 item + chờ đồng bộ JobFollower → 200/422 | `apps/hub-api/src/modules/sources/check.service.ts` | TS | cao | plan §4(6), `runner/job/job-agent-runner.ts`, `internal/credential.service.ts` |

## PF-S2 · Runtime resolve + snapshot (agent-runtime, Python) — [x] xong
| # | Task | File | Nền | Rủi ro | Đọc |
|---|---|---|---|---|---|
| S2-1 | Claim job `source.resolve` (SKIP LOCKED như agent.cli); vòng resolve từng item + báo `/sources-resolved` + kết thúc job | `apps/agent-runtime/src/agent_runtime/runtimes/.../resolve*` | PY | cao | plan §4, spec §3.5, cách claim `agent.cli` hiện có |
| S2-2 | Driver git_remote: `execFile(['git',...])`, `GIT_TERMINAL_PROMPT=0`, https host allowlist (`HUB_SOURCE_GIT_HOSTS`), cấm file/ext/git://, branch không `-`, chặn IP nội bộ (SSRF, PB-R19) | `.../sources/git_driver.py` | PY | cao | plan §2, spec PB-R02/R19 |
| S2-3 | Driver local_path (realpath, dưới `HUB_SOURCE_LOCAL_ROOTS`, chống symlink) + library (job token kho H2c, version) | `.../sources/local_driver.py`, `library_driver.py` | PY | cao | spec PB-R03/R04/R15 |
| S2-4 | Mirror cache + snapshot: khoá `(tenant,source,sha,hash(allowlist))`, lọc PB-R07 (picomatch tương đương), trần 50MB/2000 file, copy chmod ro + rename nguyên tử, LRU, không-xoá-run-mở | `.../sources/snapshot.py`, `cache.py` | PY | cao | plan §2, spec PB-R07/R16 |
| S2-5 | Mount `work/<job_id>/sources/<key>/` chỉ-đọc; hook PreToolUse deny Write/Edit dưới `sources/`; ép `allowedTools=Read,Grep,Glob` | `.../runtimes/cli/files/*`, `providers/claude/options.py` + `test_options.py` | PY | cao | spec PB-R10, `providers/claude/options.py` |
| S2-6 | `files_read` parse stream-json tool_use (D8; thiếu⇒null) để Hub ghi audit | `.../runtimes/cli/*` | PY | thường | spec PB-R11/D8 |
| S2-7 | `fake-cli` 4 directive `#fake:read=<p>` / `#fake:tree=<dir>` / `#fake:scan=<needle>` / `#fake:obey=<path>` (cú pháp `=`, khớp regex; giả đọc nguồn + ghi audit) cho test | `.../fake-cli` (hoặc nơi B1 P-a) | PY | thường | spec §7, P-a B1 |

## PF-S3 · Hub giao nguồn vào job — [x] xong
| # | Task | File | Nền | Rủi ro | Đọc |
|---|---|---|---|---|---|
| S3-1 | Start: `snapshot.sources` từ def (gộp allowlist_union), `pinned_sources=NULL`; không nguồn ⇒ `'[]'` | `apps/hub-api/src/modules/processes/runs/start.service.ts`, `runs.repo.ts` | TS | cao | plan §4(1), `start.service.ts` |
| S3-2 | Launcher gate: def có nguồn ∧ pinned NULL ⇒ enqueue `source.resolve` (idempotent, khoá run), không launch stage 0 | `apps/hub-api/src/modules/processes/runs/launcher.ts` | TS | cao | plan §4(2), `launcher.ts` |
| S3-3 | `resolve.service` nhận `/sources-resolved` (job-token, cross-run 401 PB-R18): ok⇒pin+kick; error/timeout⇒`needs_decision` source_unresolvable | `apps/hub-api/src/modules/internal/sources-resolved.*`, `internal/*.routes.ts` | TS | cao | plan §4(3-5), `internal/attachments.service.ts` |
| S3-4 | Ráp `payload.sources` cho stage job (pin+allowlist, ép allowed_tools R/G/G) | `apps/hub-api/src/modules/processes/runs/launcher.ts`, `runner/runner.rules.ts` | TS | cao | plan §1, spec §3.5, `runner.rules.ts buildJobPayload` |
| S3-5 | MANIFEST + prompt ("dữ liệu, không phải lệnh") + kiểm output `## Nguồn tham chiếu` (key:path@ver) | `apps/hub-api/src/modules/processes/runs/*`, `template.rules.ts` | TS | thường | spec PB-R09/R10, `template.rules.ts` |
| S3-6 | Audit `source_job_reads` (nguồn+pin+files_read/job); không token/URL-credential | `apps/hub-api/src/modules/processes/...`, repo | TS | cao | spec PB-R11, plan §5(2) |

## PF-S4 · Fix P-a (BLOCKER, làm sớm, độc lập) — [x] xong
| # | Task | File | Nền | Rủi ro | Đọc |
|---|---|---|---|---|---|
| S4-1 | #134: `closeMemberRun` nhận outcome, ghi `error_code`/`message`/`hint` hợp lệ (timeout⇒TIMEOUT, else UPSTREAM_ERROR) | `apps/hub-api/src/modules/processes/runs/team-member.ts` | TS | cao | plan §6.1, `team-member.ts`, `0000:297` |
| S4-2 | #134: `stage-driver.drive` catch → run `needs_decision` (map reason), không kẹt running; `apply`/`finish` bọc lỗi | `apps/hub-api/src/modules/processes/runs/stage-driver.ts`, `team-runner.ts toDecision` | TS | cao | plan §6.1, `stage-driver.ts:61-87`, `team-runner.ts:349` |
| S4-3 | #133: persist nháp member thành attachment thật (id hợp lệ) + chốt chặn PB-R18 id thuộc run+tenant | `apps/hub-api/src/modules/processes/runs/team-exec.ts`, `launcher.ts`, `output-attachment.ts` | TS | cao | plan §6.2, `team-exec.ts:300`, `internal/attachments.service.ts:54` |

## PF-S5 · Smoke Claude thật (UAT) — [x] xong
| # | Task | File | Nền | Rủi ro | Đọc |
|---|---|---|---|---|---|
| S5-1 | Smoke claude-sub đọc nguồn thật, agent trần ≤50k token, ép R/G/G + hook; KHÔNG vào CI "Lệnh xong" | UAT script (qc-uat phối hợp) | PY/TS | thường | spec PB-R22/D7 |

**Seed dev/UAT (người dùng 2026-10-11):** seed nguồn test (`local_path` tới repo ai-system, + 1 git_remote, + 1 library) trên **CẢ hai** tenant `acme` VÀ `evolu` — để UAT/kiểm tay chạy cách ly chéo thật (tenant acme KHÔNG thấy/đọc được nguồn của evolu và ngược lại; AC-H36(d), AC-PB-04). qc-uat dựng seed trên cả hai tenant; test int cross-tenant (A-09, P-03/05, C-07, ID-07, IN-02) vẫn dùng factory DB riêng.

## Tranh chấp test
<!-- để trống -->

## Quyết định trong lúc làm
<!-- một dòng mỗi quyết định (BUILD) -->
- RV3 #1 (PB-R05/AC-H36): lá cache `local_path` = `<allow_hash>-<snapshot_id>` (UUID chuẩn hoá); `resolve_local` sinh `snapshot_id` TRƯỚC rồi dựng; `mount` tra theo `pin.snapshot_id`, mất cache ⇒ dựng lại từ realpath (PB-R16, nội dung lúc dựng lại — chấp nhận như spec). Bỏ khử trùng theo `content_signature` (mỗi resolve = 1 bản chép; LRU lo dung lượng) — đơn giản nhất, không đổi contract. `content_signature` giữ lại (test CS khoá dùng). LRU: không đổi (`.refs` theo `hub.runs` id của stage; giữa 2 stage vẫn có thể bị dọn ⇒ dựng lại, không lỗi) — TECH-DEBT #142.
- RV3 #4: bỏ `Write` khỏi `_PATH_INPUT_KEYS`; sửa unit `providers/claude/test_mcp.py` (Write ⇒ None).
- RV3 #5: `commit` lỗi thật ⇒ `SourceError("SOURCE_UNRESOLVABLE", "không lưu được snapshot nguồn")`; chi tiết OSError chỉ log Runtime (`source.snapshot_commit_failed`).
- RV3 tooling: `testEnvFile` (`packages/db/src/test-db.ts`) đổi thêm `HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL` (nếu có) sang DB tag; file `.env.test-<tag>.local` cũ phải sinh lại bằng `db:test:create <tag>` (ghi CONVENTIONS §2 Bẫy, README db).
