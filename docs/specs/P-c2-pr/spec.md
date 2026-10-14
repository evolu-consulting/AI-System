---
id: P-c2-pr
title: P-c2 · Áp bản sửa — push nhánh + PR / apply_mode / rebase khi main đổi / repo git riêng tư
milestone: P-c2 (sau P-c1, xong 2026-10-14)
status: approved         # Gate tự duyệt Luật 2b 2026-10-14 (readiness lần 5 READY); BUILD
requirements: [HUB-FR-129, HUB-FR-128, HUB-FR-130, HUB-BR-34, HUB-BR-30, HUB-BR-32, HUB-FR-68, WRK-FR-29]
design:
  - docs/CHANGE-REQUESTS.md#CR-061 (D4 PR sau duyệt), #CR-065 (E4 rebase, E5 apply_mode)
  - docs/design/agent-hub/ba-agent-hub.md §6.10 (HUB-FR-128…130), §7 HUB-BR-30, 32, 34, 38(b)
  - docs/design/worker/ba-worker.md (WRK-FR-29)
  - docs/adr/0011-write-exec-sandbox.md (Accepted; "Bổ sung (CR-065)" — không đổi)
  - docs/specs/P-c-autofix/spec.md (P-c1: PC-R01…R16, Q5 = repo riêng ở P-c2)
  - docs/specs/H4b1-secrets/plan.md §2.3 (`useSecret`, `source_credential`, route `/admin/source-credentials*`)
  - docs/specs/P-b-sources/spec.md (nguồn `git_remote`/`local_path`, resolve, mirror)
owner: backend-lead + frontend-lead
---

# P-c2 · Áp bản sửa (PR / apply_mode / rebase / repo riêng)

> Contract chi tiết, DDL, luồng Hub + Runtime, chữ ký hàm thuần: [`plan.md`](plan.md). Task: [`tasks.md`](tasks.md).

## 1. Phạm vi
**Bối cảnh:** P-c1 cho stage tự-sửa trả **diff đã kiểm** + gate người. P-c2 làm phần "áp" (HUB-FR-129, HUB-BR-34): sau gate Đạt, đẩy nhánh `ai/<run>/<stage>` lên repo và mở PR bằng `source_credential` (H4b-1); chế độ áp theo nguồn; rebase khi nhánh mặc định đã đổi (E4); clone/fetch repo **riêng tư** (Q5 của P-c).

| Làm | Không làm (P-c2) |
|---|---|
| Stage **"Áp"**: executor mới `{kind:"apply"}`, `real_action=true`, `after=auto`, ở bước ngay sau stage tự-sửa (Q3) | Agent/LLM trong stage Áp (Áp là chương trình) |
| `git_remote` + `apply_mode` `pr` (mặc định) / `auto_merge` / `branch_only`; `local_path` luôn `branch_only` | Push thẳng nhánh mặc định; Hub/Runtime tự merge |
| Runtime (ngoài container) push nhánh; **Hub** gọi API provider mở PR / bật auto-merge (HUB-BR-34) | GitLab, GitHub Enterprise, Bitbucket (Q1 — sau) |
| Rebase **lúc Áp**: nhánh mặc định đổi so với commit ghim ⇒ áp bản vá 3-way lên HEAD mới + chạy lại cài/test trong container; xung đột ⇒ "Cần người quyết" | Theo dõi `main` liên tục; agent tự giải xung đột; tự quay lại stage tự-sửa |
| `git_remote.credential_secret_id` (khoá `source_credential`) dùng cho resolve (P-b + P-c) **và** push; mirror riêng theo nguồn khi có khoá | Khoá SSH; token trong URL; nhiều khoá/nguồn |
| Màn Nguồn: chọn/tạo khoá nguồn + chế độ áp; editor: executor "Áp"; run view: kết quả Áp + PR | Webhook từ provider; đồng bộ trạng thái PR (merged/closed) về Hub |

## 2. Nghiệp vụ cụ thể hoá (PC2-R)
BA là nguồn sự thật; chỉ ghi phần BA chưa nói. Luật P-c1 (PC-R01…R16) giữ nguyên.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PC2-R01 | Stage Áp hợp lệ (422 `PROCESS_DEF_INVALID`, `rules`): `executor.kind="apply"` ⇒ `real_action=true` (`APPLY_REAL`); `after.kind="auto"` (`APPLY_AFTER`); def có stage tự-sửa ở **bước = bước(Áp) − 1** (`APPLY_NO_AUTOFIX`); ≤ 1 stage Áp/def (`APPLY_MAX`); `sources=[]`, `autofix=null`, `token_budget=null`, `must_know=[]` (`APPLY_FIELDS`). Luật `REAL_ACTION` cũ vẫn áp (bước trước toàn review — thoả nhờ `AUTOFIX_REVIEW`) | HUB-BR-34, 38(b) |
| PC2-R02 | `apply_mode` hiệu lực (`effectiveApplyMode`): `local_path` ⇒ `branch_only` (luôn); `git_remote` có `apply_mode` ⇒ giá trị đó; vắng ⇒ `pr` nếu host có provider hỗ trợ (`gitProviderOf(url)≠null`, P-c2: `github.com`) ngược lại `branch_only`. Lưu nguồn với `apply_mode ∈ {pr, auto_merge}` mà host không hỗ trợ ⇒ 422 `SOURCE_APPLY_UNSUPPORTED` | HUB-FR-129, E5 |
| PC2-R03 | Khi stage Áp chạy, Hub lấy kết quả **mới nhất** của stage tự-sửa bước trước (là bản người vừa Đạt): `no_changes` ⇒ stage Áp `done` ngay, không job, hàng `status=no_changes`; `local_path` ⇒ `done` ngay, `branch_only` (người tải `.diff` + `git apply`, không push — Q4); `git_remote` ⇒ job `source.apply` (`push_only = mode==="branch_only"`). Kết quả khác `ok`/`no_changes` (không thể sau gate Đạt) ⇒ `apply_failed{code:"provider_error"}` (phòng thủ) | HUB-BR-34, PC-R09 |
| PC2-R04 | Runtime `source.apply` (ngoài container, git cứng như P-c1 §5.3): fetch mirror (có khoá ⇒ lấy khoá qua kênh nội bộ) → `target` = HEAD hiện tại của `config.branch` → checkout `target` trong `work/<job>/repo/` → `git apply --3way --index --binary` bản vá đã duyệt → commit `ai-autofix`. Áp lỗi/xung đột ⇒ báo `conflict{files}` | E4, WRK-FR-29 |
| PC2-R05 | `target ≠ pin.sha` ⇒ `rebased=true` ⇒ kiểm PC-R08 lại trên diff `target..HEAD` (đường dẫn → kích thước → bí mật → `install_cmd` (nếu có) + `test_cmd` trong container MỚI, dựng từ bản xuất **đã lọc PB-R07** của cây sau áp). Trượt ⇒ `check_failed{failures}`; không container ⇒ job lỗi `container`. `target = pin.sha` ⇒ không chạy lại (P-c1 đã kiểm) | E4, WRK-FR-29, HUB-BR-33 |
| PC2-R06 | Push: chỉ refspec `HEAD:refs/heads/<branch>` với `<branch>` khớp `AUTOFIX_BRANCH_RE` (= `ai/<run uuid>/<stage_key>` của stage tự-sửa); cưỡng bức (`+`) **chỉ** trong không gian `ai/` của chính run; ref từ xa đã = `head_sha` ⇒ bỏ qua push. Không bao giờ push `config.branch`, `--all`, `--mirror`, tag | HUB-BR-34 |
| PC2-R07 | Sau `pushed`: `push_only` ⇒ stage `done` (`status=pushed`). Ngược lại **Hub** gọi provider: tìm PR mở có `head=<owner>:<branch>` → có thì dùng, không thì tạo (`base = config.branch`); tạo trả 422 "already exists" ⇒ tìm lại. `auto_merge` ⇒ bật auto-merge (SQUASH, Q6); bật không được ⇒ PR vẫn mở, `auto_merge="failed"`, stage vẫn `done` (không "Cần người quyết") | HUB-FR-129, E5 |
| PC2-R08 | Lỗi ⇒ "Cần người quyết", xét theo thứ tự: job lỗi `container` ⇒ `sandbox_unavailable` (P-c1); `conflict` ⇒ `apply_conflict`; `check_failed` / `failed` / lỗi job khác / thiếu báo cáo / lỗi provider ⇒ `apply_failed` kèm `error_code` (bảng §3). Lựa chọn **chỉ** `add_attempt` (chạy lại job Áp, idempotent PC2-R06/R07) / `cancel`; `use_current` ⇒ 409 `PROCESS_RUN_STATE`. Người quyết: `canDecide` sẵn có (người bắt đầu/admin) | HUB-FR-115 |
| PC2-R09 | Lỗi provider (Hub, mỗi lời gọi timeout 15 s, không theo redirect, thân ≤ 1 MiB): 401 ⇒ `auth`; 403 có `x-ratelimit-remaining: 0` hoặc 429 ⇒ chờ `retry-after`/`x-ratelimit-reset` nếu ≤ 60 s rồi thử lại **1** lần, còn lại ⇒ `rate_limited`; 403/404 khác ⇒ `auth` (không phân biệt "không quyền" và "không thấy repo" — tránh dò); 422 khác "already exists" ⇒ `provider_error`; 5xx/mạng ⇒ thử lại 3 lần (1/2/4 s) rồi `provider_error`. `detail` lưu ≤ 300 ký tự **đã che**, không thân phản hồi thô | HUB-BR-30 |
| PC2-R10 | Khoá nguồn: `git_remote.credential_secret_id` ≠ null ⇒ secret phải tồn tại, `kind=source_credential`, **cùng tenant** với nguồn, chưa xoá — sai mọi kiểu ⇒ 422 `SOURCE_CREDENTIAL_INVALID` (một thân). Tạo/thay/xoá khoá qua route H4b-1 `/admin/source-credentials*` (sẵn có); xoá khoá đang dùng ⇒ luật `used_by` của H4b-1 | HUB-FR-68, HUB-BR-30 |
| PC2-R11 | Giao khoá cho Runtime: `POST /internal/jobs/:job_id/source-credential {source_id}` chỉ khi job `running`, cùng tenant, `type ∈ {source.resolve, source.apply}` và `source_id` thuộc job (item resolve / nguồn Áp) và nguồn có khoá; sai ⇒ 404 cùng thân. Runtime giữ khoá **trong bộ nhớ** tới hết job, truyền cho git qua env `GIT_CONFIG_*` (`http.<origin>.extraHeader`), không qua argv/URL/file; không bao giờ vào `work/<job>/`, container, log, báo cáo, prompt | HUB-BR-30, ADR-0011 #4 |
| PC2-R12 | Mirror: nguồn **có** khoá ⇒ mirror riêng `mirrors/src-<source_id>` (không dùng chung theo URL); không khoá ⇒ như P-b (`sha256(url)`); fetch lỗi ⇒ `SOURCE_UNRESOLVABLE`, không bao giờ rơi về mirror khác. Cache snapshot đã khoá theo tenant (P-b `snapshot.py`) — giữ ⇒ tenant khác khai cùng URL không đọc được nội dung riêng | HUB-BR-14, 30 |
| PC2-R13 | Audit: mỗi lần Áp = một hàng `hub.autofix_applies` (nguồn, chế độ, nhánh, pin, target, head, rebase, provider, PR số + URL, auto-merge, mã lỗi, test). Không giá trị khoá. Ủy quyền hành động thật: audit `authorize_real_action` sẵn có (actor = người Đạt gate stage tự-sửa) — mở rộng cho executor `apply` | HUB-FR-130, HUB-BR-38(b) |
| PC2-R14 | Nội dung PR (Q7): tiêu đề `[AI] <tên quy trình> · <tên stage tự-sửa> (<8 ký tự đầu run id>)` ≤ 256; thân = mục `## Thay đổi` + `## Test` của output stage tự-sửa đã duyệt (≤ 8.000 ký tự, che mẫu bí mật PC-R08) + chân `Tạo bởi AI System · run <run id> · vòng <k>`. Không tên/e-mail người duyệt, không đầu vào người dùng | HUB-BR-30 |
| PC2-R15 | `pr_url` chỉ lưu/hiện khi là `https://` và host = `HUB_GITHUB_WEB_HOST` (mặc định `github.com`); ngược lại lưu null + `error_code=provider_error` | bảo mật hiển thị |
| PC2-R16 | Cách ly tenant: nguồn/khoá/kết quả Áp theo `tenant_id` + RLS; view stage Áp theo `runAccess` như P-c1 (PC-R14); id của run khác ⇒ 404 | HUB-BR-14 |

## 3. Contract (backend-lead)
<!-- Bảng trường đầy đủ: plan.md §3. z.strictObject khắp; chỉ THÊM trường/giá trị (cuối mảng enum). -->
| Nhóm | Tóm tắt (chi tiết plan §3) |
|---|---|
| Nguồn (`hub-admin/sources.ts`) | `GitRemoteConfig += credential_secret_id: uuid \| null` (default null) `+ apply_mode?: "pr"\|"auto_merge"\|"branch_only"` (vắng = mặc định PC2-R02). `LocalPathConfig` không đổi. Hàm thuần `gitProviderOf`, `effectiveApplyMode`. `SOURCE_ERRORS += SOURCE_CREDENTIAL_INVALID (422), SOURCE_APPLY_UNSUPPORTED (422)` |
| Stage def (`hub-admin/processes.ts`, `process-steps.ts`) | `executor` += `{kind:"apply"}`; `EXECUTOR_KINDS += "apply"`; `PROCESS_DEF_RULES += APPLY_REAL, APPLY_AFTER, APPLY_NO_AUTOFIX, APPLY_MAX, APPLY_FIELDS` (cuối); hàm thuần `applyStageIssues` (FE dùng chung) |
| Job (`hub/job.ts`) | `SourceApplyJob{type:"source.apply", source{source_id,key,url,branch,has_credential}, pin_sha, branch, apply_mode, push_only, patch: JobAttachment, install_cmd, test_cmd, write_allowlist, timeout_s}`; `JobPayload` union += ; `ResolveItem.config` mang `credential_secret_id` (chỉ id) |
| Kênh nội bộ (`hub-internal/`) | `POST /internal/jobs/:id/source-credential {source_id}` → 200 `{username, token}` · 401 · 404 `NOT_FOUND` · 409 `NOT_CONFIGURED` (khoá hỏng/mất). `POST /internal/jobs/:id/apply-result` body `ApplyReport{status pushed\|conflict\|check_failed\|failed, target_sha, head_sha\|null, rebased, code\|null, conflict_files ≤50, failures ≤50, test\|null}` → 201 `{id}` · 400 · 401 · 409 `APPLY_NOT_EXPECTED` · 409 `APPLY_RESULT_EXISTS` |
| Xem run (`chat/processes-entities.ts`) | Stage view `apply?: ApplyStageView{mode, status, branch\|null, target_sha\|null, head_sha\|null, rebased, provider\|null, pr_number\|null, pr_url\|null, auto_merge: "on"\|"failed"\|null, error_code\|null, conflict_files, failures, created_at}`; `AutofixStageView += apply_mode: ApplyMode \| null` (null = def không có stage Áp), `apply_base: string \| null` (= `config.branch` nguồn hiện tại khi `apply_mode ≠ null` và nguồn `git_remote`) — để gate hiện "Đạt sẽ mở PR vào `<apply_base>`"; `ApplyStageView.test_log_file: {id,name} \| null`. Luật: `status ∈ {failed, check_failed}` ⇒ `error_code ≠ null` (`check_failed` ⇒ `error_code="check_failed"`); `conflict` ⇒ null |
| Quyết định | `DECISION_REASONS += "apply_conflict", "apply_failed"` (cuối); `autofixDecisionOptions` mở rộng: hai lý do mới ⇒ `[add_attempt, cancel]` |
| `APPLY_ERROR_CODES` | `auth` · `no_credential` · `push_rejected` · `network` · `rate_limited` · `provider_error` · `check_failed` · `unsupported_provider` |
| Luật thuần (QC viết test trước) | contracts `gitProviderOf`, `effectiveApplyMode`, `applyStageIssues`; Hub `processes/runs/apply.rules.ts`; Runtime `apply/rules.py` — chữ ký plan §4 |

## 4. Dữ liệu (backend-lead)
<!-- DDL đầy đủ: plan.md §2. Migration 0032 viết tay idempotent, chỉ THÊM/nới. -->
| Đối tượng | Tóm tắt |
|---|---|
| `hub.autofix_applies` (mới, RLS "T") | `tenant_id, process_run_id, stage_run_id, job_id NULL UNIQUE, autofix_result_id NULL, source_key, mode, status CHECK(no_changes\|branch_only\|pushed\|pr_opened\|conflict\|check_failed\|failed), branch, pin_sha, target_sha, head_sha, rebased, provider, pr_number, pr_url, auto_merge, error_code, detail, conflict_files, failures, test_*, created_at, updated_at`; GRANT `SELECT, INSERT` + `UPDATE (status, provider, pr_number, pr_url, auto_merge, error_code, detail, updated_at)` cho `hub_rw` (không DELETE) |
| CHECK nới | `review_tasks_reason_ck += apply_conflict, apply_failed`; `jobs_type_ck += source.apply`, `jobs_agent_ck` cho phép job `source.apply` không agent |
| Nguồn / stage | `sources.config` jsonb + `process_defs.stages` jsonb — KHÔNG DDL (đọc cũ: `credential_secret_id ?? null`, `apply_mode` vắng) |
| Seed | Template **mới** `fixbug-pr` (= `fixbug-apply` + stage `apply` bước 1) — **không** sửa `fixbug-apply` (test P-c1 khoá) |

## 5. UI (frontend-lead)
PLAN FE: [`plan-frontend.md`](plan-frontend.md) (FC1…FC15, câu chữ VI/EN, nhãn e2e §5, đề nghị contract §7). Mockup đã duyệt: `docs/design/agent-hub/canvas/Pc2-{Sources,Credential,Editor,Result,Decision}.dc.html`. Màn đã vẽ:
| Màn | Nội dung cần vẽ | App |
|---|---|---|
| `Pc2-Sources` | Form nguồn `git_remote`: ô **Khoá nguồn** (chọn khoá có sẵn / "Tạo khoá mới" mở sheet / "Không — repo công khai") + **Chế độ áp** (3 lựa chọn, `pr`/`auto_merge` mờ khi host không hỗ trợ, ghi chú auto-merge cần bật ở GitHub); `local_path` hiện "Chỉ nhánh (cố định)"; danh sách nguồn có nhãn "riêng tư" + chế độ; lỗi `SOURCE_CREDENTIAL_INVALID`, `SOURCE_APPLY_UNSUPPORTED`, `SOURCE_UNRESOLVABLE` (khoá sai khi "Kiểm tra kết nối") | admin-web `/sources` |
| `Pc2-Credential` | Sheet tạo/thay/xoá khoá nguồn (tên, token chỉ ghi, hướng dẫn quyền PAT tối thiểu: Contents RW + Pull requests RW); khoá đang dùng ⇒ không xoá | admin-web `/sources` (route H4b-1 `/admin/source-credentials*`) |
| `Pc2-Editor` | Executor "Áp bản sửa" trong panel stage (ẩn agent/instruction/nguồn/ngân sách; `real_action` bật cứng; `after` = tự động); lỗi `APPLY_*` | admin-web editor |
| `Pc2-Result` | Kết quả stage Áp: PR (#, liên kết ngoài), nhánh, commit, "đã rebase lên `<sha7>`", auto-merge bật/không bật; `branch_only`/`local_path`: hướng dẫn tải `.diff` + `git apply`; `no_changes`; dòng gate stage tự-sửa "Đạt sẽ mở PR vào `main`" | chat-web + admin-web run view |
| `Pc2-Decision` | `apply_conflict` (danh sách file xung đột) · `apply_failed` theo `error_code` (8 nhãn) · thẻ thread | chat-web + admin-web |

## 6. Rủi ro & hàng rào bảo mật (hard stop)
| Rủi ro | Hàng rào |
|---|---|
| Lộ token git/provider | Token chỉ: bảng secrets (mã hoá) → `useSecret` ở Hub (gọi API) / kênh nội bộ có token job → bộ nhớ Runtime → env `GIT_CONFIG_*` của tiến trình git. Không vào payload job, DB khác, `work/<job>/`, container, log (che `Authorization`), PR, audit (PC2-R11) |
| Push nhầm nhánh mặc định / ghi đè nhánh người | Refspec cố định không gian `ai/<run>/` (PC2-R06, kiểm ở Runtime bằng hàm thuần + regex contract ở Hub); không `--all/--mirror/tag` |
| Đọc chéo repo riêng giữa tenant | Mirror theo `source_id` khi có khoá; cache snapshot theo tenant (PC2-R12); kênh khoá chỉ trả cho job cùng tenant chứa nguồn đó (PC2-R11) |
| Áp bản chưa duyệt | Stage Áp `real_action` chỉ chạy sau gate Đạt bước trước (REAL_ACTION + `authorize_real_action`); bản vá = diff đính kèm của kết quả `ok` mới nhất (không lấy từ agent) |
| Mã repo chạy trên host khi checkout/áp | git cứng P-c1 §5.3 (không hook, không filter/`diff.external`, `GIT_CONFIG_NOSYSTEM/GLOBAL`); test sau rebase chạy trong container trên bản xuất đã lọc |
| Liên kết độc trong UI | `pr_url` kiểm https + host (PC2-R15) |
| Hub gọi ra ngoài | Chỉ `HUB_GITHUB_API_URL` (mặc định `https://api.github.com`), không theo redirect, trần thân 1 MiB, timeout 15 s |
| `auto_merge` gộp code chưa đủ kiểm | Chỉ bật theo nguồn (tenant_admin); gộp do provider (theo branch protection/required checks của repo); Hub không tự gộp |

## 7. Phụ thuộc & giả lập
- Phụ thuộc: P-c1 (autofix_results, diff, gate, sandbox), H4b-1 (`useSecret`, route khoá nguồn), P-b (resolve, mirror), P-a D4 (`real_action`, `authorize_real_action`).
- **Test không gọi provider thật:** (1) git: repo bare cục bộ + `url.<file:///…>.insteadOf=https://github.com/` qua `GIT_CONFIG_*` (cơ chế C6 P-b, chỉ khi `RUNTIME_ENV≠production`); (2) API: mock GitHub HTTP trong `tools/mocks` (như mock Dify/KH) — `GET/POST /repos/:o/:r/pulls`, `POST /graphql`, kịch bản 401/403/404/422/429/5xx; Hub trỏ `HUB_GITHUB_API_URL` vào mock. **Smoke với GitHub thật = hard stop** (cần repo thử + PAT của người dùng — Q9).
- Env mới (Hub, ghi `.env.example`): `HUB_GITHUB_API_URL` (`https://api.github.com`) · `HUB_GITHUB_WEB_HOST` (`github.com`). Runtime: không env mới (timeout job = `timeout_s` của stage Áp, mặc định 600).
- Không thư viện mới (Hub dùng `fetch` của Bun; Runtime dùng `git` CLI qua `subprocess` như P-b/P-c1) ⇒ **không ADR mới**.

## 8. Tiêu chí nghiệm thu
qc viết `test-plan.md` + test khoá theo PC2-R01…R16 và plan §4. Mốc đạt khi `bun run done:pc2` xanh + review + security review + UAT (mock + bare repo). Smoke GitHub thật chỉ khi người dùng cấp repo/PAT (Q9).

## 9. Quyết định
### PLAN backend (2026-10-14, tự quyết theo Luật 2)
| # | Quyết định | Lý do ngắn |
|---|---|---|
| C1 | Stage Áp là stage riêng executor `apply` (không phải bước ẩn sau gate) | Dùng lại máy trạng thái stage/decision/output/`real_action` + audit D4; không thêm trạng thái stage mới |
| C2 | Runtime push, **Hub** gọi API provider | BA HUB-BR-34 "PR do Hub tạo"; khoá cho API không rời Hub; mock HTTP ở Hub dễ |
| C3 | Rebase = `git apply --3way` bản vá đã duyệt lên HEAD mới (blob id trùng vì snapshot là bản sao byte-đúng) | Một phép, không cần lịch sử nhánh lâu dài (B3 P-c1: Runtime không trạng thái) |
| C4 | `apply_mode` lưu trong `sources.config` (jsonb), vắng = mặc định theo host | Không DDL; nguồn cũ đọc được |
| C5 | Template mới `fixbug-pr`; giữ `fixbug-apply` (diff-only) | Không phá test seed P-c1 đã khoá; người dùng chọn chế độ bằng quy trình (PC-R03) |
| C6 | Một bảng `autofix_applies` có UPDATE theo cột (push → PR) thay vì hai bảng/append-only | Ít bảng; cột sửa được giới hạn bằng GRANT |
| C7 | `AutofixStageView.apply_mode` để gate nói rõ hậu quả của Đạt | Người duyệt biết Đạt = mở PR |
| C8 | `apply_mode` đọc **lúc Áp** (không ghim lúc bắt đầu run); hàng `autofix_applies.mode` ghi giá trị thật | Đơn giản; đổi nguồn là việc của tenant_admin |

### Chốt contract theo đề nghị FE (2026-10-14)
| # | Quyết định |
|---|---|
| C9 | `AutofixStageView.apply_base` = `config.branch` nguồn hiện tại (cùng chỗ đọc với `apply_mode`); `local_path`/`apply_mode=null` ⇒ null. Người duyệt không cần quyền `/admin/sources` |
| C10 | `ApplyStageView.test_log_file` nhận: file log như `autofix_results` (`<stage_key>-apply-test.log.txt`, `{id,name}`), tải qua route attachment sẵn có; quyền đọc theo PC-R14 mở rộng |
| C11 | `error_code ≠ null` khi `status ∈ {failed, check_failed}` (DB CHECK `autofix_applies_err_req_ck`); thiếu báo cáo/lỗi job khác ⇒ driver ghi hàng `failed` + `provider_error`; `check_failed` ⇒ `check_failed`; `conflict` ⇒ null |
| C12 | `GET/POST/PUT/DELETE /admin/source-credentials*`: tenant_admin không gửi `tenant_id` (dùng tenant phiên; gửi khác ⇒ bỏ qua/403 theo `credentialTenant`); platform_admin thiếu `tenant_id`: GET ⇒ 404 `NOT_FOUND`, POST ⇒ 400 path `tenant_id` (khớp test khoá H4b-1 A51). Không đổi code BE (đã có `credentialTenant`) |

### Chốt theo test khoá (2026-10-14, G1–G16 của test-plan §6)
| # | Quyết định |
|---|---|
| C13 (G1) | Seam GitHub của Hub: `AppDeps.github?: {apiUrl, webHost}`; vắng ⇒ env `HUB_GITHUB_API_URL`/`HUB_GITHUB_WEB_HOST` ⇒ mặc định `api.github.com`/`github.com`. Đọc một lần ở `createApp`; config e2e đặt khoá `HUB_SECRETS_KEY` test khi vắng (G14) |
| C14 (G2) | Runtime kết thúc job `source.apply` bằng UPDATE `hub.jobs` (như `finish_resolve`); POST `apply-result` xong ⇒ Hub chạy `advanceApply(job_id)` (driver); job kết thúc không báo cáo ⇒ `sweepOnce` thấy job `source.apply` đã kết thúc mà chưa có hàng ⇒ ghi `failed`+`provider_error` (C11). Không thêm kênh mới (giống `autofix-result` P-c1) |
| C15 (G3) | Migration 0032 nới `jobs_type_ck` **và** `jobs_agent_ck` (0021) |
| C16 (G4–G6) | Tên export contract theo test-plan §6 G4; log test Áp `<stage_key>-apply-test.log.txt`; Runtime `agent_runtime.apply.host.ApplyHost`, claim `source.apply` riêng, nhánh ngoài `ai/` ⇒ failed không push, báo cáo trước khi kết thúc, tác giả `ai-autofix`, test sau rebase đỏ ⇒ `failures[0].check="tests"` |
| C17 (G15) | `done:pc2` migrate/tạo lại DB Runtime H1 (0032) trước Runtime int (D1/R2) |
| C18 (G8–G13,G16) | Nhận mặc định qc, không trái spec (G8/G16 không khoá; G9–G12 theo test-plan §6; G13 F2 giữ `combobox "Người thực hiện"`) |

### Áp mặc định readiness lần 1 + 2 (2026-10-14; chi tiết plan)
C19–C35 (lần 1) chuyển sang [`spec-decisions.md`](spec-decisions.md) (giữ cho trần kích thước); C22, C24, C34 đã sửa ở đó theo C36–C38.
| # | Quyết định |
|---|---|
| C36 | (#1) C34: `has_credential=false` + lỗi `auth` ⇒ `no_credential`; `push_rejected`/`network` giữ nguyên; đổi ở `ApplyHost` sau `classify_push_error` |
| C37 | (#2) `applyOutcome`: có báo cáo ⇒ theo `r.status` (trừ jobReason `container` ⇒ `sandbox_unavailable`); báo cáo được nhận ⇒ job `succeeded` kể cả `conflict`/`failed`; thiếu báo cáo ⇒ `apply_failed{provider_error}` |
| C38 | (#3) Claim `source.apply` (`apply_sql.py`) đòi (job tự-sửa + Áp đang chạy) < `RUNTIME_SANDBOX_MAX`; `SANDBOX_SLOT` đếm thêm Áp; R2 bỏ "chỉ khi retest" (code: `CLAIM_SELECT` JOIN providers ⇒ Áp cần claim riêng) |
| C39 | (#4) `db:test:create` có migrate ⇒ R2 + `done:pc2` dùng `db:test:drop h1 && db:test:create h1`, không `db:migrate` (dính DB dev) |
| C40 | (#5) Lệnh xong B2: `packages/db` + `db.int.test.ts`; B3: thư mục `tests/acceptance/P-b` + `sources.int.test.ts` — không `test:int` toàn bộ (kéo ca đỏ P-c2) |
| C41 | (#6) B7 sửa `processes/runs/{sweeps,autofix.rules}.ts` (không có `sweeper*.ts`) |
| C42 | (#7) Tên hàm đúng: `realActionPre` (launcher-step.ts) |
| C43 | (#8) Nguồn xoá/đổi kind ⇒ `AutofixStageView.apply_mode` và `apply_base` đều null |
| C44 | (#10) Chữ trạng thái cũ (mockup "chờ duyệt") cập nhật: T1 đã duyệt |

## 10. Câu hỏi Q1–Q10
Đã chốt 2026-10-14 (người dùng chấp nhận mặc định): xem [`spec-decisions.md`](spec-decisions.md).
