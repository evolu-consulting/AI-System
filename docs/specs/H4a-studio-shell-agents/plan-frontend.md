---
spec: H4a-studio-shell-agents
part: frontend
owner: frontend-lead
status: draft
requirements: [HUB-FR-72, HUB-FR-60, HUB-FR-61, HUB-FR-62, HUB-FR-64, HUB-BR-08, HUB-BR-09]
---

# Plan frontend · H4a · `apps/studio-web`

Nguồn: spec §1/§2/§5/§9 · ui-agent-studio §2, §3, §5, §6, §13 · canvas `Main`, `AgentEditor`, `Orchestrator` · mẫu Admin ui-admin §4–9 · token `docs/design/canvas/tokens-map.md`. Contract: `@ai/contracts/studio` (backend-lead, `plan.md`) — không chép, chỉ ghi điều FE cần (§10).

## 0. Quyết định chính
| # | Quyết định | Lý do |
|---|---|---|
| D1 | `apps/studio-web` cùng stack + **cùng phiên bản gói** với admin-web (Rsbuild 2.2, React 18.3, TanStack Router/Query, RHF + zod 4, Tailwind 4, radix-ui, sonner, lucide). **Không thêm thư viện** → không ADR | ADR-0001; Q1 |
| D2 | Router `basepath: "/studio"` cả dev lẫn prod; Rsbuild `server.base = "/studio"`, `output.assetPrefix = "/studio/"`. Không route FE nào bắt đầu bằng `/studio/api` | Hub serve `/studio/*` + `/studio/api/*` cùng origin (Q5) |
| D3 | Gọi API bằng **đường dẫn tương đối**; dev proxy (mẫu chat-web): `/auth` → `ADMIN_API_URL` (mặc định `http://localhost:3001`, như admin-web), `/studio/api` → `HUB_URL` (mặc định `http://localhost:4020`). Cookie `ai_rt` (`Path=/auth`, `SameSite=Strict`) chạy qua proxy, không cần CORS | Cookie refresh hoạt động ở dev mà không chờ CR-044 |
| D4 | Prod: `/studio/api` cùng origin Hub. `/auth`: `PUBLIC_AUTH_URL` (vắng = tương đối, cần reverse proxy `/auth` → admin-api — mục PRODUCTION-NOTES; **U4 chấp nhận**); có giá trị khác origin ⇒ chỉ access token (không refresh) cho tới CR-044 | spec Q3, CR-044 |
| D5 | Token chỉ trong bộ nhớ (R14). Tải trang: thử `POST /auth/refresh` (cookie) một lần → được thì vào thẳng (chung phiên với Admin khi cùng host); không được → `/login?next=`. 401 giữa chừng: refresh 1 lần, hỏng → `/login?next=<url>` + toast | R14, mẫu `chat-web/src/lib/auth` (đọc để bắt chước, không import) |
| D6 | Role kiểm bằng `GET /studio/api/me`: 403 ⇒ `/forbidden`, không gọi API khác. Không tự giải mã JWT | R01, R02 |
| D7 | Primitive shadcn **copy-then-own** vào `src/components/ui` (chỉ cái cần: button, input, textarea, label, select, checkbox, switch, radio-group, badge, card, table, tabs, dialog, alert-dialog, sheet, dropdown-menu, popover, tooltip, skeleton, alert, separator, sonner, breadcrumb). TECH-DEBT: "rút `packages/ui` dùng chung Admin/Chat/Studio" | Q1 |
| D8 | i18n: file mới `packages/i18n/locales/studio/{vi,en}.json` + `src/studio-locales.ts` (`loadStudioLocale`, nạp động mỗi ngôn ngữ) + **một dòng export** `./studio-locales` trong `packages/i18n/package.json` + nhánh `studio/` trong `tools/scripts/src/i18n-check.ts` (mẫu `CHAT_DIR`). **Chỉ thêm**, không sửa chuỗi Admin/Chat | Q10; **U3 đã chốt 2026-10-06**: F1 được phép |
| D9 | Form agent dựng từ `agent_types.config_schema` bằng **renderer tự viết** (≤ 150 dòng): hỗ trợ `string`, `integer`, `number`, `boolean`, `enum`, `object` 1 cấp; kiểu khác → ô JSON thô (textarea + kiểm `JSON.parse`) | Tránh rjsf (~90 KB gzip) |
| D10 | Ngôn ngữ: VI mặc định, đổi ở menu người dùng, nhớ `localStorage["studio.locale"]` (try/catch). Không ghi về admin-api | Đơn giản, không đụng Admin |
| D11 | "Xem như Orchestrator thấy" + badge trùng ý (R08) **tính ở client** từ danh sách agent (Jaccard ≥ 0,6 trên từ ≥ 3 ký tự, chữ thường, giữ dấu); định dạng dòng lấy từ hàm chung (đề xuất E7) | R08, S1 |
| D12 | **U2 chốt**: chỉ `agentic-cli` làm Orchestrator. FE lọc select Orchestrator + menu "Đặt làm Orchestrator" theo `ORCHESTRATOR_RUNTIMES` import từ `@ai/contracts/studio` (không hard-code chuỗi runtime). Mở `llm` sau = đổi hằng ở contract | K2, plan P9 |

## 1. Cấu trúc
```
apps/studio-web/  rsbuild.config.ts · index.html (lang="vi") · scripts/check-bundle.ts (copy admin, đổi ngân sách §8)
src/app/          router.tsx (basepath /studio) · providers.tsx (Query, i18n, Toaster) · AppShell (Sidebar, Topbar)
src/routes/       __root · login · forbidden · _authed (guard) · _authed/index (→ agents) · _authed/agents.{index,new,$agentId} · _authed/orchestrator · $ (404)
src/components/ui/        primitive (D7)
src/components/shared/    DataTable (nhẹ, không virtualize), PageHeader, EmptyState, ErrorState, ForbiddenState, ConflictDialog, ConfirmDialog, SoonBadge, UnsavedGuard
src/lib/          http.ts (Bearer, 401→refresh 1 lần, map lỗi `{error:{code,message,details}}`) · auth/session.ts · env.ts · i18n.ts
src/features/auth/          api.ts, pages/LoginPage, components/{LoginForm,TotpForm}
src/features/shell/         api.ts (me), components/{Sidebar,Topbar,ConfigBadge,UserMenu}
src/features/agents/        api.ts, pages/{AgentsPage,AgentEditorPage}, components/{AgentTable,AgentRowMenu,EditorSteps/*,WorkflowPicker,CliOptions,SchemaForm,OrchestratorView}, lib/{overlap.ts,draft.ts,schema-form.ts}
src/features/orchestrator/  api.ts, pages/OrchestratorPage, components/{DefaultForm,TenantTable,TenantSheet}
```
Giới hạn CONVENTIONS §4: `EditorSteps/` tách mỗi bước một file; `features/agents` > 10 file ngang hàng ⇒ thư mục con như trên.

## 2. Route & điều hướng
| Route (sau basepath `/studio`) | Màn | Guard | Ghi chú |
|---|---|---|---|
| `/login?next=` | Đăng nhập (+ bước TOTP) | công khai; đã có phiên → `next` hoặc `/agents` | `next` chỉ nhận đường dẫn nội bộ bắt đầu `/` (chống open redirect) |
| `/forbidden` | Không có quyền | có token | nút về Chat (`PUBLIC_CHAT_WEB_URL`, vắng ẩn) + Đăng xuất |
| `/` | — | `_authed` | redirect `/agents` |
| `/agents` | Danh sách (Main) | `_authed` + me OK | `?q=&runtime=&status=on\|off` giữ bộ lọc trên URL |
| `/agents/new` · `/agents/new?from=<id>` | Editor tạo / nhân bản (R12) | idem | nhân bản: tải agent gốc, `key=""`, `enabled=false`, tên thêm " (bản sao)" |
| `/agents/$agentId` | Editor sửa | idem | 404 → NotFound |
| `/orchestrator` | Orchestrator | idem | Sheet bản tenant: `?tenant=<tenant_id>\|new` |
| `*` | 404 "Không tìm thấy trang" | — | nút về Agents |

Menu (ui §2) giữ đủ thứ tự; chỉ **Agents**, **Orchestrator** là link; còn lại `<span aria-disabled="true">` + `SoonBadge` "Sắp có" (không route chết). Badge số ở Agents = tổng agent; không badge Models/Runs.

## 3. Màn ↔ artboard ↔ trạng thái
| Màn | Artboard / mẫu | Đang tải | Rỗng | Lỗi | Không quyền / 409 |
|---|---|---|---|---|---|
| Khung | Main (sidebar + topbar) | Skeleton sidebar + topbar khi chờ `me` | — | `me` lỗi mạng: ErrorState toàn trang + [Thử lại] | `me` 403 → `/forbidden` |
| Đăng nhập | **mới — mẫu Admin ui-admin §7.1**, bỏ hero, thêm logo "✦ Agent Studio" | nút "Đang đăng nhập…" disabled | — | câu lỗi (phụ lục copy) dưới form (`role=alert`) | `password_change_required` → Alert "Bạn cần đổi mật khẩu ở Admin trước khi vào Studio." + link Admin |
| Không có quyền | **mới — mẫu Admin `state.forbidden`** | — | — | — | (chính nó) |
| Agents | Main; **bỏ cột "24 giờ"** (R11), bỏ nút Import yaml | Skeleton 6 dòng bảng | EmptyState ui §13 + [+ Tạo agent đầu tiên]; lọc không ra → "Không có agent nào khớp bộ lọc" + [Xoá bộ lọc] | ErrorState + [Thử lại] | PATCH/DELETE 409 → toast lỗi theo mã (phụ lục copy); 409 VERSION → toast + refetch |
| Agent editor | AgentEditor; "Chạy thử", "Lưu · kiểm thử định tuyến" → nút **"Lưu"**; panel Chạy thử ẩn; "Xem như model thấy" (workflow) disabled `SoonBadge` "Sắp có (H4c)"; bước 5 Quyền: chỉ số tenant + nút "Quản lý quyền agent" disabled "Sắp có (H4b)" | Skeleton form | — | 404 → NotFound; lỗi tải agent-types/profiles/workflows → Alert inline trong bước tương ứng + [Thử lại] (form vẫn sửa được phần khác) | 409 VERSION → ConflictDialog; 422/400 → lỗi gắn trường |
| Orchestrator | Orchestrator; **bỏ tab Kiểm thử, Dry-run, cột Kiểm thử, câu "Lưu… chạy bộ câu kiểm thử", công tắc kế thừa bộ câu**; nút "Lưu" | Skeleton form + bảng | Bảng tenant chỉ có dòng Mặc định → dòng chú thích "Chưa tenant nào có Orchestrator riêng." | ErrorState | 409 VERSION → ConflictDialog; 409 `ORCHESTRATOR_EXISTS` → lỗi ở ô tenant |
| Mất mạng (mọi màn) | mẫu Admin `state.offline` | — | — | banner "Mất kết nối, thay đổi chưa được lưu" | — |

**Hành vi chi tiết**
| Màn | Tương tác | Hành vi |
|---|---|---|
| Agents | Tìm / lọc | Client-side trên danh sách (`limit` 200, §8); tìm theo key + tên VI/EN, không phân biệt hoa thường. **`truncated=true`** → Alert vàng `agents.truncated` (copy) và ô tìm/lọc chuyển sang server: gửi `?q=&runtime=&enabled=` (debounce 300 ms), không lọc client nữa |
| Agents | Công tắc Bật/Tắt | PATCH optimistic; tắt → toast "Đã tắt {name}. Orchestrator sẽ không còn chọn agent này." + [Hoàn tác] (PATCH ngược với version mới); lỗi → trả trạng thái + toast mã lỗi |
| Agents | Menu `⋯` | Nhân bản (→ `/agents/new?from=`), Đặt làm Orchestrator (chỉ agent bật, runtime ∈ `ORCHESTRATOR_RUNTIMES`; ConfirmDialog → PUT orchestrator/default với version hiện có), Bật/Tắt, Xoá (ConfirmDialog). "Thử trong Playground", "Cấp cho tenant…" disabled "Sắp có" |
| Agents | Badge | "Orchestrator" (mặc định) / "Orchestrator · {n} tenant"; "Chưa cấp" khi `entitled_tenant_count=0`; "Mô tả trùng ý" (D11); công tắc + Xoá disabled kèm tooltip khi đang là Orchestrator |
| Agents | Banner "Cần chú ý" | Chỉ hiện khi có agent **bật** mà chưa cấp tenant: "{n} agent đang bật nhưng chưa cấp cho tenant nào: {keys}". Vế provider dự phòng hiện khi contract có E3, không thì bỏ |
| Editor | Đổi runtime | Bước ② ③ đổi theo ui §5.2; trường không áp dụng ẩn nhưng giữ giá trị trong state, **khi gửi lọc theo runtime** (vd `dify-*` bỏ `profile_id`) |
| Editor | Runtime không có trong `agent-types` | Alert vàng "Chưa có Worker đăng ký runtime này — lưu được nhưng chưa chạy được." |
| Editor | `agentic-cli` | CLI (radio claude/codex/gemini; codex/gemini → cảnh báo R05), tool được phép (checkbox Read, Grep, Glob, Edit, Write, Bash), MCP (switch), thư mục làm việc (`cwd_mode`, select theo enum contract). Tick Bash → Alert đỏ + checkbox bắt buộc |
| Editor | `python` / runtime có `config_schema` | SchemaForm (D9) trong bước ② |
| Editor | Workflow ③ | Danh sách gắn (key, loại, mô tả, [Gỡ]); [+ Gắn workflow từ catalog] mở Dialog picker: tìm key/tên, lọc loại (workflow/agent), chỉ workflow bật; `dify-workflow`/`dify-agent` chọn 1 (radio, lọc sẵn loại), runtime khác chọn nhiều (checkbox). Link "Admin › Workflows ↗" tới `PUBLIC_ADMIN_WEB_URL/workflows` |
| Editor | Xem như Orchestrator thấy | Popover: dòng của agent này (bản nháp) + các agent bật khác; badge "Không thấy mô tả trùng ý" / "Trùng ý với {key} ({pct}%)" |
| Editor | Lưu | Validate client (§4) → POST/PUT; thành công: toast "Đã lưu agent · hub config v{n}", tạo mới → `replace` tới `/agents/{id}`; tạo mới và chưa cấp tenant → toast thứ hai "Chưa tenant nào dùng được agent này." |
| Editor | Rời trang khi dirty | UnsavedGuard (mẫu Admin `unsaved`) + `beforeunload` |
| Orchestrator | Bản mặc định | Form inline: Agent (select chỉ agent bật, runtime ∈ `ORCHESTRATOR_RUNTIMES` = `agentic-cli`; nhãn "{name} ({key}) · {runtime}"), Số bước tối đa, Ngân sách token / run, Số tin lịch sử, Không có agent nào phù hợp (radio). Alert "Chậm…" (ui §6) hiện khi `warnings` có `agentic_cli_slow` |
| Orchestrator | Bảng theo tenant | Dòng đầu "Mặc định (toàn hệ thống)" (không Xoá); cột Tenant · Agent · Số bước · Cập nhật · Thao tác ([Sửa] [Xoá]) ; [+ Thêm cho tenant] mở Sheet (chọn tenant: `active` và `has_orchestrator=false`). **Giá trị khởi tạo (M1)**: bản mới điền sẵn từ bản mặc định (`agent`, `max_steps`, `token_budget`, `history_n`, `on_no_match`), tenant trống; bản sửa nạp giá trị của tenant đó |
| Orchestrator | Xoá bản tenant | ConfirmDialog "Xoá Orchestrator của {tenant}? Tenant sẽ quay về dùng bản mặc định." |
| Mọi lưu | Sau thành công | invalidate `me` (badge `hub config vN`), danh sách liên quan |

## 4. Validate phía client (khớp contract/DB — plan §2.3–2.4, P8; dùng thẳng schema zod từ `@ai/contracts/studio`, chỉ map câu lỗi). Lỗi 400 `VALIDATION_ERROR`: `details.issues[{path,code,message}]` → `path` gắn đúng trường (§4 + copy)
| Trường | Luật (spec) | VI | EN |
|---|---|---|---|
| key | `AgentKeySchema` `^[a-z][a-z0-9-]{1,47}$` (plan §2.3, P8; **không `_`**) | Key 2–48 ký tự: chữ thường, số, `-`, bắt đầu bằng chữ | Key must be 2–48 chars: lowercase letters, digits, `-`, starting with a letter |
| key trùng (409 từ server) | — | Key đã được dùng bởi agent khác | This key is already used by another agent |
| name.vi / name.en | bắt buộc | Nhập tên tiếng Việt / Nhập tên tiếng Anh | Enter the Vietnamese name / Enter the English name |
| description | trim **20–400, chặn** (CHECK DB; bỏ cảnh báo mềm và bộ đếm "/1000") | Mô tả từ 20 đến 400 ký tự | Description must be 20–400 characters |
| profile_id | bắt buộc `llm`/`agentic-cli` | Chọn model profile | Select a model profile |
| workflow (`dify-workflow`/`dify-agent`) | đúng 1 (R04) | Chọn workflow cho agent | Select a workflow for this agent |
| bash_ack | Bash ⇒ true (R05) | Xác nhận bạn hiểu rủi ro khi bật Bash | Confirm you understand the risk of enabling Bash |
| timeout_s | 10–3600 (mặc định 600) | Timeout từ 10 đến 3600 giây | Timeout must be 10–3600 seconds |
| token_budget (agent) | ≥ 1 hoặc trống | Ngân sách token phải ≥ 1 hoặc để trống | Token budget must be ≥ 1 or empty |
| max_steps | 1–20 | Số bước tối đa từ 1 đến 20 | Max steps must be 1–20 |
| token_budget (orch) | 1000–10 000 000 | Ngân sách token tối thiểu 1000 | Token budget must be at least 1000 |
| history_n | 1–50 | Số tin lịch sử từ 1 đến 50 | History must be 1–50 messages |
| agent_id (orch) | bắt buộc | Chọn agent làm Orchestrator | Select an agent to act as Orchestrator |
| tenant (bản tenant) | bắt buộc | Chọn tenant | Select a tenant |
| SchemaForm JSON thô | `JSON.parse` được | JSON không hợp lệ | Invalid JSON |

## 5. Câu chữ VI / EN
Nguyên văn ở phụ lục [`plan-frontend-copy.md`](plan-frontend-copy.md) (key `studio.*` + bảng lỗi theo mã). Nhãn e2e §6 lấy đúng từ phụ lục.

## 6. Role + nhãn cho e2e (VI; giữ nguyên khi code)
| Màn | Phần tử |
|---|---|
| Đăng nhập | `heading "Đăng nhập Agent Studio"` · `textbox "Mã công ty"` · `textbox "Tên đăng nhập"` · `textbox "Mật khẩu"` (type password) · `button "Đăng nhập"` · lỗi `alert` · TOTP `textbox "Mã xác thực"`, `button "Xác nhận"` |
| Không quyền | `heading "Bạn không có quyền vào Agent Studio"` · `link "Về Chat"` · `button "Đăng xuất"` |
| Khung | `navigation "Menu Studio"` · `link "Agents"` · `link "Orchestrator"` · mục chưa làm: text + `aria-disabled="true"` (vd "Models") · `status` chứa "hub config v{n}" (`aria-label="Phiên bản cấu hình Hub"`) · `link "⇄ Admin"` · `button "Tài khoản"` → `menuitem "Đăng xuất"` |
| Agents | `heading "Agents"` · `link "+ Tạo agent"` · `searchbox "Tìm agent"` · `radiogroup "Lọc runtime"` (radio "Tất cả", "llm", "agentic-cli", "dify-workflow", "dify-agent", "python") · `checkbox "Đang tắt"` · `table "Danh sách agent"`, mỗi `row` có text key · trong dòng: `switch "Bật {key}"`, `button "Thao tác {key}"` → `menuitem "Nhân bản" / "Đặt làm Orchestrator" / "Xoá"` · badge text "Orchestrator", "Chưa cấp" · `alertdialog` → `button "Xoá agent"` |
| Editor | `heading "Tạo agent"`/`"Sửa agent"` · `textbox "Key"` (readonly khi sửa) · `textbox "Tên hiển thị (VI)"` · `textbox "Tên hiển thị (EN)"` · `textbox "Mô tả cho Orchestrator"` · `radiogroup "Runtime"` (radio theo tên runtime) · `combobox "Model profile"` · `radiogroup "CLI"` · `checkbox "Bash"` (+ "Read", "Grep", …) · `checkbox "Tôi hiểu agent chạy được lệnh hệ thống trên máy Worker"` · `switch "Dùng MCP"` · `spinbutton "Timeout (giây)"` · `spinbutton "Ngân sách token"` · `textbox "System prompt"` · `switch "Bật agent"` · `button "+ Gắn workflow từ catalog"` → `dialog "Chọn workflow từ catalog"` (`searchbox "Tìm theo key hoặc tên"`, checkbox/radio theo key workflow, `button "Gắn"`) · `button "Gỡ {key}"` · `button "Xem như Orchestrator thấy"` · `button "Lưu"` · `button "Huỷ"` · `button "Chạy thử"` (disabled) · lỗi trường: `aria-invalid` + `aria-describedby` tới câu §4 |
| Xung đột | `alertdialog "Có người vừa lưu bản mới hơn"` · `button "Tải bản mới"` · `button "Ghi đè"` · `button "Xem khác biệt"` · hành vi (chép Admin `ConflictDialog`; câu chữ ở copy `conflict.*`): **Tải bản mới** = nạp `details.current` vào form, bỏ nháp, toast `conflict.toast.loaded`. **Xem khác biệt** = bảng Trường / Bản của bạn / Bản mới nhất (v{n}) chỉ các trường khác nhau (`conflict.diff.*`). **Ghi đè** = bước xác nhận (`conflict.overwrite.*`, nút "Ghi đè" + "Huỷ"), xác nhận → gửi lại **bản nháp** với `version = details.current.version` (PUT lại; lỗi 409 lần nữa → mở lại hộp); lịch sử vẫn giữ bản cũ |
| Orchestrator | `heading "Orchestrator"` · `combobox "Agent làm Orchestrator"` · `spinbutton "Số bước tối đa"` · `spinbutton "Ngân sách token / run"` · `spinbutton "Số tin lịch sử"` · `radiogroup "Không có agent nào phù hợp"` · `button "Lưu"` · `table "Orchestrator theo tenant"` (dòng "Mặc định (toàn hệ thống)" không có nút Xoá) · `button "+ Thêm cho tenant"` → `dialog "Thêm Orchestrator cho tenant"` (`combobox "Tenant"`, các ô như trên, `button "Lưu"`) · `button "Sửa {tenant}"`, `button "Xoá {tenant}"` |
| Toast | `region "Notifications"` (sonner) chứa text phụ lục copy |
| Bổ sung (e2e qc, N3) | `alertdialog` "Đặt làm Orchestrator" (`button "Huỷ"`, `button "Đặt làm Orchestrator"`) · menuitem "Đặt làm Orchestrator" **ẩn** (không chỉ disabled) khi runtime không thuộc `ORCHESTRATOR_RUNTIMES` · TOTP sai mã: câu `login.totp.wrong` trong `role="alert"` · option `combobox "Tenant"` dạng `{name} ({key})` |

## 7. Accessibility
Element thật; mọi nút chỉ icon có `aria-label`; Dialog/Sheet bẫy focus, Esc đóng, trả focus; lỗi form `role=alert` + focus ô lỗi đầu; tương phản ≥ 4.5:1 (token tokens-map); điều hướng bàn phím toàn bộ bảng + menu `⋯`. `html lang` theo ngôn ngữ đang chọn.

## 8. Hiệu năng & bundle (CONVENTIONS §6; không chặn mốc)
| Chỉ số | Ngân sách | Cách đạt |
|---|---|---|
| JS ban đầu | ≤ 150 KB gzip (spec §6; CONVENTIONS 250) | `autoCodeSplitting` mỗi route; locale JSON nạp động; lucide import từng icon |
| CSS ban đầu | ≤ 25 KB gzip | Tailwind 4 chỉ quét `apps/studio-web/src` |
| Chunk route | ≤ 50 KB gzip | Editor tách `WorkflowPicker`, `SchemaForm`, `ConflictDialog` bằng `lazy` |
| LCP `/agents` | < 2 s máy dev | 1 request list + `me` song song; skeleton |
| Bảng | không virtualize (≤ 200 dòng); `truncated=true` → cảnh báo + lọc phía server (§3) | §6 CONVENTIONS |
| Re-render | Editor: RHF `useWatch` theo trường, bước là component `memo`; overlap tính `useMemo` theo danh sách mô tả | |
| Query | `staleTime` 30 s cho lookup (agent-types, profiles, providers, workflows, tenants); `me` refetch sau mỗi mutation | |
`check:bundle` copy từ admin-web (`scripts/check-bundle.ts`), đổi đường `dist`; thêm vào `done:h4a`.

## 9. Trả lời câu hỏi spec (vế FE)
| Q | Trả lời |
|---|---|
| Q1 | Đồng ý; D1, D7 |
| Q2/Q3 | Đồng ý; D3–D6 — dev chung phiên với Admin nhờ proxy + cookie (localhost không phân biệt cổng); prod cần reverse proxy `/auth` hoặc CR-044 |
| Q8 | Hiện codex/gemini + cảnh báo (`editor.cliNotReady`) |
| Q9 | `link "⇄ Admin"` tới `PUBLIC_ADMIN_WEB_URL` (vắng → ẩn) |
| Q10 | D8 |

## 10. Đề xuất cho backend-lead (`@ai/contracts/studio`; FE không tự đổi)
| # | Đề xuất | Mặc định FE nếu không có |
|---|---|---|
| E1 | `GET agents` trả **mọi** agent (≤ 200, `limit` mặc định 200) với: `id, key, name{vi,en}, description, runtime, enabled, version, profile{id,key}\|null, workflow_count, entitled_tenant_count, orchestrator_of{default:boolean, tenant_ids[]}, updated_at` | Thiếu `description` ⇒ bỏ badge trùng ý ở danh sách |
| E2 | `GET agents/:id` thêm `workflows[{workflow_id, key, name, app_type, description, enabled}]` (đọc từ catalog, Studio không lưu — R04) để hiển thị bước ③ không cần tra lại | FE ghép từ `GET workflows` |
| E3 | `GET model-profiles` trả `steps[{provider_id, model}]`; `providers` trả `state{status, cooldown_until}` — hoặc gọn hơn: profile có `active_step{index, provider_key, status, is_fallback}` tính ở server (cùng logic Gateway) | FE hiện "Profile" chỉ key; dòng "Lúc này sẽ chạy bằng" ẩn |
| E4 | `GET workflows` trả `{id, key, name, app_type: 'workflow'\|'agent'\|…, description, enabled}` chỉ bản bật (R04), hỗ trợ `?q=` | Lọc client |
| E5 | **Chốt theo plan §12**: `GET tenants` trả `{id, key, name, active, has_orchestrator}` (không `locked`); `GET orchestrator` trả `{default, tenants[]}`, `Orch{tenant{id,key,name}\|null, agent{id,key,name,runtime}, max_steps, token_budget, history_n, on_no_match, version, updated_at}` | — |
| E6 | **Đã chốt theo plan §12**: `details.current` = bản đầy đủ mới nhất, không có `updated_by.display_name` → dùng câu `conflict.body.anon` | — |
| E7 | Export hàm thuần `formatAgentForOrchestrator(agent): string` trong contract (đúng chuỗi Hub đưa vào prompt Orchestrator) để "Xem như Orchestrator thấy" khớp S1 | FE dùng `- {key}: {description}` (canvas) |
| E8 | **Đã chốt theo plan §12**: key trùng 409 `KEY_TAKEN{field}`; tenant khoá 409 `TENANT_INACTIVE`; tenant không có 400 `INVALID_REFERENCE{tenant_id}`; agent không làm Orchestrator 409 `AGENT_NOT_ORCHESTRATABLE{reason}`; validation 400 `VALIDATION_ERROR` `details.issues[{path,code,message}]`; hằng `STUDIO_ERRORS` | Bảng lỗi ở copy |
| E9 | `me` thêm `display_name`, `tenant_key` (menu tài khoản) | Hiện username đã nhập ở login |
| E10 | Mọi mutation trả `hub_config_version` mới (toast "hub config v{n}") | refetch `me` |
| E11 | Hằng enum dùng chung trong contract: `RUNTIMES`, `CLI_KINDS`, `CLI_TOOLS`, `CWD_MODES`, `ON_NO_MATCH` | — |
| E12 | CORS 3200 ở Hub chỉ cần cho cách không proxy; dev FE dùng proxy (D3) — giữ cũng không hại | — |

## 11. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Prod không có `/auth` cùng origin ⇒ không refresh, reload = đăng nhập lại | D4; ghi PRODUCTION-NOTES (reverse proxy) — docs-architect ở I3 |
| Đăng xuất Studio thu hồi refresh token chung ⇒ Admin cùng host cũng đăng xuất | Chấp nhận (chung tài khoản); ghi README feature auth |
| Lệch luật ui §13 với contract (key, `max_steps`) | Theo contract/DB (§4); ui §13 sửa ở I3 (CR) |
| Thêm export `packages/i18n` + nhánh `i18n-check` chạm file chung | Chỉ thêm, mẫu chat; hỏi nếu điều phối không đồng ý (D8) |
| E2E cần `playwright.config.ts` project mới cho studio (build + preview 3200 + Hub + admin-api) | qc (Q1) — file của qc |
| depcruise alias `@/*` theo app | F1 thêm rule cho `apps/studio-web` (mẫu admin-web) |

## 12. Câu hỏi mới — đã chốt 2026-10-06
QF1 (theo contract/DB, §4) · QF2 (Studio làm bước TOTP như Admin) · QF3 ("Đặt làm Orchestrator" ở H4a, chỉ PUT orchestrator/default) — chấp nhận mặc định. U2 (D12), U3 (D8), U4 (D4) chấp nhận.
