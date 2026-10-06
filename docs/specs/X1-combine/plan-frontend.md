# Plan frontend · X1-combine (F1–F6)

Chủ: frontend-lead · 2026-10-07 · nguồn: spec §2, §5, §8; CR-036/038/040/043/044; contract `@ai/contracts/chat` (commands, agents, attachments, errors, entities), `@ai/contracts/hub-admin`, `@ai/contracts/hub-internal/test-run`. Không thư viện mới, không ADR, không artboard mới (mẫu C1 composer/AskCard, M3 Groups tab/AccessExplainer, ui-admin §7.4 Test panel).

## 0. Quyết định chung
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Chat: gọi Hub bằng đường dẫn tương đối, proxy dev/preview thêm `/agents`, `/commands`, `/attachments` (khớp tiền tố, gồm `/attachments/:id/content`) trong `apps/chat-web/rsbuild.config.ts` (`server.proxy` dùng cho cả `dev` và `preview`) | giống C1 D4; X1-AC09 |
| D2 | Chat `lib/http.ts`: (a) `RequestOptions.rawBody?: Blob` (gửi nguyên, không `JSON.stringify`, không ép `Content-Type` JSON); (b) `ApiError.retryAfter?: number` đọc `RETRY_AFTER_HEADER` (giây, sai định dạng → `TOO_MANY_RUNS_RETRY_AFTER_S`); (c) `ApiErrorCode` thêm `ChatCommandErrorCode \| ChatRoutingErrorCode \| ChatAttachmentErrorCode` | upload thân thô (CR-040), 429 |
| D3 | `//…` và `@@…` gửi **nguyên văn**, Hub bỏ một ký tự (`command-parse.rules.ts`, `mention-parse.rules.ts`); client chỉ **không mở menu** | không lặp luật |
| D4 | `context` (`MessageContext`): chat-web không có nguồn trang → không gửi; hàm thuần `buildSendRequest({content, flowId?, context?, attachmentIds?})` bỏ trường rỗng, `run-driver` nhận `context`/`attachment_ids` để extension dùng sau | X1-AC03 = unit + contract |
| D5 | Kết quả gửi chuyển về composer: `onSubmit(text, extras)` trả `SendOutcome` thay `boolean`; lỗi trước stream có mã riêng (§1.4) hiện **trong composer** (`role="alert"`), không toast; mã khác giữ toast C1 | giữ chữ để sửa |
| D6 | Admin gọi Hub **thẳng** (X1-R08): `apps/admin-web/src/lib/hub.ts` `hubUrl(path)` = `PUBLIC_HUB_URL` (bỏ `/` cuối) + path, dùng lại `api()` của `lib/http.ts` (Bearer + refresh 1 lần; fetch URL tuyệt đối). Vắng `PUBLIC_HUB_URL` → không gọi, hiện trạng thái "Chưa cấu hình Hub". `PUBLIC_*` Rsbuild tự nhúng ⇒ **không sửa `apps/admin-web/rsbuild.config.ts`**; chỉ thêm kiểu vào `src/env.d.ts` (`PUBLIC_HUB_URL`, `PUBLIC_STUDIO_URL`) | CR-043 Q-K1 |
| D7 | Nút "⇄ Agent Studio" đặt trong `Topbar.tsx` (không cần `AppShell.tsx`); `<a href>` cùng tab như Studio "⇄ Admin" | ui-admin §4.1 |
| D8 | Test command: gọi admin-api (giả định `POST /admin/commands/:id/test`, chờ backend-lead chốt ở `plan.md`); `HUB_INTERNAL_TOKEN` không bao giờ ở FE | X1-R08, AC11 |
| D9 | Feature mới: chat `features/{commands,agents,attachments}` (mỗi cái có `api.ts` + README); admin `features/hub` (api agent-grants + effective). Composer chỉ import hook/kiểu, không fetch | CONVENTIONS §2 |

4 file từng sửa dở đã commit (66299a0) — không còn chờ Q10. File "nhạy" task chạm: `apps/chat-web/rsbuild.config.ts` (F1, 3 dòng proxy). `apps/admin-web/rsbuild.config.ts`, `AppShell.tsx`, `docs/PRODUCTION-NOTES.md`: **không chạm**.

## 1. Chat (`apps/chat-web`)

### 1.1 Menu `/` (F1)
| Mục | Chi tiết |
|---|---|
| Mở | ký tự đầu là `/`, chưa có khoảng trắng, không phải `//`; con trỏ trong token đầu |
| Dữ liệu | `features/commands/api.ts` `useCommandMenu()` = `GET /commands` (`CommandMenuResponseSchema`), TanStack Query `staleTime` 5 phút, nạp lười lần đầu gõ `/` |
| Lọc | `lib/slash.ts` thuần: tiền tố `name` hoặc `aliases`, không phân biệt hoa thường, tối đa 8 dòng hiện (cuộn); khớp alias hiện "(alias /x)" |
| Dòng | `/name` + cú pháp `<arg>` (required) / `[arg]` (không), `rest` thêm `…`; mô tả theo ngôn ngữ (`en` null → `vi`) |
| Phím | ↑↓ chọn (vòng), Enter/Tab điền `/name ` (không gửi), Esc đóng menu (Esc chỉ dừng run khi menu đóng), click chọn |
| A11y | textarea `aria-controls`, `aria-expanded`, `aria-activedescendant`; menu `role="listbox"` tên "Lệnh"; dòng `role="option"` `aria-selected` |
| Trạng thái | tải: "Đang tải lệnh…" · rỗng: "Bạn chưa được cấp lệnh nào" · không khớp: "Không có lệnh khớp “/{q}”" · lỗi: "Không tải được danh sách lệnh" + nút "Thử lại" (401 do `lib/http` refresh; 403 coi như rỗng) |

### 1.2 Menu `@` (F2)
| Mục | Chi tiết |
|---|---|
| Mở | token tại con trỏ bắt đầu bằng `@` (không `@@`) và mọi token trước nó đều là tag `@key` (vùng tag đầu tin, như Hub) |
| Dữ liệu | `features/agents/api.ts` `useAgentMenu()` = `GET /agents` (`AgentMenuResponseSchema`), staleTime 60 s (Studio sửa thấy sau ≤ 1 phút, CR-044 (7)) |
| Lọc | tiền tố `key` hoặc chứa trong `name[lang]`; dòng: tên + `@key` (mono) + mô tả 1 dòng (cắt) |
| Phím/A11y | như §1.1; listbox tên "Agent" |
| Trạng thái | tải "Đang tải agent…" · rỗng "Bạn chưa được cấp agent nào" · không khớp "Không có agent khớp “@{q}”" · lỗi "Không tải được danh sách agent" + "Thử lại" |
| Thành phần | `composer/components/SuggestMenu.tsx` dùng chung (listbox trình bày), `composer/hooks/use-suggest.ts` (trigger + chỉ mục), `CommandMenu`/`AgentMenu` mỏng |

### 1.3 `responder` (F2)
`run/lib/reducer.ts`: `run.started.responder` → `RunState.responder`; tin lịch sử `Message.responder`. `FlowBlock`/`FlowMessages`: nhãn người trả lời = `responder.name` nếu có, không thì `answer.who` ("Consultant"); avatar giữ nguyên. Delta dài: giữ rAF gộp của `run-driver`, thêm unit 500 delta ≤ 40 ký tự khi step đang mở → nội dung đủ, không chờ `step.finished` (X1-AC06).

### 1.4 Lỗi trước stream (F1, F2) — `composer/components/SendErrorNotice.tsx`, `role="alert"`
| Mã | VI | EN | Hành động |
|---|---|---|---|
| `CMD_NOT_FOUND` | Không có lệnh /{name}. | There is no /{name} command. | nếu `suggestions` ≠ []: "Ý bạn là:" / "Did you mean:" + nút `/{s}` (thay tên lệnh trong ô, focus) |
| `CMD_MISSING_ARG` | Lệnh /{name} thiếu: {missing}. | /{name} is missing: {missing}. | thêm dòng nếu `invalid` ≠ []: "Giá trị không hợp lệ: {invalid}." / "Invalid value: {invalid}." |
| `CMD_MISSING_ARG` (tin chỉ có tag) | Hãy nhập nội dung sau @{tag}. | Type a message after @{tag}. | khi tin bắt đầu `@` và không phải lệnh |
| `AGENT_NOT_FOUND` | Không tìm thấy agent @{tag}. | Agent @{tag} not found. | "Ý bạn là:" + nút `@{s}` (thay tag) |
| `TOO_MANY_RUNS` | Bạn đang có quá nhiều câu trả lời đang chạy. Thử lại sau {n} giây. | Too many answers are running. Try again in {n}s. | đếm ngược theo `retryAfter`; nút Gửi `disabled` tới 0 rồi tự ẩn thông báo; không tự gửi lại |
| `ATTACHMENT_NOT_FOUND` | Một số tệp không còn. Hãy xoá và đính kèm lại. | Some files are no longer available. Remove and attach them again. | chip có id trong `details.ids` → trạng thái lỗi |
| khác | (giữ toast C1 `toast.sendFailed` / `toast.flowBusy`) | | |
`{name}`/`{tag}` lấy từ chữ đã gửi (`lib/slash.ts` `leadingCommand`, `leadingTags`). Thông báo mất khi sửa chữ hoặc gửi thành công. `details` parse bằng schema contract; sai dạng → bỏ phần gợi ý.

### 1.5 AskCard `side_effect` (F1)
Không đổi component: SSE `ask` `choices:["Đồng ý","Huỷ"]` (Hub dịch theo `Accept-Language`) đã hiện chip; bấm chip gửi đúng chữ. Chỉ thêm unit render 2 chip + e2e X1-AC08 (qc).

### 1.6 Đính kèm (F3) — `features/attachments`
| Mục | Chi tiết |
|---|---|
| Nút | icon kẹp giấy trong composer, `button` aria-label "Đính kèm tệp"/"Attach files"; `<input type="file" multiple hidden accept=...>` từ `ATTACH_ALLOWED`; kéo-thả vào composer cùng luật |
| Chặn sớm (`lib/validate.ts`) | đuôi ∉ `ATTACH_ALLOWED` → chip lỗi; `size > ATTACH_MAX_BYTES` → chip lỗi; `size = 0` → lỗi; tên > `ATTACH_FILENAME_MAX` hoặc `X-Filename` mã hoá > `ATTACH_FILENAME_HEADER_MAX_BYTES` → lỗi; tổng > `ATTACH_PER_MESSAGE_MAX` → bỏ phần dư + toast |
| Upload (`api.ts` `uploadAttachment`) | `POST /attachments`, `rawBody=file`, `Content-Type` = MIME theo đuôi (`ATTACH_ALLOWED`, không tin `file.type`), `X-Filename` = `encodeURIComponent(name)`; 201 parse `AttachmentSchema`; hàng đợi ≤ 3 đồng thời (`hooks/use-attach-queue.ts`); 429 → chờ `retryAfter` rồi thử lại **1 lần** |
| Chip (`components/AttachmentChip.tsx`) | đang tải (spinner, "Đang tải lên…") · sẵn sàng (tên + cỡ) · lỗi (đỏ, câu lỗi, "Thử lại" nếu lỗi mạng/429) · nút xoá icon aria-label "Xoá {filename}" |
| Gửi | Gửi `disabled` khi còn chip đang tải; `attachment_ids` = chip sẵn sàng (thứ tự chọn); nội dung chữ vẫn bắt buộc (contract `content.min(1)`); thành công → xoá chip; chip không lưu vào nháp |
| Hiển thị tin (`components/AttachmentList.tsx`) | `Message.attachments` của tin user và assistant (FlowBlock, FlowMessages); chip: icon theo MIME, tên, cỡ; `available=false` → xám, `aria-disabled`, title "Tệp đã bị xoá"; file agent tạo chỉ có sau tải lại lịch sử (không chờ SSE) |
| Tải (`lib/download.ts` + `api.ts` `fetchAttachmentContent`) | `GET /attachments/:id/content` qua `apiResponse` (Bearer) → blob → object URL → `<a download>` tạm → revoke; không `<a href>` trần (X1-R07); lỗi → toast |

Câu lỗi upload:
| Mã / luật | VI | EN |
|---|---|---|
| `ATTACHMENT_TOO_LARGE` / > 20 MiB | Tệp lớn hơn 20 MB. | File is larger than 20 MB. |
| `ATTACHMENT_TYPE_NOT_ALLOWED` / đuôi lạ | Loại tệp không được hỗ trợ. | File type not supported. |
| `ATTACHMENT_QUOTA_EXCEEDED` | Đã hết dung lượng lưu tệp của công ty. Liên hệ quản trị. | Your organization's file storage is full. Contact your admin. |
| tệp rỗng | Tệp rỗng. | File is empty. |
| tên quá dài | Tên tệp quá dài. | File name is too long. |
| > 10 tệp (toast) | Tối đa 10 tệp mỗi tin. | Up to 10 files per message. |
| `TOO_MANY_RUNS` (sau 1 lần thử lại) / mạng | Không tải lên được. Thử lại. | Upload failed. Try again. |
| tải về lỗi (toast) | Không tải được tệp. | Couldn't download the file. |

### 1.7 Câu chữ khác (Chat, `packages/i18n/locales/chat/{vi,en}.json`)
| Key | VI | EN |
|---|---|---|
| `menu.commands` / `menu.agents` | Lệnh / Agent | Commands / Agents |
| `attach.button` | Đính kèm tệp | Attach files |
| `attach.list` | Tệp đính kèm | Attachments |
| `attach.messageList` | Tệp trong tin | Files in message |
| `attach.uploading` | Đang tải lên… | Uploading… |
| `attach.remove` | Xoá {{filename}} | Remove {{filename}} |
| `attach.retry` | Thử lại | Retry |
| `attach.unavailable` | Tệp đã bị xoá | File no longer available |
| `attach.download` | Tải {{filename}} | Download {{filename}} |
| `attach.waitUpload` (tooltip Gửi) | Chờ tải tệp xong | Wait for uploads to finish |
| `sendError.didYouMean` | Ý bạn là: | Did you mean: |

## 2. Admin (`apps/admin-web`)

### 2.1 Workflows `side_effect` (F4)
| Chỗ | Chi tiết |
|---|---|
| Editor `WorkflowInfoSection` | `Switch` nhãn "Cần xác nhận trước khi chạy" / "Requires confirmation before running"; mô tả "Bật khi workflow gửi, ghi hoặc xoá dữ liệu bên ngoài. Chat sẽ hỏi người dùng Đồng ý/Huỷ trước khi chạy." / "Turn on when the workflow sends, writes or deletes external data. Chat asks the user to Agree/Cancel first."; `lib/schemas.ts` `side_effect: boolean` mặc định `false`; `defaults` form ↔ body |
| Danh sách `WorkflowTable` | cột "Xác nhận" / "Confirm": `StatusBadge` "Hỏi xác nhận" / "Asks first" khi true, "—" khi false; không sort |
| Transfer (M4) | nhãn trường diff `side_effect` = "Cần xác nhận" / "Requires confirmation" (nếu `diff-fields` dùng nhãn theo trường) |
| Trạng thái | như M2 (tải/lỗi/409 `ConflictDialog`); trường vắng ở response cũ → coi `false` |

### 2.2 Test command (F4, ADM-FR-23) — `features/commands/components/test/TestPanel.tsx` (`lazy()`)
| Mục | Chi tiết |
|---|---|
| Bố cục | ≥ 1024px: cột phải cố định trong `CommandEditorPage`; < 1024px: tab "Chạy thử" cạnh "Cấu hình" (ui-admin §7.4, responsive) |
| Ô | textarea "Nội dung sau lệnh" / "Text after the command" (placeholder = cú pháp `buildSyntax`, ≤ `TEST_RUN_TEXT_MAX`); "Đoạn bôi đen" / "Selected text" (tuỳ chọn); "URL trang" / "Page URL" (tuỳ chọn, `^https?://`); "Chạy với tư cách user…" / "Run as user…" (`SearchCombobox` user, vắng = chính admin) |
| Chạy | nút "Chạy thử" / "Test run" (`Ctrl+Enter`); gửi **bản nháp** form (`workflow_id, args, input_map, output, timeout_s`) — không lưu; đang chạy: spinner + nút "Dừng" / "Stop" (abort fetch) |
| Kết quả | đầu: "{ms} ms · {in}+{out} token" ; tab "Kết quả" (`<pre>` xuống dòng, không thêm lib markdown) · "Raw" (JSON) · "Các bước" (steps: nhãn, ok/failed, ms) |
| `ok:false` | `Alert` 1 dòng `error.message` + `Collapsible` "Chi tiết từ Dify" / "Details from Dify" (`error.detail`, ẩn khi null); mã run hiện mono |
| Vô hiệu | lệnh chưa lưu (không `:id`): nút disabled + tooltip "Lưu lệnh một lần để chạy thử" / "Save the command once to test it" (tới khi backend có endpoint không id — §5); form có lỗi validate bắt buộc → disabled + "Sửa lỗi trong form trước" / "Fix form errors first" |
| Lỗi HTTP | 502 `HUB_UNAVAILABLE`: "Hub không phản hồi. Kiểm tra hub-api rồi thử lại." / "Hub is not responding. Check hub-api and try again." · 403: "Bạn không có quyền chạy thử lệnh này." / "You can't test this command." · 400 `VALIDATION_ERROR`: "Cấu hình nháp chưa hợp lệ: {message}" / "Draft config is invalid: {message}" · mạng: `auth.error.network` có sẵn |
| Lưu khi chưa test | gợi ý không chặn "Bạn chưa chạy thử bản này" / "You haven't tested this version" (ui-admin §7.4) |

### 2.3 Groups tab Agent (F5) — thay `AgentTab` "Chưa khả dụng"
| Mục | Chi tiết |
|---|---|
| Dữ liệu | `features/hub/api.ts` `useGroupAgentGrants(groupId, tenantId?)` = `GET /agent-grants?subject_type=group&subject_id=<g>[&tenant_id=]` (`AgentGrantListResponseSchema`); platform_admin truyền `tenant_id` của `?tenant=`, tenant_admin không |
| Bảng (`DataTable`) | cột "Agent" (tên theo ngôn ngữ + `key` mono) · "Trạng thái" ("Bật"/"Tắt"; `runnable=false` → badge "Chưa chạy được" / "Not runnable") · "Cấp cho group" (`Switch` aria-label "Cấp {agent} cho {group}" / "Grant {agent} to {group}", bật ⇔ `grants.length > 0`) |
| Ghi | bật → `POST /agent-grants` `{agent_id, subject_type:"group", subject_id}`; tắt → `DELETE /agent-grants?agent_id&subject_type&subject_id` (204 idempotent); lạc quan, lỗi → hoàn lại + toast; xong → invalidate effective |
| Toast | cấp: "Đã cấp {agent} cho {group}" / "Granted {agent} to {group}" · thu hồi: "Đã thu hồi {agent} khỏi {group}" / "Revoked {agent} from {group}" |
| Trạng thái | tải: skeleton bảng · rỗng: "Chưa có agent nào trong Agent Studio" / "No agents in Agent Studio yet" · lỗi: "Không tải được danh sách agent từ Hub" + "Thử lại" · Hub chưa cấu hình (vắng `PUBLIC_HUB_URL`): "Chưa cấu hình địa chỉ Hub (PUBLIC_HUB_URL)." · `truncated`: "Chỉ hiện 200 agent đầu." · platform chưa chọn tenant: dùng `TenantPicker` như tab khác |

Mã `HUB_ADMIN_ERRORS` → câu (thêm vào `lib/errors.ts` `describeError` + `ERROR_MESSAGE_KEYS`, key `hubErrors.*`):
| Mã | VI | EN |
|---|---|---|
| `FORBIDDEN` | Bạn không có quyền quản lý agent của công ty này. | You can't manage agents for this organization. |
| `TENANT_REQUIRED` | Chọn công ty trước. | Choose an organization first. |
| `INVALID_REFERENCE` `{field:agent_id}` | Agent không còn tồn tại. Tải lại trang. | The agent no longer exists. Reload the page. |
| `INVALID_REFERENCE` `{field:subject_id}` | Group không còn tồn tại. | The group no longer exists. |
| `NOT_ENTITLED` | Công ty chưa được mở agent này. | This organization isn't entitled to this agent. |
| `AGENT_NOT_GRANTABLE` | Agent đang tắt hoặc chưa chạy được, không cấp được. | The agent is disabled or not runnable and can't be granted. |
| mạng/5xx Hub | Không kết nối được Hub. | Couldn't reach the Hub. |

### 2.4 Quyền hiệu lực phần agent (F5)
`AccessExplainer` nhận prop `agents?: EffectiveAgentsState` (trình bày); hook `useEffectiveAgents(userId, tenantId?)` (`GET /agent-grants/effective/:user_id`, `staleTime 0`) gọi ở tab "Kiểm tra quyền" (`features/access`) và tab "Quyền hiệu lực" drawer user (`features/users`). Bỏ qua `EffectiveAccess.agents` `{available:false}` của admin-api.
| Mục | VI | EN |
|---|---|---|
| Thấy, `grant_user` | Cấp trực tiếp | Granted directly |
| Thấy, `grant_group` | Qua group {group} | Via group {group} |
| `user_inactive` | Tài khoản đang khoá | User is inactive |
| `tenant_locked` | Công ty đang bị khoá | Organization is locked |
| `agent_disabled` | Agent đang tắt | Agent is disabled |
| `runtime_unavailable` | Runtime chưa sẵn sàng | Runtime unavailable |
| `no_entitlement` | Công ty chưa được mở agent | Organization not entitled |
| `no_grant` | Chưa được cấp | Not granted |
Trạng thái: tải (skeleton 3 dòng) · rỗng "Không có agent nào" · lỗi "Không tải được quyền agent từ Hub" + "Thử lại" (phần feature/command vẫn hiện) · Hub chưa cấu hình (như §2.3). Danh sách: thấy trước, rồi không thấy; mỗi dòng ✓/✕ + lý do.

### 2.5 Nút "⇄ Agent Studio" (F6)
`Topbar.tsx`: `<a href={STUDIO_URL}>` icon `ArrowLeftRight` + chữ "Agent Studio"; hiện khi `session.user.role === "platform_admin"` **và** `PUBLIC_STUDIO_URL` khác rỗng (`lib/env.ts` `STUDIO_URL`, bỏ `/` cuối); `tenant_admin`/`member` không render. Màn hẹp: chỉ icon + `aria-label` "Agent Studio".

## 3. Role + nhãn cho e2e (giữ nguyên khi code)
| App | Phần tử | Role + tên (VI) |
|---|---|---|
| Chat | ô nhập | `textbox` "Hỏi điều mới…"/có sẵn C1 (`composer.input`/`flowInput`) |
| Chat | menu lệnh / agent | `listbox` "Lệnh" / `listbox` "Agent"; dòng `option` "/translate …", "@dify-chatbot …" (tên bắt đầu `/name` / tên agent) |
| Chat | lỗi gửi | `alert` (chứa câu §1.4); gợi ý `button` "/translate", `button` "@dify-chatbot" |
| Chat | nút gửi khi 429 | `button` "Gửi" `disabled` |
| Chat | đính kèm | `button` "Đính kèm tệp"; `list` "Tệp đính kèm" > `listitem`; `button` "Xoá {filename}" |
| Chat | tệp trong tin | `list` "Tệp trong tin"; `button` "Tải {filename}" (xám: `aria-disabled="true"`) |
| Chat | AskCard | `region` "Consultant cần thêm thông tin" (C1) > `button` "Đồng ý", `button` "Huỷ" |
| Chat | người trả lời | text = `responder.name` cạnh avatar |
| Admin | workflow | `switch` "Cần xác nhận trước khi chạy"; `columnheader` "Xác nhận" |
| Admin | test | `button` "Chạy thử", `button` "Dừng", `textbox` "Nội dung sau lệnh", `combobox` "Chạy với tư cách user…", `tab` "Kết quả"/"Raw"/"Các bước", `alert` (lỗi) |
| Admin | groups | `tab` "Agent"; `switch` "Cấp {agent} cho {group}" |
| Admin | effective | `heading` "Agent" (`access.check.section.agents` có sẵn) |
| Admin | studio | `link` "Agent Studio" |

Spec §5 ghi nhãn "Test command": glossary ui-admin §12 bắt buộc VI "Chạy thử" (không dùng "Test") ⇒ nhãn e2e = `button "Chạy thử"` (EN "Test run"). QC dùng nhãn này.

## 4. Hiệu năng / bundle
| Mục | Ngân sách / cách |
|---|---|
| chat-web | `check:bundle` hiện có: JS đầu ≤ 150 KB, CSS ≤ 25 KB, chunk async ≤ 50 KB; menu + chip + upload ước +6–9 KB gzip, không lib mới; `AttachmentList` trong chunk route hội thoại |
| admin-web | cùng ngưỡng; `TestPanel` và `AgentTab` qua `lazy()` (như `AccessTab`) |
| Menu | lọc thuần `useMemo` theo `q`; ≤ 500 mục, hiện ≤ 8 + cuộn, không virtualize; `SuggestMenu` `memo` |
| Upload | không đọc file vào bộ nhớ JS (gửi `File` trực tiếp) |
| Delta | giữ rAF gộp (C1), unit 500 delta |

## 5. Cần backend-lead (đề xuất, không tự đổi contract)
| # | Việc | Mặc định FE nếu chưa có |
|---|---|---|
| BL1 | Chốt endpoint Test: đề xuất `POST /admin/commands/test` (không id, chạy được command chưa lưu, đúng ADM-FR-23) **hoặc** giữ `/:id/test` | FE gọi `POST /admin/commands/:id/test`, disable khi chưa lưu |
| BL2 | Body Test: `{command:{workflow_id,args,input_map,output,timeout_s}, text, context?, run_as_user_id?}` (admin-api tự điền `actor_user_id`); response = nguyên `TestRunResponseSchema` (có `ms`, `steps`, `usage`), không đổi thành `duration_ms` | FE parse `TestRunResponseSchema` |
| BL3 | Thêm `HUB_UNAVAILABLE: 502` vào `API_ERRORS` admin (spec §3 có, contract chưa có) | FE map theo status 502 nếu mã khác |
| BL4 | `WorkflowSchema`/create/patch thêm `side_effect` (B1) | — |
| BL5 | `GroupDto.agent_count` (CR-043 (1)): admin-api không biết grant Hub ⇒ hoặc bỏ cột, hoặc FE đếm từ Hub. Đề xuất: giữ cột, admin-api trả 0, FE hiển thị "—" (không gọi Hub ở danh sách) | giữ như hiện có |
| BL6 | Hub `GET /agent-grants?subject_type=group&subject_id=` phải trả **mọi** agent (grants lọc theo subject) để bật/tắt; nếu chỉ trả agent có grant, FE gọi thêm không lọc rồi ghép | FE giả định trả mọi agent |

## 6. Câu hỏi (đều có mặc định)
| Q | Câu hỏi | Mặc định |
|---|---|---|
| FQ1 | Test panel: form tự sinh mỗi arg 1 ô (ui-admin) hay 1 ô "Nội dung sau lệnh"? | 1 ô (khớp `text` của contract test-run, Hub parse như Chat); form theo arg → TECH-DEBT |
| FQ2 | Test panel giả lập file đính kèm, "nhớ 5 lần test" | không làm ở X1 (contract test-run không có file) → TECH-DEBT |
| FQ3 | Nhãn nút | "Chạy thử" / "Test run" (§3) |
| FQ4 | Tin chỉ có tệp, không chữ | không cho (contract `content` ≥ 1); Gửi disabled tới khi có chữ |

## 7. Task FE (chi tiết cho `tasks.md`)
| # | File chính | Test của FE |
|---|---|---|
| F1 | `apps/chat-web/rsbuild.config.ts` (proxy), `src/lib/http.ts` (D2), `features/commands/{api.ts,README.md,lib/slash.ts}`, `features/composer/{components/SuggestMenu,CommandMenu,SendErrorNotice,Composer}.tsx`, `hooks/use-suggest.ts`, `features/run/{run-driver.ts,lib/send-request.ts,hooks/use-send.ts}`, call site `WelcomePage`, `FlowFooter`, i18n chat | unit `slash`, `use-suggest`, `buildSendRequest`, `http` (rawBody, retryAfter), `SendErrorNotice` |
| F2 | `features/agents/{api.ts,README.md}`, `composer/components/AgentMenu.tsx`, `run/lib/reducer.ts` (responder), `thread/components/FlowBlock.tsx`, `flow-panel/components/FlowMessages.tsx`, đếm ngược 429 trong `SendErrorNotice` | unit trigger `@`, reducer responder, delta 500, countdown |
| F3 | `features/attachments/{api.ts,README.md,lib/validate.ts,lib/download.ts,hooks/use-attach-queue.ts,components/AttachButton,AttachmentChip,AttachmentList}.tsx`, gắn vào `Composer`, `FlowBlock`, `FlowMessages` | unit validate (đuôi/cỡ/tên/10), queue ≤ 3, download revoke |
| F4 | `admin-web/src/features/workflows/{lib/schemas.ts,lib/defaults?,components/editor/WorkflowInfoSection.tsx,components/list/WorkflowTable.tsx}`, `features/commands/{api.ts,components/test/*,pages/CommandEditorPage.tsx}`, `lib/errors.ts`, i18n admin | unit schema `side_effect`, `TestPanel` (ok/false/502) |
| F5 | `src/lib/hub.ts`, `src/env.d.ts`, `features/hub/{api.ts,README.md}`, `features/groups/components/editor/AgentTab.tsx`, `components/shared/access/AccessExplainer.tsx`, `features/access/pages/*` + `features/users` tab Quyền hiệu lực, `lib/errors.ts` (`hubErrors`) | unit `hubUrl`, map lỗi Hub, AgentTab (tải/rỗng/lỗi/chưa cấu hình) |
| F6 | `src/lib/env.ts` (STUDIO_URL), `features/shell/components/Topbar.tsx` | unit hiện/ẩn theo role + env |
i18n: chat `packages/i18n/locales/chat/{vi,en}.json`; admin `packages/i18n/locales/{vi,en}.json`; mỗi task chạy `bun run i18n:check`.
