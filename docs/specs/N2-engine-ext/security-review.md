# Security review · N2-engine-ext (mở rộng engine quy trình)

- Phạm vi: commit `feae3775` (spec/test trước), `42767d4f` (Từ chối + `exclude_starter`), `e61572f4` (trần run theo tenant + UI admin), `c7dcb639` (gói khởi chạy run + tool gói trong stage `tool` và `/mcp`), `48571f97` (tách `review-out.ts`). Chỉ đọc; không sửa code.
- Ngày: 2026-10-19 · Reviewer: security (Opus) · Làn đầy đủ (quyền, tenant, contract, migration admin 0013).
- Test đã chạy: int `tests/acceptance/N2/**` 21/21 pass (6 file, `test:int:par`, 47 s); unit `pack-tools.provider`, `n2-review.rules`, `start-pack-run.usecase` 10/10 pass.

## Kết luận: **SAFE** (không hard stop)

Không thấy đường cross-tenant, không thấy đường bỏ qua quyền ở các điểm được hỏi, và tool gói `side_effect` không gọi được ngoài stage `real_action`. Còn 2 lỗi Trung bình (M1, M2), cần xử lý trước HD3 (duyệt hợp đồng dùng `exclude_starter` + tool gói), và vài lỗi Thấp/Info. Không lỗi nào là Chặn.

## Đã kiểm, đạt

| Mục | Bằng chứng |
|---|---|
| (a) `side_effect` ở `/mcp` | `packMcpTools.usable`: `info.sideEffect ⇒ false` cho cả `tools()` và `accepts()` ⇒ tool gói side_effect không bao giờ được liệt kê hay gọi qua `/mcp`. Unit `pack-tools.provider.test.ts` có ca này. |
| (a) `side_effect` ở stage | `withPackTool` lấy `sideEffect` từ registry; `preCallReason` giữ nguyên `sideEffect ∧ realAction≠true ⇒ tool_failed` (D2-49), trước mọi lời gọi. `real_action` đọc từ snapshot stage trong cùng câu `loadCall`. AC08 xanh (0 lời gọi). |
| (a) Chỉ tool trong `payload.mcp.tools` | `usable` đòi `ctx.tools.includes(key)`; `tools()` lọc từ `ctx.tools`. `ctx.tools` lấy từ payload của job (token băm, job `agent.cli`), không từ request. |
| (a) Bật gói / quyền kiểm lúc gọi | `/mcp`: `accepts()` kiểm lại `enabled(tenant)` + `canUse(read)` mỗi lời gọi (cache cấu hình làm mới qua NOTIFY). Stage: `switchOn = packs.enabled(tenant của run)` trong `loadCall` ngay trước lời gọi. Registry chưa `bindView` ⇒ mọi gói coi như tắt (fail-closed). AC07 xanh. |
| (a) Khoá tool | `register`: tên phải bắt đầu `<pack>-` và khớp `PROCESS_KEY_RE`, trùng ⇒ ném lúc mount. `kh-query` được xét **trước** tool gói ở `/mcp` nên gói không che được KH (và khoá gói `kh` không tồn tại). Va chạm với workflow catalog: xem L1. |
| (a) Tenant khi chạy tool | Stage: `tenantId` = tenant của run (`link.tenantId`), `userId` = `started_by`; `/mcp`: tenant/user của job. `pkdemo` chạy trong `uow.tenant(...)` (role `pkdemo_rw`, RLS + `tenant_id` tường minh). AC06 xanh (hàng ghi đúng tenant run). |
| (b) Khởi chạy run từ gói | `PackRuns.start` gọi `StartService.createFromApi` với user của JWT (tenant từ token, body zod bỏ `origin`, strict) ⇒ đủ kiểm def bật, Group chạy, trần, inputs như `POST /process-runs`. `check`/`attachRun` của `pkdemo` có `tenant_id = $tenant` tường minh trong tx gói; `attachRun` có điều kiện `run_id is null`. Gắn lỗi/không gắn được ⇒ huỷ bù (`GateService.cancel` với chính starter). Gói chỉ ghi được schema của mình (role `<k>_rw`), nên không gắn run vào bản ghi của gói khác. Run luôn mới tạo, nên không gắn được run của người khác. AC01/AC02 xanh (tenant khác ⇒ 404, `run_id` null, không run mới). |
| (b) `outcomes` | Lọc UUID bằng regex, mảng truyền qua một tham số (không ghép SQL), `withHubScope(user)` + `r.tenant_id = $tenant` tường minh. |
| (c) Ai sửa trần | `tenants.routes.ts`: `requireRole("platform_admin")` cho toàn bộ `/admin/tenants*`. Không route nào khác ghi `process_runs_max` (đã grep). Audit theo khuôn `rereadAudited` (before/after có trường). |
| (c) Biên | zod `int 1..1000` ở `TenantUpdateRequestSchema` (strict) + CHECK DB `BETWEEN 1 AND 1000` + `NOT NULL DEFAULT 5`. AC11 xanh (0/1001 ⇒ 400). |
| (c) Đua | `createRun`: `lockTenant` (advisory theo tenant) rồi `activeAndCap` đếm + đọc trần trong **cùng** tx, cùng câu ⇒ start song song (kể cả từ gói, cùng đường `createRun`) bị tuần tự hoá. Trần đọc null ⇒ 5, không phải "không giới hạn". AC10 xanh (`waiting_review` vẫn đếm; tenant B độc lập). |
| (d) Starter không duyệt | `assertReviewAllowed` chạy **sau** `lockRun` (snapshot đã khoá) và **trước** `closeTask`, so `run.startedBy === v.userId` với `v.userId` lấy từ JWT. Áp cho mọi role (kể cả platform_admin) và mọi đường thành viên (user được chuyển, Group duyệt, Group chuyển cấp). `canAct` cũng trả `false` ⇒ UI không bật nút. Hub không có cơ chế uỷ quyền/impersonate (đã grep `delegat|on_behalf|impersonat`), và `reviewDecision` chỉ có một route gọi (`gates.routes.ts`). AC12/AC13 xanh. Lỗ hổng gián tiếp qua task `decision`: xem M1. |
| (e) Lý do Từ chối | Bắt buộc, `trim().max(FEEDBACK_MAX)` (zod) + `reviewDecisionCheck` ⇒ 422. Lưu `review_tasks.feedback` qua tham số. Ra thread bằng trường cấu trúc `feedback` của tin `task_result` (cùng đường với "Chưa đạt"). Web không dùng `dangerouslySetInnerHTML` (đã grep), React escape. Từ chối kết thúc run (`cancelled`) ngay trong tx nên lý do **không** vào prompt của stage nào sau đó. |

## Phát hiện

### Trung bình

**M1 · Starter vượt cấp duyệt `exclude_starter` qua task `decision` `use_current`.**
Khi người duyệt bấm "Chưa đạt" đủ số lần (`redo_limit`), hoặc quay lại chạm `back_limit`, run sang `needs_decision`. `canDecide` cho phép người bắt đầu quyết (`canCancel ⇒ isStarter`). Với `use_current`, `onDecide` chạy `advance(s, ["close_open_tasks"])`, tức stage nguồn **coi như Đạt**. `realActionAllowed` sau đó chỉ cần `prev.after === "review" && prev.status === "done"`, nên stage `real_action` kế tiếp (tool gói side_effect, ví dụ HD3 "ký/gửi hợp đồng") vẫn chạy. Như vậy người bắt đầu, vốn bị cấm duyệt, lại lật được "Chưa đạt" của người duyệt thành "Đạt". Spec N2-D06 cố ý không chặn `decision`, nhưng chưa tính tới hệ quả này. Phải có người duyệt bấm "Chưa đạt" N lần, và họ có thể dùng "Từ chối" để kết thúc run, nên đây không phải hard stop. Tuy vậy, ý nghĩa four-eyes của cờ bị phá.
Đề xuất: với stage `exclude_starter`, task `decision` lý do `redo_limit`/`back_limit` thì **bỏ `use_current`** khi người quyết là starter (403 `STARTER_CANNOT_REVIEW`), hoặc chỉ cho Group duyệt quyết lý do này. Thêm int test: starter `use_current` sau `redo_limit` ⇒ 403. Ghi thay đổi này thành quyết định N2-Dxx (đổi phạm vi đã duyệt ⇒ người dùng chốt).

**M2 · Quyền tool gói không khớp với việc tool làm (ẩn, sẽ lộ ở HD3).**
- `/mcp` chỉ đòi quyền `read` của gói (`canUse ⇒ grantedByAction.read`). Tool "không side_effect" vẫn có thể **ghi**: `pkdemo-touch` chèn item. Kết quả là user chỉ có vai `viewer` ghi được dữ liệu gói thông qua agent.
- Stage `tool` không kiểm quyền gói của starter. Chỉ cần gói bật cho tenant là tool chạy với `userId = started_by`, nên bất kỳ ai được chạy quy trình đều ghi được bản ghi gói dưới danh nghĩa của mình, kể cả khi không có vai gói nào. Người thiết kế def (quyền Studio) đã chọn tool, nên đây là ủy quyền có chủ đích. Tuy vậy, điều này chưa được ghi ở spec, và khác với guard `write` của route gói.
Hiện tại chưa khai thác được: `pkdemo` chỉ có ngoài production, và `payload.mcp.tools` chỉ chứa khoá workflow catalog (xem L1). Nhưng HD3 sẽ thừa hưởng mô hình này.
Đề xuất: thêm vào `PackToolDef` trường `action: "read" | "write"` (mặc định `write`). `/mcp` và stage kiểm `canUse(who, key, action)` của user tương ứng (stage: starter; mất quyền ⇒ `permission_lost`). Hoặc quy ước rõ trong spec: tool không side_effect phải chỉ đọc, và stage chạy theo quyền của def. Thêm test viewer gọi tool ghi ⇒ bị từ chối.

### Thấp

**L1 · Khoá tool gói che workflow catalog cùng khoá, và AC09 thực tế không tới được.** `payload.mcp.tools` được dựng từ `agentToolKeys`, tức chỉ chứa khoá workflow catalog gắn với agent. Vì vậy tool gói chỉ xuất hiện ở `/mcp` khi platform admin tạo một workflow **trùng khoá** `<pack>-<name>` và gắn vào agent. Khi đó `accepts()` của gói được xét trước workflow, nên tool gói thay workflow mà admin đã gắn. N2-D02 cũng nói gói thắng khi lưu def và khi chạy stage. `tools/list` sẽ có hai mục cùng tên. Nếu tool gói là side_effect, `/mcp` rơi xuống workflow (qua cổng xác nhận) trong khi stage chạy tool gói. Không có leo quyền vì khoá do platform admin/code đặt, nhưng hành vi khó đoán. Đề xuất: cấm tạo workflow có khoá bắt đầu bằng `<packKey>-` của gói đã đăng ký (hoặc registry từ chối khi trùng catalog), và nối khoá tool gói vào payload theo cấu hình agent nếu thật sự cần AC09.

**L2 · Run mồ côi khi huỷ bù thất bại.** `startPackRun`: nếu `attach` lỗi **và** `port.cancel` cũng lỗi (chỉ log `pack-run-cancel-failed`), run đã COMMIT ở trạng thái chưa kick. Vòng quét P-d sẽ kick nó, tức là run chạy mà không gắn bản ghi gói nào và vẫn chiếm một chỗ trong trần. Tương tự khi tiến trình chết giữa `start` và `attach`. Đề xuất: sweep bỏ qua run origin none được tạo bởi `PackRuns` mà chưa kick quá X phút, hoặc huỷ chúng; ít nhất ghi `kind` vào audit để dọn tay.

**L3 · `outcomes` trả `feedback` (lý do Từ chối) cho mọi gói.** Mọi gói gọi `outcomes` đều nhận được trạng thái và lý do Từ chối của bất kỳ run nào user thấy được (RLS user + tenant), không giới hạn ở run gắn với bản ghi của gói đó. Không cross-tenant. Đề xuất (HD3): gói chỉ hỏi run id đã lưu trong bản ghi của mình. Ghi điều này vào khuôn kit.

### Info

- **I1** · `PackToolCtx.runId` khác nhau giữa hai đường. Stage truyền `hubRunId` (hàng `hub.runs`), `/mcp` truyền `job.runId`, cả hai đều không phải `process_run_id` như spec viết ("`runId`"). Gói nào cần liên kết run quy trình (HD3) sẽ nhận sai id. Không phải lỗi bảo mật.
- **I2** · `asUser(u)` ép `PackRunCaller` thành `AuthUser`. Hiện route truyền nguyên `c.get("user")` nên an toàn. Gói nào tự dựng caller (ví dụ từ dữ liệu bản ghi) thì sẽ khởi chạy run dưới danh nghĩa user khác. Kit nên chỉ nhận `AuthUser` từ JWT.
- **I3** · Hub đọc `admin.tenants.process_runs_max` dưới scope user. Nếu sau này RLS/grant đổi khiến câu đọc trả null, trần rơi về 5 (fail-safe, không mở trần). AC10 khoá hành vi hiện tại.
- **I4** · `exclude_starter` đọc từ snapshot run đã khoá, nên sửa def sau khi start không mở/đóng cờ cho run đang chạy. Đúng ý.
