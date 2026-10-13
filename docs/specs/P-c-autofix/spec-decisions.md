# P-c · Quyết định chi tiết (phụ lục spec)

PLAN backend 2026-10-13. Spec chính: [`spec.md`](spec.md). Contract/DDL: [`plan.md`](plan.md). Hạ tầng: ADR-0011.

## §1 Vì sao P-c1 chỉ diff-only (Q1)
| Tiêu chí | P-c1 diff-only | Gộp PR vào cùng mốc |
|---|---|---|
| Tài liệu đã chốt | CR-061: "Phần diff-only làm trước phần PR"; HUB-FR-128 "làm trước, không cần mạng ra provider" | Không có chỗ nào yêu cầu gộp |
| Phụ thuộc ngoài | Không (repo công khai + `local_path`, Docker Desktop sẵn có) | Provider GitHub/GitLab thật, token `source_credential` thật (hard stop "secret thật"), repo thử để mở PR |
| Rủi ro mới | Container + kiểm diff (chính là rủi ro lõi) | + push ra ngoài, auto-merge, rebase/xung đột, quyền token tối thiểu |
| Giá trị dùng ngay | Có: người duyệt đọc diff, tải `.diff`, `git apply` tay | Có thêm PR tự động |
| Contract | P-c2 chỉ THÊM (stage "Áp" `real_action`, `sources.apply_mode`), không đổi P-c1 | — |
Kết luận: tách; P-c2 = HUB-FR-129, HUB-BR-34, `apply_mode` + UI màn Nguồn, rebase E4, repo riêng tư (Q5).

## §2 Lý do các quyết định B1–B8 (spec §9)
| # | Lựa chọn khác | Vì sao chọn cách trong spec |
|---|---|---|
| B1 nhánh `ai/<process_run_id>/<stage_key>` | `<step>` = số bước P-b2; id rút gọn 8 ký tự | Gate/làm lại theo stage; một bước có ≤ 3 stage ⇒ số bước không duy nhất. Id đầy đủ: không cần xử lý trùng khi push (P-c2) |
| B2 workspace từ snapshot đã lọc | `git clone` thô từ mirror | Một đường cho `git_remote` + `local_path`; tái dùng PB-R07 (không `.env*`/khoá/`.git` vào container); không có `.git` remote (cấu hình/hook độc). Khác: snapshot có trần riêng `caps=autofix` |
| B3 Runtime không trạng thái | Kho nhánh bare repo lâu dài ở Runtime | Không cần dọn theo TTL, restart/đổi máy không mất; Hub đã giữ diff (cần cho UI). P-c2 push: dựng nhánh từ commit ghim + diff cuối |
| B4 diff là attachment `text/plain` | Thêm MIME `text/x-diff`; cột `diff text` trong bảng | Không đổi allowlist upload của chat; không phình bảng; dùng sẵn endpoint tải file run + sweeper |
| B5 không công tắc tenant | Cờ `tenant_settings.autofix_enabled` | HUB-FR-130 "chỉ chạy khi tenant_admin bật" = bật bản chép quy trình (đã chỉ tenant_admin làm được) |
| B6 không rebase ở P-c1 | Rebase mỗi lần làm lại | Run ghim commit (HUB-BR-27); diff so với commit ghim luôn áp được lên chính commit đó. Rebase chỉ có nghĩa khi push/PR |
| B7 repo cố định trong def | Chọn bằng `source_ref` lúc chạy | `source_ref` (PB-R13) chỉ là đầu vào chữ cho agent, không đổi ghim. Ràng repo vào def giữ cổng ghim P-b nguyên vẹn |
| B8 không baseline test | Chạy test trước khi agent sửa | Thêm một lần chạy test dài; agent tự chạy được bằng `ws_exec` |

## §3 Cơ chế tool (Q4) — so sánh
| Phương án | Kết luận |
|---|---|
| A. Bash/Edit/Write/Read gốc của Claude CLI trên thư mục mount, Bash bọc `exec` qua hook sửa input | Hook sửa lệnh = chuỗi shell lồng, dễ thoát; Read/Edit gốc chạy trên host ⇒ container tạo symlink đua với kiểm `realpath` (TOCTOU) — **loại** |
| B. Cả Claude CLI chạy trong container | Phải đưa phiên subscription (`~/.claude`) vào container + mở egress Anthropic; mã repo đọc được token — **loại** (HUB-BR-34, ADR-0011 #4) |
| C. **4 tool MCP trong tiến trình Runtime, thực thi bằng `exec` trong container** | Mọi đọc/ghi/lệnh trên workspace xảy ra trong container; host chỉ chạy git cứng. Cần ngoại lệ HUB-BR-12 — **chọn** (Q4 duyệt 2026-10-13) |

## §4 Ánh xạ "Điểm còn mở" của khung (spec cũ §10) → trả lời
| # khung | Trả lời |
|---|---|
| 1 runtime/mạng/trần | ADR-0011 #1–#3 (Q2, Q6) |
| 2 cài phụ thuộc không egress | Pha chuẩn bị có mạng, chỉ `install_cmd` (Q2) |
| 3 provider PR, quyền token, nhánh trùng, auto-merge, làm lại | PR/provider/auto-merge ⇒ P-c2. Nhánh trùng: không xảy ra (id run đầy đủ). Làm lại: PC-R11 |
| 4 trần mặc định, kích thước repo | ADR-0011 #3; repo ≤ 200 MB / 20.000 file sau lọc (PC-R04) |
| 5 hình dạng diff + UI duyệt; chọn `apply_mode` | `AutofixStageView` (plan §3.4); mockup plan §8; `apply_mode` ⇒ P-c2 |
| 6 audit | `hub.autofix_results` (PC-R12) |
| 7 chọn repo/branch, một repo/job | B7; một repo/job |
| 8 AC + `done:pc` | qc |
| 9 allowlist đường dẫn ở đâu; quét bí mật; trần rebase | `write_allowlist` theo **stage** (quy trình); mẫu plan §5.4; rebase ⇒ P-c2 |

## §5 Nhật ký quyết định trong lúc làm — PLAN, contract, luật, DB, seed (chuyển từ spec §9)

- 2026-10-13 (chốt theo plan-frontend §7): (1) `test_log_file` được tạo cả khi `check_failed` nếu `test ≠ null` (log_tail đã che bí mật Runtime). (2) Thêm `pin_sha: string | null` vào `AutofixStageView` (git_remote ⇒ `pin.sha`, khác ⇒ null; không lộ path). (3) `my_tasks` không mang `autofix`; FE gọi run view sẵn có (`ProcessBlock`). Cross-check còn lại: không lệch khác; FE chỉ cần thêm `pin_sha` vào type/hiển thị `source_key@sha7` (null ⇒ không `@`).
- 2026-10-13 (chốt khoảng trống qc G1–G14, theo mặc định test đã khoá; chi tiết plan §2, §3.3, §4, §5.7–5.9): G1/G2 trường `SandboxSpec/DiffStats/Limits/Failure` khai báo ở plan §4. G3 tên export `StageAutofixSchema/JobAutofixSchema/AutofixReportSchema/AutofixStageViewSchema`. G4 `branch_ck` = `^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$` (khớp `STAGE_KEY_RE`; thay regex rộng hơn ở plan §2 cũ). G5 hook `label=="workspace"` + symlink `out/`→workspace bị chặn (so `realpath`). G9 `use_current` cho decision `autofix_*` ⇒ 4xx (mã theo lỗi decision sẵn có), run giữ `needs_decision`. G10 `PAYLOAD_TOO_LARGE` không vào `HUB_INTERNAL_ERRORS`, nằm ở `error.code` thân 413. G11 chữ ký `workspace.prepare/check.run_checks/FakeOci/AutofixHost` khai ở plan §5.8; qc mở khoá có chủ đích viết `pc/autofix_int_test.py` sau R2 (task R2b). G12 trần `RUNTIME_AUTOFIX_MAX_MB/_FILES` áp ở `workspace.prepare` (Failure `size`), test Runtime theo G11. G14 script `test:pc:sandbox` (plan §5.9). G6–G8, G13, G15 thuộc FE/qc, không đổi backend.
- 2026-10-13 (readiness lần 1, `readiness.md`): #1 quyền đọc file diff/log theo quyền xem run (người dùng chốt) → PC-R14, plan §6.6, task B5. #2–#17 áp mặc định (chi tiết `readiness.md`).
- 2026-10-14 (readiness lần 2): `autofixDecisionOptions` riêng (core trả sớm); PC-R16 = không gọi kiểm hạn mức; `canDecide`; `basePatchOf`; tách B5b; plan §5 → `plan-runtime.md`.
- 2026-10-14 (readiness lần 3, dọn 7 lỗ hổng Thấp): PC-R16 viết lại (`quotaUsed` giữ nguyên; dung lượng tăng đúng diff + log); ca PC-R16 = `report.int` E10 thuộc B4 (không phải B5b); plan §4 "mọi chỗ gọi"; trạng thái spec/tasks cập nhật. Mục test-plan (bỏ câu lệch dòng 149, tổng ca 152 = R 33 · A 45, tham chiếu `A-E10`/`E-E10`) để qc sửa.
- 2026-10-14 (B1 contract): kiểu chung ở file mới `hub-admin/autofix.ts` (tránh vòng import); `ProcessStageDef.autofix?` optional, zod default null; `JobAutofix.source.allowlist` = `.max(0)` (không refine ⇒ pydantic khớp); `AutofixReport.diff` kiểm byte bằng superRefine; `processDefStageIssues` gộp `autofixStageIssues` (thiếu `executor` ⇒ coi agent), issue tự-sửa nối sau; sửa test cạnh code (`hub-internal.test`, `delta.test`) + `thread.rules.ts` REASON thêm 2 câu; đã `contracts:gen`.
- 2026-10-14 (R1 Runtime rules/oci): (1) Mọi pha (kể cả `prep`) dựng `run -d … sleep infinity`, lệnh (`install_cmd`/`test_cmd`/`ws_exec`) chạy qua `exec` có timeout ⇒ một đường đo exit/thời gian; tên `aif-<job>-prep`. (2) "CI ghi rõ" = mẫu allowlist bắt đầu bằng `.github/workflows/` hoặc `.gitlab-ci.yml` và khớp (`.github/**` không đủ). (3) `Failure.rule` cho paths/size: `forbidden_name`/`ci_file`/`not_allowed`, `diff_files`/`diff_bytes`/`workspace_bytes`; secrets dùng tên mẫu (`aws_access_key`…); file thêm tên cấm ⇒ `secrets` rule `forbidden_name` (xoá file cấm không tính). (4) `git_env` env đủ (không kế thừa host): + `PATH` cố định, `GIT_ATTR_NOSYSTEM`, `GIT_OPTIONAL_LOCKS=0`, tác giả/committer `ai-autofix <noreply@local>`; `GIT_SAFE_ARGS` + `protocol.allow=never`, `core.quotePath=false`. (5) `fake` gác bằng `APP_ENV=test` (Runtime không có `RUNTIME_ENV`; validator config ⇒ exit 2; `open_sandbox` gác lần hai). (6) Env sandbox đọc tên không tiền tố (`validation_alias`) như bảng §7; biên: CPUS (0,64], MEMORY_MB 256–65536, PIDS 64–32768, TMP_MB 16–8192, EXEC_S 1–600, INSTALL_S/TEST_S 1–3600, MAX 1–8, DISK_MB ≥ 64, AUTOFIX_MAX_MB 1–4096. (7) Tự kiểm lúc khởi động ở `main.start_queue` → `HostConfig.sandbox: Oci | None` (R3 dùng); CLI chỉ nhận env `PATH HOME DOCKER_HOST DOCKER_CONFIG XDG_RUNTIME_DIR CONTAINER_HOST`. (8) `exec` hết giờ ⇒ kill nhóm CLI + `kill -9 -1` user 1000 trong container (PID 1 `sleep` sống).
- 2026-10-14 (B2 migration): thêm mục `0031_pc_autofix` vào `meta/_journal.json` (migrator Drizzle đọc journal); Drizzle ở file riêng `schema/hub-autofix.ts` + subpath `@ai/db/schema/hub-autofix` (không thêm vào `hub.ts` vì đã 400 dòng — chỉ sửa comment đầu); `pin`/`failures`/`diff_stats`/`commands` gắn kiểu contract (`SourcePin`, `AutofixFailure`, `AutofixDiffStats`, `AutofixReport["commands"]`); int test cạnh code `packages/db/src/hub-pc.int.test.ts` (Drizzle hub_api, append-only, FK SET NULL/CASCADE, idempotent); thêm `autofix_results` vào danh sách `migrate-hub`/`hub-rls` int (đỏ còn lại = TD #148).
- 2026-10-14 (B3 luật Hub): (1) `autofixDecisionOptions`/`isAutofixReason` ở `autofix.rules.ts`; `core/task.rules.ts` import nó (type-only cho `SnapStage` nên không vòng). (2) `allowlistUnion` (`sources.rules.ts`) gọi `autofixAllowlistUnion` trước: nguồn tự-sửa ⇒ `[]`, khác ⇒ luật cũ. (3) `SnapStage.autofix?: StageAutofix | null` thêm vào `launcher-prompt.ts`. (4) Kiểm loại nguồn: `autofixSourceKindMiss` (`def.rules.ts`) + `liveSourceKinds` (`defs.repo.ts`) + `#checkAutofixKinds` sau `#checkSources` (`defs.service`); chỉ cho def thuộc tenant (mẫu `tenantId` null bỏ qua, kiểm khi chép; kind lạ ⇒ coi sai). (5) `autofixRetryNote`: dòng `check path:line rule [detail ≤ 200]`, `secrets` bỏ detail, cắt theo dòng ≤ 2000; rỗng ⇒ câu cố định. (6) `autofixJobPart` ném lỗi nếu stage không có `autofix`.
- 2026-10-14 (B4 internal autofix-result): (1) Thứ tự kiểm: token (401) → job `running` ∧ `payload.autofix` ∧ run stage (409 `AUTOFIX_NOT_EXPECTED`) → thân (400/413) → nhánh (400); token tra KHÔNG lọc `status` để job đã kết thúc trả 409 (E03) thay vì 401. (2) Blob: `storage.stage` NGOÀI tx → tx ghi hàng → `commit` sau COMMIT (mẫu R05, không dùng `commitOutputBlob` vì cần lỗi ghi blob ⇒ 500 để Runtime retry); lỗi/409 ⇒ `discard` (không mồ côi). (3) Trong tx kiểm lại job `running` + đúng `token_hash` (requeue giữa chừng ⇒ 409 NOT_EXPECTED). (4) diff > 2 MiB đo byte UTF-8 trước zod ⇒ 413; `ok` mà diff rỗng ⇒ 400 (attachments `size ≥ 1`); `log_tail` rỗng ⇒ không tạo file log. (5) `filename` = `safe_name` = `<stage>-r<round>.diff.txt` / `-test.log.txt`, `user_id` = `jobs.user_id`; `pin`/`source_key`/`round` lấy từ `payload.autofix`. (6) Mount trong `mountH2c` (cùng kho file). (7) Lệnh xong B4: E01–E03 xanh; E04–E10 cần launcher gắn `payload.autofix` (B5) — đã kiểm bằng bản sao tạm tiêm `payload.autofix` vào job: 10/10 xanh (E08 đổi `name`→`filename`, xem Tranh chấp test).

## §6 Tranh chấp test (chuyển từ spec §9)

Kết quả phân xử cuối: [`test-plan.md`](test-plan.md) §10 (qc 2026-10-14). K02, E08, T03: qc đã sửa kỳ vọng test theo thực nhận (nhãn project 1 KH = `proj-a`; cột `filename`; 401 theo H2c-R17). AF05: test sai, đã loại `payload` khỏi quét. Không còn tranh chấp mở.

Chi tiết gốc:

- 2026-10-14 (B5) `tests/acceptance/P-c/kh.int.test.ts` K02 chờ `structuredContent.project = "kh-main/proj-a"` nhưng fixture `seed: full` cho `hd-read` tick MỘT KH (`kh-main`) ⇒ theo Q25 (`khProjectOptions`: 1 KH ⇒ nhãn = project) nhãn là `"proj-a"` (thực nhận). Đề xuất qc: đổi kỳ vọng thành `"proj-a"` (hoặc dùng agent tick ≥ 2 KH như K1 `query.int` A43). Không sửa test.
- 2026-10-14 (B4) `tests/acceptance/P-c/report.int.test.ts` E08 so `diff?.name`/`log?.name` nhưng `hub.attachments` không có cột `name` (chỉ `filename`, `safe_name`) ⇒ luôn `undefined`. Đề xuất qc: đổi sang `filename` (code ghi `filename` = `safe_name` = `fix-r1.diff.txt`/`fix-r1-test.log.txt`). Không sửa test.
- 2026-10-14 (B5b) `tests/acceptance/P-c/tenant.int.test.ts` T03 chờ 404 khi job của run khác tải diff qua `/internal/jobs/:id/attachments/:aid`, nhưng H2c-R17 (README `internal`, `findJobFile`) trả **401 một thân** cho file không thuộc job (chỉ 404 khi đã xoá/mất) ⇒ thực nhận 401. Ngoài phạm vi B5b (không chạm `/attachments` user). Đề xuất qc: kỳ vọng 401 (vẫn chứng minh không tải được). Không sửa test.
- 2026-10-14 (R3) `apps/agent-runtime/tests/acceptance/pc/autofix_int_test.py` AF05 `assert_no_secret` quét `repr(row)` với `row` = `select * from hub.jobs` ⇒ gồm cột `payload` mà CHÍNH test ghi `test_cmd = "echo AKIAQCQC…; sh test.sh"` ⇒ luôn khớp `AKIA[0-9A-Z]{16}` (span 1182, trong `payload`), bất kể Runtime. Runtime không ghi bí mật: báo cáo đã che (`[REDACTED]` ở `log_tail` — các assert trước đó xanh), log sạch, `result` chỉ có câu tóm tắt agent. Đề xuất qc: quét các cột Runtime ghi (`result`, `error_message`) thay vì cả hàng (hoặc bỏ `payload` khỏi `row` trước khi quét). AF04 dùng cùng helper nhưng bí mật do agent ghi (không trong payload) nên xanh. Không sửa test. **Phân xử (qc, 2026-10-14): test sai** — `payload` là đầu vào do test ghi; đã loại `payload` khỏi quét, giữ quét báo cáo/log/hàng job còn lại; 12/12 xanh, lock cập nhật.
