# Plan FE · P-c1 Tự sửa mã (admin-web + chat-web)

Mockup đã duyệt 2026-10-13: `docs/design/agent-hub/canvas/Pc-{Editor,Diff,Decision}.dc.html` (chuẩn; plan này chỉ lấp chỗ trống). Contract tiêu thụ: `plan.md` §3.1, §3.4 (FE không đổi). Luật: spec §2 PC-R01/R02/R08/R09/R10/R11. Mẫu bám: P-b2 `plan-frontend.md` (canvas, StageForm, DecisionCard).

## 0. Quyết định FE (Luật 2)
| # | Quyết định |
|---|---|
| FC1 | Không thêm thư viện. Diff hiển thị bằng parser thuần ~80 dòng (`diff-parse.ts`) + `<details>` mỗi file; không ADR |
| FC2 | Hai app không chung code UI (chưa có `packages/ui`) ⇒ `diff-parse.ts` + `AutofixResult` chép mỗi app, test giống nhau; ghi `TECH-DEBT.md` (gộp khi có `packages/ui`) |
| FC3 | Cắt hiển thị 2.000 dòng đầu của diff (đếm dòng đã tải); còn lại ⇒ cảnh báo "Diff lớn" + "Tải .diff". Không virtualize (trần cứng 2 MiB, 300 file) |
| FC4 | Nội dung diff/log tải qua `GET /attachments/:id/content` (có Bearer) bằng `fetchAttachmentBlob` sẵn có; `diff_file.id`/`test_log_file.id` từ `AutofixStageView`. Không đưa diff vào cache dài: `staleTime` 5 phút, key `["autofix-diff", attachmentId]` (bất biến theo id) |
| FC5 | Đuôi log test ở thẻ `autofix_check_failed`: tải `test_log_file` rồi lấy 30 dòng cuối (đã che `[REDACTED]` phía Runtime). Không có `test_log_file` ⇒ chỉ hiện exit + thời gian |
| FC6 | Nhãn nhóm lỗi dịch theo `failure.check`; `detail` hiện nguyên văn (≤ 500, server bảo đảm không bí mật); `check:"secrets"` **không** hiện `detail`, chỉ `path:line · quy tắc <rule>` |
| FC7 | Nút "Đạt" / "Chưa đạt" / "Thêm 1 lần làm lại" / "Huỷ lượt chạy" (nhãn sẵn có, G6) dùng thẻ gate/decision sẵn có (`ReviewTaskCard`, `DecisionCard`, `RunActions`); P-c chỉ chèn khối `AutofixResult` vào thẻ có stage tự-sửa. `options` lấy từ `task.options` (server, PC-R10), FE không suy |
| FC8 | Công tắc "Tự sửa mã" tắt ⇒ `autofix: null`; tắt rồi bật lại giữ giá trị đã nhập trong draft (không mất khi lưu hỏng) |
| FC10 | (2026-10-13, G6/G7 theo test-plan §6) giữ nhãn nút sẵn có; thẻ thread = `article` chứa "Tự sửa mã" + "Xem diff"; "Tải .diff"/"Tải log đầy đủ" button hoặc link (G8) |
| FC9 | Chọn nguồn: chỉ liệt kê nguồn khai báo của quy trình có `kind ∈ {git_remote, local_path}`; nguồn `library` hiện mờ + chú thích (vẫn chọn được nếu def cũ → lỗi server hiện đúng artboard 7) |

## 1. Màn / component

### 1.1 admin-web · editor (Pc-Editor; ADM-FR-65, HUB-FR-119)
Vị trí: `StageForm` thêm `<StageAutofix/>` dưới `StageSourcesField`. Draft: `StageDraft.autofix: {on, source, install, test, allow}` (`allow` = mỗi dòng/dấu phẩy một glob) ↔ `ProcessStageDef.autofix` trong `lib/def-form.ts` (`toDef`/`fromDef`). Không có DDL/route mới (lưu qua PUT def sẵn có).
| Phần | Chi tiết |
|---|---|
| Component | `components/editor/StageAutofix.tsx` (≤ 120 dòng): Switch + Select nguồn + 3 TextField (shadcn `Switch`, `Select`, `Input`, `Alert`); ghi chú mạng (`note`) hiện khi bật |
| Hợp lệ badge | "Hợp lệ" khi bật, đủ nguồn + test, không lỗi ô (chỉ hiển thị; server là chuẩn) |
| Validate client (`lib/autofix-form.ts`, thuần) | `source` bắt buộc khi bật · `test` trim 1..1000 · `install` rỗng ⇒ `null`, nếu có 1..1000 · không NUL · `allow` ≤ 20 mẫu, mỗi mẫu theo `GlobSchema` (import từ contract) · luật chéo `autofixStageIssues(stages)` từ `@ai/contracts/hub-admin` (dùng chung server) ⇒ `AUTOFIX_EXECUTOR` đặt lỗi ở ô "Người thực hiện" (`stages.N.executor`), `AUTOFIX_REVIEW` ở ô "Sau stage" (`stages.N.after`), `AUTOFIX_MAX` ở khối (`stages.N.autofix`) |
| Lỗi server | `PROCESS_REF_INVALID{path:"stages.N.autofix.source_key", ref:"source"}` ⇒ lỗi ô Nguồn (artboard 7); `PROCESS_DEF_INVALID` có `rules[]` ⇒ cùng map như client (`STEP_ERR` mở rộng 3 mã) |
| Quyền | `readOnly` (template / thiếu quyền) ⇒ mọi ô `disabled`, chỉ xem — như `StageSourcesField` |
| Canvas | `StageNode` hiện badge nhỏ "Tự sửa mã" khi `autofix ≠ null` (không đổi layout) |

### 1.2 Khối kết quả `AutofixResult` (Pc-Diff; dùng ở chat-web gate "Chờ tôi kiểm", chat-web trang run, admin-web trang run)
Vào: `stage.autofix: AutofixStageView`. `features/processes/.../autofix/` mỗi app: `AutofixResult.tsx` (đầu + trạng thái), `DiffView.tsx` (danh sách file + hunk), `use-autofix-diff.ts`, `lib/diff-parse.ts`, `lib/autofix-view.ts` (thuần: nhãn, `+x −y`, "nguồn@sha7", rút gọn nhánh `ai/9f3c…/fix`).
| Trạng thái (`status`) | Hiển thị |
|---|---|
| `ok` | Đầu: "Tự sửa mã" · badge "Vòng k" · `source_key@sha7` (sha7 = 7 ký tự đầu `pin` — xem "Cần backend-lead" #2) · nhánh · `+i` `−d` · "n file" · badge "Test đạt · 12,4 giây" (`exit_code=0`) · liên kết Xem log (mở `Dialog` đuôi log) / Tải log / Tải .diff. Dưới: danh sách file (nhị phân = badge "nhị phân", không nội dung) + `<details>` diff hợp nhất; file đầu mở sẵn |
| `no_changes` | Thẻ "Không có thay đổi" + câu hướng dẫn; vẫn hiện nút gate |
| `check_failed` | Trong gate/run view: dòng "Kiểm không đạt · <nhóm>" (không có diff); chi tiết ở thẻ Cần người quyết (1.3) |
| đang tải diff | Skeleton (`aria-busy`) |
| lỗi tải | "Không tải được diff" + `Thử lại` + `Tải .diff`; lỗi 404/403 attachment ⇒ cùng thẻ lỗi |
| chưa có kết quả (`autofix` vắng) | Không hiện khối (stage đang chạy: `StageStrip` sẵn có) |
Tải về: blob từ `fetchAttachmentBlob` → `URL.createObjectURL` → `<a download="<name>">` (tên = `diff_file.name`); không `<a href>` trần (cần Bearer). Cắt 2.000 dòng (FC3). Ngôn ngữ số: `Intl.NumberFormat(lang)` (12,4 / 12.4).

### 1.3 Cần người quyết (Pc-Decision; chat-web `DecisionCard`, admin-web `RunActions`)
- `autofix_check_failed`: tiêu đề "Kiểm bản sửa không đạt" + badge Vòng k + câu "Chưa lưu diff…"; component `AutofixFailures.tsx` nhóm `failures[]` theo `check` theo thứ tự: `paths` · `size` · `secrets` · `tests` (exit + thời gian + đuôi log + "Tải log đầy đủ") · `install` · `apply_patch`; chỉ nhóm có lỗi. Nút theo `options` (= Thêm lượt / Huỷ quy trình); ghi chú lượt thêm dùng ô note sẵn có.
- `failures = []` (Runtime chết, không báo cáo): hiện câu "Không nhận được báo cáo kiểm từ máy chạy." thay danh sách.
- `sandbox_unavailable`: tiêu đề + câu như artboard; không nhóm lỗi.
- `reasonKey`/`reasonHintKey` (`decision-reason.ts`) thêm 2 mã; `ReasonHint` hiện câu hướng dẫn.
- Dòng stage run view (admin `RunProgress`) + thẻ thread (`StatusLine`/`RunCard`): badge "Tự sửa mã" + "Vòng k" + kết quả kiểm gần nhất (`Test đạt` / `Kiểm không đạt · <nhóm đầu>` / `Không có thay đổi`) + `+i −d · n file` + liên kết/nút "Xem diff" (mở gate / cuộn tới khối).

## 2. Hook / state
| Hook | Việc |
|---|---|
| `use-autofix-diff(attachmentId)` | `useQuery(["autofix-diff", id], fetchAttachmentText)`, `staleTime` 5 phút, `enabled` khi khối hiển thị (diff chỉ tải khi mở thẻ); trả `{text,lines,truncated}` qua `parseDiff` |
| `use-autofix-log(attachmentId, tail=30)` | như trên, cho đuôi log / Xem log |
| `use-download(file)` | tạo blob URL, thu hồi sau click; lỗi ⇒ `toast.error` |
| Run/gate data | không hook mới: `autofix` đã nằm trong run view hiện có (invalidate theo realtime sẵn có `process.*`); không thêm sự kiện realtime |
Không context mới. Selector: `AutofixResult` nhận prop nguyên thuỷ (`view`), `memo` cho `DiffView`; `parseDiff` chạy trong `useMemo` theo `text`.

## 3. Câu chữ VI / EN nguyên văn
Khoá: admin `process.admin.autofix.*` (locale feature admin-web, chỗ `process.admin.*` hiện có); chat `process.common.autofix.*` (`process-locales.ts`); `{{x}}` nội suy.
| Khoá (hậu tố) | VI | EN |
|---|---|---|
| `title` | Tự sửa mã | Autofix |
| `switch.off` / `switch.on` | Tắt / Bật | Off / On |
| `hint` | Agent sửa file trong bản sao của nguồn và chỉ ra diff để người duyệt. Không push. | The agent edits files in a copy of the source and produces a diff for a person to review. Nothing is pushed. |
| `source` / `source.ph` / `source.hint` | Nguồn / Chọn nguồn… / Chỉ nguồn git_remote hoặc local_path. | Source / Select a source… / Only git_remote or local_path sources. |
| `test` / `test.ph` | Lệnh kiểm thử / vd: bun test | Test command / e.g. bun test |
| `install` / `install.ph` | Lệnh cài phụ thuộc / vd: bun install (bỏ trống = không cài) | Install command / e.g. bun install (leave empty = no install) |
| `allow` / `allow.ph` / `allow.hint` | Đường dẫn được sửa / vd: src/** (bỏ trống = mọi đường dẫn) / Tối đa 20 mẫu. Không cho sửa .github/workflows trừ khi ghi rõ. | Editable paths / e.g. src/** (empty = any path) / Up to 20 patterns. .github/workflows is blocked unless listed explicitly. |
| `net` | Container chạy agent và test không có mạng. Lệnh cài chạy trước, có mạng, tối đa 600 giây. Không đặt lệnh cài thì không có mạng. | The container that runs the agent and tests has no network. The install command runs first, with network, for up to 600 seconds. With no install command there is no network at all. |
| `valid` | Hợp lệ | Valid |
| `err.test` | Nhập lệnh kiểm thử (tối đa 1000 ký tự). | Enter a test command (up to 1000 characters). |
| `err.install` | Lệnh cài tối đa 1000 ký tự. | The install command can be at most 1000 characters. |
| `err.source` | Chọn nguồn để tự sửa mã. | Select a source to autofix. |
| `err.allow` | Tối đa 20 mẫu, mỗi mẫu là glob hợp lệ. | Up to 20 patterns, each a valid glob. |
| `err.AUTOFIX_EXECUTOR` | Stage tự sửa mã phải do agent thực hiện. | An autofix stage must be run by an agent. |
| `err.AUTOFIX_REVIEW` | Stage tự sửa mã luôn phải qua người duyệt. Chọn "Duyệt" ở mục Sau stage. | An autofix stage always needs a person to review it. Choose "Review" under After stage. |
| `err.AUTOFIX_MAX` | Mỗi quy trình chỉ có một stage tự sửa mã. Đã có ở stage "{{stage}}". | A process can have only one autofix stage. It is already set on stage "{{stage}}". |
| `err.sourceKind` | Nguồn "{{key}}" thuộc loại {{kind}}, không sửa được. Chọn nguồn git_remote hoặc local_path. | Source "{{key}}" is of kind {{kind}} and cannot be edited. Choose a git_remote or local_path source. |
| `round` | Vòng {{n}} | Round {{n}} |
| `testOk` | Test đạt · {{sec}} giây | Tests passed · {{sec}} s |
| `testFail` | Test đỏ · exit {{code}} · {{sec}} giây | Tests failed · exit {{code}} · {{sec}} s |
| `diffStat` | {{n}} file | {{n}} files |
| `binary` / `binaryNote` | nhị phân / File nhị phân, không hiển thị nội dung. | binary / Binary file, content not shown. |
| `viewLog` / `downloadLog` / `downloadDiff` | Xem log / Tải log / Tải .diff | View log / Download log / Download .diff |
| `fullLog` | Tải log đầy đủ | Download full log |
| `big` | Diff lớn: chỉ hiển thị 2.000 dòng đầu, còn {{rest}} dòng. Tải .diff để xem đủ. | Large diff: only the first 2,000 lines are shown, {{rest}} more. Download the .diff to see everything. |
| `noChanges` / `noChanges.hint` | Không có thay đổi / Agent không sửa file nào, hoặc bản sửa trùng nguồn. Chọn "Chưa đạt" nếu cần thêm lượt. | No changes / The agent changed no files, or the change matches the source. Choose "Not approved" to add a round. |
| `loadErr` / `loadErr.hint` | Không tải được diff / Kiểm tra kết nối rồi thử lại. Vẫn có thể tải file .diff. | Could not load the diff / Check your connection and try again. You can still download the .diff file. |
| `retry` | Thử lại | Retry |
| `files` (aria) | Danh sách file | File list |
| `region` (aria) | Kết quả tự sửa mã | Autofix result |
| `lastCheck` | Kiểm gần nhất: | Latest check: |
| `viewDiff` | Xem diff | View diff |
| `checkFailed` / `checkFailed.short` | Kiểm không đạt / Kiểm không đạt · {{group}} | Check failed / Check failed · {{group}} |
| `decision.check.title` | Kiểm bản sửa không đạt | The change did not pass checks |
| `decision.check.hint` | Chưa lưu diff. Chọn thêm một lượt (agent nhận tóm tắt lỗi dưới đây) hoặc huỷ quy trình. | No diff was saved. Add another round (the agent gets the error summary below) or cancel the process. |
| `decision.check.empty` | Không nhận được báo cáo kiểm từ máy chạy. | No check report was received from the runner. |
| `decision.sandbox.title` | Không có môi trường chạy an toàn | No safe runtime available |
| `decision.sandbox.hint` | Máy chạy chưa dựng được container cô lập nên không thể tự sửa mã. Liên hệ quản trị rồi chọn thêm lượt, hoặc huỷ. | The runner could not start an isolated container, so autofix cannot run. Contact your administrator, then add a round or cancel. |
| `group.paths` / `.size` / `.secrets` / `.tests` / `.install` / `.apply_patch` | Đường dẫn / Kích thước / Bí mật (không hiện giá trị) / Test đỏ · exit {{code}} · {{sec}} giây / Cài phụ thuộc / Áp bản vá lượt trước | Paths / Size / Secrets (values are never shown) / Tests failed · exit {{code}} · {{sec}} s / Install dependencies / Applying the previous round's patch |
| `secret.line` | {{path}}:{{line}} · quy tắc {{rule}} | {{path}}:{{line}} · rule {{rule}} |
Nút gate/quyết: P-c **không thêm khoá**, giữ nhãn sẵn có của chat-web (G6): gate = "Đạt" / "Chưa đạt"; Cần người quyết = "Thêm 1 lần làm lại" / "Huỷ lượt chạy" (không có "Dùng bản hiện có" cho `autofix_*`). Nhãn "Thêm lượt" / "Huỷ quy trình" / "Chưa đạt, làm lại" trong artboard chỉ là mô tả, không dùng làm nhãn. Câu `noChanges.hint` nói "Chọn \"Chưa đạt\" nếu cần thêm lượt." (EN: "Choose \"Not approved\"…" theo khoá EN sẵn có của nút).
Toast: tải thất bại `Không tải được tệp. Thử lại sau.` / `Could not download the file. Try again later.` (`download.err`). Thành công quyết định: khoá sẵn có.

## 4. Map lỗi contract → câu
| Nguồn | Mã | Câu |
|---|---|---|
| Lưu def | `PROCESS_DEF_INVALID` + `rules` | `AUTOFIX_EXECUTOR/REVIEW/MAX` → khoá `err.*` tại ô theo path (đã có `serverPaths`); mã khác → như hiện có |
| Lưu def | `PROCESS_REF_INVALID{ref:"source"}` đường `autofix.source_key` | `err.sourceKind` (kind lấy từ `def.sources`) tại ô Nguồn |
| Quyết định | `PROCESS_RUN_STATE`, `NOT_PROCESS_DECIDER` | khoá sẵn có `process.*.apiError.*` |
| Tải diff/log | 401/403/404/5xx/mạng | thẻ `loadErr` (không toast); tải về lỗi ⇒ toast `download.err` |
| Failure `check` lạ (contract mở rộng sau) | — | nhóm "Khác" dùng `detail`; không crash (switch có `default`) |
`AUTOFIX_NOT_EXPECTED/RESULT_EXISTS` là internal (Runtime ↔ Hub) — FE không gặp.

## 5. Role + nhãn e2e (QC dùng; BUILD phải giữ)
| Màn | Phần tử (role "nhãn") |
|---|---|
| Editor | `switch "Tự sửa mã"` · `combobox "Nguồn"` · `textbox "Lệnh kiểm thử"` · `textbox "Lệnh cài phụ thuộc"` · `textbox "Đường dẫn được sửa"` · `alert` chứa câu lỗi `err.*` · `button "Lưu"` (sẵn có) |
| Khối kết quả | `region "Kết quả tự sửa mã"` · `list "Danh sách file"` · `text "Vòng 2"` · `text "Test đạt · 12,4 giây"` (vi) · `link/button "Xem log"` `"Tải log"` `"Tải .diff"` · `text "Không có thay đổi"` · `alert "Không tải được diff"` + `button "Thử lại"` |
| Gate | thẻ `region "Kiểm <tên stage>"` (sẵn có) chứa `region "Kết quả tự sửa mã"` · `button "Đạt"` · `button "Chưa đạt"` (sẵn có) |
| Cần người quyết | `region "Cần người quyết"` · heading `Kiểm bản sửa không đạt` / `Không có môi trường chạy an toàn` · `button "Thêm 1 lần làm lại"` · `button "Huỷ lượt chạy"` (sẵn có; không có "Dùng bản hiện có") · nhóm `Đường dẫn` `Kích thước` `Bí mật (không hiện giá trị)` `Cài phụ thuộc` `Áp bản vá lượt trước` |
| Thread (G7) | thẻ thread là `article` (role sẵn có hoặc thêm `role="article"`) chứa `text "Tự sửa mã"` + `text "Vòng k"` + `button "Xem diff"` (button hoặc link đều được) |
Khoá `data-testid` chỉ cho vùng không có role: `autofix-diff-file-<index>`. E2E cần có (qc viết, fake-cli): (1) tạo def bật autofix → lưu OK, mở lại thấy đúng giá trị; (2) 3 lỗi `AUTOFIX_*` + nguồn library hiện đúng câu; (3) run `fixbug-apply` → gate hiện diff đúng +/−, file, Test đạt, tải .diff → Đạt → run xong; (4) Chưa đạt → vòng 2 cộng dồn ("Vòng 2"); (5) `#fake:ws_secret` → Cần người quyết nhóm Bí mật không lộ giá trị → Thêm lượt; (6) test đỏ → nhóm Test đỏ + đuôi log; (7) `no_changes`; (8) `sandbox_unavailable` (Runtime `off`) chỉ 2 nút; (9) user khác tenant không thấy run (404); (10) diff > 2.000 dòng hiện cảnh báo "Diff lớn"; (11) EN/VI chuyển ngôn ngữ.

## 6. A11y / hiệu năng
`region`/`list` có aria-label; badge không chỉ dùng màu (có chữ); diff dùng `<details><summary>`, +/− có ký tự đầu dòng (không chỉ màu), tương phản theo token (b-ok/b-err đã ≥ 4.5:1 theo canvas); `Switch` có `aria-label`; lỗi `role="alert"` + `aria-invalid`. Hiệu năng: `DiffView` chỉ render file mở (nội dung `<details>` đóng không mount), 2.000 dòng trần; parser chạy một lần/`text`; `AutofixResult`/`DiffView` thuộc chunk route run/gate sẵn có, không import eager vào shell; bundle không thêm thư viện (`check:bundle` giữ).

## 7. Cần backend-lead — ĐÃ CHỐT 2026-10-13 (spec §9): #1 có log khi `test ≠ null`; #2 thêm `pin_sha` (git_remote ⇒ sha đầy đủ, khác ⇒ null; FE cắt 7); #3 `my_tasks` không có `autofix`, FE dùng run view; #4 đúng như plan §3.3
| # | Nội dung | Mặc định FE nếu không đổi |
|---|---|---|
| 1 | `test_log_file` có được tạo cả khi `check_failed` có chạy test (để Cần người quyết hiện đuôi log + tải log)? plan §6.2 chỉ nói "diff/log" | Giả định có khi `test ≠ null`; vắng ⇒ chỉ hiện exit + thời gian |
| 2 | `AutofixStageView` thiếu `sha7` ghim nguồn (mockup có `repo-app@a1b2c3d`). Đề xuất thêm `pin_sha: string \| null` (từ `autofix_results.pin`) | Thiếu ⇒ hiện `source_key` không `@sha` (không chặn) |
| 3 | Task `autofix_check_failed` / review gate cần tìm `AutofixStageView` theo `stage_idx` trong run view: xác nhận view của `my_tasks` (chat inbox) có `autofix` hoặc FE phải gọi run view (thêm 1 request) | FE gọi run view sẵn có theo `run_id`, đã có ở `ProcessBlock` |
| 4 | `failures` cần luôn đúng thứ tự nhóm/`detail` ≤ 500 không bí mật (đã có trong plan §3.3) — FE chỉ nhóm lại | — |

## 8. Rủi ro / bẫy
- `DECISION_REASONS` mới: `process-locales.test.ts` đếm khoá lý do (14) ⇒ cập nhật khi thêm 2.
- `STEP_ERR` hiện cho luật bước; thêm 3 mã autofix vào bảng riêng tránh lẫn path.
- Diff có thể chứa HTML/JS: render bằng text node (React), không `dangerouslySetInnerHTML`.
- Tên file/đường dẫn dài: `break-all` + `title`; `detail` rendered text.
- Realtime làm lại stage: key diff theo `attachmentId` nên vòng mới tự tải lại.
