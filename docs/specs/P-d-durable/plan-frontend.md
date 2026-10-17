# P-d-durable · plan frontend (admin-web + chat-web) — P-d1 [ADM-FR-71, 72][CHAT-AC-59][HUB-FR-143…145, 115] · P-d2: [`plan-frontend-d2.md`](plan-frontend-d2.md)

Spec: [`spec.md`](spec.md) §6, [`spec-tz-tools.md`](spec-tz-tools.md) (UI) · contract (chỉ **tiêu thụ**; backend-lead sở hữu): [`plan-contract.md`](plan-contract.md) §1–§5 · đặt code web: [`spec-ca.md`](spec-ca.md) §6, ADR-0023 · câu chữ VI/EN **nguyên văn**: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) (lệch file này ⇒ i18n thắng) · mockup [`mockup/`](mockup/) 01–03.
**Điều kiện BUILD:** T5 + T6a xong. Mockup duyệt ở Gate (D0c). **Không thêm thư viện, không ADR mới.**

## 0. Quyết định (FD; người dùng chốt "UI giữ pattern cũ")
| # | Quyết định |
|---|---|
| FD1 | Chỉ dùng component/kiểu sẵn có: `Panel`, `FormField`, `SelectField`/`TextField` (`editor/Fields.tsx`), `Switch`, `Checkbox`, `Badge`/`StatusBadge`, `RefPicker`, `ConfirmDialog`, `Alert`, `Table`, `EmptyState`/`ErrorState`/`LoadingState`, `Tabs`. Không component shadcn mới, không sửa `components/ui/**` |
| FD2 | Panel stage mở rộng **theo mẫu `apply`** (`apply-form.ts` + `StageApply.tsx`): `StageDraft.executor` thêm giá trị cố định `"wait_until"` (P-d2 `"tool"`); `normalizeWait()` ép ô khoá; khối riêng `StageWait.tsx` thay các khối thường. `StageForm` giữ một `section aria-label="Giai đoạn {{n}}: {{name}}"` (nhãn e2e cũ) |
| FD3 | Editor quy trình giữ `use-draft` + `validateDraft` (không RHF). RHF + `zodResolver` chỉ ở màn **tenant** (đã dùng) |
| FD4 | Validate live = hàm contract thuần `processDefStageIssues(stages, {inputs})` (plan-contract §3) + luật phụ ở `domain/`; 422 `rules[]` map theo path ra cùng câu (§6) |
| FD5 | Múi giờ: `RefPicker trigger="button"` + ô chỉ-đọc (mẫu `DefInfoCard` chọn Group); danh sách `Intl.supportedValuesOf("timeZone")` của trình duyệt (`ref-picker.ts` cắt 50). Vùng máy chủ từ chối ⇒ 400 path `timezone` ⇒ lỗi dưới ô (R3 plan §9) |
| FD6 | Chat: huy hiệu run `waiting_timer` = "Đang chờ hẹn" (tông `info`); chi tiết "Chờ tới {ngày}" / "Đang thử lại (n/3)" ở dòng trạng thái + `StageStrip` + hàng trang Run, suy từ `StageView.wait/next_retry_at/retry_count`. Chấm chờ hẹn = **vòng rỗng** + icon đồng hồ (không chỉ màu); `skipped` = chữ + gạch ngang |
| FD7 | Ngày hẹn hiển thị theo `wait.timezone` server trả (múi giờ **lúc lưu hẹn**, B7). vi `DD/MM/YYYY HH:mm`, en `YYYY-MM-DD HH:mm` (khớp .md "Đã chờ tới {YYYY-MM-DD HH:MM} ({timezone}).") bằng `Intl.DateTimeFormat().formatToParts`; múi giờ lạ với trình duyệt (RangeError) ⇒ UTC. Giờ thử lại theo giờ máy người xem, chỉ `HH:mm` |
| FD8 | Nhãn nút quyết theo lý do: `retry_exhausted` ⇒ `add_attempt` "Thử lại ngay"; `timer_invalid` ⇒ `add_attempt` "Tính lại ngày hẹn", `use_current` "Bỏ chờ, đi tiếp"; còn lại nhãn cũ. `decisionOptionVariant(reason, option)` gọi ở `DecisionButtons` (chat), `RunActions` (admin) |
| FD9 | `Record<ProcessRunStatus,…>` (chat `status.ts`, admin `RunStatusBadge`) thêm `waiting_timer` (typecheck ép); `stageStatusKey("skipped")` ⇒ `process.common.stage.skipped` |
| FD10 | Domain web (CR-091): **hai bản** `features/processes/domain/` (admin, chat) — trùng `isIsoCalendarDate`, `stage-wait`; mỗi bản có test + `lib/domain-contract.test.ts` (lớp 3) khẳng định hằng bằng contract; ghi nợ gộp vào TECH-DEBT |
| FD11 | Quy trình **mẫu** (tenant null): "Chờ tới ngày" dùng được, dòng múi giờ ghi "theo múi giờ của công ty chạy quy trình"; "Gọi tool" ẩn (P-d2) |

## 1. Bản đồ màn / khối (file dưới `apps/<app>/src/features/`)
| Màn · file | Thay đổi | Dữ liệu | Mockup |
|---|---|---|---|
| admin `processes/components/editor/{StageGeneral,StageWait(mới),StageForm}.tsx` | executor "Chờ tới ngày" + nguồn ngày/chênh/giờ/múi giờ | def + `GET /process-editor/context?tenant_id=` → `timezone` | 01 A1–A2 |
| admin `…/editor/{StageGate,StageRemind(mới)}.tsx` | "Nhắc mỗi (giờ)", "Chuyển cấp…" | def; `refs.groups` | 01 A3 |
| admin `…/editor/DefInfoCard.tsx`, thẻ Giới hạn | "Thời hạn lượt chạy (ngày)" + "Không hết hạn" | `ProcessDef.ttl_days` | 01 A4 |
| admin `…/canvas/{stage-view,StageBody}.ts(x)`, `…/editor/InputRow.tsx` | huy hiệu "Chờ tới ngày"; kiểu input "Ngày" | def, `INPUT_TYPES` | 01 A1 |
| admin `…/run/{RunProgress,RunStatusBadge}.tsx` | "Chờ tới …", "Đang thử lại (n/3)", `waiting_timer` | `StageView.wait/next_retry_at/retry_count` | 01 A5 |
| admin `tenants/{components/TenantInfoForm,TenantCreateForm,lib/schemas,pages/TenantDetailPage}` | ô "Múi giờ" | `TenantDetail.timezone`; `PATCH /admin/tenants/:id` | 02 B1–B3 |
| chat `processes/shared/**`, `run-block/**`, `run-page/StageRow.tsx` | nhãn trạng thái, lý do mới, "Đã chuyển cấp" | `ProcessRunFullView`, `StageView`, `OpenTask.escalated_group`, `TaskDetail.escalated` | 03 D1–D5 |
| chat `processes/inputs/**`, `inbox/**` | trường `date`; thông báo `escalated` | `ProcessInputDef`, `ProcessNotice` | 03 D3–D4 |

## 2. Admin · panel giai đoạn P-d1
**Bố cục:** giữ nguyên canvas P-b2 (`complementary "Chi tiết giai đoạn"` 420 px, <1024 px là `Sheet`). `StageGeneral` thêm lựa chọn "Chờ tới ngày" vào `SelectField "Người thực hiện"` (sau Agent/Nhóm/Áp bản sửa; `WAIT_EXECUTOR = "wait_until"`). Chọn ⇒ `onChange(WAIT_PATCH)` (executor, `real:false`, `after:"auto"`, `backTo:[]`, `groupId:""`).

**`StageWait.tsx`** (`fieldset aria-label="Chờ tới ngày"`, ≤ 120 dòng, thay các khối thường):
| Thành phần | Control | Ghi chú |
|---|---|---|
| Tiêu đề + huy hiệu "Hợp lệ" | `<strong>` + `Badge ok` | hiện khi không lỗi (như `StageApply`) |
| Lấy ngày từ | `SelectField` `id=<uid>-wait-from` | nguồn = `dateSources()` (§5): input kiểu `date` của quy trình + trường `date` của stage **ở bước nhỏ hơn bất kỳ** (PD-R13); giá trị `input:<key>` / `field:<stage_key>:<field>` |
| Chênh lệch (ngày) | `TextField type=number` min −365 max 365 | |
| Giờ trong ngày | `TextField` với `type="time"` (mặc định `09:00`, Q4) | `aria-describedby` → dòng múi giờ |
| Dòng múi giờ | `Alert role="status"` | tenant: "Theo múi giờ công ty: {tz} ({offset})…"; mẫu: "Quy trình mẫu: tính theo múi giờ của công ty chạy quy trình…" |
| Câu tóm tắt | `<p class="sub">` | `offsetDirection` (§5): "Tới hạn lúc 09:00, 3 ngày trước ngày lấy từ …" |
| Sau giai đoạn | `SelectField disabled` "Chạy tiếp (cố định)" | `after.kind='auto'`, `real_action=false` (PD-R17) |
Ẩn hẳn: Hướng dẫn, Kết quả (Hub ép template/sections/fields, PD-R17), Nguồn, Tự sửa mã, Hành động thật, Người trả lời, Hạn/ngân sách token, "Điều phải biết". `normalizeWait(s)` (gửi/validate): xoá các ô ẩn; gửi `output = {filename:"<key>.md", template:"# {name}\n\n## Bàn giao\n", required_sections:["Bàn giao"], fields:[]}`, `answerer:{kind:"starter"}`, `token_budget:null`, `timeout_s` mặc định (Hub ép lại, §14 G3).

**Trạng thái:** *tải context* (`aria-busy`, "Đang tải múi giờ…" + skeleton; vẫn lưu được) · *lỗi context* (`Alert role="alert"` + "Thử lại"; không chặn lưu) · *rỗng* (không có nguồn ngày ⇒ `Select` disabled + `Alert role="status"`) · *chỉ xem* (control disabled) · *409* `ConflictDialog` · *không quyền* `ProcessRouteGate`.

**Khối "Sau giai đoạn" = Duyệt (`StageGate` + `StageRemind.tsx` mới):** dưới "Nhóm kiểm" thêm `TextField number "Nhắc mỗi (giờ)"` (rỗng = `remind_every_h:null`, chữ phụ "Để trống = nhắc một lần sau 24 giờ…"), `Checkbox "Chuyển cấp nếu chưa ai kiểm"`; bật ⇒ hiện `TextField number "Chuyển cấp sau (giờ)"` (4…2160) + `SelectField "Chuyển cấp tới nhóm"` (`refs.groups` **bỏ** nhóm kiểm). Tắt ⇒ `escalate:null`. `after = auto` ⇒ cả hai khối ẩn và gửi `null`.

**Thẻ Thông tin / Giới hạn:** `DefInfoCard` thêm (sau Ngân sách) `TextField number "Thời hạn lượt chạy (ngày)"` 1…365 + `Checkbox "Không hết hạn"` (bật ⇒ ô số disabled, rỗng, gửi `ttl_days:null`). Quy trình mới mặc định `7`; nạp `ttlFromValue(def.ttl_days)`; lưu **luôn gửi** `ttl_days` (số|null). `LimitsCard`: `limitsTextTtl {{days}}` / `limitsTextNoTtl` + câu `limitsWait` ("Lượt đang chờ tới ngày không tính vào 5 lượt cùng lúc.").

**Canvas/StepList:** `StageView` thêm `kind: "agent"|"team"|"apply"|"wait"|"tool"`, `branches: number` (P-d2); `StageBody` hiện huy hiệu icon + chữ ("Chờ tới ngày"); `layoutSteps` không đổi (không node mới).

**Trang Run (admin):** `RunProgress` ô Trạng thái dùng `stageLabel()` (§4): "Chờ tới 14/12/2026 09:00 (Asia/Ho_Chi_Minh)", "Đang thử lại (2/3) · 10:42"; `RunStatusBadge` thêm `waiting_timer` ⇒ `info`. Nhật ký `run.log.kinds` thêm `escalate`, `branch`.

**Validate client:** `validateDraft` gọi `waitIssues` (domain), `remindIssue`, `escalateIssues`, `ttlIssue`, rồi `processDefStageIssues(stages, {inputs})` cho luật chéo; bảng lỗi §6.

## 3. Admin · Múi giờ tenant (ADM-FR-72)
`TenantInfoForm` thêm trường `timezone` sau "Giới hạn slot subscription" (mockup 02 B1): `FormField id="info-timezone" label="Múi giờ"` chứa `Input readOnly` (giá trị `"Asia/Ho_Chi_Minh (UTC+07:00)"`, lớp `bg-muted font-mono` như ô "Mã công ty") + `RefPicker trigger="button" label="Đổi múi giờ" placeholder="Tìm múi giờ"`; option `{id: zone, label: zone, hint: "UTC+07:00"}` (`timeZoneOptions`, §5). Chọn ⇒ `form.setValue("timezone", id, {shouldDirty:true})` ⇒ thanh lưu dính đáy có sẵn.
- **Schema** (`tenants/lib/schemas.ts`, lớp 3): `timezone: z.string().min(1,"tenants.error.timezoneRequired").refine(isSupportedTimeZone,"tenants.error.timezoneUnsupported")` (`isSupportedTimeZone` từ `@ai/contracts`; **không** dùng `TimezoneInputSchema` vì message không phải khoá i18n). `tenantInfoSchema` + `tenantCreateSchema` thêm trường; `toValues` nạp `tenant.timezone`; `reset` so sánh thêm `timezone`.
- **Lưu:** `conflict.save({ name, max_concurrent_sub, timezone }, version)`; 409 `VERSION_CONFLICT` ⇒ `ConflictDialog` sẵn có; 400 `VALIDATION_ERROR` path `timezone` ⇒ `form.setError("timezone", {message:"tenants.error.timezoneUnsupported"})`.
- **Tạo tenant** (`TenantCreateForm`, TZ-R03): thêm cùng ô ở khối "Công ty", mặc định `Asia/Ho_Chi_Minh` (`TENANT_TZ_DEFAULT`); gửi `timezone` luôn.
- **Trạng thái:** tải/lỗi/403/404 giữ nguyên; gõ không khớp ⇒ "Không có kết quả."; giá trị tenant ngoài danh sách của trình duyệt vẫn hiện (không validate tới khi sửa). `tenants.quota.note` ("Tháng tính theo giờ Việt Nam") không đổi (quota tháng không theo `timezone`).

## 4. Chat-web · nhãn trạng thái + ô ngày
| Chỗ | Quy tắc hiển thị (suy từ `StageView`; hàm `describeStageWait` §5) | Khoá i18n (file i18n §0, §2) |
|---|---|---|
| Huy hiệu run `waiting_timer` | tông `info`, chữ "Đang chờ hẹn" | `common.status.waiting_timer` |
| `StatusLine` run `running` + stage hiện tại đang `retry` | "Đang thử lại (2/3) · Giai đoạn 1/3 · {tên}" | `run.line.retrying` |
| `StatusLine` run `waiting_timer` | "Chờ tới {ngày giờ} · Giai đoạn n/total · {tên}" (hẹn **sớm nhất**); thiếu `wait` (người xem ngoài phòng) ⇒ "Đang chờ hẹn · Giai đoạn n/total" | `run.line.waitingTimer(NoDate)` |
| `StageStrip` giai đoạn | `wait` ⇒ "{tên} · Chờ tới {ngày}" (`title` = ngày giờ + múi giờ); retry ⇒ "{tên} · Đang thử lại (n/3) · {giờ}"; `skipped` ⇒ "{tên} · Bỏ qua" gạch ngang; `waiting_timer` không chi tiết ⇒ "Đang chờ hẹn" | `common.stageLabel.*`, `common.stage.skipped` |
| `StageRow` (trang Run) | ngày giờ đầy đủ + múi giờ; "Đang thử lại (n/3) · giờ" | như trên |
| Thẻ "Cần người quyết" | lý do `retry_exhausted`, `timer_invalid` (+ hint); nhãn nút theo FD8 | `common.retry_exhausted`…, `common.option.*_<reason>` |
| Thẻ kiểm / `TaskWaitingNote` | `TaskDetail.escalated` ⇒ huy hiệu "Đã chuyển cấp" + câu giải thích; `OpenTask.escalated_group` ⇒ "Đang chờ {names} hoặc {nhóm} (đã chuyển cấp) kiểm — …" | `run.review.escalated(Note)`, `thread.wait.reviewEscalated` |
| DM "Quy trình" | thông báo `escalated`; thẻ mở được `TaskPanel` (thêm vào `TASK_NOTICE_KINDS`; cần `task_id`, §14 G4) | `inbox.notice.escalated` |
| Form `!key` | `type='date'` ⇒ `<input type="date" aria-label={def.label}>` + lỗi `role="alert"`; `toRequestInputs` thêm nhánh `date` → `{type:"date", key, value}` (**bẫy:** nhánh cuối chuỗi if/else hiện là `source_ref` ⇒ `date` sẽ bị bỏ lặng lẽ) | `inputs.err.date.invalid` |
| 400 `VALIDATION_ERROR` path `inputs.<i>.value` | lỗi **dưới trường thứ i** (`submitErrorKey` nhận `issues`), không dùng câu "Nguồn hoặc nhánh…" | `inputs.err.date.invalid` |
| Hết hạn | `thread.end.expired` nhận `{{days}}` = `expiryDays(started_at, expires_at)`; thiếu dữ liệu ⇒ `end.expiredGeneric` | Q3 |
**Trạng thái tải/rỗng/lỗi:** không thêm màn; dùng sẵn `loadError`, `gone`, `stale`. Chế độ Tối: chỉ dùng token (`--primary`, `--warning-solid`…), mockup 03 D5.

## 5. Domain thuần `features/processes/domain/` (ADR-0023: chỉ built-in; cấm React, `@ai/contracts`, zod, `Date.now()`)
Hằng khai lại ở domain (`WAIT_OFFSET_DAYS`, `REMIND_EVERY_H`, `ESCALATE_AFTER_H`, `PROCESS_TTL_DAYS`, `STAGE_RETRY_MAX`, `WAIT_TIME_RE`…); `lib/domain-contract.test.ts` (lớp 3) khẳng định bằng hằng contract. Mọi thời điểm là tham số (`atIso`).
**admin-web** (`apps/admin-web/src/features/processes/domain/`):
| File · hàm | Chữ ký | Việc |
|---|---|---|
| `wait-rules.ts` · `dateSources` | `(inputs: {key,label,type}[], stages: {key,name,step,fields:{key,type}[]}[], step: number) => DateSource[]` | nguồn ngày hợp lệ (§2) |
| · `sourceValue` / `parseSourceValue` | `(s: DateSource) => string` / `(v: string) => {kind:"input",key}\|{kind:"field",stageKey,field}\|null` | giá trị `Select` ↔ contract |
| · `offsetDirection` | `(days: number) => {dir:"before"\|"on"\|"after"; abs: number}` | câu tóm tắt |
| · `waitIssues` | `(f:{source:string; offset:string; time:string}, sources: DateSource[]) => {source?:"required"\|"invalid"; offset?:"range"; time?:"format"}` | luật PD-R13/R17 phía form |
| `remind-rules.ts` · `remindIssue` | `(text: string) => "range"\|null` | rỗng hợp lệ; 4…168 nguyên |
| · `escalateIssues` | `(e:{on:boolean; afterH:string; groupId:string}, reviewGroupId: string) => {afterH?:"range"; groupId?:"required"\|"same"}` | 4…2160; khác nhóm kiểm |
| `ttl-rules.ts` · `ttlIssue` / `ttlToValue` / `ttlFromValue` | `(text, noExpiry) => "range"\|null` / `(text, noExpiry) => number\|null` / `(v: number\|null) => {text; noExpiry}` | 1…365 hoặc null |
| `tz-format.ts` · `utcOffsetLabel` | `(timeZone: string, atIso: string) => string` | `"UTC+07:00"`; múi giờ lạ ⇒ `""` |
| · `timeZoneOptions` | `(zones: readonly string[], atIso: string) => {id,label,hint}[]` | cho `RefPicker` |
| `stage-wait.ts`, `wait-format.ts`, `decision-option.ts` | bản sao của chat-web (FD10) | `RunProgress`, `RunActions` |
**chat-web** (`apps/chat-web/src/features/processes/domain/`):
| File · hàm | Chữ ký | Việc |
|---|---|---|
| `stage-wait.ts` · `describeStageWait` | `(f:{status: string; retryCount?: number; nextRetryAt?: string; wait?: {dueAt: string; timeZone: string}}) => {kind:"retrying"; n: number; nextAt?: string}\|{kind:"waiting_date"; dueAt; timeZone}\|{kind:"waiting"}\|{kind:"skipped"}\|{kind:"none"}` | thứ tự: `skipped` → `next_retry_at` (retry) → `wait` → `waiting_timer` trơn → (`running`/`queued` có `retryCount>0` ⇒ `retrying` không `nextAt`) → `none` |
| · `earliestWait` | `(stages: StageWaitFacts[]) => {dueAt; timeZone}\|null` | `StatusLine` |
| `wait-format.ts` · `formatWaitDate` / `formatWaitDateTime` / `formatClock` | `(iso: string, timeZone: string, lang: "vi"\|"en") => string` | FD7; bắt `RangeError` ⇒ UTC |
| `date-input.ts` · `isIsoCalendarDate` | `(s: string) => boolean` | `^\d{4}-\d{2}-\d{2}$` + `Date.UTC` khớp (2026-02-30 ⇒ false) |
| `decision-option.ts` · `decisionOptionVariant` | `(reason: string, option: "add_attempt"\|"use_current"\|"cancel") => "default"\|"retry_exhausted"\|"timer_invalid"` | FD8 |
| `expiry.ts` · `expiryDays` | `(startedAtIso: string, expiresAtIso: string\|null) => number\|null` | câu hết hạn |
| `escalation.ts` · `reviewWaitVariant` | `(o:{escalatedGroup?: string\|null}) => "plain"\|"escalated"` | `TaskWaitingNote` |
Lớp 3 (map contract → domain): chat `shared/lib/stage-label.ts` (`stageLabel(stage: StageView, lang, t) => string`), admin `lib/stage-label.ts`; `lib/domain-contract.test.ts`.

## 6. Mã lỗi → câu báo (khoá i18n ở file i18n; admin `process.admin.*`, chat `process.*`)
| Nguồn | Mã · path | Hiển thị | Khoá |
|---|---|---|---|
| Client/live | `wait` nguồn trống / offset ngoài −365…365 / giờ sai | dưới ô tương ứng, `role="alert"` | `editor.stage.wait.err.{source,offset,time}` |
| 422 `PROCESS_DEF_INVALID` rule `WAIT_INVALID` | path `stages.i.executor`(`.from`…) | dưới khối "Lấy ngày từ" | `…wait.err.WAIT_INVALID` |
| 422 rule `ESCALATE_INVALID` | `stages.i.after.escalate` | dưới khối Chuyển cấp | `…err.ESCALATE_INVALID` |
| 422 `PROCESS_REF_INVALID` `ref:"group"` | `stages.i.after.escalate.group_id` | dưới "Chuyển cấp tới nhóm" | `process.admin.apiError.PROCESS_REF_INVALID` (có sẵn) |
| 422 `PROCESS_REF_INVALID` `ref:"tool"` (P-d2) | `stages.i.executor.tool_key` | dưới "Tool" | `…tool.err.ref` |
| Client | `remind_every_h`, `escalate.after_h`, `ttl_days` ngoài dải | dưới ô | `…err.remind`, `…err.escalateAfter`, `editor.err.ttl` |
| 400 `VALIDATION_ERROR` path `timezone` (admin) | | dưới ô Múi giờ | `tenants.error.timezoneUnsupported` |
| 400 `VALIDATION_ERROR` path `inputs.i.value` (chat) | | dưới trường i | `process.inputs.err.date.invalid` |
| 409 `VERSION_CONFLICT` (def, tenant) | | `ConflictDialog` sẵn có | — |
| 403 | | `ForbiddenState` / toast `state.forbiddenAction` | có sẵn |
`serverErrors(code, paths, rules)` mở rộng nhận `refs: string[]` (từ `details.ref`); `errors.ts` KNOWN không đổi.

## 7. Role + nhãn e2e P-d1 (BUILD phải giữ đúng; QC chọn theo role + tên)
| Màn | Role · tên |
|---|---|
| Panel | `region "Giai đoạn n: <tên>"` (cũ); `combobox "Người thực hiện"` có option "Chờ tới ngày"; `group "Chờ tới ngày"` chứa `combobox "Lấy ngày từ"`, `spinbutton "Chênh lệch (ngày)"`, `getByLabel("Giờ trong ngày")`, `status` chứa "Theo múi giờ công ty: Asia/Ho_Chi_Minh"; `combobox "Sau giai đoạn"` disabled "Chạy tiếp (cố định)" |
| Gate | `spinbutton "Nhắc mỗi (giờ)"`, `checkbox "Chuyển cấp nếu chưa ai kiểm"`, `spinbutton "Chuyển cấp sau (giờ)"`, `combobox "Chuyển cấp tới nhóm"` |
| Thẻ Thông tin | `spinbutton "Thời hạn lượt chạy (ngày)"`, `checkbox "Không hết hạn"` |
| Tenant | `textbox "Múi giờ"` (readonly, giá trị bắt đầu bằng IANA), `button "Đổi múi giờ"`, `searchbox "Tìm múi giờ"`, `option "Europe/Berlin"`, `button "Lưu"` (cũ), `alert` "Múi giờ này chưa được hỗ trợ…" |
| Chat strip | `list "Tiến độ quy trình"` → `listitem` chứa "Chờ tới 14/12/2026" / "Đang thử lại (2/3)" / "Bỏ qua" |
| Chat huy hiệu/dòng | "Đang chờ hẹn"; `status` "Chờ tới 14/12/2026 09:00 · Giai đoạn 2/3 · …" |
| Thẻ quyết | `region "Cần người quyết"`; text "Đã thử lại tối đa 3 lần mà vẫn lỗi."; `button "Thử lại ngay"`, `button "Huỷ lượt chạy"`; `timer_invalid`: `button "Tính lại ngày hẹn"`, `button "Bỏ chờ, đi tiếp"` |
| Form `!key` | `getByLabel("<nhãn trường ngày>")` (type=date), `alert` "Chọn một ngày hợp lệ." |
| Chuyển cấp | `region "Kiểm …"` chứa text "Đã chuyển cấp"; DM: `article` tên "Việc ở … đã chuyển cấp tới nhóm của bạn" |

## 8. Hiệu năng · a11y · test
- **Bundle/render:** không thư viện mới; chunk `canvas` +~1 KB (ngân sách 80 KB giữ), chat initial +~1.5 KB. Múi giờ ≈ 440 mục: `RefPicker` cắt 50, không virtualize. `describeStageWait` thuần trong `memo` của `StageStrip`; `dateSources` `useMemo`.
- **A11y:** mọi control có `label`/`aria-label` (§7); chấm trạng thái kèm chữ + icon (`aria-hidden`); lỗi `role="alert"`, dòng múi giờ `role="status"`; `<input type=date|time>` thật; token đã đạt AA.
- **Unit (`bun test`):** domain mỗi file (ca biên: ngày 2026-02-30, offset ±365, giờ `24:00`, 4/168/2160 giờ, `ttl` 0/366, múi giờ lạ ⇒ rơi UTC, `describeStageWait` mọi nhánh, `decisionOptionVariant` mọi tổ hợp); `stage-label` (VI/EN); `inputs-rules` ca `date`; `def-form` round-trip `wait_until`/`ttl_days`/`remind`/`escalate`; `schemas` tenant `timezone`; `ALL_NOTICE_KINDS`/status exhaustive; `domain-contract.test.ts`. `bun run i18n:check` + `placeholders.test.ts` (`{{x}}` ↔ `{x}`).

## 9. BUILD T11 — thứ tự, chia, file
Đề xuất chia T11 (diff ≈ 400/task): **T11a** i18n (cả 3 file + `i18n:check`) + domain admin/chat + test + sửa exhaustive; **T11b** admin editor (StageWait, StageRemind, DefInfoCard/Limits, canvas badge, RunProgress/RunStatusBadge, def-form, errors); **T11c** admin tenants (Múi giờ) + chat (nhãn, thẻ quyết, form `date`, inbox `escalated`). Lệnh xong: `bun run typecheck && bun test apps/admin-web apps/chat-web packages/i18n && bun run i18n:check && bun run depcruise && bunx playwright test e2e/P-d` (e2e do QC, Luật 4b: ghi kết quả `bun run test:all`). Khối mới qua file mới, không phình `StageForm` (≤ 200 dòng/component).

## 10–13. P-d2 → [`plan-frontend-d2.md`](plan-frontend-d2.md) (panel "Gọi tool" + "Rẽ nhánh" + canvas, chat nhãn "Bỏ qua", tab "Tool quy trình", domain/e2e P-d2)

## 14. Contract còn thiếu cho FE (backend-lead bổ sung — FE không tự sửa)
| # | Cần | Vì sao | Mặc định FE nếu chưa có |
|---|---|---|---|
| G1 | `params[]` thêm `description?`, `options?` → plan-addendum A1 | map tham số | `const` = ô chữ |
| G2 | Hàm thuần live-validate P-d2 + path cụ thể → plan-addendum A2 | câu lỗi đúng ô | một câu chung (§6 i18n) |
| G3 | Hub bỏ qua `output`/`answerer`/`token_budget`/`timeout_s` stage `wait_until`/`tool` → plan-addendum A3 | `ensureWaitStage`/`ensureToolStage` | gửi mặc định (§2) |
| G4 | Notice `escalated` có `task_id` → plan-addendum A4 | DM "Quy trình" | thẻ chỉ tiêu đề |
| G5 | `next_retry_at` ⊥ `wait`, `retry_count` hiệu lực → plan-addendum A4 | `describeStageWait` | như §5 |
| G6 | `expires_at` ở full view → plan-addendum A4 | câu hết hạn (Q3) | `end.expiredGeneric` |
| G7 | `escalated_group`/`escalated`, `tenant_id === null` (FD11) → plan-addendum A4 | thẻ kiểm | chỉ trang Run |

## 15. Câu hỏi mở (kèm mặc định — dùng nếu không trả lời)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | Ô "Múi giờ" có thêm ở **Tạo tenant** (TZ-R03 nói đặt khi tạo) hay chỉ ở Thông tin? | Áp mặc định (Luật 2b): cả hai (§3) |
| Q2 | Nhãn nút quyết riêng cho `retry_exhausted`/`timer_invalid` (FD8) có chấp nhận (khác nhãn chung "Thêm 1 lần làm lại")? | Chấp nhận |
| Q3 | Câu "Lượt chạy hết hạn (7 ngày …)" là hằng 7: đổi thành `{{days}}` từ `expires_at − started_at` | Áp mặc định (Luật 2b): đổi (7 ngày ⇒ chữ như cũ) |
| Q4 | Mockup là HTML tĩnh tự chứa (không `.dc.html` + `support.js`); sau Gate có chuyển thành artboard `docs/design/**/canvas`? | Áp mặc định (Luật 2b): chỉ khi người dùng yêu cầu |
