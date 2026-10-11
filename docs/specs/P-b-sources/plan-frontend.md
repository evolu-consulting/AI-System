# P-b-sources · plan frontend (admin-web + chat-web) — Nguồn tham chiếu

Spec: [`spec.md`](spec.md) §1, §2 (PB-R01–R22), §5 · gate [`../P-b-sources-gate.md`](../P-b-sources-gate.md) · contract (chỉ **tiêu thụ**): [`plan.md`](plan.md) §3 · câu chữ VI/EN nguyên văn: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) · task: [`tasks-frontend.md`](tasks-frontend.md) · nền FE: [`../P-process-engine/plan-frontend.md`](../P-process-engine/plan-frontend.md) (FD2 cờ engine, FD3 i18n riêng, FD10 không thư viện mới).
Artboard: chưa có; mẫu bảng + drawer của Secrets (`features/secrets/`) và Quy trình (`features/processes/`). **Không ADR** (không thêm thư viện).

## 0. Quyết định (Luật 2; "FS" = frontend decision)
| # | Quyết định | Lý do |
|---|---|---|
| FS1 | Admin: feature mới `apps/admin-web/src/features/sources/` (route `routes/_authed/sources.tsx`, nav id `sources` → `/sources`, nhóm CHỨC NĂNG, **cả** `tenant_admin` và `platform_admin`). Hiện khi engine quy trình `on` (dùng lại `useProcessEngine()`, FD2); `off` ⇒ ẩn nav + `NotFoundState`, không nạp chunk | Nguồn là phần của engine quy trình; cùng cờ |
| FS2 | i18n: thêm 2 phần vào `PROCESS_LOCALE_PARTS`: `sources` (trang Nguồn, admin) và `inputs` (form `!key` + chip, chat); câu chữ editor thêm vào phần `admin` có sẵn (`process.admin.editor.sources/inputs/mustKnow`). Nav: `nav.sources` trong `locales.ts` | FD3 |
| FS3 | Mọi gọi API Nguồn nằm ở `features/sources/api.ts`; editor quy trình lấy danh sách nguồn qua **hook của sources** (`useSourceOptions`) — `processes/` không tự gọi `/admin/sources` | CONVENTIONS §2 |
| FS4 | Lỗi server → **câu tĩnh theo mã** (không dùng `message` server), `VALIDATION_ERROR` map theo `details.issues` (mẫu `SecretDrawerController`); 409 `VERSION_CONFLICT` → `ConflictDialog` chung; `SOURCE_IN_USE` → `BlockedDialog` + `DependencyList` | Mẫu Secrets / Quy trình |
| FS5 | **Rò `config.path`**: trên client, kiểu cấu hình tách hai nhánh (`SourceConfig` hoặc `SourceConfigPublic`); `SourceRow` chỉ in `path` khi `config.kind==="local_path" && "path" in config`. Không đưa `path` vào URL, query key, log, `title`, toast, `aria-label` của dòng tenant_admin | PB-R21, D6 |
| FS6 | Nút **Kiểm tra kết nối** dùng `POST /:key/check` ⇒ chỉ bật với nguồn **đã lưu** và form **không dirty** ("Lưu trước rồi kiểm tra", vì check dùng cấu hình đã lưu). Chờ đồng bộ tới `timeout_s` của Hub: spinner + nút khoá, `AbortController` bỏ khi đóng drawer, mốc chờ phía client 130 s | Plan §4(6) |
| FS7 | Form `!key`: **nhẹ tay (lenient)** — thiếu trường `required` vẫn bắt đầu (PB-R13, agent hỏi bằng AskCard); chỉ chặn `source_ref` đã chọn nguồn mà thiếu/sai branch. Có `inputs` ⇒ cả **phòng** và Hỏi AI đi `POST /process-runs` kèm `inputs` (phòng với `origin:{kind:"room"}` như nút ▶); không `inputs` ⇒ đường cũ không đổi | Contract `RunProcessDefRequest.inputs`; tin gọi trong phòng đi `useSendRoomText` không mang `inputs` |
| FS8 | AskCard chip nguồn: **không đổi contract**. Hub điền `choices` = ký hiệu nguồn (xem §9 điểm 4); FE ghép mô tả từ `GET /process-runs/sources` (khớp `choice === chip.key`) làm `title` + mô tả phụ. Chip không khớp ⇒ hiện như chip thường | PB-R13 ("chip = nguồn đã đăng ký") |
| FS9 | Giới hạn kích thước: component ≤ 200 dòng. `StageForm.tsx` hiện 235 dòng (nợ cũ) ⇒ **chỉ chèn 2 dòng gắn** `<StageSourcesField/>` + `<StageMustKnow/>`; logic ở file mới; ghi `docs/TECH-DEBT.md`. `def-form.ts` (305) chỉ thêm gọi sang `lib/sources-form.ts` mới | Luật 4 |
| FS10 | Hiệu năng: route `/sources` là chunk riêng (autoCodeSplitting, ≤ 50 KB gz); `InputsForm` (chat) là chunk lười (≤ 8 KB gz) nạp khi `!key` của quy trình có `inputs`; danh sách nguồn cursor "Tải thêm" (≤ 100/trang, không virtualize); chip `staleTime` 60 s | CONVENTIONS §6; perf không chặn mốc |

## 1. Màn "Nguồn" — `/sources` (admin · P-b1)
**Bố cục:** `PageHeader` (tiêu đề + phụ đề + `Thêm nguồn`) → thanh lọc (`TenantPicker` chỉ `platform_admin`, chọn "Loại nguồn", ô tìm theo ký hiệu) → `DataTable`. Bộ lọc/drawer trên URL: `?tenant&kind&q&drawer=new|edit|view&source=<key>` (mẫu Secrets). Không có `path` trong URL.

| Cột | Nội dung |
|---|---|
| Ký hiệu | `key` (mono) |
| Loại | badge: `Git công khai` / `Đường dẫn cục bộ` / `Tài liệu thư viện` |
| Mô tả | `description` (cắt 1 dòng, `title` đủ) |
| Đích | git: `host/đường-dẫn` rút gọn + `@branch`; library: tên tài liệu (nếu có) hoặc "Tài liệu thư viện"; local_path: `platform_admin` thấy `path`, `tenant_admin` thấy "Ẩn (chỉ quản trị nền tảng)" |
| Dùng bởi | `used_by.length` quy trình (hover liệt kê); 0 ⇒ "—" |
| Trạng thái | từ `last_pin`: có ⇒ badge "Đã kiểm tra · {{pin}}" (git: 7 ký tự SHA; library: 8 ký tự version; local: "snapshot"); `null` ⇒ "Chưa kiểm tra". Không có trạng thái "lỗi" lưu sẵn (contract không có) |

Menu dòng `⋯`: `Sửa` (hoặc `Xem` nếu `tenant_admin` + `local_path`), `Kiểm tra kết nối`, `Xoá`. Dòng `local_path` với `tenant_admin`: chỉ `Xem` (và kiểm tra bị khoá, `tooltip` "Chỉ quản trị nền tảng kiểm tra được nguồn này").

**Trạng thái trang**
| Trạng thái | Hiển thị |
|---|---|
| Đang tải | `LoadingState` dạng skeleton 5 dòng (aria-busy) |
| Rỗng | `EmptyState` "Chưa có nguồn nào." + `Thêm nguồn`; sau lọc không khớp ⇒ câu chung `state.empty.noMatch` + `Xoá bộ lọc` |
| Lỗi | `ErrorState` "Không tải được danh sách nguồn." + `Thử lại` |
| Không có quyền / engine tắt | `member` ⇒ `ForbiddenState`; engine `off` ⇒ `NotFoundState` |
| 403 khi ghi | drawer: `alert` câu tĩnh (xem i18n §3) |
| 409 | `VERSION_CONFLICT` ⇒ `ConflictDialog`; `SOURCE_KEY_TAKEN` ⇒ lỗi dưới ô ký hiệu; `SOURCE_IN_USE` ⇒ `BlockedDialog` |

## 2. Drawer khai báo/sửa (admin · P-b1)
`Sheet` phải (mẫu `SecretDrawer`), chế độ `new` / `edit` / `view`. Thứ tự trường:
1. `Ký hiệu nguồn` (chỉ `new`; sửa ⇒ khoá, `key` bất biến) — trim, chữ thường.
2. `Loại nguồn` (radiogroup): `Git công khai` · `Tài liệu thư viện` · `Đường dẫn cục bộ` (**chỉ `platform_admin`**). Sửa ⇒ khoá loại (PUT không đổi `kind`; đổi loại = tạo nguồn mới; tránh `SOURCE_IN_USE` do đổi loại).
3. Theo loại:
   | Loại | Trường |
   |---|---|
   | git_remote | `Địa chỉ kho Git (https)` + `Nhánh (branch)` + `alert` thông tin "Chỉ kho công khai. Kho riêng chưa được hỗ trợ." (D2). **Không** ô mật khẩu/token. |
   | library | `Tài liệu thư viện` (combobox tìm theo tên, nạp qua endpoint danh sách tài liệu — §9 điểm 1); sau khi chọn hiện "Phiên bản hiện tại: {{version}}" (chỉ thông tin; ghim thật do Runtime lúc chạy) |
   | local_path | `Đường dẫn trên máy Runtime` + `alert` **cảnh báo bắt buộc** (variant warning, luôn hiện, `role="alert"` tĩnh): "Đường dẫn này nằm trên máy chạy Runtime, không phải máy của bạn. Phải nằm trong thư mục gốc đã được cấu hình." + `Công ty` (`TenantPicker`, bắt buộc khi `new` — gửi `tenant_id`) |
4. `Mô tả` (textarea ≤ 500, đếm ký tự; agent đọc mô tả này trong MANIFEST nên có gợi ý "Mô tả ngắn để agent biết nguồn này dùng cho việc gì").
5. Khối **Kiểm tra kết nối** (chỉ nguồn đã lưu): nút `Kiểm tra kết nối` + vùng kết quả `role="status"`:
   | Kết quả | Hiển thị |
   |---|---|
   | 200 git | "Kết nối được: {{branch}} → {{sha}} · {{files}} tệp · {{size}}" (SHA đủ 7 ký tự đầu, `title` đủ 40) |
   | 200 library | "Tài liệu đọc được · phiên bản {{version}} · {{size}}" |
   | 200 local | "Đường dẫn hợp lệ · {{files}} tệp · {{size}}" |
   | 422 `SOURCE_UNRESOLVABLE` / `_HOST_NOT_ALLOWED` / `_TOO_LARGE` | `alert` câu tĩnh theo mã (i18n §3) |
   | 403 `SOURCE_FORBIDDEN_KIND` | `alert` câu tĩnh |
   | Hết thời gian chờ / mạng | `alert` "Không nhận được phản hồi từ Runtime. Thử lại sau." |
   Kết quả 200 cũng làm `invalidate` danh sách (cột Trạng thái cập nhật `last_pin`).
6. Chân: `Lưu` (EditorSaveBar-style trong Sheet) · `Huỷ`. Lưu gửi `version` (PUT); `new` ⇒ POST. Toast thành công: "Đã tạo nguồn {{key}}" / "Đã lưu nguồn {{key}}".
7. Chế độ `view` (tenant_admin + local_path): chỉ ký hiệu, loại, mô tả (đọc), cảnh báo; không nút Lưu/Kiểm tra.

**Xoá:** `ConfirmDialog` nhẹ (không bắt gõ lại tên — nguồn chỉ-đọc, xoá mềm, khác Secrets): "Xoá nguồn {{key}}?" / "Quy trình không còn dùng nguồn này. Các lượt chạy đang dùng bản ghim vẫn giữ nguyên." Nếu `used_by.length>0` ⇒ không mở confirm mà mở thẳng `BlockedDialog` (rồi vẫn xử lý 409 từ server, vì `used_by` có thể cũ): danh sách `DependencyList` mỗi dòng `{{process_key}} · giai đoạn {{stage_key}}` là link tới `/processes/<process_key>`. Toast: "Đã xoá nguồn {{key}}". `SOURCE_FORBIDDEN_KIND` ⇒ toast lỗi.

## 3. Validate phía client (khớp contract plan §3.1–3.2; câu lỗi ở i18n §2)
| Trường | Luật | Mã lỗi (key) |
|---|---|---|
| `key` | trim + lower; `^[a-z0-9-]{2,32}$` | `key.invalid` |
| `kind` | bắt buộc; `local_path` chỉ platform_admin | — |
| `config.url` | trim; bắt buộc; ≤ 2048; `new URL`; scheme `https:`; không `username`/`password`; không có `@` trước host | `url.required` · `url.https` · `url.credential` · `url.tooLong` |
| `config.branch` | trim; 1..255; không mở đầu `-` | `branch.required` · `branch.dash` · `branch.tooLong` |
| `config.path` | trim; 1..1024 | `path.required` · `path.tooLong` |
| `config.document_id` | bắt buộc (UUID chọn từ danh sách) | `document.required` |
| `tenant_id` (local_path, platform_admin) | bắt buộc khi `new` | `tenant.required` |
| `description` | ≤ 500 | `desc.tooLong` |
| Editor — `def.sources` | ≤ 20; nguồn đã chọn phải còn trong danh sách (nguồn xoá ⇒ gắn cờ "không còn") | `defSources.max` |
| Editor — `stage.sources` | ≤ 5/giai đoạn; mỗi `source_key` ∈ `def.sources` | `stageSources.max` · `stageSources.notInDef` |
| Editor — allowlist | mỗi dòng: trim, bỏ dòng trống, 1..256, không `..`, không mở đầu `/` hoặc `\`, không ký tự null; ≤ 20 dòng/nguồn | `glob.invalid` · `glob.max` |
| Editor — `must_know` | mỗi dòng trim, ≤ 200 ký tự; ≤ 10 dòng | `mustKnow.tooLong` · `mustKnow.max` |
| Editor — `inputs` | ≤ 10; `key` `^[a-z0-9-]{2,32}$` duy nhất; `label` trim 1..80; `type` ∈ 4 giá trị; `options` chỉ khi `select`, 1..20 mục, mỗi 1..200, không trùng | `input.key` · `input.keyDup` · `input.label` · `input.options` · `input.max` |
| Form `!key` — `text` | ≤ `PROCESS_INPUT_MAX` (hằng của contract) | `inputs.text.tooLong` |
| Form `!key` — `source_ref` | nếu chọn nguồn ⇒ branch bắt buộc, 1..255, không mở đầu `-` | `inputs.branch.*` |
| Form `!key` — `select` | giá trị ∈ `options` | — |

Schema zod ở `features/sources/lib/schemas.ts` (+ `.test.ts`) — thông điệp là **key i18n** (như `secrets/lib/schemas.ts`), tái dùng `SourceKeySchema`/`GlobSchema`/`BranchSchema` từ `@ai/contracts` khi chúng được export; **không** dựng bản sao nếu contract đã có.

## 4. Editor quy trình — khối nguồn / đầu vào / must_know (admin · P-b1 tối thiểu)
Phần **P-b1** (đủ HUB-FR-121/124/125 + ADM-FR-69 dạng khai báo); phần còn lại **P-b2** (xem §8).

| Khối | Vị trí | Hành vi (P-b1) |
|---|---|---|
| "Nguồn của quy trình" (`SourcesCard`) | sau `DefInfoCard` | `combobox "Thêm nguồn"` (tìm trong nguồn công ty, loại đã chọn) + danh sách chip có `button "Bỏ nguồn {{key}}"`; ≤ 20. Bỏ nguồn đang được ≥ 1 giai đoạn dùng ⇒ chặn + câu "Nguồn {{key}} đang được giai đoạn {{n}} dùng. Bỏ khỏi giai đoạn trước." Rỗng ⇒ "Quy trình chưa dùng nguồn nào." + link `Khai báo nguồn` → `/sources`. Nguồn bị xoá phía server ⇒ chip đỏ "không còn" (lưu bị chặn tới khi bỏ) |
| "Thông tin đầu vào" (`InputsCard`) | sau `SourcesCard` | bảng hàng sửa tại chỗ: ký hiệu · nhãn · kiểu · bắt buộc · lựa chọn (chỉ `select`, textarea mỗi dòng một giá trị); `Thêm trường` (≤ 10), `Xoá trường`. Ghi chú: "Thiếu trường bắt buộc, agent sẽ hỏi lại người chạy." Không xem trước form (P-b2) |
| Trong mỗi giai đoạn (`StageSourcesField`) | trong accordion giai đoạn, sau "Mẫu kết quả" | `group "Nguồn của giai đoạn"`: một `checkbox` mỗi nguồn trong `def.sources`; chọn ⇒ hiện `textbox "Đường dẫn cho phép — {{key}}"` (mỗi dòng một glob; rỗng = cả nguồn, kèm "Vẫn tính trần 50 MB / 2.000 tệp"). Tick thứ 6 ⇒ `disabled` + "Tối đa 5 nguồn mỗi giai đoạn." Có ≥ 1 nguồn ⇒ `Alert` thông tin: "Giai đoạn này sẽ bắt buộc có mục “## Nguồn tham chiếu” trong kết quả (tự thêm)." và nhãn tĩnh "Ngân sách mặc định 200.000 token nếu giai đoạn không đặt." (chỉ nhãn; ô sửa ngân sách = P-b2 nếu chưa có trong editor) |
| Trong mỗi giai đoạn (`StageMustKnow`) | cuối accordion | `textbox "Điều phải biết trước khi làm"` (textarea, mỗi dòng một mục; ≤ 10, ≤ 200 ký tự) + gợi ý "Agent sẽ hỏi những điều chưa biết (tối đa 3 lần hỏi mỗi giai đoạn)." |

`lib/sources-form.ts` (thuần, test): `defToForm`/`formToDef` cho `sources[]`, `inputs[]`, `stage.sources[]` (allowlist ⇄ textarea), `must_know[]` (⇄ textarea); `unusedSources(def)`; `canDropSource(def,key)`. Lỗi server `PROCESS_REF_INVALID` với path `stages.<i>.sources.<j>.source_key` ⇒ gắn vào giai đoạn i (bổ sung `processes/lib/errors.ts`).

## 5. Chat-web — form `!key` và chip (P-b1)
Thư mục `apps/chat-web/src/features/processes/inputs/` (PF mới; `api.ts` riêng — nơi duy nhất gọi `GET /process-runs/sources` và upload tệp cho trường `file`).
| File | Việc |
|---|---|
| `api.ts` | `useSourceChips(enabled)` (`GET /process-runs/sources`, `staleTime` 60 s, key `processKeys.sourceChips`); `uploadInputFile(file)` dùng lại `features/attachments/api` (H2c); parse `ProcessSourceChip` |
| `lib/inputs-rules.ts` | thuần: `needsForm(item)` (`inputs.length>0`), `emptyValues(defs)`, `toRequestInputs(defs, values)` (bỏ giá trị rỗng, ghép `type`), `validateSourceRef`, `gitChips(chips)` (lọc `kind==='git_remote'`) |
| `components/InputsForm.tsx` | `Dialog` "Thông tin cho quy trình {{name}}", lưới trường; footer `Bắt đầu quy trình` / `Huỷ`; ≤ 200 dòng |
| `components/InputField.tsx` | rẽ theo `type`: text `Textarea`; select `Select`; file nút chọn tệp (1 tệp, hiện tên + `Bỏ`); source_ref ⇒ `SourceRefField` |
| `components/SourceRefField.tsx` | `Select` nguồn (chip `git_remote`, mỗi mục `key — mô tả`) + `Input` nhánh (placeholder "main"; điền sẵn `default_branch` nếu contract có — §9 điểm 3) |
| `hooks/use-inputs-form.ts` | state form + `submit` gọi `startProcess({process_key,input,origin,inputs})` (tái dùng `useRunStarter` của `composer/hooks/use-bang-submit.ts` — **xuất** hàm, không viết lại) |

**Luồng:** gõ `!key nội dung` + Enter ⇒ `intercept` (đã có) tra catalog: quy trình **có `inputs`** ⇒ mở `InputsForm` (nội dung gõ giữ làm `input`; cả phòng lẫn Hỏi AI, FS7) thay vì gửi ngay; quy trình không `inputs` ⇒ đường cũ. Đóng form (`Huỷ`/Esc) ⇒ trả lại chữ cho composer (không mất). Thành công ⇒ toast cũ "Đã bắt đầu quy trình …" (nút Mở) hoặc mở run.
Trạng thái form: tải chip (skeleton trong ô nguồn) · chip rỗng (select hiện "Công ty chưa khai báo nguồn Git nào." + trường vẫn bỏ trống được) · lỗi chip ("Không tải được danh sách nguồn." + `Thử lại`, form vẫn gửi được nếu không chọn nguồn) · đang tải tệp (nút khoá, thanh tiến độ) · lỗi tải tệp (câu dưới trường) · gửi lỗi (`alert` trong form, giữ giá trị): 422 `SOURCE_UNRESOLVABLE` ⇒ câu "Không bắt đầu được…"; `PROCESS_NOT_FOUND` / `TOO_MANY_PROCESS_RUNS` ⇒ dùng câu composer hiện có (`process.composer.error.*`).
**AskCard chip (FS8):** `AskTaskCard`/`useAskCard` gọi `useSourceChips` **chỉ khi** có `choice` khớp một `chip.key` (bật lười sau lần khớp đầu, tránh gọi cho mọi câu hỏi); chip hiển thị `key`, `title` = mô tả. Chip đơn-câu gửi ngay như hiện hành (`ask-rules`), không đổi.
**Nhãn lý do:** thêm `source_unresolvable` vào bản đồ lý do `DecisionCard` (chat `run-block`/`inbox`) và run page admin (phần `run` có sẵn, 15 mã): "Không đọc được nguồn tham chiếu" + giải thích 1 dòng (i18n §3).

## 6. Role + nhãn cho e2e (QC chọn đúng các nhãn này; VI, `ai.locale=vi`)
| Vùng | Phần tử | Role + tên |
|---|---|---|
| Nav | mục | `link "Nguồn"` (nhóm CHỨC NĂNG; `tenant_admin` + `platform_admin`; không có khi engine tắt) |
| Trang | tiêu đề / bảng | `heading "Nguồn tham chiếu"` · `table "Nguồn"` (cột Ký hiệu · Loại · Mô tả · Đích · Dùng bởi · Trạng thái) |
| | lọc | `combobox "Công ty"` (platform_admin) · `combobox "Loại nguồn"` · `searchbox "Tìm theo ký hiệu"` |
| | nút | `button "Thêm nguồn"` · menu dòng `button "Thao tác {{key}}"` → `menuitem "Sửa"` / `"Xem"` / `"Kiểm tra kết nối"` / `"Xoá"` |
| Drawer | tên | `dialog "Thêm nguồn"` · `dialog "Sửa nguồn {{key}}"` · `dialog "Xem nguồn {{key}}"` |
| | trường | `textbox "Ký hiệu nguồn"` · `radiogroup "Loại nguồn"` ⊃ `radio "Git công khai"` / `radio "Tài liệu thư viện"` / `radio "Đường dẫn cục bộ"` (**chỉ platform_admin**; tenant_admin: không tồn tại) · `textbox "Địa chỉ kho Git (https)"` · `textbox "Nhánh (branch)"` · `textbox "Đường dẫn trên máy Runtime"` (**không tồn tại** với tenant_admin) · `combobox "Tài liệu thư viện"` · `combobox "Công ty"` (local_path, platform) · `textbox "Mô tả"` |
| | cảnh báo | `alert` chứa "Đường dẫn này nằm trên máy chạy Runtime, không phải máy của bạn." (luôn hiện khi loại = local_path / chế độ xem) |
| | hành động | `button "Lưu"` · `button "Huỷ"` · `button "Kiểm tra kết nối"` (disabled khi chưa lưu/dirty) · kết quả `status` (200) hoặc `alert` (lỗi) |
| Xoá | xác nhận | `alertdialog "Xoá nguồn {{key}}?"` (`button "Xoá"`, `button "Huỷ"`) · chặn: `dialog "Không thể xoá nguồn {{key}}"` ⊃ `link "{{process_key}} · giai đoạn {{stage_key}}"` |
| Editor | khối nguồn | `region "Nguồn của quy trình"` ⊃ `combobox "Thêm nguồn"`, `button "Bỏ nguồn {{key}}"` |
| | đầu vào | `region "Thông tin đầu vào"` ⊃ `button "Thêm trường"`; mỗi hàng `textbox "Ký hiệu trường"`, `textbox "Nhãn hiển thị"`, `combobox "Kiểu trường"`, `checkbox "Bắt buộc"`, `textbox "Lựa chọn (mỗi dòng một giá trị)"`, `button "Xoá trường {{key}}"` |
| | giai đoạn | trong `region "Giai đoạn n: <tên>"`: `group "Nguồn của giai đoạn"` ⊃ `checkbox "{{key}}"`, `textbox "Đường dẫn cho phép — {{key}}"`; `textbox "Điều phải biết trước khi làm"` |
| Chat | form | `dialog "Thông tin cho quy trình {{name}}"`; trường theo **nhãn** do quy trình đặt: `textbox "<label>"` (text) · `combobox "<label>"` (select) · `button "Chọn tệp — <label>"` (file) · `combobox "<label> · Nguồn"` + `textbox "<label> · Nhánh (branch)"` (source_ref); `button "Bắt đầu quy trình"` · `button "Huỷ"`; lỗi `alert` |
| | AskCard | chip nguồn = `button "<key>"` trong `region "… cần thêm thông tin"` (như chip hiện có); `title` = mô tả |
| Run | lý do | "Không đọc được nguồn tham chiếu" trong Cần người quyết (admin run page + chat DecisionCard) |

## 7. Ca e2e đề xuất
| Ca | AC | Nội dung |
|---|---|---|
| E-PB1 | ADM-FR-68 | platform_admin: Thêm nguồn git (url https hợp lệ) ⇒ toast "Đã tạo nguồn …", dòng xuất hiện "Chưa kiểm tra"; `Kiểm tra kết nối` ⇒ `status` "Kết nối được: … → <sha>" và cột Trạng thái đổi |
| E-PB2 | PB-R02 | host ngoài allowlist ⇒ lỗi dưới ô URL (câu `SOURCE_HOST_NOT_ALLOWED`); URL có `user:pass@` ⇒ lỗi client, không gọi API |
| E-PB3 | AC-H36(e), PB-R21 | tenant_admin: không có `radio "Đường dẫn cục bộ"`; dòng local_path của công ty hiển thị ký hiệu + mô tả, **không** chứa đường dẫn (DOM + XHR response đã là Public); chỉ `menuitem "Xem"`; platform_admin thấy path + cảnh báo "trên máy Runtime" |
| E-PB4 | PB-R08 | xoá nguồn đang được quy trình dùng ⇒ `dialog "Không thể xoá nguồn …"` liệt kê quy trình/giai đoạn; bỏ khỏi quy trình rồi xoá ⇒ toast "Đã xoá nguồn …" |
| E-PB6 | ADM-FR-69 | editor: thêm nguồn, chọn 5 nguồn cho giai đoạn (tick thứ 6 disabled), glob `../x` ⇒ lỗi client, bỏ nguồn đang dùng bị chặn; Lưu ⇒ tải lại thấy đủ |
| E-PB7 | AC-H37 | chat: `!key` của quy trình có `inputs` mở form; chọn nguồn + branch + Bắt đầu ⇒ run chạy, `inputs` đã gửi; để trống trường bắt buộc vẫn bắt đầu rồi AskCard hiện chip nguồn |
| E-PB8 | PB-R05 | nguồn không resolve được ⇒ form báo "Không bắt đầu được…" (hoặc run `needs_decision` + lý do "Không đọc được nguồn tham chiếu") |

## 8. P-b1 vs P-b2 (ranh giới)
| P-b1 (lát này) | P-b2 (hoãn, spec riêng — D1) |
|---|---|
| Trang Nguồn đủ CRUD + kiểm tra + xoá chặn | Editor đầy đủ ①②: kéo sắp xếp giai đoạn, nhóm agent ③, Luật tự duyệt, tự quay lại |
| Editor: thẻ nguồn, thẻ đầu vào, nguồn + allowlist + must_know mỗi giai đoạn (form tối thiểu) | Xem trước form `!key` trong editor; ô sửa ngân sách token mỗi giai đoạn; gợi ý glob/duyệt cây thư mục nguồn |
| Form `!key` + chip AskCard + nhãn lý do | Form đầu vào ở nút "Chạy" của admin (RunDialog giữ ô "Nội dung đầu vào") |
| — | "Nguồn đã ghim" + bảng file đã đọc ở trang run / Token (cần contract `RunView`) |

## 9. Cần backend-lead / qc xác nhận
| # | Điều cần | Mặc định FE nếu chưa trả lời |
|---|---|---|
| 1 | **Endpoint liệt kê tài liệu library** cho picker (chưa có trong contract): đề xuất `GET /admin/sources/library-documents?q&limit&cursor` → `{items:[{id,name,version,updated_at}],next_cursor}` (tenant_admin, theo tenant) | Picker thay bằng `textbox "Mã tài liệu (UUID)"` — khó dùng; library vẫn khai báo được nhưng UX kém |
| 2 | `ProcessCatalogItem` (chat `GET /processes`) cần thêm `inputs: ProcessInputDef[]` (default `[]`) để `!key` biết có form hay không và vẽ trường | Không có ⇒ không mở được form: **chặn P-b1 chat**; FE chưa làm FS7 tới khi có |
| 3 | `ProcessSourceChip` thêm `default_branch?: string` cho `git_remote` (không phải bí mật) | Ô nhánh để trống, placeholder "main" |
| 4 | Ask-task `choices` do Hub điền = ký hiệu nguồn khi trường `source_ref` thiếu (PB-R13)? | FE ghép mô tả theo khớp `key` (FS8); nếu Hub không điền `choices`, không có chip nguồn |
| 5 | Mã lỗi `POST /process-runs` khi `source_ref` sai (nguồn không tồn tại/không phải git/branch lỗi): `VALIDATION_ERROR` hay mã riêng? Và khi Runtime ngoại tuyến/không claim trong `timeout_s` cho `POST /:key/check` và start | FE coi `422 SOURCE_UNRESOLVABLE`; còn lại câu chung "Không thực hiện được. Thử lại sau." |
| 6 | Run bắt đầu từ phòng qua `POST /process-runs` `origin:room` có sinh tin gọi/khối timeline giống gõ `!key` trong phòng không? (FS7) | Giả định có (nút ▶ đang dùng cùng đường); QC xác nhận bằng E-PB7 |
| 7 | Mock cho `bun run mocks`: `/admin/sources*`, `/process-runs/sources`, thêm `inputs` ở catalog — ai dựng (backend B2-style hay FE)? | FE dựng mock trong `apps/admin-web`/`chat-web` mock hiện có theo contract, backend-lead soát |
