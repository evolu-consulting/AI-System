# Review HD3 — flow duyệt hợp đồng (code + bảo mật, một vòng)

## Kết luận
- **Code: CHANGES REQUESTED** · Spec: `docs/specs/HD3-approval-flow/` · Vòng: 1
- **Bảo mật: UNSAFE**, có **1 hard stop** (lách duyệt cấp 2 sau khi đã "Đã duyệt", mục S1). Không tìm thấy đường đọc/ghi chéo tenant.
  Tool gói chỉ chạm HĐ có `run_id` = run gọi. Luật người bắt đầu (D3-07/D3-08) đúng ở cả API gói lẫn engine/chat-web.

Phạm vi: `git show f4af4b7a 59dda88e 77cf4f35 b3d0e8ee f9ca91f8` (nhánh `platform/gd0`). Đọc kỹ phần BE/engine, migration, test.
Phần FE (77cf4f35) chỉ đọc lướt `contract-approval/lib`, `hooks` và chat-web `ReviewTaskCard`.

## Lệnh đã chạy
- Chỉ đọc (`git show`, `git log`, `git diff --stat`). **Không chạy int/e2e**: máy đang 100% CPU, và bằng chứng tĩnh đã đủ để ra kết luận.
  Số liệu xanh trong `tasks.md` (flow 10/10, isolation 3/3, starter-decision 2/2, sweep 3/3) là của agent làm lát, reviewer chưa chạy lại.
- `git diff --stat f4af4b7a~1 f9ca91f8 -- tests/acceptance/HD1 tests/acceptance/HD2 tests/acceptance/N2` → **rỗng**.
  `tests/.lock` không đổi trong 5 commit.

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| S1 | **Blocker (hard stop bảo mật)** | 3 Bảo mật / 2 Nghiệp vụ | `application/patch-fields.usecase.ts:52-70` + `adapters/patch-fields.repo.ts:31-34` ↔ `adapters/approval.repo.ts:79-91`, `adapters/contracts.tools.ts:82-89` | **Lách cấp 2 sau khi duyệt.** `PATCH /contracts/:id/fields` không kiểm `status`. Mọi user có quyền `write` sửa được `total_value` của HĐ `active` ("Đã duyệt") hoặc HĐ đang chờ duyệt. Cách lách: HĐ 245 tr đi hết cấp 1 ⇒ `active`, sau đó PATCH `total_value` = 900 tr ⇒ HĐ vẫn "Đã duyệt", `confirmed_by` vẫn là người duyệt cấp 1, không có cấp 2 nào. `finalize` cũng không kiểm lại giá trị và ngưỡng lúc ghi. D3-02 nói "sửa tay không lách cấp 2", nhưng chỉ chặn được sửa **trước** stage `value`. Ngoài `field_edited` (có actor) thì không có dấu vết nào. | Cần người dùng chốt (sửa sau duyệt là luật sản phẩm). Mặc định đề xuất: (1) `contracts-finalize` đọc lại `total_value` + ngưỡng; nếu `needsLevel2` mà run không có review `pass` ở stage `approve` ⇒ ném lỗi (`tool_failed`), 0 ghi. (2) PATCH trên HĐ `active`/đang có run sống mà đổi `total_value` ⇒ 409 `CONTRACT_LOCKED`, hoặc đưa HĐ về `needs_review` và mở run duyệt mới. Thêm int test cho cả hai. | backend + người dùng |
| M1 | Major | 3 Bảo mật (audit) | `adapters/approval.repo.ts:121-132`, `application/approval.usecase.ts:150-162` | Đổi cài đặt duyệt (ngưỡng, Group cấp 1/2) **không có audit**: chỉ ghi đè `updated_by/updated_at`. Ngưỡng nâng lên tối đa 1e15 là tắt cấp 2 cho cả tenant, mà không còn lịch sử trước/sau. Đồng bộ def (`DefsService.update`) có audit, nhưng ngưỡng không nằm trong def. | Ghi audit `approval_settings.update` với `before/after` và actor, cùng tx với `saveSettings` (port audit của kit gói hoặc `hub.audit_log`). Thêm int test. | backend |
| M2 | Major | 6 Test (Luật 4b) | `tests/acceptance/HD3/*`, `adapters/action-quota.ts` | Thiếu test cho phần rủi ro cao. (a) **AC37b** (đổi Group cấp 2 ⇒ `approve.after.group_id` của def = Group mới): không có test. (b) Trần thao tác khi **Redis vắng/lỗi ⇒ 503** (fail-closed D3-10): không có test; plan T5 ghi "unit counter" nhưng không có file. (c) **AC34f** nhánh `processRunId` null (`/mcp` gọi `contracts-*`): chỉ test nhánh "run khác". | Thêm: int AC37b; unit `action-quota.test.ts` (redis vắng, `exec` lỗi, phần tử lỗi trong pipeline ⇒ 503; vượt trần ⇒ 429 + `resets_at`); int gọi `/mcp` tool `contracts-finalize` ⇒ lỗi, HĐ không đổi. | backend/qc |
| m1 | Minor | 1 Đúng spec | `adapters/approval.routes.ts:83`, `action-quota.ts:1-3` | HD-FR-35 ghi "`/extract`, `/manual`, `/approval` POST: trần". Code chỉ đếm `/approval` khi `redo`; Duyệt/Từ chối không đếm. Hợp lý (không tốn AI) nhưng lệch spec. | Sửa spec HD-FR-35 và D3-10 thành "`/approval` redo", hoặc đếm mọi POST. | docs-architect |
| m2 | Minor | 5 Hiệu năng / 2 Nghiệp vụ | `adapters/approval.repo.ts:150-163`, `application/approval-sweep.ts:44` | Quét đọc `limit 500` theo `updated_at` tăng dần. HĐ đang chờ cấp 2 nhiều ngày (run còn sống) luôn đứng đầu và bị đọc lại mỗi lượt. Tenant có > 500 HĐ trong flow thì HĐ bị từ chối ở chat-web hoặc HĐ STALE mới hơn **không bao giờ** tới lượt (GET S05 vẫn hoà giải được). | Con trỏ xoay vòng (keyset theo `(updated_at,id)` lưu trong RAM), hoặc tách hai câu: STALE riêng, và HĐ có `run_id` theo con trỏ. | backend |
| m3 | Minor | 5 Hiệu năng | `application/approval-sweep.ts:45-50, 56-61` | `Promise.all` trên **mọi** tenant ⇒ số tx song song = số tenant, có thể chiếm hết pool kết nối. | Giới hạn song song (vd 4–8), hoặc gộp đọc nhiều tenant vào một câu scope system có lọc `tenant_id = any`. | backend |
| m4 | Minor | 2 Nghiệp vụ | `application/approval-sweep.ts:20, 35` | Run `failed`/`expired` (lỗi kỹ thuật, hết hạn) ⇒ HĐ `rejected` ("Bị từ chối", event `cancelled`). Người dùng thấy "Bị từ chối" dù không ai từ chối. | Chốt với người dùng: `failed/expired` ⇒ `extract_failed` (mã `FLOW_FAILED`), chỉ `cancelled` ⇒ `rejected`. | backend + người dùng |
| m5 | Minor | 4 Dữ liệu | `application/approval.usecase.ts:157-161`; `runs/pack-runs-hd3.ts:108-111` | `saveApprovalSettings` lưu cài đặt **trước** rồi mới đồng bộ def. Đồng bộ lỗi (vd `VERSION_CONFLICT` khi admin đang sửa def) ⇒ 500, cài đặt đã đổi nhưng def vẫn giữ Group cũ. Đồng bộ cũng ghi đè **cả** def, xoá các sửa tay của admin mà D3-05 cho phép. | Đồng bộ trước, lưu sau (hoặc thử lại khi `VERSION_CONFLICT`). Chỉ vá `group_id` của hai stage review thay vì thay cả def; ghi rõ trong D3-05. | backend |
| m6 | Minor | 4 Dữ liệu (migration) | `packages/db/migrations-pack-contracts/meta/_journal.json` | Câu (h): `when` **tăng dần theo thứ tự mảng** (0001 < 0002 < 0005 < 0003 < 0004), drizzle chỉ so `when` với `created_at` lớn nhất đã áp. ⇒ **DB mới**: áp 0001, 0002, 0005, 0003, 0004 (0005 độc lập, không phụ thuộc 0003/0004) — đúng. **DB đã có 0001–0002**: áp đủ ba — đúng. **Rủi ro**: DB nào đã áp 0003/0004 từ một journal **thiếu** 0005 (worktree khác dùng chung DB dev) sẽ **bỏ qua 0005 trong im lặng**, vì `when` của 0005 nhỏ hơn. Việc nợ "sắp lại khi gộp đợt" trong `tasks.md` là **nguy hiểm**: đổi `when`/thứ tự sau khi đã áp sẽ làm migration bị bỏ qua hoặc chạy lại. | KHÔNG sắp lại journal; xoá dòng nợ đó trong `tasks.md`. Kiểm DB dev/stg: `select count(*) from drizzle.__drizzle_migrations_pack_contracts` = 5 và `to_regclass('contracts.approval_settings')` khác null. | docs-architect |
| m7 | Minor | 6 Test | `tests/acceptance/HD3/starter-decision.int.test.ts:66-89`, `isolation.int.test.ts:91-102` | Test viết trước bị sửa trong commit code (59dda88e). Ca "Adm `use_current` ⇒ 200" đổi thành 409 `NO_OUTPUT` + `add_attempt` ⇒ **AC34e** (người khác thuộc owner `use_current` ⇒ được) không còn được chứng minh theo hướng dương. AC32b đổi từ `needs_decision/tool_failed` sang "không `done` + audit failed" (vẫn kiểm HĐ không đổi). Lý do sửa hợp lý, nhưng không ghi ở "Tranh chấp test". | Ghi "Tranh chấp test" trong spec. Thêm ca AC34e dương (stage có output ⇒ owner khác `use_current` ⇒ 200, đi tiếp). | qc |
| m8 | Minor | 3 Bảo mật (rủi ro còn lại) | `runs/pack-runs-hd3.ts:52-54`; `domain/approval-def.rules.ts:26-29` | (a) Văn bản HĐ có rào nonce (HD2), nhưng câu chèn vẫn có thể khiến agent trả `total_value` thấp ⇒ bỏ cấp 2, nếu người duyệt cấp 1 (có thể chính là người tải lên — câu 5) không bắt được. Rủi ro còn lại, nên ghi rõ. (b) `agent()` chọn agent theo `key` trong snapshot toàn cục, không kiểm tenant có quyền dùng agent đó. **Cần xác minh** agent có phạm vi tenant hay không. | (a) Ghi rủi ro trong spec; nếu được, so `total_value` trích được với tổng `items`, lệch thì cảnh báo ở S05. (b) Nếu agent theo tenant thì lọc thêm theo tenant. | backend |
| m9 | Minor | 8 FE | `contracts-web/.../hooks/use-approval.ts:26`; `task-access.rules.ts:68-80` | S05 tải lại mỗi 2 s khi bước đang chạy (poll UI). Thẻ decision ở stage cấp 2 vẫn báo `can_act` = true cho người bắt đầu, dù `use_current` sẽ bị 403. | Ghi chú/DEVIATIONS. Sau này đẩy trạng thái qua SSE. Trong chat-web, ẩn `use_current` với người bắt đầu ở stage `exclude_starter`. | frontend |

## Bảo mật — đã kiểm theo câu hỏi
- **(a) Người bắt đầu.**
  - API gói: `POST …/approval` ⇒ `PackRuns.act` ⇒ `GateService.reviewDecision` ⇒ `assertReviewAllowed` ⇒ `assertNotExcludedStarter`, chạy **trong tx sau `lockRun`** (gates.service.ts:178-184). Chặn MỌI kết quả (pass/fail/reject) ở stage `approve` (`exclude_starter: true`), đúng D3-08. Engine trả 403 `STARTER_CANNOT_REVIEW`, giữ nguyên qua `asReviewer` (chỉ đổi mã 404).
  - Decision: `assertDecisionAllowed(..., b.option)` ⇒ `starterDecisionBlocked` chặn `use_current` với **mọi lý do** ở stage `exclude_starter` (D3-07). Không còn cách nào để người bắt đầu đi qua nhánh decision.
  - Chuyển task: decision không chuyển được (`TASK_KIND_MISMATCH`). Review chỉ chuyển được tới thành viên Group duyệt. `starterExcluded` so `startedBy === userId` nên người bắt đầu là assignee hay thuộc Group chuyển cấp vẫn bị chặn. Def không có `escalate`.
  - Stage `value` (`after: auto`) có `use_current` ⇒ 409 `NO_OUTPUT` khi tool lỗi (không có output) ⇒ không lách rẽ nhánh.
  - **Lỗ duy nhất là sửa trường sau duyệt (S1)**, nằm ngoài engine.
- **(b) Tool gói.**
  - `target()` buộc phải có `ctx.processRunId`; engine đặt giá trị này từ `link.runId`, người dùng không chỉnh được. `/mcp` ⇒ null ⇒ ném lỗi.
  - Mọi câu SQL có `id` + `tenant_id` + `run_id = $run` (beginExtract, valueOf, finalize) trong `PackUow` (RLS FORCE).
  - `run_id` chỉ được gán bằng `attachRun` từ `startApproval` (khoá def cố định, điều kiện `run_id is not distinct from prev`), nên def tự dựng không trỏ được vào HĐ.
  - `PackRuns.agent` kiểm `hub.runs` khớp `tenant_id`, `status = 'running'`, `stage_run_id` khác null.
  - `outcomesOf`/`lastApprover`/`groupIdsOf` chạy scope system nhưng lọc `tenant_id` tường minh; `closesOf` kiểm lại `o.tenant_id === t`.
  - AC34c (tenant khác ⇒ 404) và AC34g có test.
- **(c) `approval_settings`.**
  - PUT dùng `packGuard(..., "admin")`; có test AC37a (B không phải admin ⇒ 403).
  - Biên: zod `int 0..1e15` + CHECK DB cùng biên (an toàn với `Number`); khoá Group theo regex + phải tồn tại trong tenant (`groupIdsOf` lọc tenant).
  - RLS: `packs.secure_table` + `REVOKE DELETE`; suite `rls-packs.int.test.ts` đã thêm bảng.
  - **Thiếu audit (M1).**
- **(d) Agent không tool.**
  - `noTools` ⇒ `#mcp` trả `NO_MCP` (không KH, không catalog); payload có `allowed_tools: []`, không `autofix`/ws.
  - agent-runtime: `job_tools` = [], `disallowed` = mọi tool dựng sẵn, hook PreToolUse vẫn chạy (`providers/claude/options.py:92-104`).
  - Văn bản HĐ nằm trong thẻ có nonce và chuỗi giả thẻ bị vô hiệu (`domain/extract-prompt.rules.ts`), có test HD2. Rủi ro còn lại: m8.
- **(e) Quét và trần thao tác.**
  - Quét: mọi câu ghi đều có điều kiện (`run_id is not distinct from x.runId` + trạng thái), event chỉ chèn từ các hàng đã `returning` ⇒ nhiều instance hay quét song song với GET S05 vẫn chỉ chuyển một lần. Gắn run mới giữa lúc đọc và lúc ghi ⇒ câu ghi không khớp, 0 hàng.
  - Trần: `INCR` nguyên tử, cùng pipeline với `EXPIRE`; Redis vắng, `exec` lỗi hay phần tử lỗi ⇒ 503 `UPLOAD_QUOTA_UNAVAILABLE` (**fail-closed đúng**, nhưng chưa có test — M2).
  - Lưu ý vận hành: ioredis có hàng đợi offline nên khi Redis chết, request treo tới hết số lần thử rồi mới 503. Không sai, chỉ chậm.
- **(f) Từ chối từ chat-web.**
  - Run `cancelled` với task `result = 'reject'` ⇒ quét (`closesOf` ⇒ `rejected`) hoặc GET S05 (`markRejected`). Cả hai đều có điều kiện `status in OPEN`; câu thứ hai chạy sau, trong READ COMMITTED đánh giá lại WHERE ⇒ 0 hàng, không có event đôi.
  - Từ chối ở S05 ghi ngay; GET sau đó đọc `status = rejected` nên không ghi lại.
  - Có test: `sweep.int` (lượt 2 `closed = 0`) và `flow.int` D3-06.
- **(g) f9ca91f8.** Chỉ sửa `application/approval-flow.ts`: `engine_off` ⇒ không ghi gì, HĐ giữ `extracting` như HD1. Không sửa test khoá nào (diff test HD1/HD2/N2 rỗng, `tests/.lock` không đổi). Hệ quả đã ghi trong comment: nếu engine tắt quá 15 phút, vòng quét đánh HĐ thành STALE.
- **(h) Journal.** Xem m6: DB mới và DB hiện có đều migrate đúng; không được sắp lại thứ tự.

## Đạt (không cần sửa)
- Khuôn `startPackRun` (kiểm ⇒ mở ⇒ gắn có điều kiện ⇒ huỷ bù) ngăn được hai `/extract` chạy đua.
- `needsLevel2`: giá trị trống, âm, chuỗi hay không hữu hạn ⇒ vẫn đi cấp 2.
- Số đo perf có thật: quét p95 10,6 ms ≤ 50; GET p95 9,3 ms ≤ 30.
- Mọi câu SQL là văn bản hằng; lô quét truyền qua MỘT tham số JSON.

## Re-verify (bảo mật, 2026-10-19) — commit 2a00c051, 3a60b3d8, 627bf0cb

**Kết luận: SAFE** cho hard stop S1 và các sửa liên quan bảo mật. Đây không phải review lại toàn bộ; chỉ đọc code, không chạy test int.

- **Finalize (S1).** `contracts.tools.ts` finalize đọc lại `valueOf` (theo `run_id`) và `settings()` trong cùng tx với câu ghi. Nếu `needsLevel2(v, threshold)` mà không có `pass` ở stage `approve` (`passedStages`: task `review` có `result = 'pass'`) thì ném `tool_failed`. Engine tắt ⇒ ném, không ghi. Đường lách cũ (sửa `total_value` sau khi rẽ nhánh, hoặc def bị sửa bỏ cấp 2) bị chặn. Có test `guard.int` "finalize đọc lại".
- **PATCH khi đang duyệt.** `editVerdict` + `needsRunPhase`: HĐ ở `needs_review` có run và đổi `total_value` ⇒ hỏi engine giai đoạn run (đọc trong khi đang giữ `FOR UPDATE` hàng HĐ). Kết quả `later` ⇒ 409 `CONTRACT_IN_APPROVAL`; `level1` ⇒ cho sửa (D3-02). Sau quyết định cấp 2, run nằm ở `approve`/`finalize`, hoặc đã xong và HĐ `active` ⇒ 409 hoặc mở lại duyệt. Vì vậy sửa ở cấp 1 không thể hạ giá trị xuống dưới ngưỡng sau khi cấp 2 đã quyết. `state` dùng RLS hub theo tenant nên người sửa cùng tenant luôn thấy run; lỗi engine ⇒ PATCH lỗi (fail-closed).
- **D3-13 mở lại duyệt.** Cùng một câu UPDATE (`version = expected`, sau `FOR UPDATE`) đặt `needs_review` và xoá `confirmed_*` cùng `run_id`. Finalize run cũ cần `status = 'needs_review' and run_id = run` nên không còn khớp; `attachRun` gắn run mới với `prev = null`. Không thấy đường nào để HĐ `active` mang giá trị chưa duyệt. Các đường ghi tiền khác:
  - `requestExtract` chỉ chạy từ `needs_review`/`extract_failed` (`active` ⇒ `not_allowed`), và `saveResult` cần `extracting`.
  - Nhập tay chỉ INSERT `needs_review`.
  - Giá phụ lục HD5 chỉ đọc (`family`, không ghi `total_value`).
  - `handled.repo` và vòng nhắc chỉ đổi giữa các trạng thái đã duyệt: `statusOn` giữ nguyên trạng thái chưa duyệt, `apply` có `c.status = x.prev`.
  - CKS chỉ ghi `terminated`.
- **Audit cài đặt (M1).** Migration gói 0006 tạo `contracts.approval_settings_audit` qua `packs.secure_table` (ENABLE + FORCE RLS, policy tenant), rồi `REVOKE UPDATE, DELETE` khỏi `contracts_rw` ⇒ chỉ thêm. Bản ghi audit được chèn trong cùng câu CTE với upsert cài đặt; đã thêm bảng vào `rls-packs.int`.
- **m8.** `extractAgentFor`: agent phải `enabled` và tenant phải có entitlement đúng `agentId` + `tenantId` với `revokedAt === null`; nếu không ⇒ `AGENT_UNAVAILABLE`.
- **m9.** `task-view.ts` bỏ `use_current` khỏi thẻ decision của người bắt đầu ở stage `exclude_starter`, ngay phía server trong phản hồi API. Engine vẫn chặn khi gửi lên: `task-access.rules.ts` cho `use_current` vào nhóm chặn người bắt đầu với mọi lý do. Có test AC34a + m9.

### Còn lại (không chặn)
- **Trung bình (làm cứng): TOCTOU hẹp ở finalize.** `valueQ` là SELECT thường, không khoá. Giả sử một PATCH cấp 1 đã đọc `phase = level1` trước khi cấp 1 quyết, rồi commit giá trị ≥ ngưỡng giữa lúc finalize đọc `valueOf` và lúc chạy UPDATE (hoặc UPDATE chờ khoá hàng của PATCH, sau đó READ COMMITTED đánh giá lại WHERE vẫn khớp). Khi đó HĐ thành `active` mà không qua cấp 2. Muốn vậy, tx PATCH phải mở suốt từ trước khi cấp 1 quyết, qua stage `value`, tới lúc finalize; thực tế gần như không khai thác được. Sửa: thêm `for update` vào `valueQ`, hoặc đưa điều kiện ngưỡng vào chính câu UPDATE của finalize.
- **Thấp (khả dụng): mở lại duyệt nhưng `restart` lỗi.** HĐ ở `needs_review` với `run_id = null`. Vòng quét không nhặt hàng này, chỉ có log warn. An toàn (không `active`) nhưng HĐ bị treo.
- **Thấp (chức năng): `passedStages` chỉ đếm task `review` `pass`.** Một `use_current` hợp lệ của nhóm cấp 2 ở stage `approve` (task decision) sẽ bị finalize từ chối. Kết quả là fail-closed.
