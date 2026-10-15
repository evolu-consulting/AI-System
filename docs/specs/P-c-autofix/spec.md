---
id: P-c-autofix
title: P-c · Luồng tự-sửa (autonomous fix) — workspace ghi-được + exec trong container + diff (P-c1) · PR (P-c2)
milestone: P-c (sau H4b-2)
status: done             # P-c1 xong 2026-10-14: done:pc, review + security 3 vòng, UAT evolu vòng 2 Đạt; P-c2 chưa làm
requirements: [HUB-FR-119, HUB-FR-126, HUB-FR-127, HUB-FR-128, HUB-FR-129, HUB-FR-130, WRK-FR-28, WRK-FR-29, HUB-BR-32, HUB-BR-33, HUB-BR-34, WRK-BR-08]
design:
  - docs/CHANGE-REQUESTS.md#CR-061 (Intake Đầy đủ chốt 2026-10-12), #CR-065 (sửa đổi: nhánh, kiểm diff, apply_mode)
  - docs/design/agent-hub/ba-agent-hub.md §6.10 (HUB-FR-119, 126…130), §7 HUB-BR-32…34
  - docs/design/worker/ba-worker.md (WRK-FR-28, WRK-FR-29, WRK-BR-08, WRK-NFR-02)
  - docs/adr/0011-write-exec-sandbox.md (Accepted 2026-10-13 — Q4/Q6/Q7)
  - docs/specs/P-b-sources/spec.md (nguồn chỉ-đọc, snapshot PB-R07 — tái dùng, không đổi hành vi)
owner: backend-lead + frontend-lead
---

# P-c · Luồng tự-sửa

> Chi tiết contract/DDL/luồng Runtime: [`plan.md`](plan.md). Lý do phạm vi + so sánh phương án: [`spec-decisions.md`](spec-decisions.md).

## 1. Phạm vi
**Bối cảnh:** `fixbug-evolu` (P-b) chỉ tư vấn trên nguồn chỉ-đọc. P-c cho agent **tự áp bản sửa**: đọc repo → sửa file → chạy test → nhánh/diff → (sau duyệt) PR. Là HUB-FR-119 (CR-061).

**Chia pha (CR-061 "phần diff-only làm trước phần PR"; tách mốc theo Q1, người dùng duyệt 2026-10-13):**
| Pha | Làm | Mã |
|---|---|---|
| **P-c1 (mốc này)** | Stage có cấu hình `autofix` (một nguồn); workspace ghi-được = bản sao snapshot đã lọc tại commit ghim; container mỗi job `--network none`; 4 tool `ws_*` chạy trong container; Runtime commit nhánh `ai/<run>/<stage>` + tính diff + **kiểm diff bằng chương trình** (đường dẫn, kích thước, bí mật, chạy lại test); Hub lưu diff + log + audit; gate duyệt hiển thị diff; Chưa đạt ⇒ làm lại cộng dồn trên cùng nhánh; mẫu `fixbug-apply` | HUB-FR-119 (một phần), 126, 127, 128 (trừ rebase), 130 (trừ `apply_mode`), WRK-FR-28, 29 (trừ rebase), HUB-BR-32, 33, WRK-BR-08 |
| P-c2 (mốc sau) | Stage "Áp" `real_action`: push nhánh + mở PR qua API provider bằng `source_credential`; `apply_mode` theo nguồn (`pr`/`auto_merge`/`branch_only`) + UI màn Nguồn; rebase khi `main` đổi; clone repo riêng | HUB-FR-129, HUB-BR-34, phần còn lại HUB-FR-128/130, WRK-FR-29 |

**Không làm (P-c1):** ghi ngược vào `local_path`/repo thật/host/`sources/`; push bất kỳ đâu; gọi API provider; đổi hành vi P-b (`fixbug-evolu`, stage chỉ-đọc giữ nguyên); stage tự-sửa kiểu `team`; > 1 stage tự-sửa mỗi quy trình; nhiều repo/job; allowlist lệnh (bù bằng cô lập); chọn ảnh container theo quy trình; tự rebase.

## 2. Nghiệp vụ cụ thể hoá (PC-R)
BA là nguồn sự thật (HUB-FR-126…130, HUB-BR-32…34, WRK-FR-28/29, WRK-BR-08); chỉ ghi phần BA chưa nói. Gate duyệt: HUB-FR-109 / HUB-BR-20.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PC-R01 | Stage có `autofix` ⇔ stage tự-sửa. `autofix.source_key ∈ def.sources`, nguồn loại `git_remote` hoặc `local_path` (Q3) — `library`/khác ⇒ 422 `PROCESS_REF_INVALID{ref:"source"}` | HUB-FR-126, 130 |
| PC-R02 | Luật def (422 `PROCESS_DEF_INVALID`, `rules`): executor phải `agent` (`AUTOFIX_EXECUTOR`); `after.kind="review"` (`AUTOFIX_REVIEW` — luôn qua người, HUB-BR-34); ≤ 1 stage `autofix`/def (`AUTOFIX_MAX`) | HUB-BR-34, CR-061 D4 |
| PC-R03 | Bật theo tenant = quy trình chỉ chạy khi `enabled` (do `tenant_admin` bật bản chép); mẫu `fixbug-apply` là template nền tảng (tắt sẵn). Người dùng chọn chế độ bằng quy trình: `!fixbug-evolu` (cố vấn) / `!fixbug-apply` (tự-áp). Không thêm công tắc tenant riêng | HUB-FR-130, D8 |
| PC-R04 | Ghim: nguồn của stage tự-sửa resolve như P-b (PB-R05) nhưng **toàn repo** (allowlist hợp = `[]`) và trần riêng `RUNTIME_AUTOFIX_MAX_MB=200` / `_MAX_FILES=20000` (sau lọc PB-R07); vượt ⇒ `SOURCE_TOO_LARGE` như P-b | HUB-FR-126, HUB-BR-27 |
| PC-R05 | Workspace = **bản sao ghi được** của snapshot đã lọc (PB-R07; không `.git`) ở `work/<job_id>/workspace/<key>/`; git riêng `work/<job_id>/git/` ngoài mount; commit `base` (sau pha cài nếu có), nhánh `ai/<process_run_id>/<stage_key>` | HUB-FR-126, 128, E1 |
| PC-R06 | Thực thi: chỉ trong container (ADR-0011 #1–#5); không container ⇒ job lỗi `container` ⇒ "Cần người quyết" `sandbox_unavailable`. Không dùng hook thay container | HUB-BR-33, WRK-BR-08 |
| PC-R07 | Công cụ: Hub ép `allowed_tools` = `[Read,Grep,Glob]` nếu stage có nguồn chỉ-đọc, ngược lại `[]`; Runtime thêm `ws_exec/ws_read/ws_write/ws_edit` (trong container). Hook chặn tool gốc dưới `workspace/`, `git/` | HUB-BR-31, 33; ADR-0011 |
| PC-R08 | Kiểm diff (Runtime, không LLM, theo thứ tự, dừng ở nhóm trượt đầu): (1) **đường dẫn** — mọi file đổi khớp `write_allowlist` (rỗng = mọi đường dẫn) VÀ không thuộc danh sách cấm cứng (basename PB-R07; `.github/workflows/**`, `.gitlab-ci.yml` trừ khi allowlist ghi rõ); (2) **kích thước** — diff ≤ 2 MiB, ≤ 300 file, workspace ≤ 4 GiB; (3) **bí mật** — dòng **thêm** khớp mẫu (plan §5.4) hoặc thêm file tên cấm; (4) **test** — `test_cmd` trong container mới, exit 0. Trượt ⇒ `status=check_failed`, **không** lưu diff | WRK-FR-29, E2 |
| PC-R09 | Diff rỗng sau kiểm ⇒ `status=no_changes` (không file diff); vẫn qua gate như stage thường (người quyết Đạt/Chưa đạt) | HUB-FR-128 |
| PC-R10 | Kết quả job, xét **theo thứ tự**: (a) vượt ngân sách token P-a ⇒ `stage_tokens`/`run_tokens` như cũ (F12); (b) job lỗi `container` ⇒ `sandbox_unavailable`; (c) mọi lỗi job khác (kể cả `timeout`) / thiếu báo cáo / `check_failed` ⇒ `autofix_check_failed`; (d) `ok`/`no_changes` ⇒ gate. Lựa chọn của `autofix_*` **chỉ** `add_attempt` / `cancel`; `use_current` ⇒ 409 `PROCESS_RUN_STATE`, run giữ `needs_decision`. Người quyết `autofix_*` = người bắt đầu hoặc admin (`canDecide` sẵn có; KHÔNG vào `REVIEW_GROUP_REASONS`). Thêm lượt ⇒ prompt kèm tóm tắt lỗi kiểm (không giá trị bí mật) | HUB-FR-115, WRK-FR-29 |
| PC-R11 | Chưa đạt ở gate ⇒ làm lại stage: job mới nhận `base_patch` = diff `ok` mới nhất của stage_run; Runtime áp lên commit ghim (commit "vòng 1…k-1"), agent sửa tiếp; diff mới = **cộng dồn** so commit ghim, cùng tên nhánh | E3, HUB-FR-128 |
| PC-R12 | Audit mỗi job tự-sửa = một hàng `hub.autofix_results` (nguồn, ghim, nhánh, head, trạng thái, lỗi kiểm, thống kê, exit/thời gian test, danh sách lệnh ≤ 300). Không giá trị bí mật; log test che bằng `[REDACTED]` | HUB-FR-130 |
| PC-R13 | Ngân sách token stage tự-sửa: mặc định 200k nếu `token_budget` null (như PB-R12) | HUB-FR-116 |
| PC-R14 | Cách ly tenant: nguồn/def/kết quả theo `tenant_id` (RLS); id kết quả/diff của run khác ⇒ 404 (HUB-BR-14); token job chỉ báo được cho chính job. Đọc file diff/log qua `GET /attachments/:id/content`: file là `diff_attachment_id`/`test_log_attachment_id` của một `autofix_results` ⇒ đọc được khi `runAccess(viewer, run) ≠ null` (gồm `task`); `platform_admin` truyền `tenant_id` như `/process-runs/:id/outputs`; file khác giữ luật cũ (X2b2-R05/R06). Người dùng chốt 2026-10-13 | HUB-BR-14, 25, 32 |
| PC-R15 | Pha cài: `install_cmd` (không null) chạy ở container chuẩn bị **có mạng** (Q2; chạy cả script của repo — §6), ≤ 600 s, không secret, trước agent; lỗi ⇒ `check_failed{check:"install"}` | ADR-0011 #2 |
| PC-R16 | Không gọi kiểm hạn mức khi ghi diff/log tự-sửa (`origin='output'`); hàm `quotaUsed` giữ nguyên; dung lượng đã dùng tăng đúng diff + log | HUB-FR-130 |

## 3. Contract (backend-lead)
<!-- Bảng trường đầy đủ: plan.md §3. z.strictObject khắp; không đổi trường cũ. -->
| Nhóm | Tóm tắt (chi tiết plan.md §3) |
|---|---|
| Stage def (`hub-admin/processes.ts`) | `ProcessStageDef.autofix: StageAutofix \| null` (default `null`; snapshot cũ vắng = null). `StageAutofix = {source_key, install_cmd: string 1..1000 \| null, test_cmd: string 1..1000, write_allowlist: Glob[] ≤ 20 (default [])}`. `PROCESS_DEF_RULES += AUTOFIX_EXECUTOR, AUTOFIX_REVIEW, AUTOFIX_MAX` (hàm thuần `autofixStageIssues` trong `process-steps.ts`, FE dùng chung) |
| Job (`hub/job.ts`) | `AgentCliJob.autofix?: JobAutofix = {source: JobSource (allowlist [])...; install_cmd; test_cmd; write_allowlist; branch; round ≥1; base_patch: JobAttachment \| null}` — vắng = job thường. `JOB_FAIL_REASONS += "container"` |
| Kênh báo (`hub-internal/autofix.ts`) | `POST /internal/jobs/:job_id/autofix-result` (Bearer token job) body `AutofixReport{status ok\|no_changes\|check_failed, branch, base_sha, head_sha, diff ≤ 2 MiB \| null, diff_stats, test, failures ≤ 50, commands ≤ 300}` → 201 `{id}` · 401 `UNAUTHORIZED` (token sai/job khác) · 409 `AUTOFIX_NOT_EXPECTED` (job không có `autofix` hoặc không `running`) · 409 `AUTOFIX_RESULT_EXISTS` · 413 `PAYLOAD_TOO_LARGE` · 400 `VALIDATION_ERROR`. Bất biến: `diff≠null ⇔ status=ok` |
| Xem run (`chat/processes-entities.ts`) | Stage view thêm `autofix?: AutofixStageView = {source_key, pin_sha: string \| null, branch, round, status, diff_stats, diff_file: AutofixFile \| null, test_log_file: AutofixFile \| null, test: {exit_code, duration_ms} \| null, failures: AutofixFailure[], created_at}` (kết quả mới nhất của stage). `AutofixFileSchema = z.strictObject({id: uuid, name: string, mime: string, size: int ≥0})` (chat contracts, mới) |
| Tải diff/log | `GET /attachments/:id/content` sẵn có (+ `?tenant_id=` cho `platform_admin`); quyền đọc theo PC-R14 (`findReadableAttachment` mở rộng, plan §6.6). Không endpoint mới |
| Quyết định | `DECISION_REASONS += "autofix_check_failed", "sandbox_unavailable"` (cuối mảng). Lựa chọn + người quyết + `use_current` ⇒ 409 `PROCESS_RUN_STATE` theo PC-R10 |
| Mã lỗi mới | `AUTOFIX_NOT_EXPECTED` 409 · `AUTOFIX_RESULT_EXISTS` 409 (internal). Def dùng `PROCESS_DEF_INVALID`/`PROCESS_REF_INVALID` sẵn có |
| Luật thuần (QC viết test trước) | Hub `processes/runs/autofix.rules.ts`, contracts `autofixStageIssues`, Runtime `autofix/rules.py` — chữ ký plan.md §4 |

## 4. Dữ liệu (backend-lead)
<!-- DDL đầy đủ: plan.md §2. Migration 0031 viết tay idempotent như 0021/0024. -->
| Đối tượng | Tóm tắt |
|---|---|
| `hub.autofix_results` (mới, RLS "T", append-only) | `tenant_id, process_run_id, stage_run_id, job_id UNIQUE, round, source_key, pin jsonb, branch, base_sha, head_sha, status CHECK(ok\|no_changes\|check_failed), failures jsonb[], diff_stats jsonb NULL, diff_attachment_id NULL, test_log_attachment_id NULL, test_exit_code NULL, test_duration_ms NULL, commands jsonb[], created_at`; CHECK `status='ok' OR diff_attachment_id IS NULL` (chiều ngược kiểm ở service); FK `(process_run_id, tenant_id)` CASCADE; FK attachment `SET NULL`; index `(stage_run_id, created_at DESC)`. GRANT `SELECT, INSERT` cho `hub_rw` (UPDATE/DELETE ⇒ 42501); `agent_runtime` không quyền |
| CHECK nới | `review_tasks_reason_ck += autofix_check_failed, sandbox_unavailable`; `jobs_error_reason_check += container` (chỉ nới, không mất dữ liệu) |
| Stage `autofix` | Nằm trong `process_defs.stages` jsonb — KHÔNG DDL |
| Diff/log | `hub.attachments` `origin='output'`, `job_id` = job tự-sửa, `text/plain`, tên `<stage_key>-r<round>.diff.txt` / `<stage_key>-r<round>-test.log.txt` (không thêm MIME) |
| Seed | `apps/hub-api/seed/processes.yaml`: agent `fixbug-apply` + template `fixbug-apply` (1 stage tự-sửa, review) + template `fixbug-evolu` (V08; chỉ-đọc, không `autofix`) — nguyên văn plan §6.1; dev `fake-cli` directive `#fake:ws_*`; smoke `claude-sub` riêng |

## 5. UI (frontend-lead)
**Mockup duyệt 2026-10-13** (người dùng). Chi tiết màn, câu chữ VI/EN, map lỗi, nhãn e2e: [`plan-frontend.md`](plan-frontend.md).
| Artboard (`docs/design/agent-hub/canvas/`) | Nội dung | Nơi |
|---|---|---|
| `Pc-Editor.dc.html` | Khối "Tự sửa mã" trong panel stage: tắt · trống · hợp lệ · lỗi `AUTOFIX_EXECUTOR/REVIEW/MAX` · nguồn `library` · test trống · ghi chú mạng | admin-web editor |
| `Pc-Diff.dc.html` | Duyệt diff: có diff · `no_changes` · đang tải · lỗi tải | chat-web "Chờ tôi kiểm" + trang run (cả hai app) |
| `Pc-Decision.dc.html` | `autofix_check_failed` (nhóm lỗi) · `sandbox_unavailable` · dòng stage run view · thẻ thread | chat-web + admin-web |
Chốt UI: không thêm thư viện (diff = parser thuần + `<details>`); cắt hiển thị 2.000 dòng + "Tải .diff"; nhãn nhóm lỗi dịch theo `check`, `detail` nguyên văn (riêng `secrets` chỉ `path:line · quy tắc`); nút gate/decision dùng thẻ sẵn có, `options` do server (PC-R10). FE dùng `autofixStageIssues` (contract) để validate cùng luật server.

## 6. Rủi ro & hàng rào bảo mật (hard stop)
| Rủi ro | Hàng rào |
|---|---|
| Ghi ra ngoài workspace / vào repo thật | Bản sao riêng; container chỉ mount `/workspace`; không ghi ngược `local_path` (HUB-BR-32) |
| Lệnh độc / thoát sandbox | Container mỗi job `--network none`, `--cap-drop ALL`, `no-new-privileges`, rootfs read-only, non-root, trần CPU/RAM/pids/thời gian/token (HUB-BR-33, ADR-0011 #3) |
| Mã container chạy trên host qua git | git dir ngoài mount + cấu hình git cứng (ADR-0011 #4) |
| Đua symlink với tool gốc | Tool gốc bị chặn trong `workspace/`; mọi thao tác workspace qua `ws_*` trong container |
| Lộ secret | Không token/secret vào container/workspace/env; quét bí mật diff; che log (PC-R08/12) |
| Áp bản sửa sai | P-c1 không áp gì ra ngoài; gate người bắt buộc (`AUTOFIX_REVIEW`) |
| Lộ chéo tenant | RLS `tenant_id`; token job theo job; run khác ⇒ 404 |
| Prompt injection từ repo | HUB-BR-31 + không mạng + diff kiểm bằng chương trình + gate |
| Pha cài có mạng | **Thực tế chạy script vòng đời của repo + phụ thuộc** (`install_cmd` do admin khai, nhưng `npm/bun install` chạy lifecycle script). Không agent, không secret, trần 600 s, mạng `aif-prep` (`icc=false`/`isolate`), đóng `.git`; vẫn tới được RFC1918/169.254/host ⇒ cần tường lửa host (PRODUCTION-NOTES P-c1). Mặc định: `install_cmd` null ⇒ không mạng lúc nào (Q2) |

## 7. Phụ thuộc & giả lập
- Phụ thuộc: P-b (resolve/snapshot/lọc), P-a/P-b2 (gate, làm lại, "Cần người quyết"), H2c (job token, `attachments` output). Không cần H4b secret ở P-c1.
- Giả lập: `RUNTIME_SANDBOX=fake` (chỉ `RUNTIME_ENV=test`) chạy lệnh trong thư mục tạm; `fake-cli` directive `#fake:ws_write=…`, `#fake:ws_exec=…`, `#fake:ws_edit=…` (plan §5.6). Bộ test container thật (`docker`) cô lập mạng/trần: `test:pc:sandbox`, cần Docker.
- Env mới (Runtime, đọc ở `config.py`, ghi vào `.env.example` gốc ở R1; Hub: không env mới):

| Biến | Mặc định | Biến | Mặc định |
|---|---|---|---|
| `RUNTIME_SANDBOX` (`off\|docker\|podman\|fake`) | `off` | `RUNTIME_SANDBOX_EXEC_S` | `120` (agent xin ≤ 600) |
| `RUNTIME_SANDBOX_IMAGE` | `ai-autofix-sandbox:0.1.0` | `RUNTIME_SANDBOX_INSTALL_S` | `600` |
| `RUNTIME_SANDBOX_HOST_WORKDIR` (dev) | rỗng = đường thật | `RUNTIME_SANDBOX_TEST_S` | `900` |
| `RUNTIME_SANDBOX_CPUS` | `2` | `RUNTIME_SANDBOX_MAX` | `1` |
| `RUNTIME_SANDBOX_MEMORY_MB` | `2048` | `RUNTIME_AUTOFIX_MAX_MB` | `200` |
| `RUNTIME_SANDBOX_PIDS` | `512` | `RUNTIME_AUTOFIX_MAX_FILES` | `20000` |
| `RUNTIME_SANDBOX_TMP_MB` | `256` | `RUNTIME_SANDBOX_DISK_MB` | `4096` |

## 8. Tiêu chí nghiệm thu
Ca + kỳ vọng: [`test-plan.md`](test-plan.md) §3 (ma trận luật → ca), §4 (danh sách ca R/A/P/S/E), §5–§6 (chập chờn, mặc định qc), §7 (lệnh). Mốc đạt khi `bun run done:pc` (test-plan §7, task D1) xanh + review + security review + UAT D2.

## 9. Quyết định
### Trước Gate (đã chốt với người dùng, CR-061, 2026-10-12)
| # | Quyết định |
|---|---|
| D1 | CR-061 + spec P-c riêng; P-b (nguồn chỉ-đọc, CR-060) giữ nguyên |
| D2 | Ghi vào clone riêng `work/<job_id>/workspace/<repo>/`; nguồn chỉ-đọc mount riêng; CẤM ghi `local_path`/repo thật/host/`sources/` |
| D3 | Bash/ghi chỉ trong container mỗi job + cắt egress (trừ git allowlist) + trần CPU/RAM/thời gian/token; chưa có container ⇒ P-c chặn |
| D4 | Áp = nhánh + diff → PR qua API provider bằng secret H4b, luôn sau gate (HUB-FR-109); không push thẳng (chế độ áp theo nguồn: xem E5, CR-065) |
| D5 | Chỉ clone `git_remote` của chính tenant; cấm `local_path`; chỉ quy trình do tenant_admin bật |
| D6 | Lệnh test/bash tự do nhưng chỉ trong container không-egress, không secret trong workspace |
| D7 | Mốc P-c sau H4b; ADR-0011 trước BUILD; không đụng P-b |
| D8 | `fixbug-evolu` giữ làm chế độ an toàn; `fixbug-apply` là biến thể mới; người dùng chọn chế độ |
### Sửa đổi theo CR-065 (Intake Đầy đủ chốt 2026-10-12)
| # | Quyết định |
|---|---|
| E1 | Nhánh đặt tên `ai/<run>/<step>` trong clone riêng của Runtime |
| E2 | **Runtime kiểm diff bằng chương trình** (WRK-FR-29): chạy lại test, quét bí mật, allowlist đường dẫn; sai ⇒ stage lỗi, không trả diff |
| E3 | Trượt duyệt ⇒ commit thêm vào **cùng nhánh** (không nhánh mới) |
| E4 | `main` đổi ⇒ Runtime rebase + chạy lại test; xung đột ⇒ "Cần người quyết" (agent không tự giải) |
| E5 | `apply_mode` theo nguồn: `pr` (mặc định) · `auto_merge` (chỉ bật theo nguồn, sau gate người Đạt + test Runtime xanh, qua auto-merge của provider) · `branch_only` (duy nhất cho `local_path`, trong clone riêng của Runtime, người tự merge). HUB-BR-34 đã viết lại |
| E6 | Giữ nguyên: clone riêng mỗi job (D2), container mỗi job (D3, ADR-0011 + phần "Bổ sung (CR-065)"), cấm ghi `local_path` (HUB-BR-32), Edit/Write + test chỉ trong container |
| E7 | Sửa code KHÔNG đụng P-b; P-c nhận qua CR-065. Readiness cần chạy lại khi tới mốc (spec đổi sau khung) |
### PLAN backend (2026-10-13, tự quyết theo Luật 2 — lý do: `spec-decisions.md` §2)
| # | Quyết định |
|---|---|
| B1 | `<run>` = `process_run_id` đầy đủ, `<step>` = `stage_key` (stage là đơn vị gate/làm lại; P-b2 một bước nhiều stage) |
| B2 | Workspace dựng từ snapshot P-b đã lọc (không clone thô) ⇒ một đường cho `git_remote` + `local_path`, không `.git` từ remote |
| B3 | Runtime không trạng thái: nhánh dựng lại mỗi job từ commit ghim + `base_patch` do Hub giữ (thay kho nhánh lâu dài) |
| B4 | Diff/log lưu `hub.attachments` (`origin='output'`, `text/plain`) — không thêm MIME |
| B5 | Không thêm công tắc tenant; `enabled` của quy trình là công tắc (PC-R03) |
| B6 | Diff so với commit **ghim**; rebase (E4) chuyển P-c2 cùng PR |
| B7 | Repo của stage tự-sửa cố định trong def (`autofix.source_key`, nhánh = nhánh mặc định của nguồn); một repo/job. Chọn repo lúc chạy bằng `source_ref` (PB-R13) để sau — mỗi repo một bản chép quy trình |
| B8 | Test xác nhận = `test_cmd` exit 0 trong container mới; không chạy test "trước khi sửa" (baseline) ở P-c1 — agent tự chạy qua `ws_exec` nếu cần |
| B9 | KnowledgeHub (K1, CR-072/073) giữ nguyên ở stage tự-sửa: agent đã tick KH ⇒ job có `kh_query` cạnh 4 tool `ws_*` (gọi qua Hub `/mcp` từ Runtime, ngoài container — container vẫn không mạng; KH là nguồn đọc, không vào workspace); `## Tóm tắt` ghi worklog khi stage `done` (gate duyệt diff Đạt) như K1. Không thêm cấu hình KH riêng cho autofix; mockup không đổi (chọn KH ở Studio → Sửa agent → Tri thức; `KnowledgeNotice` của K1 hiện ở run view). Hỏi người dùng 2026-10-13 |

### Trong lúc làm (nhật ký đã chuyển sang phụ lục — spec ≤ 25 KB)
| Phụ lục | Nội dung |
|---|---|
| [`spec-decisions.md`](spec-decisions.md) §5 | PLAN/contract (B1), migration (B2), luật Hub (B3), internal (B4), launcher (B5), đọc diff/log (B5b), seed (B6), readiness lần 1–3 |
| [`spec-log-build.md`](spec-log-build.md) | Runtime R2/R3/R4, review code + review bảo mật vòng 1–3 (vá) |
| [`spec-decisions.md`](spec-decisions.md) §6 | Tranh chấp test K02/E08/T03/AF05 — **đã phân xử hết** (qc 2026-10-14; test-plan §10) |

**Ghi nhận hành vi (UAT P-c1 Minor #4):** số "Vòng k" đếm cả lần thử lại do `template_invalid` (gate đầu tiên có thể đã là "Vòng 4") — hành vi Hub, giữ nguyên; xem TECH-DEBT.

**Đồng bộ sau BUILD (2026-10-14):** pha cài (`install_cmd`) chạy ở container có mạng và **thực thi script vòng đời của repo + phụ thuộc** (không chỉ "lệnh admin khai báo") — hàng rào ở §6; `local_path` chỉ ghi trên bản sao; workspace dựng từ snapshot đã lọc (B2); KnowledgeHub như K1 (B9).

## 10. Câu hỏi cho người dùng (trình Gate; mỗi câu có mặc định đề xuất)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Tách P-c thành **P-c1 diff-only** (mốc này) và **P-c2 PR/`apply_mode`/rebase** (mốc sau)? | Có — CR-061 đã ghi "diff-only làm trước"; P-c1 dùng được ngay (tải `.diff`, `git apply`), không cần provider/secret thật |
| Q2 | Cài phụ thuộc khi container không mạng: cho phép **pha chuẩn bị có mạng** chạy `install_cmd` do admin khai (không agent, không secret, ≤ 600 s)? (khác CR-061 D3 "cắt egress trừ git") | Có; không đặt `install_cmd` ⇒ không có mạng lúc nào. Proxy allowlist registry để sau |
| Q3 | `local_path` làm nguồn tự-sửa? (HUB-FR-126/D5 "cấm local_path" ↔ CR-065/HUB-BR-34 "`local_path` chỉ `branch_only`") | Có ở P-c1: chỉ sửa **bản sao**, không ghi ngược; cần cho demo repo `ai-system` trên máy Runtime |
| Q4 | Chấp nhận **ngoại lệ thứ hai của HUB-BR-12**: 4 tool `ws_*` do Runtime cung cấp, chỉ chạy trong container của job? | Có (không còn cách an toàn khác cho Bash/ghi — ADR-0011 "Cơ chế tool") |
| Q5 | Repo `git_remote` **riêng tư** (`source_credential`) ở P-c1 hay P-c2? | P-c2 (cùng push/PR; P-c1 = repo công khai + `local_path`) |
| Q6 | Runtime container: **Podman rootless** (prod WSL2) + Docker Desktop (dev), trần mặc định ADR-0011 #3 (2 CPU, 2 GiB, 512 pids, job 30 phút, ≤ 1 job tự-sửa đồng thời)? | Có |
| Q7 | Ảnh sandbox một bộ công cụ chung (git, rg, python3, node LTS, bun; ~400–600 MB, dựng từ Dockerfile trong repo)? | Có; chọn ảnh theo quy trình để sau |

**Người dùng trả lời 2026-10-13:** chấp nhận mặc định Q1–Q7 (Q1 tách P-c1/P-c2; Q2 cho pha cài có mạng; Q3 `local_path` chỉ trên bản sao; Q4/Q6/Q7 duyệt sandbox ADR-0011 như đề xuất — ADR-0011 Accepted 2026-10-13; Q5 = P-c2 theo Q1). Mockup `Pc-*.dc.html` duyệt 2026-10-13.

## Kết luận P-c1 (2026-10-14)
- **Đạt, `status: done`** (diff-only). P-c2 (PR/`apply_mode`/rebase, HUB-FR-129, HUB-BR-34) chưa làm.
- `done:pc` xanh từng chặng (chưa một lượt liền — TD #169); review code 2 vòng APPROVED; review bảo mật 3 vòng SAFE (`826ae84f`, `46d9d6fa`, `e74c15c4`).
- UAT `qc-uat` (`evidence/2026-10-14/REPORT.md`): vòng 1 Đạt có điều kiện (`e27072da`, `942dba3d`); **vòng 2 Đạt** (`d99db5ae`, `20d2863a`): Major 1–2 hết, Minor 3, 5–8 đã sửa; Minor 4 chỉ ghi nhận (TD #173).
- Nợ: TD #168–#175. Kế tiếp: P-c2 — cần PLAN + spec-readiness.

## Cập nhật CR-081 (2026-10-16) — seed tối giản, fixture opt-in

- §4 Seed: agent `fixbug-apply`/`fixbug-engineer`/`fixbug-reviewer` + template `fixbug-apply` (+ `fixbug-evolu`) thành **fixture opt-in**; feature tự-sửa giữ nguyên, QC tự tạo agent/process def (stage autofix/apply) khi cần.
- Test khoá cần qc đặt cờ: P-c defs/seed.
Cơ chế: file `*.full.yaml` chỉ nạp khi `HUB_SEED_FIXTURES=1` (`readSeedDir`); mặc định (cờ tắt) = minimal (`orchestrator`, `assistant`, `dify-*`, providers, workflows). Chi tiết + lý do: [CR-081](../../CHANGE-REQUESTS.md). **Gate lại: CÓ** (đổi tiền điều kiện dữ liệu của test khoá; qc đặt `HUB_SEED_FIXTURES=1`). Lịch sử bên trên giữ nguyên.

