# Plan FE · P-c2 Áp bản sửa (admin-web + chat-web)

Mockup đã duyệt (2026-10-14): `docs/design/agent-hub/canvas/Pc2-{Sources,Credential,Editor,Result,Decision}.dc.html` (đã đăng ký `canvas.json`; sau khi duyệt là chuẩn). Mẫu: `P-c-autofix/plan-frontend.md`. Luật: spec §2 PC2-R01/02/03/07/08/10/15. Contract: `plan.md` §3 (FE không đổi).

## 0. Quyết định FE (Luật 2)
| # | Quyết định |
|---|---|
| FC1 | Không thêm thư viện, không ADR; shadcn có sẵn (`Select`, `RadioGroup`, `Dialog`, `Sheet`, `Alert`, `Badge`) |
| FC2 | Khoá nguồn quản lý **trong trang Nguồn**: nút "Khoá nguồn" mở `Sheet` (danh sách, Tạo, Thay token, Xoá); mục "+ Tạo khoá mới…" trong form nguồn mở `Dialog` tạo khoá (cùng `CredentialForm`), lưu xong tự chọn khoá mới. Không route/nav mới |
| FC3 | Hook khoá (`useCredentials`, create/rotate/delete) trong `features/sources/api.ts`, URL `/admin/source-credentials*`. Token chỉ ở body; `gcTime: 0`; platform_admin kèm `tenant_id` (mẫu `features/secrets/api.ts`) |
| FC4 | "Riêng tư" = `config.credential_secret_id ≠ null` (từ `SourceView`). Id khoá không còn trong danh sách ⇒ "Khoá không còn" |
| FC5 | Chế độ hiệu lực tính bằng `effectiveApplyMode`/`gitProviderOf` của contract. Radio `pr`/`auto_merge` `disabled` khi host không hỗ trợ; URL đổi sang host đó khi đang chọn chúng ⇒ về `branch_only` kèm hint `applyMode.hostHint` |
| FC6 | Chỉ gửi `apply_mode` khi người dùng chủ động chọn (vắng = mặc định theo host, PC2-R02); `credential_secret_id` = id hoặc `null` |
| FC7 | `local_path`: không render radio; hiện badge "Chỉ nhánh (cố định)" + hint (mockup 2). Chỉ platform_admin tạo được `local_path` nên tenant_admin thường chỉ thấy nó ở chế độ xem |
| FC9 | Kiểu "Người thực hiện" thêm "Áp bản sửa" (`executor.kind="apply"`): ẩn agent/chỉ dẫn/nguồn/ngân sách/tự sửa mã/must_know; `real_action` bật + `disabled`; "Sau stage" = `auto` + `disabled` ⇒ `APPLY_REAL/AFTER/FIELDS` chỉ gặp với def cũ. Đổi kiểu giữ draft ô đã ẩn (mẫu FC8 P-c) |
| FC10 | `APPLY_NO_AUTOFIX`/`APPLY_MAX` hiện live (`role=alert`) trong khối stage bằng `applyStageIssues(stages)` (contract, dùng chung server); 5 mã `APPLY_*` từ 422 `PROCESS_DEF_INVALID.rules[]` map cùng bảng (`serverPaths`) |
| FC11 | `ApplyResult` mỗi app một bản (nợ gộp đã ghi TECH-DEBT từ P-c); nhận `stage.apply` + `diff_file` của stage tự sửa mã liền trước (cho "Tải .diff") |
| FC12 | Liên kết PR: render `<a>` **chỉ khi** `pr_url` bắt đầu `https://` (server đã kiểm PC2-R15; client kiểm lại phòng thủ), `target="_blank" rel="noopener noreferrer"`, nội dung `PR #n` (không in URL thô). URL không hợp lệ ⇒ chỉ chữ `PR #n`, không link |
| FC13 | Dòng gate "Đạt sẽ…" lấy từ `AutofixStageView.apply_mode` + `apply_base` (backend đã chấp nhận C9–C12). Luật: `apply_mode=null` ⇒ không hiện dòng · `branch_only` và `apply_base===null` ⇒ `gate.local` · `branch_only` có `apply_base` ⇒ `gate.branch_only` · `pr` ⇒ `gate.pr` · `auto_merge` ⇒ `gate.auto_merge` (`{{base}}`=`apply_base`). `pr`/`auto_merge` mà `apply_base===null` (không xảy ra) ⇒ không hiện dòng |
| FC14 | `apply_conflict`/`apply_failed`: nút theo `task.options` (`[add_attempt, cancel]`), giữ nhãn sẵn có "Thêm 1 lần làm lại" / "Huỷ lượt chạy" (lệch mockup "Thêm lượt" có chủ đích, như P-c FC10). Câu `apply_failed` theo `apply.error_code`; mã lạ ⇒ `decision.failed.generic` |
| FC15 | `error_code=check_failed` dùng lại `AutofixFailures`; `conflict_files` ≤ 50 dòng `mono`, `break-all` |

## 1. Màn / component

### 1.1 admin-web · `/sources` (Pc2-Sources, Pc2-Credential; ADM-FR-68, HUB-FR-129)
| Phần | Chi tiết |
|---|---|
| `components/CredentialField.tsx` | `Select` "Khoá nguồn": khoá của tenant + "Không — repo công khai" (`null`) + "+ Tạo khoá mới…" (sentinel mở `CredentialDialog`). Chỉ cho `git_remote` |
| `components/ApplyModeField.tsx` | `RadioGroup` "Chế độ áp" 3 lựa chọn + mô tả, badge "Mặc định"; `local_path` ⇒ badge cố định (FC7). Gắn vào `KindFields` |
| `CredentialSheet` · `CredentialForm` · `CredentialDialog` (lazy) | Danh sách (FC2), form tạo (tên + token `type=password`, note quyền PAT), form thay (một ô, "Lưu" `disabled` tới khi nhập), xác nhận xoá `AlertDialog`; khoá đang dùng ⇒ "Xoá khoá" `disabled` + `credential.inUse` |
| `lib/credential-schema.ts` (+test) | tên theo `HUB_SECRET_NAME_RE`, token 8–2048 không trim (import contract) |
| `lib/schemas.ts` | thêm `credential_secret_id`, `apply_mode?` vào `SourceFormValues` ↔ request (FC6) |
| `lib/errors.ts` | `SOURCE_CREDENTIAL_INVALID` ⇒ ô Khoá nguồn; `SOURCE_APPLY_UNSUPPORTED` ⇒ ô Chế độ áp; `SOURCE_UNRESOLVABLE` khi kiểm tra: nguồn có khoá ⇒ `check.unresolvable.private`, không khoá ⇒ câu sẵn có + `check.privateNoKey`; khoá: `SECRET_NAME_TAKEN` ⇒ ô Tên (`credential.err.taken`), `SECRET_IN_USE` ⇒ `credential.inUse` (+ `used_by`), `VERSION_CONFLICT` ⇒ refetch + toast `credential.conflict` |
| `SourceTable.tsx` | badge "Riêng tư" cạnh loại + cột "Chế độ áp" (`effectiveApplyMode`) |
| Trạng thái | Khoá: đang tải (skeleton `aria-busy`) · rỗng "Chưa có khoá nguồn." · lỗi tải + Thử lại · không quyền (403 ⇒ ẩn nút, ô Khoá nguồn chỉ đọc) · xung đột 409. Quyền: nút và ô chỉ cho `tenant_admin`/`platform_admin` |

### 1.2 admin-web · editor (Pc2-Editor)
`StageGeneral` thêm kiểu "Áp bản sửa"; khối `components/editor/StageApply.tsx` (≤ 80 dòng: mô tả, badge Hợp lệ, ghi chú nhánh, vùng lỗi). `lib/def-form.ts`: `executor:{kind:"apply"}`. `lib/apply-form.ts` (thuần, +test): ép giá trị FC9 + `applyStageIssues`. `StageNode` hiện badge "Áp bản sửa". `readOnly` ⇒ mọi ô `disabled`.

### 1.3 Kết quả Áp (Pc2-Result; chat-web gate/run/thread, admin-web run)
`ApplyResult.tsx` (≤ 120 dòng, thuần) mỗi app + `lib/apply-view.ts` (nhãn, `sha7`, `branchShort` = `ai/9f3c…/fix`, `prLinkOk`).
| `status` | Hiển thị |
|---|---|
| `pr_opened` | "Đã mở PR" + link `PR #n ↗` + nhánh (`→ <apply_base>` nếu có) + commit `sha7(head_sha)`; `rebased` ⇒ badge "Đã rebase lên `sha7(target_sha)`" + hint; `auto_merge` `on` ⇒ "Tự gộp: bật", `failed` ⇒ cảnh báo "Tự gộp: không bật được" + hint |
| `pushed` | "Đã đẩy nhánh" + nhánh + commit + `pushedOnly` |
| `branch_only` (local, không job) | "Chỉ nhánh" + hướng dẫn + `git apply <tên>.diff` + "Tải .diff" (tên = `diff_file.name`); thiếu `diff_file` ⇒ chỉ chữ |
| `no_changes` | "Không có thay đổi" + câu |
| `conflict`/`check_failed`/`failed` | Dòng run view: "Xung đột · n file" / "Kiểm không đạt" / "Lỗi áp"; chi tiết ở §1.4 |
| Chưa có `apply` | Không hiện khối (`StageStrip` sẵn có) |
Gate stage tự sửa mã: dòng `note` theo luật FC13 (`apply_mode` + `apply_base`). Thread (`RunCard`/`StatusLine`) + admin `RunProgress`: badge "Áp bản sửa" + trạng thái + `#n ↗` (FC12).

### 1.4 Cần người quyết (Pc2-Decision)
`decision-reason.ts` (chat-web + bản admin) thêm `apply_conflict`, `apply_failed` (`reasonKey` + `reasonHintKey`). `ApplyIssue.tsx` cạnh `AutofixFailures`: conflict ⇒ danh sách file; failed ⇒ câu theo `error_code` (+ `AutofixFailures` khi `check_failed`). Nút theo `options` (FC14). `process-locales.test.ts` 14 → 16.

## 2. Validate client
| Trường | Luật (khớp contract) | Câu lỗi |
|---|---|---|
| Tên khoá | `HUB_SECRET_NAME_RE` `^[A-Za-z0-9_-]{2,64}$` | `credential.err.name` |
| Token | bắt buộc; 8–2048 đơn vị UTF-16, không trim | `credential.err.valueRequired` / `.valueLen` |
| Khoá nguồn | uuid \| null; khoá phải có trong danh sách | server `SOURCE_CREDENTIAL_INVALID` |
| Chế độ áp | `pr`/`auto_merge` chỉ khi `gitProviderOf(url)≠null` (FC5) | server `SOURCE_APPLY_UNSUPPORTED` |
| Stage Áp | `applyStageIssues` (FC10) | `process.admin.apply.err.*` |
Server là chuẩn; client chỉ chặn sớm cùng luật.

## 3. Câu chữ VI / EN nguyên văn
Khoá: nguồn/khoá `process.sources.*` (`packages/i18n/locales/process/sources.{vi,en}.json`); editor `process.admin.apply.*` (`admin.*.json`); kết quả + quyết định + gate `process.common.apply.*` (chat-web `process-locales.ts`; admin dùng bản chung hoặc chép như autofix). `{{x}}` nội suy.

**Nguồn / khoá (`process.sources.`)**
| Khoá | VI | EN |
|---|---|---|
| `credential.label` | Khoá nguồn | Source credential |
| `credential.none` | Không — repo công khai | None — public repo |
| `credential.new` | + Tạo khoá mới… | + Create new credential… |
| `credential.gone` | Khoá không còn | Credential no longer exists |
| `credential.hint` | Dùng để đọc repo riêng tư và đẩy nhánh / mở PR. Token không hiện lại sau khi lưu. | Used to read private repos and to push branches / open PRs. The token is not shown again after saving. |
| `credential.create.title` | Tạo khoá nguồn | Create source credential |
| `credential.name` / `.name.ph` | Tên khoá / vd: gh-acme-pat | Credential name / e.g. gh-acme-pat |
| `credential.token` / `.token.ph` | Token / github_pat_… | Token / github_pat_… |
| `credential.token.hint` | Chỉ ghi. Sau khi lưu không xem lại được. | Write-only. It cannot be viewed after saving. |
| `credential.pat` | Quyền tối thiểu của PAT (fine-grained, chỉ repo cần dùng): Contents: Read and write · Pull requests: Read and write. Repo công khai chỉ đọc thì không cần khoá. | Minimum PAT permissions (fine-grained, only the repos you need): Contents: Read and write · Pull requests: Read and write. A public repo that is only read needs no credential. |
| `credential.save` / `.cancel` | Lưu khoá / Huỷ | Save credential / Cancel |
| `credential.rotate.token` / `.ph` | Token mới / Nhập token mới để thay (token cũ bị ghi đè) | New token / Enter a new token to replace it (the old token is overwritten) |
| `credential.delete` | Xoá khoá | Delete credential |
| `credential.delete.title` | Xoá khoá "{{name}}"? | Delete credential "{{name}}"? |
| `credential.inUse` | Khoá đang được {{n}} nguồn dùng nên chưa xoá được. Gỡ khoá khỏi các nguồn đó trước. | The credential is used by {{n}} sources, so it cannot be deleted yet. Remove it from those sources first. |
| `credential.conflict` | Khoá vừa được người khác sửa. Đã tải lại bản mới. | Someone else just changed this credential. The latest version was reloaded. |
| `credential.err.name` | Tên khoá gồm 2–64 ký tự: chữ, số, gạch dưới hoặc gạch nối. | The name must be 2–64 characters: letters, digits, underscore or hyphen. |
| `credential.err.valueRequired` | Nhập token (8–2048 ký tự). | Enter a token (8–2048 characters). |
| `credential.err.valueLen` | Token dài 8–2048 ký tự. | The token must be 8–2048 characters. |
| `credential.err.taken` | Tên khoá đã có trong công ty này. | A credential with this name already exists in this company. |
| `applyMode.label` | Chế độ áp | Apply mode |
| `applyMode.pr` / `.pr.hint` | Mở PR / Đẩy nhánh ai/… và mở pull request để người trong repo duyệt. | Open a PR / Push an ai/… branch and open a pull request for the repo team to review. |
| `applyMode.auto_merge` / `.auto_merge.hint` | Mở PR và tự gộp / Bật auto-merge (squash). Cần bật "Allow auto-merge" và branch protection trên GitHub; nếu không, PR vẫn mở và chờ gộp tay. | Open a PR and auto-merge / Enables auto-merge (squash). "Allow auto-merge" and branch protection must be on in GitHub; otherwise the PR stays open for a manual merge. |
| `applyMode.branch_only` / `.branch_only.hint` | Chỉ nhánh / Đẩy nhánh ai/…, không mở PR. | Branch only / Pushes an ai/… branch without opening a PR. |
| `applyMode.default` | Mặc định | Default |
| `applyMode.hostHint` | Chỉ GitHub (github.com) hỗ trợ mở PR. Máy chủ git khác chỉ đẩy nhánh. | Only GitHub (github.com) supports opening PRs. Other git hosts can only push a branch. |
| `applyMode.local` / `.local.hint` | Chỉ nhánh (cố định) / Nguồn đường dẫn cục bộ không đẩy lên đâu cả. Người duyệt tải file .diff và tự git apply. | Branch only (fixed) / A local path source is not pushed anywhere. The reviewer downloads the .diff file and runs git apply. |
| `apiError.SOURCE_CREDENTIAL_INVALID` | Khoá nguồn không dùng được. Chọn khoá khác của công ty này. | This credential cannot be used. Choose another credential of this company. |
| `apiError.SOURCE_APPLY_UNSUPPORTED` | Máy chủ git này chưa hỗ trợ mở PR. Chọn "Chỉ nhánh". | This git host does not support opening PRs yet. Choose "Branch only". |
| `check.unresolvable.private` | Không đọc được repo. Khoá nguồn sai, hết hạn hoặc không đủ quyền. | Could not read the repo. The credential is wrong, expired or lacks permission. |
| `check.privateNoKey` | Nguồn riêng tư chưa có khoá nguồn. Gán khoá để đọc và đẩy nhánh. | This private source has no credential. Assign one to read it and push branches. |

**Editor (`process.admin.apply.`)**
| Khoá | VI | EN |
|---|---|---|
| `title` | Áp bản sửa | Apply the fix |
| `kind` | Áp bản sửa | Apply the fix |
| `hint` | Đẩy nhánh và mở PR bằng bản sửa người vừa duyệt ở bước trước. Chạy bằng chương trình, không dùng agent. Chế độ áp lấy theo nguồn của stage tự sửa mã. | Pushes a branch and opens a PR with the fix the reviewer just approved. Runs as a program, with no agent. The apply mode comes from the source of the autofix stage. |
| `realAction` / `fixed` | Hành động thật / Bật (cố định) | Real action / On (fixed) |
| `after.fixed` | Chạy tiếp (cố định) | Continue (fixed) |
| `valid` | Hợp lệ | Valid |
| `err.APPLY_NO_AUTOFIX` | Stage Áp phải đứng ngay sau stage tự sửa mã. | The apply stage must come right after the autofix stage. |
| `err.APPLY_MAX` | Mỗi quy trình chỉ có một stage Áp. Đã có ở stage "{{stage}}". | A process can have only one apply stage. It is already set on stage "{{stage}}". |
| `err.APPLY_REAL` | Stage Áp phải bật "Hành động thật". | The apply stage must have "Real action" on. |
| `err.APPLY_AFTER` | Stage Áp phải chạy tiếp sau khi xong, không có bước duyệt. | The apply stage must continue when done, with no review step. |
| `err.APPLY_FIELDS` | Stage Áp không có nguồn, tự sửa mã, ngân sách token hay kiến thức cần biết. | The apply stage has no sources, autofix, token budget or must-know. |

**Kết quả / gate / quyết định (`process.common.apply.`)**
| Khoá | VI | EN |
|---|---|---|
| `title` / `region` (aria) | Áp bản sửa / Kết quả áp bản sửa | Apply the fix / Apply result |
| `status.pr_opened` | Đã mở PR | PR opened |
| `status.pushed` | Đã đẩy nhánh | Branch pushed |
| `status.branch_only` | Chỉ nhánh | Branch only |
| `status.no_changes` | Không có thay đổi | No changes |
| `status.conflict` | Xung đột · {{n}} file | Conflict · {{n}} files |
| `status.check_failed` | Kiểm không đạt | Check failed |
| `status.failed` | Lỗi áp | Apply failed |
| `pr` | PR #{{n}} | PR #{{n}} |
| `rebased` | Đã rebase lên {{sha}} | Rebased onto {{sha}} |
| `rebased.hint` | Nhánh mặc định đã đổi nên bản sửa được áp lại và chạy lại test trước khi đẩy. | The default branch changed, so the fix was re-applied and the tests were run again before pushing. |
| `auto.on` | Tự gộp: bật | Auto-merge: on |
| `auto.failed` | Tự gộp: không bật được | Auto-merge: could not enable |
| `auto.failed.hint` | PR vẫn mở, cần gộp tay. Kiểm tra repo đã bật "Allow auto-merge" chưa. | The PR stays open and needs a manual merge. Check that the repo has "Allow auto-merge" on. |
| `branch` / `commit` | Nhánh {{branch}} / commit {{sha}} | Branch {{branch}} / commit {{sha}} |
| `pr.aria` | Mở PR #{{n}} trên GitHub (tab mới) | Open PR #{{n}} on GitHub (new tab) |
| `pushedOnly` | Nguồn đặt chế độ "Chỉ nhánh" nên không mở PR. | The source is set to "Branch only", so no PR was opened. |
| `local.hint` | Nguồn đường dẫn cục bộ không đẩy lên đâu. Tải bản sửa rồi áp vào máy của bạn: | A local path source is not pushed anywhere. Download the fix and apply it on your machine: |
| `downloadDiff` | Tải .diff | Download .diff |
| `noChanges.hint` | Bản sửa trùng nguồn nên không có gì để đẩy. | The fix matches the source, so there is nothing to push. |
| `gate.pr` | Đạt sẽ mở PR vào {{base}}. | Passing will open a PR into {{base}}. |
| `gate.auto_merge` | Đạt sẽ mở PR vào {{base}} và tự gộp khi đủ điều kiện. | Passing will open a PR into {{base}} and auto-merge when it is allowed. |
| `gate.branch_only` | Đạt sẽ đẩy nhánh lên repo, không mở PR. | Passing will push a branch to the repo without opening a PR. |
| `gate.local` | Đạt chỉ chốt bản sửa. Tải .diff để tự áp vào máy. | Passing only approves the fix. Download the .diff to apply it yourself. |
| `decision.conflict.title` | Bản sửa xung đột với mã mới | The fix conflicts with the new code |
| `decision.conflict.hint` | Nhánh main đã đổi và bản sửa không áp lại được. Muốn sửa trên mã mới thì chạy lại quy trình. Chọn thêm lượt chỉ có ích khi đã xử lý xung đột ở repo. | The default branch changed and the fix cannot be re-applied. To fix against the new code, run the process again. Adding a round only helps once the conflict is resolved in the repo. |
| `decision.conflict.files` | File xung đột | Conflicting files |
| `decision.failed.title` | Áp bản sửa không thành công | Applying the fix failed |
| `decision.failed.generic` | Không áp được bản sửa. Thử lại hoặc huỷ. | The fix could not be applied. Retry or cancel. |
| `err.auth` | GitHub từ chối khoá nguồn (sai, hết hạn hoặc không đủ quyền). Thay khoá ở trang Nguồn rồi thử lại. | GitHub rejected the source credential (wrong, expired or lacking permission). Replace the credential on the Sources page, then retry. |
| `err.no_credential` | Nguồn chưa có khoá nguồn nên không đẩy được nhánh. Gán khoá ở trang Nguồn rồi thử lại. | The source has no credential, so the branch cannot be pushed. Assign one on the Sources page, then retry. |
| `err.push_rejected` | GitHub từ chối nhận nhánh (bị bảo vệ hoặc bị chặn). Thử lại hoặc huỷ. | GitHub refused the branch (protected or blocked). Retry or cancel. |
| `err.network` | Không kết nối được tới GitHub. Thử lại sau. | Could not reach GitHub. Try again later. |
| `err.rate_limited` | GitHub giới hạn tần suất gọi. Đợi vài phút rồi thử lại. | GitHub is rate-limiting requests. Wait a few minutes, then retry. |
| `err.provider_error` | GitHub báo lỗi khi mở PR. Thử lại sau. | GitHub reported an error while opening the PR. Try again later. |
| `err.check_failed` | Sau khi gộp với mã mới nhất, bản sửa không qua kiểm lại (test, đường dẫn, kích thước hoặc bí mật). Chạy lại quy trình trên mã mới, hoặc huỷ. | After merging with the latest code the fix did not pass the checks again (tests, paths, size or secrets). Run the process again on the new code, or cancel. |
| `err.unsupported_provider` | Máy chủ git của nguồn chưa hỗ trợ mở PR. Đổi chế độ áp của nguồn sang "Chỉ nhánh". | The source's git host does not support opening PRs. Change the source's apply mode to "Branch only". |
Nút gate/quyết: không thêm khoá, giữ "Đạt"/"Chưa đạt" và "Thêm 1 lần làm lại"/"Huỷ lượt chạy". Toast tải thất bại: dùng `download.err` sẵn có của P-c.

## 4. Map lỗi contract → câu
Bảng lỗi ở §1.1 (`errors.ts`) và FC10/FC14. Khác: tải `.diff` lỗi ⇒ toast `download.err`; `PROCESS_RUN_STATE`/`NOT_PROCESS_DECIDER` ⇒ khoá `process.*.apiError.*` sẵn có. Kênh nội bộ (`APPLY_NOT_EXPECTED`, `source-credential`) FE không gặp.

## 5. Role + nhãn e2e (QC dùng; BUILD phải giữ)
| Màn | Phần tử (role "nhãn") |
|---|---|
| Nguồn | `combobox "Khoá nguồn"` (option "Không — repo công khai", "+ Tạo khoá mới…") · `radiogroup "Chế độ áp"` với `radio "Mở PR"` / `"Mở PR và tự gộp"` / `"Chỉ nhánh"` · `text "Chỉ nhánh (cố định)"` · `alert` chứa câu `apiError.SOURCE_*` · `button "Lưu"` · `button "Kiểm tra kết nối"` · bảng: cột "Chế độ áp", `text "Riêng tư"` |
| Khoá | `button "Khoá nguồn"` → `dialog "Khoá nguồn"` (`button "Tạo khoá"`; hàng có `button "Thay token"`, `button "Xoá khoá"`) · tạo: `dialog "Tạo khoá nguồn"` với `textbox "Tên khoá"`, `textbox "Token"`, `button "Lưu khoá"`, `button "Huỷ"` · thay: `textbox "Token mới"`, `button "Lưu"` · xoá: `alertdialog` + `button "Xoá khoá"` |
| Editor | `combobox "Người thực hiện"` option `"Áp bản sửa"` · `switch "Hành động thật"` (checked, disabled) · `alert` câu `err.APPLY_*` · `text "Hợp lệ"` |
| Kết quả | `region "Kết quả áp bản sửa"` với `text "Đã mở PR"`/`"Đã đẩy nhánh"`/`"Chỉ nhánh"`/`"Không có thay đổi"` · `link "PR #n"` (https, `_blank`) · `text "Đã rebase lên <sha7>"` · `text "Tự gộp: bật"`/`"Tự gộp: không bật được"` · `button "Tải .diff"` |
| Gate | `region "Kiểm <stage>"` (sẵn có) chứa `text "Đạt sẽ mở PR vào <nhánh>."` (hoặc biến thể) · `button "Đạt"`/`"Chưa đạt"` |
| Cần quyết | `region "Cần người quyết"` · heading `Bản sửa xung đột với mã mới` / `Áp bản sửa không thành công` · `text` file xung đột, câu `err.<code>` · `button "Thêm 1 lần làm lại"` / `"Huỷ lượt chạy"` |
| Thread | `article` chứa `text "Áp bản sửa"` + `"Đã mở PR"`/`"Xung đột · n file"` + `link "#n"` |
`data-testid` chỉ cho vùng không role: `apply-conflict-file-<index>`.

## 6. Hiệu năng / a11y
`CredentialSheet` lazy (chỉ mở theo yêu cầu); danh sách khoá ≤ 100, không virtualize; `ApplyResult` thuần, `memo`. Token: `autoComplete="off"`, không vào query key/URL/log, reset form khi đóng. Badge kèm chữ; link ngoài có `aria-label` + `rel`; lỗi `role=alert`; tương phản ≥ 4.5:1 theo token canvas.

## 7. Đã thống nhất với backend-lead (readiness lần 1; không còn đề nghị mở, không mặc định dự phòng)
| # | Nội dung | FE dùng |
|---|---|---|
| C9 | `AutofixStageView.apply_base: string \| null` (= `config.branch` nguồn khi `apply_mode ≠ null`) | Luật gate FC13 |
| C10 | `ApplyStageView.test_log_file: {id,name} \| null` | Đuôi log khi `check_failed` sau rebase (`AutofixFailures`) |
| C11 | `error_code` luôn có khi `status ∈ {failed, check_failed}` | Câu `err.<code>` (FC14) |
| C12 | `GET /admin/source-credentials`: tenant_admin không cần `tenant_id`, platform_admin gửi `tenant_id` | FC3 |
| R1 | Stage Áp: `executor = {kind:"apply", key:"apply", name:{vi:"Áp bản sửa", en:"Apply the fix"}}` | Nhãn stage Áp đọc từ `process.admin.apply.kind` (không lấy `executor.name`) |

## 8. Bẫy
- `fieldForCode` mở rộng (`errors.test.ts`); `SOURCE_*` mới ngoài union `ApiErrorCode` ⇒ dùng `hasCode`.
- `EXECUTOR_KINDS += apply`: mọi `switch (executor.kind)` (`def-form`, `canvas-layout`, `step-label`) cần nhánh. `DECISION_REASONS += 2`: `process-locales.test.ts` 14 → 16, `decision-reason.test.ts`.
- Nguồn cũ đọc `?? null`, không gửi `apply_mode` (FC6). Sentinel "+ Tạo khoá mới…" không lọt vào giá trị form. Link PR chỉ từ `pr_url` đã kiểm, không nối từ `pr_number`.

## 9. Task FE (chi tiết `tasks.md`)
| Task | Phạm vi | Lệnh xong |
|---|---|---|
| F1 | §1.1 + i18n `process.sources.*` + `credential-schema.ts`, `schemas.ts`, `errors.ts` | `bun run typecheck && bun test apps/admin-web/src/features/sources && bun run i18n:check && bun run db:test:create pc2_e2e && bunx playwright test -c e2e/P-c2/playwright.pc2.config.ts --reporter=line admin/sources.pc2.ts` |
| F2 | §1.2 + i18n `process.admin.apply.*` + `apply-form.ts`, `def-form.ts` (`kind==="apply"` ⇒ `"apply"`: B1 làm nhánh tối thiểu, F2 làm nốt UI) | `bun run typecheck && bun test apps/admin-web/src/features/processes && bun run i18n:check && bun run db:test:create pc2_e2e && bunx playwright test -c e2e/P-c2/playwright.pc2.config.ts --reporter=line admin/editor.pc2.ts` |
| F3 | §1.3, §1.4 (hai app) + i18n `process.common.apply.*` + `decision-reason` | `bun run typecheck && bun test apps/chat-web apps/admin-web && bun run i18n:check && bun run db:test:create pc2_e2e && bunx playwright test -c e2e/P-c2/playwright.pc2.config.ts --reporter=line chat/ && bunx playwright test -c e2e/P-c/playwright.pc.config.ts --reporter=line` (hồi quy P-c) `&& bun run test:lock:verify` |
