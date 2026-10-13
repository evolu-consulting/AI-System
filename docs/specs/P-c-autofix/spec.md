---
id: P-c-autofix
title: P-c · Luồng tự-sửa (autonomous fix) — workspace ghi-được + exec trong container + diff (P-c1) · PR (P-c2)
milestone: P-c (sau H4b-2)
status: draft            # PLAN backend 2026-10-13 xong; chờ mockup FE + câu hỏi người dùng (§10) + qc + spec-readiness + Gate
requirements: [HUB-FR-119, HUB-FR-126, HUB-FR-127, HUB-FR-128, HUB-FR-129, HUB-FR-130, WRK-FR-28, WRK-FR-29, HUB-BR-32, HUB-BR-33, HUB-BR-34, WRK-BR-08]
design:
  - docs/CHANGE-REQUESTS.md#CR-061 (Intake Đầy đủ chốt 2026-10-12), #CR-065 (sửa đổi: nhánh, kiểm diff, apply_mode)
  - docs/design/agent-hub/ba-agent-hub.md §6.10 (HUB-FR-119, 126…130), §7 HUB-BR-32…34
  - docs/design/worker/ba-worker.md (WRK-FR-28, WRK-FR-29, WRK-BR-08, WRK-NFR-02)
  - docs/adr/0011-write-exec-sandbox.md (Proposed — khuyến nghị đã điền)
  - docs/specs/P-b-sources/spec.md (nguồn chỉ-đọc, snapshot PB-R07 — tái dùng, không đổi hành vi)
owner: backend-lead + frontend-lead
---

# P-c · Luồng tự-sửa

> Chi tiết contract/DDL/luồng Runtime: [`plan.md`](plan.md). Lý do phạm vi + so sánh phương án: [`spec-decisions.md`](spec-decisions.md).

## 1. Phạm vi
**Bối cảnh:** `fixbug-evolu` (P-b) chỉ tư vấn trên nguồn chỉ-đọc. P-c cho agent **tự áp bản sửa**: đọc repo → sửa file → chạy test → nhánh/diff → (sau duyệt) PR. Là HUB-FR-119 (CR-061).

**Chia pha (CR-061 "phần diff-only làm trước phần PR"; backend-lead đề xuất tách mốc — chờ Gate, Q1):**
| Pha | Làm | Mã |
|---|---|---|
| **P-c1 (mốc này)** | Stage có cấu hình `autofix` (một nguồn); workspace ghi-được = bản sao snapshot đã lọc tại commit ghim; container mỗi job `--network none`; 4 tool `ws_*` chạy trong container; Runtime commit nhánh `ai/<run>/<stage>` + tính diff + **kiểm diff bằng chương trình** (đường dẫn, kích thước, bí mật, chạy lại test); Hub lưu diff + log + audit; gate duyệt hiển thị diff; Chưa đạt ⇒ làm lại cộng dồn trên cùng nhánh; mẫu `fixbug-apply` | HUB-FR-119 (một phần), 126, 127, 128 (trừ rebase), 130 (trừ `apply_mode`), WRK-FR-28, 29 (trừ rebase), HUB-BR-32, 33, WRK-BR-08 |
| P-c2 (mốc sau) | Stage "Áp" `real_action`: push nhánh + mở PR qua API provider bằng `source_credential`; `apply_mode` theo nguồn (`pr`/`auto_merge`/`branch_only`) + UI màn Nguồn; rebase khi `main` đổi; clone repo riêng (nếu Q5 = sau) | HUB-FR-129, HUB-BR-34, phần còn lại HUB-FR-128/130, WRK-FR-29 |

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
| PC-R10 | Kết quả job: thiếu báo cáo hoặc `check_failed` ⇒ run "Cần người quyết" `autofix_check_failed`, lựa chọn **chỉ** `add_attempt` / `cancel` (không `use_current`). Thêm lượt ⇒ prompt kèm tóm tắt lỗi kiểm (không giá trị bí mật) | HUB-FR-115, WRK-FR-29 |
| PC-R11 | Chưa đạt ở gate ⇒ làm lại stage: job mới nhận `base_patch` = diff `ok` mới nhất của stage_run; Runtime áp lên commit ghim (commit "vòng 1…k-1"), agent sửa tiếp; diff mới = **cộng dồn** so commit ghim, cùng tên nhánh | E3, HUB-FR-128 |
| PC-R12 | Audit mỗi job tự-sửa = một hàng `hub.autofix_results` (nguồn, ghim, nhánh, head, trạng thái, lỗi kiểm, thống kê, exit/thời gian test, danh sách lệnh ≤ 300). Không giá trị bí mật; log test che bằng `[REDACTED]` | HUB-FR-130 |
| PC-R13 | Ngân sách token stage tự-sửa: mặc định 200k nếu `token_budget` null (như PB-R12) | HUB-FR-116 |
| PC-R14 | Cách ly tenant: nguồn/def/kết quả theo `tenant_id` (RLS); id kết quả/diff của run khác ⇒ 404 (HUB-BR-14); token job chỉ báo được cho chính job | HUB-BR-14, 32 |
| PC-R15 | Pha cài: `install_cmd` (không null) chạy ở container chuẩn bị **có mạng** (Q2), ≤ 600 s, không secret, trước agent; lỗi ⇒ `check_failed{check:"install"}` | ADR-0011 #2 |

## 3. Contract (backend-lead)
<!-- Bảng trường đầy đủ: plan.md §3. z.strictObject khắp; không đổi trường cũ. -->
| Nhóm | Tóm tắt (chi tiết plan.md §3) |
|---|---|
| Stage def (`hub-admin/processes.ts`) | `ProcessStageDef.autofix: StageAutofix \| null` (default `null`; snapshot cũ vắng = null). `StageAutofix = {source_key, install_cmd: string 1..1000 \| null, test_cmd: string 1..1000, write_allowlist: Glob[] ≤ 20 (default [])}`. `PROCESS_DEF_RULES += AUTOFIX_EXECUTOR, AUTOFIX_REVIEW, AUTOFIX_MAX` (hàm thuần `autofixStageIssues` trong `process-steps.ts`, FE dùng chung) |
| Job (`hub/job.ts`) | `AgentCliJob.autofix?: JobAutofix = {source: JobSource (allowlist [])...; install_cmd; test_cmd; write_allowlist; branch; round ≥1; base_patch: JobAttachment \| null}` — vắng = job thường. `JOB_FAIL_REASONS += "container"` |
| Kênh báo (`hub-internal/autofix.ts`) | `POST /internal/jobs/:job_id/autofix-result` (Bearer token job) body `AutofixReport{status ok\|no_changes\|check_failed, branch, base_sha, head_sha, diff ≤ 2 MiB \| null, diff_stats, test, failures ≤ 50, commands ≤ 300}` → 201 `{id}` · 401 `UNAUTHORIZED` (token sai/job khác) · 409 `AUTOFIX_NOT_EXPECTED` (job không có `autofix` hoặc không `running`) · 409 `AUTOFIX_RESULT_EXISTS` · 413 `PAYLOAD_TOO_LARGE` · 400 `VALIDATION_ERROR`. Bất biến: `diff≠null ⇔ status=ok` |
| Xem run (`chat/processes-entities.ts`) | Stage view thêm `autofix?: AutofixStageView = {source_key, branch, round, status, diff_stats, diff_file: RunFile \| null, test_log_file: RunFile \| null, test: {exit_code, duration_ms} \| null, failures: AutofixFailure[], created_at}` (kết quả mới nhất của stage); nội dung diff tải qua endpoint file run sẵn có |
| Quyết định | `DECISION_REASONS += "autofix_check_failed", "sandbox_unavailable"` (cuối mảng). Lựa chọn theo PC-R10 |
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
| Seed | Template `fixbug-apply` (1 stage tự-sửa, review) + agent dev `fake-cli` directive `#fake:ws_*`; smoke `claude-sub` riêng |

## 5. UI (frontend-lead)
<!-- frontend-lead: mockup trước (người dùng yêu cầu). Màn cần làm: plan.md §8. -->
Mockup P-c1 (chờ người dùng duyệt; chưa viết plan-frontend), trong `docs/design/agent-hub/canvas/`:
| Artboard | Nội dung |
|---|---|
| `Pc-Editor.dc.html` | Khối "Tự sửa mã" trong panel stage (admin-web): tắt · trống · hợp lệ · lỗi `AUTOFIX_EXECUTOR/REVIEW/MAX` · nguồn `library` · test trống · ghi chú mạng |
| `Pc-Diff.dc.html` | Duyệt diff (chat-web "Chờ tôi kiểm" + trang run admin-web): có diff · `no_changes` · đang tải · lỗi tải |
| `Pc-Decision.dc.html` | `autofix_check_failed` (nhóm lỗi) · `sandbox_unavailable` · dòng stage run view · thẻ thread |

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
| Pha cài có mạng | Chỉ lệnh admin khai báo, không agent, không secret, trần 600 s (Q2) |

## 7. Phụ thuộc & giả lập
- Phụ thuộc: P-b (resolve/snapshot/lọc), P-a/P-b2 (gate, làm lại, "Cần người quyết"), H2c (job token, `attachments` output). Không cần H4b secret ở P-c1 (trừ khi Q5 = có).
- Giả lập: `RUNTIME_SANDBOX=fake` (chỉ `RUNTIME_ENV=test`) chạy lệnh trong thư mục tạm; `fake-cli` directive `#fake:ws_write=…`, `#fake:ws_exec=…`, `#fake:ws_edit=…` (plan §5.6). Bộ test container thật (`docker`) cô lập mạng/trần: `test:pc:sandbox`, cần Docker.
- Env mới (Runtime): `RUNTIME_SANDBOX`, `RUNTIME_SANDBOX_IMAGE`, `RUNTIME_SANDBOX_HOST_WORKDIR` (dev), `RUNTIME_SANDBOX_CPUS/MEMORY_MB/PIDS/TMP_MB/DISK_MB`, `RUNTIME_SANDBOX_EXEC_S/INSTALL_S/TEST_S`, `RUNTIME_SANDBOX_MAX`, `RUNTIME_AUTOFIX_MAX_MB/_MAX_FILES`. Hub: không env mới.

## 8. Tiêu chí nghiệm thu
<!-- qc --> (chờ qc; đề xuất AC-PC-01…: PC-R01…R15 + ADR-0011 #2–#5 + cách ly tenant; `done:pc`)

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
### Trong lúc làm
- (chưa)

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

**Người dùng trả lời 2026-10-13:** chấp nhận mặc định Q1–Q7 (Q1 tách P-c1/P-c2; Q2 cho pha cài có mạng; Q3 `local_path` chỉ trên bản sao; Q4/Q6/Q7 duyệt sandbox ADR-0011 như đề xuất — ADR chuyển Accepted ở Gate; Q5 = P-c2 theo Q1). Mockup `Pc-*.dc.html` chờ người dùng duyệt.
