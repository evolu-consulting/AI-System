---
spec: K1-knowledgehub
part: frontend
owner: frontend-lead
status: plan
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-BR-35, HUB-BR-36, HUB-BR-40]
---

# Plan frontend · K1 · KnowledgeHub (CR-073 siêu tối giản)

Nguồn: spec §1–3 · `plan.md` §3 · H4b-1 `plan-frontend.md` (D3–D9: ConflictDialog, "Đã lưu · v{n}") · mẫu: studio-web `features/{agents,secrets}`, admin-web `features/processes`.
**Mockup đã được người dùng OK 2026-10-13** = bố cục chuẩn (5 màn): https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ. Plan chỉ lấp trạng thái, câu chữ, validate, nhãn e2e; không vẽ lại. Không bảng công ty, không Dialog `tenant_admin`, không `/admin/kh`, không trang "Tri thức", không ns/keyspace/token.

## 0. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không thư viện/ADR mới. Route `/settings` nạp lười; nav Studio không thêm mục | CONVENTIONS §6 |
| D2 | "Khoá" = Select secret `kh_api_key` **nền tảng** (`GET /studio/api/secrets?kind=kh_api_key`, lọc client `tenant_id=null`); không nhập giá trị khoá ở K1; link "Tạo secret" → `/secrets` | spec §3.2 |
| D3 | Một bảng "Kết nối KnowledgeHub" + Sheet Thêm/Sửa (mockup 2) + Dialog kết quả kiểm (mockup 4) | mockup |
| D4 | "Project ghi Tóm tắt": ô văn bản tự do, tuỳ chọn; Hub không liệt kê project của KH. Rỗng ⇒ `null` ⇒ không ghi Tóm tắt | spec §3.1 |
| D5 | Agent: `PUT /agents/:id/knowledge {connection_ids, version}`; [Lưu] **riêng** của section, version riêng; chỉ `agentic-cli`; thứ tự tick = ưu tiên; ≤ 5 | spec §3.2 |
| D6 | Cảnh báo hạ cấp là dữ liệu `StageView.knowledge.warning`, không toast: `Alert` vàng `aria-live="polite"` trong `KnowledgeNotice`; không chặn | HUB-FR-134 |
| D7 | Kiểm tra theo hàng đã lưu. Đổi `base_url`/khoá ⇒ `unchecked` (đổi tên/project không) — Sheet báo trước | spec §3.2 |
| D8 | Note rủi ro tĩnh dưới tiêu đề bảng (CR-073): Hub không cách ly theo công ty | CR-073 |
| D9 | `KnowledgeNotice` ở `packages/ui` (thuần trình bày, props = `StageKnowledge`); dùng cho admin OutputDialog và chat run-block/run-page | spec §3.1 |

## 1. Cấu trúc
- studio-web: `routes/_authed/settings.tsx` (lazy) · `features/settings/knowledgehub/{api.ts, hooks/, lib/{schema,check-labels}.ts, components/{KhConnectionsTable,KhConnectionSheet,KhCheckDialog}, pages/KnowledgeHubSettingsPage.tsx, README.md}` · `features/agents/components/AgentKnowledgeSection.tsx` (+ hook trong `agents/api.ts`; chỉ hoạt động khi `runtime=agentic-cli`).
- `packages/ui/src/knowledge-notice/KnowledgeNotice.tsx`; admin-web `features/processes/components/run/OutputDialog.tsx` gắn `KnowledgeNotice`; chat-web `features/processes/**` (run-block, run-page).

## 2. Màn và trạng thái (bố cục: mockup)
| Màn | Nội dung | Đang tải | Rỗng | Lỗi | Quyền / 409 |
|---|---|---|---|---|---|
| 1 Studio → Cài đặt → "Kết nối KnowledgeHub" | Cột Tên · Địa chỉ · Khoá (tên secret) · Project ghi Tóm tắt (— khi null) · Trạng thái (badge) · Agent dùng (`agents_count`); mỗi dòng [Kiểm tra] [Sửa] [Xoá]; [+ Thêm kết nối]; note rủi ro (D8); chip "Origin được phép" từ `allowed_origins` (chỉ đọc); "Tải thêm" theo `next_cursor` | Skeleton 4 dòng `aria-busy` | EmptyState "Chưa có kết nối KnowledgeHub" + [Thêm kết nối]; `allowed_origins` rỗng ⇒ Alert "Vận hành chưa khai báo HUB_KH_ALLOWED_ORIGINS — không lưu được địa chỉ" | Alert + [Thử lại] | Không `platform_admin` ⇒ `/forbidden`; `VERSION_CONFLICT` ⇒ ConflictDialog |
| 2 Sheet Thêm/Sửa kết nối | `Tên`, `Địa chỉ` (https), `Khoá` (Select secret nền tảng + link "Tạo secret"), `Project ghi Tóm tắt (tuỳ chọn)`; [Huỷ] [Lưu]; sau lưu ở lại "Đã lưu · v{n}". Sửa địa chỉ/khoá ⇒ Alert "Lưu sẽ đặt trạng thái về Chưa kiểm tra; agent ngừng dùng kết nối tới khi kiểm tra lại." | Select "Đang tải…" | Chưa có secret: "Chưa có secret KnowledgeHub của nền tảng" + link "Tạo secret" | theo trường: `KH_CONNECTION_EXISTS` (field `name`/`base_url`), `KH_URL_NOT_ALLOWED` (ô Địa chỉ), `KH_SECRET_INVALID` (ô Khoá) | 409 ConflictDialog |
| 1b Xoá kết nối | `alertdialog` "Xoá kết nối {name}? Secret không bị xoá."; `KH_CONNECTION_IN_USE {agents}` ⇒ Alert trong dialog, không đóng | — | — | — | — |
| 4 Dialog kết quả kiểm | Mở ngay khi bấm [Kiểm tra] và làm mới hàng. Tổng `role="status"`; danh sách mục (lỗi trước, cảnh báo sau; icon + chữ); "Phiên bản KnowledgeHub: {v}", "Kiểm lúc {thời gian}"; "Project khoá thấy: {n}" + chip ≤ 50 | "Đang kiểm tra…" (nút disabled; hạn UI 25 s) | — | `404` ⇒ "Kết nối không còn tồn tại" | — |
| 3 Sửa agent → section "KnowledgeHub" | Checkbox mọi kết nối (tên + địa chỉ + badge trạng thái), thứ tự tick hiện số 1..n; [Lưu]. Tick thứ 6 ⇒ ô còn lại disabled + "Tối đa 5 kết nối". Kết nối chưa `ok`: tick được, kèm chú "Chưa dùng được tới khi kiểm tra đạt" | Skeleton | "Chưa có kết nối KnowledgeHub — vào Cài đặt để thêm" + link `/settings` | `KH_AGENT_RUNTIME`/`KH_CONNECTION_NOT_FOUND` ⇒ Alert trong section; khác ⇒ toast | Runtime ≠ `agentic-cli`: section disabled + "Chỉ agent chạy bằng CLI mới dùng được tri thức"; `VERSION_CONFLICT` ⇒ ConflictDialog |
| 5 `KnowledgeNotice` (admin OutputDialog; chat run-block/run-page) | Trên output, chỉ khi `knowledge` có: Alert vàng khi `warning≠null`; dòng phụ "Tri thức: {queries}/{query_limit} lần hỏi · Tóm tắt: {trạng thái}" + (khi `write_to`) " (ghi vào {project} · {connection})" | — | `knowledge` vắng ⇒ không render | — | — |

| Tương tác | Hành vi |
|---|---|
| Lưu kết nối | `POST/PUT /kh/connections[/:id]` (PUT kèm `version`); `summary_project` rỗng ⇒ `null`; toast "Đã lưu kết nối {name}" |
| Kiểm tra | `POST /kh/connections/:id/check` (KH lỗi vẫn 200) ⇒ mở Dialog + làm mới hàng |
| Lưu section agent | `connection_ids` theo thứ tự tick + `version` agent hiện tại; cập nhật `version` form từ `AgentWriteResponse`; toast "Đã lưu kết nối của agent" |

## 3. Validate client (zod; khớp contract §3.1)
| Trường | Luật | VI | EN |
|---|---|---|---|
| Tên | trim 1..80, không `/` | "Nhập tên (tối đa 80 ký tự, không chứa /)" | "Enter a name (at most 80 characters, no /)" |
| Địa chỉ | bắt buộc, URL `https://` (cho `http://localhost`/`127.0.0.1`/`[::1]` khi dev), ≤ 512, không userinfo/query/fragment | "Địa chỉ không hợp lệ" · "Chỉ chấp nhận https:// (trừ localhost khi phát triển)" · "Địa chỉ không được chứa tài khoản, query hay fragment" | "Invalid address" · "Only https:// is allowed (except localhost in development)" · "Address must not contain credentials, query or fragment" |
| Khoá | bắt buộc (uuid) | "Chọn khoá KnowledgeHub" | "Select a KnowledgeHub key" |
| Project ghi Tóm tắt | rỗng được; `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` | "Mã project không hợp lệ" | "Invalid project ID" |
| Agent | ≤ 5, không trùng | "Tối đa 5 kết nối" | "At most 5 connections" |

Lỗi server qua `api-error.ts` (KNOWN += `KH_URL_NOT_ALLOWED`, `KH_CONNECTION_EXISTS`, `KH_CONNECTION_IN_USE`, `KH_CONNECTION_NOT_FOUND`, `KH_SECRET_INVALID`, `KH_AGENT_RUNTIME`).

## 4. Câu chữ (VI / EN; key `knowledgehub.*`, `agents.knowledge.*`, `ui.knowledgeNotice.*`)
| Chỗ | VI | EN |
|---|---|---|
| Tiêu đề | "Cài đặt" · "Kết nối KnowledgeHub" | "Settings" · "KnowledgeHub connections" |
| Note rủi ro | "Agent đọc được mọi project mà khoá của kết nối thấy. Muốn tách dữ liệu giữa các công ty, dùng khoá hoặc KnowledgeHub riêng cho từng công ty." (nguyên văn mockup) | "Agents can read every project the connection's key can see. To separate data between companies, use a separate key or KnowledgeHub per company." |
| Bảng | "Tên" · "Địa chỉ" · "Khoá" · "Project ghi Tóm tắt" · "Trạng thái" · "Agent dùng" · "Kiểm tra" · "Sửa" · "Xoá" · "Thêm kết nối" · "Origin được phép" · "Chưa có kết nối KnowledgeHub" · "Tải thêm" | "Name" · "Address" · "Key" · "Summary project" · "Status" · "Agents using" · "Test" · "Edit" · "Delete" · "Add connection" · "Allowed origins" · "No KnowledgeHub connection yet" · "Load more" |
| Badge | "Chưa kiểm tra / Đạt / Lỗi" | "Not tested / OK / Error" |
| Sheet | "Thêm kết nối" · "Sửa kết nối" · "Tên" · "Địa chỉ" · "Khoá" · "Tạo secret" · "Chưa có secret KnowledgeHub của nền tảng" · "Project ghi Tóm tắt (tuỳ chọn)" · "Lưu" · "Huỷ" · "Lưu sẽ đặt trạng thái về Chưa kiểm tra; agent ngừng dùng kết nối tới khi kiểm tra lại." | "Add connection" · "Edit connection" · "Name" · "Address" · "Key" · "Create secret" · "No platform KnowledgeHub secret yet" · "Summary project (optional)" · "Save" · "Cancel" · "Saving resets the status to Not tested; agents stop using the connection until re-tested." |
| Lỗi server | `KH_CONNECTION_EXISTS` "Tên hoặc địa chỉ đã được kết nối khác dùng" · `KH_CONNECTION_IN_USE` "Kết nối còn {agents} agent đang dùng" · `KH_CONNECTION_NOT_FOUND` "Kết nối không còn tồn tại" · `KH_SECRET_INVALID` "Khoá phải là secret KnowledgeHub của nền tảng" · `KH_AGENT_RUNTIME` "Chỉ agent chạy bằng CLI mới dùng được tri thức" · `KH_URL_NOT_ALLOWED` "Địa chỉ không được phép ({reason})" | "Name or address is used by another connection" · "The connection is still used by {agents} agents" · "The connection no longer exists" · "The key must be a platform KnowledgeHub secret" · "Only CLI agents can use knowledge" · "Address not allowed ({reason})" |
| Xoá | "Xoá kết nối {name}? Secret không bị xoá." | "Delete connection {name}? The secret is not deleted." |
| Kết quả kiểm | "Kết quả kiểm tra" · "Kết nối đạt" · "Kết nối chưa đạt: {n} lỗi" · "Đang kiểm tra…" · "Phiên bản KnowledgeHub: {v}" · "Kiểm lúc {thời gian}" · "Project khoá thấy: {n}" | "Check result" · "Connection OK" · "Connection failed: {n} errors" · "Testing…" · "KnowledgeHub version: {v}" · "Checked at {time}" · "Projects the key sees: {n}" |
| Toast | "Đã lưu kết nối {name}" · "Đã xoá kết nối {name}" · "Đã lưu kết nối của agent" | "Connection {name} saved" · "Connection {name} deleted" · "Agent connections saved" |
| Agent | "KnowledgeHub" · "Chọn kết nối KnowledgeHub mà agent được hỏi khi chạy quy trình. Thứ tự tick = thứ tự ưu tiên (tối đa 5)." · "Tối đa 5 kết nối" · "Chưa có kết nối KnowledgeHub — vào Cài đặt để thêm" · "Chỉ agent chạy bằng CLI mới dùng được tri thức" · "Chưa dùng được tới khi kiểm tra đạt" · "Lưu" | "KnowledgeHub" · "Pick the KnowledgeHub connections the agent may query while running a process. Tick order = priority (at most 5)." · "At most 5 connections" · "No KnowledgeHub connection yet — go to Settings to add one" · "Only CLI agents can use knowledge" · "Not usable until the test passes" · "Save" |
| Output | "Tri thức: {queries}/{limit} lần hỏi" · "Tóm tắt: đang chờ / đã ghi / lỗi / bỏ qua / không ghi" (`pending/written/failed/skipped/none`) · "(ghi vào {project} · {connection})" | "Knowledge: {queries}/{limit} queries" · "Summary: pending / written / failed / skipped / none" · "(writing to {project} · {connection})" |
| Hạ cấp (`warning`) | Đầu: "Không truy cập được KnowledgeHub — stage đã chạy không có tri thức." Lý do: `unreachable` "Không kết nối được" · `timeout` "Hết thời gian chờ" · `unauthorized`/`forbidden` "Khoá bị từ chối" · `not_found` "Không tìm thấy project" · `invalid` "Yêu cầu bị từ chối" · `rate_limited` "Vượt giới hạn tần suất" · `server_error` "KnowledgeHub gặp lỗi" · `disabled` "Kết nối không còn dùng được" | "KnowledgeHub was unreachable — this stage ran without knowledge." · "Cannot connect" · "Timed out" · "Key rejected" · "Project not found" · "Request rejected" · "Rate limit exceeded" · "KnowledgeHub error" · "Connection no longer usable" |

**Mục kiểm (`items[].code` → nhãn; `params` thay `{…}`)** — 7 lỗi:
| Mã | VI | EN |
|---|---|---|
| `kh_url_not_allowed` | "Địa chỉ không được phép ({reason})" | "Address not allowed ({reason})" |
| `kh_unreachable` | "Không kết nối được KnowledgeHub (HTTP {status})" | "Cannot reach KnowledgeHub (HTTP {status})" |
| `kh_timeout` | "KnowledgeHub không trả lời kịp" | "KnowledgeHub did not respond in time" |
| `kh_auth_disabled` | "KnowledgeHub trả lời khi không có khoá — hãy bật KH_API_KEY" | "KnowledgeHub answers without a key — enable KH_API_KEY" |
| `kh_key_invalid` | "Không đọc được secret khoá" | "Cannot read the key secret" |
| `kh_key_rejected` | "KnowledgeHub từ chối khoá (hoặc đang ở chế độ đăng nhập SSO)" | "KnowledgeHub rejected the key (or runs in SSO mode)" |
| `kh_version_too_old` | "Phiên bản KnowledgeHub phải ≥ v6.4 (hiện {found})" | "KnowledgeHub must be ≥ v6.4 (found {found})" |

5 cảnh báo: `kh_auth_disabled_dev` "Xác thực đang tắt (chỉ chấp nhận khi phát triển)" / "Authentication is off (acceptable in development only)" · `kh_embedder_english` "Embedder {model} chỉ hỗ trợ tiếng Anh — cần embedder đa ngữ (ví dụ bge-m3) để tìm tiếng Việt chính xác" / "Embedder {model} is English-only — a multilingual embedder (e.g. bge-m3) is needed for Vietnamese" · `kh_projects_empty` "Khoá chưa thấy project nào" / "The key sees no project" · `kh_projects_many` "Khoá thấy {count} project (chỉ dùng 50 đầu)" / "The key sees {count} projects (only the first 50 are used)" · `kh_summary_project_missing` "Project ghi Tóm tắt {project_id} không nằm trong project khoá thấy" / "Summary project {project_id} is not among the projects the key sees". Mã lạ ⇒ "Mục kiểm {code}".

## 5. Role + nhãn cho e2e (giữ đúng khi code; spec §5 trích lại)
| Màn | Phần tử |
|---|---|
| Cài đặt | `heading "Cài đặt"` · `heading "Kết nối KnowledgeHub"` · `table "Kết nối KnowledgeHub"` (cột "Tên" "Địa chỉ" "Khoá" "Project ghi Tóm tắt" "Trạng thái" "Agent dùng") · `button "Thêm kết nối"` · `list "Origin được phép"` · `button "Tải thêm"` · `note` chứa "Agent đọc được mọi project mà khoá của kết nối thấy" |
| Dòng kết nối | `button "Kiểm tra {name}"` · `button "Sửa {name}"` · `button "Xoá {name}"` |
| Sheet kết nối | `dialog "Thêm kết nối"` / `"Sửa kết nối"` · `textbox "Tên"` · `textbox "Địa chỉ"` · `combobox "Khoá"` · `link "Tạo secret"` · `textbox "Project ghi Tóm tắt"` · `button "Lưu"` · `button "Huỷ"` · `status` "Đã lưu · v{n}" |
| Dialog kết quả | `dialog "Kết quả kiểm tra"` · `status` (tổng: "Kết nối đạt" / "Kết nối chưa đạt: {n} lỗi") · `list` mục kiểm |
| ConfirmDialog | `alertdialog`; nút xác nhận **"Xoá"**, nút **"Huỷ"**; xoá kết nối chứa "Secret không bị xoá."; `KH_CONNECTION_IN_USE` ⇒ `alert` chứa "agent đang dùng"; toast: `region "Notifications"` |
| Agent | `region "KnowledgeHub"` có `checkbox "{tên kết nối}"` (mỗi kết nối) · `button "Lưu"` (trong region) · text "Tối đa 5 kết nối" |
| Output (admin OutputDialog + chat) | `status` chứa "Không truy cập được KnowledgeHub" · text "Tri thức: 2/5 lần hỏi" · "Tóm tắt: đang chờ" · "(ghi vào {project} · {connection})" |

`name` trong nhãn dòng = tên kết nối (`aria-label` = "{Hành động} {name}"). Không còn trong e2e: bảng "Công ty của kết nối", `combobox "Tenant"`, `textbox "Namespace"`/"Keyspace", `button "Tri thức"` / `dialog "Tri thức"` / `switch` của admin-web. Test khoá T2 cũ (`e2e/studio/k1-knowledgehub.studio.ts`, `e2e/K1/**`) viết theo thiết kế cũ: qc viết lại theo bảng này.

## 6. Hiệu năng và a11y
Trang Cài đặt KH < 25 KB gzip (lazy route); bảng phân trang cursor ≤ 100/lần, không virtualize. Kết quả kiểm có icon **và** chữ; Alert `aria-live="polite"`; tương phản ≥ 4.5:1; checkbox agent có `label`; nút icon có `aria-label`; điều hướng bàn phím.

## 7. Đối chiếu contract BE (spec §3) · Cần backend-lead
Khớp: `KhConnection` (`secret {id,name}`, `summary_project`, `agents_count`, `check`), `KhCheckResult` (7+5 mã, `projects`), `GET C → allowed_origins`, `PUT /agents/:id/knowledge`, `AgentSchema.knowledge_connection_ids`, `StageView.knowledge.write_to`. FE cần thêm một điểm: Select "Khoá" lấy secret nền tảng — dùng `HubSecretListQuery` H4b-1 (`kind=kh_api_key`; chưa có lọc nền tảng nên FE lọc `tenant_id=null` phía client, lỗi còn lại do `KH_SECRET_INVALID`). Không cần đổi contract. Artboard: mockup đủ 5 màn, không đề xuất thêm.

## 8. Chốt theo test khoá (qc G13–G15)
| # | Chốt |
|---|---|
| G13 | Admin vào qua `/processes/:defId/runs/:runId` → `button "Xem kết quả"` của stage → `dialog "Kết quả giai đoạn {stage}"` (nhãn i18n hiện có của OutputDialog) chứa `KnowledgeNotice` (`status` + dòng "Tri thức: n/5 lần hỏi · Tóm tắt: …"). Không thêm trang/nút/route admin riêng cho K1. |
| G14 | Select "Khoá" gọi đúng `GET /studio/api/secrets?kind=kh_api_key` (không tham số lọc nền tảng), rồi **lọc client `tenant_id === null`**; mock/BE có thể trả secret bất kỳ cho query `/secrets?…`, FE vẫn chỉ hiện secret nền tảng. Phân trang: lặp `next_cursor` tới hết (≤ 5 trang) trước khi báo "Chưa có secret KnowledgeHub của nền tảng". |
| G15 | `KH_URL_NOT_ALLOWED` hiện inline ở ô Địa chỉ, nguyên văn VI **"Địa chỉ không được phép ({reason})"** / EN "Address not allowed ({reason})"; `{reason}` = chuỗi thô `error.details.reason` từ server, **không dịch**, thiếu ⇒ bỏ cả cụm " ({reason})". e2e chỉ khớp phần đầu "Địa chỉ không được phép". |
