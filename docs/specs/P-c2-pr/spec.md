---
id: P-c2-pr
title: P-c2 · Áp bản sửa — push nhánh + PR / apply_mode / rebase khi main đổi / repo git riêng tư
milestone: P-c2 (sau P-c1, xong 2026-10-14)
status: draft            # PLAN backend 2026-10-14; chờ mockup FE + qc + spec-readiness + Gate
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
| Xem run (`chat/processes-entities.ts`) | Stage view `apply?: ApplyStageView{mode, status, branch\|null, target_sha\|null, head_sha\|null, rebased, provider\|null, pr_number\|null, pr_url\|null, auto_merge: "on"\|"failed"\|null, error_code\|null, conflict_files, failures, created_at}`; `AutofixStageView += apply_mode: ApplyMode \| null` (null = def không có stage Áp) — để gate hiện "Đạt sẽ mở PR vào `<branch>`" |
| Quyết định | `DECISION_REASONS += "apply_conflict", "apply_failed"` (cuối); `autofixDecisionOptions` mở rộng: hai lý do mới ⇒ `[add_attempt, cancel]` |
| `APPLY_ERROR_CODES` | `auth` · `no_credential` · `push_rejected` · `network` · `rate_limited` · `provider_error` · `check_failed` · `unsupported_provider` |
| Luật thuần (QC viết test trước) | contracts `gitProviderOf`, `effectiveApplyMode`, `applyStageIssues`; Hub `processes/runs/apply.rules.ts`; Runtime `apply/rules.py` — chữ ký plan §4 |

## 4. Dữ liệu (backend-lead)
<!-- DDL đầy đủ: plan.md §2. Migration 0032 viết tay idempotent, chỉ THÊM/nới. -->
| Đối tượng | Tóm tắt |
|---|---|
| `hub.autofix_applies` (mới, RLS "T") | `tenant_id, process_run_id, stage_run_id, job_id NULL UNIQUE, autofix_result_id NULL, source_key, mode, status CHECK(no_changes\|branch_only\|pushed\|pr_opened\|conflict\|check_failed\|failed), branch, pin_sha, target_sha, head_sha, rebased, provider, pr_number, pr_url, auto_merge, error_code, detail, conflict_files, failures, test_*, created_at, updated_at`; GRANT `SELECT, INSERT` + `UPDATE (status, provider, pr_number, pr_url, auto_merge, error_code, detail, updated_at)` cho `hub_rw` (không DELETE) |
| CHECK nới | `review_tasks_reason_ck += apply_conflict, apply_failed`; `jobs_type_check += source.apply` |
| Nguồn / stage | `sources.config` jsonb + `process_defs.stages` jsonb — KHÔNG DDL (đọc cũ: `credential_secret_id ?? null`, `apply_mode` vắng) |
| Seed | Template **mới** `fixbug-pr` (= `fixbug-apply` + stage `apply` bước 1) — **không** sửa `fixbug-apply` (test P-c1 khoá) |

## 5. UI (frontend-lead)
PLAN FE: [`plan-frontend.md`](plan-frontend.md) (FC1…FC15, câu chữ VI/EN, nhãn e2e §5, đề nghị contract §7). Mockup chờ duyệt: `docs/design/agent-hub/canvas/Pc2-{Sources,Credential,Editor,Result,Decision}.dc.html`. Màn đã vẽ (artboard đề xuất `docs/design/agent-hub/canvas/Pc2-*.dc.html`):
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

### Trong lúc làm
(trống)

## 10. Câu hỏi cho người dùng (trình Gate; mỗi câu có mặc định đề xuất tối giản)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Provider ở P-c2? | **Chỉ GitHub (`github.com`)**. GitLab/GHES để sau (thêm `gitProviderOf` + client). Nguồn host khác: mặc định `branch_only` |
| Q2 | Runtime nhận token `source_credential` qua kênh nội bộ (như `dify-credential`) để clone/fetch/push repo riêng? (HUB-BR-30 hiện nói "clone/fetch") | **Có** — chỉ trong bộ nhớ + env của tiến trình git; mở rộng HUB-BR-30 thêm "push" |
| Q3 | "Áp" là **stage riêng** (executor `apply`, sau stage tự-sửa) hay tự áp ngay khi gate stage tự-sửa Đạt? | **Stage riêng** (C1) — thấy được trên canvas, có kết quả/quyết định riêng |
| Q4 | Nghĩa của `branch_only`? | `local_path`: **không push, không clone lâu dài** — "nhánh" = diff đã duyệt ở Hub (tải `.diff`, `git apply`), vì Runtime không giữ trạng thái (B3) và cấm ghi `local_path`. `git_remote` + `branch_only`: **push nhánh `ai/…`, không mở PR** |
| Q5 | Rebase khi `main` đổi: chỉ xét lúc Áp; xung đột ⇒ chỉ "Thử lại / Huỷ"? | **Có**. Muốn sửa trên `main` mới ⇒ chạy lại quy trình. Tự quay lại stage tự-sửa trên `main` mới để sau |
| Q6 | `auto_merge`: bật auto-merge của GitHub kiểu **squash**; repo chưa bật "Allow auto-merge"/không có branch protection ⇒ PR vẫn mở, ghi "auto-merge không bật được", không "Cần người quyết"? | **Có** |
| Q7 | Nội dung PR: tiêu đề + mục `## Thay đổi`/`## Test` của output đã duyệt, không tên người duyệt, không đầu vào người dùng (PC2-R14)? | **Có** |
| Q8 | Ai đặt `apply_mode` (kể cả `auto_merge`)? | **tenant_admin** của tenant (như sửa nguồn); `local_path` cố định `branch_only` |
| Q9 | Smoke với GitHub thật (repo thử + fine-grained PAT: Contents RW, Pull requests RW, chỉ repo đó)? | **Không chặn mốc**: P-c2 đạt bằng mock + bare repo; người dùng cấp repo/PAT thì `qc-uat` chạy thêm (hard stop: secret thật) |
| Q10 | Khoá nguồn dùng cho cả nguồn **chỉ-đọc** P-b (vd `fixbug-evolu` đọc repo riêng)? | **Có** — cùng đường resolve, không thêm việc |

**Người dùng trả lời 2026-10-14:** chấp nhận mặc định Q1–Q10 (Q1 chỉ GitHub; Q2 Runtime nhận khoá qua kênh nội bộ, chỉ ngoài container; Q3 stage "Áp" riêng sau gate; Q4–Q10 như bảng). Còn chờ: mockup `Pc2-*` (T1) trước khi qc viết test.
