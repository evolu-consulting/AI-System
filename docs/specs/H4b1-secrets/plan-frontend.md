---
spec: H4b1-secrets
part: frontend
owner: frontend-lead
status: draft
requirements: [HUB-FR-68, HUB-FR-69, HUB-BR-30, AC-H4b1-01, AC-H4b1-04, AC-H4b1-05, AC-H4b1-08]
---

> **Ghi chú e2e:** e2e đóng Sheet trước khi kiểm dòng bảng/toast; không đổi `modal` (qc sửa test).
>
> **Đổi nhãn sau T1:** không đổi nhãn/role đã công bố. Chỉ **thêm**: `combobox "Phạm vi"` trong Sheet tạo khoá KnowledgeHub (Q7); cột Tenant cũng hiện ở tab KnowledgeHub; text badge `Nguồn · {key}` / `KnowledgeHub · {key}` (trước đây `{name}` / không key).

# Plan frontend · H4b-1 · Studio → Secrets (`apps/studio-web`)

Nguồn: spec §1/§2/§5/§9 · ui-agent-studio §2, §11 · ui-admin SecretField (dòng 133) · H4a `plan-frontend.md` (D1–D12 vẫn đúng) · code mẫu: `apps/admin-web/src/features/secrets` (SecretField/Drawer/Table), `studio-web` `features/orchestrator` (Page + Sheet + ConfirmDialog), `components/shared/conflict/ConflictDialog`. **Contract đã chốt** ở spec §3 (`fb9dc388`); §8 đối chiếu từng điểm. FE không đổi contract.

## 0. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không thêm thư viện → không ADR. Chunk `/secrets` nạp lười (`lazyRouteComponent`) | H4a D1, §8 |
| D2 | Không có artboard riêng: bám mẫu **màn Agents** (PageHeader + bảng) + **Sheet** của Orchestrator + SecretField của Admin. Không đề xuất artboard mới | ui §11 "giống hệt mẫu Admin" |
| D3 | **Chỉ ghi, không bao giờ hiện lại**: UI không có nút xem; không hiện last4 (spec §2 metadata không có `last4`, không xin thêm — lộ 4 ký tự là lộ). Cột Giá trị luôn `•••• •••• Đã lưu` | HUB-FR-68, HUB-BR-30 |
| D4 | Giá trị chỉ sống trong state RHF của Sheet: không vào URL, `localStorage`, cache TanStack (mutation tạo/thay đặt `gcTime: 0` và gọi `mutation.reset()` khi lưu xong hoặc đóng Sheet; `form.reset()` chỉ ở `onSuccess` và khi đóng Sheet — lỗi thì giữ nguyên form để [Ghi đè]/sửa tên; unit test: sau settle `queryClient.getMutationCache().getAll()` không còn `value`), toast, `console`, `aria-label`, `data-*`, biến test id. Input `type=password`, `autoComplete="new-password"`, `spellCheck=false`; nút Hiện/Ẩn chỉ cho giá trị đang gõ (mẫu Admin). Đóng Sheet = bỏ giá trị, **không** hỏi xác nhận (như TD #83) | R14-tinh-thần, AC-H4b1-07 |
| D5 | Ba tab theo `kind` trong URL `?kind=provider_api_key\|source_credential\|kh_api_key` (mặc định `provider_api_key`). Mỗi tab `GET /studio/api/secrets?kind=<tab>&limit=100`; `next_cursor` ≠ null → nút [Tải thêm] (cursor). Không đếm trên tab. Studio là `platform_admin` nên thấy mọi tenant (không gửi `tenant_id`) | spec §3A |
| D6 | Tạo mới chỉ cho `provider_api_key` (không gửi `tenant_id`) và `kh_api_key` (Sheet có `Phạm vi`: "Toàn nền tảng" mặc định hoặc một tenant → `tenant_id`, Q7; chọn "Toàn nền tảng" ⇒ **bỏ hẳn khoá `tenant_id`** khỏi body (không gửi null/rỗng); danh sách tenant từ `tenantsQuery` của orchestrator, nạp khi mở Sheet). Tab `source_credential` (Q1): **xem + thay + xoá**, có cột Tenant; nút tạo ẩn, dòng chú thích "Khoá nguồn do tenant admin tạo ở màn Nguồn." | spec Q1/§3B: tạo qua route tenant `/admin/source-credentials*` từ màn Nguồn của Admin, **ngoài phạm vi FE H4b-1** (chỉ Studio) |
| D7 | `name` không đổi sau khi tạo; Sheet thay hiện tên bằng chữ thường (`<p>`/`<dd>`), **không dùng input** (E04 đòi 0 `textbox "Tên"`). Đổi tên = tạo mới + xoá cũ | PUT chỉ nhận `{version, value}`; `kind`/`tenant_id`/`name` bất biến (spec §3A) |
| D8 | 409 `VERSION_CONFLICT` dùng lại `ConflictDialog` dùng chung với `rows=[]` (secret không có diff). Thay đổi nhỏ ở component chung: khi `rows.length===0` ẩn nút [Xem khác biệt]. Giá trị đang gõ giữ nguyên để [Ghi đè] gửi lại với `version` mới. Ghi đè xác nhận hai bước như H4a (ConflictDialog dùng chung). [Ghi đè] thành công = như lưu thường, áp D9 | H4a-R09, HUB-FR-69 |
| D9 | Sau lưu thành công Sheet **ở lại**: hiện dòng `role=status` "Đã lưu · v{n}", ô nhập rỗng lại, footer chỉ còn [Đóng] (ẩn [Huỷ]/[Lưu]); ô `Giá trị`, `Tên` (và `combobox "Phạm vi"` ở chế độ tạo) dùng `disabled`, vẫn trong DOM với value rỗng, tới khi đóng Sheet (AC-H4b1-08) | AC-H4b1-08 |
| D10 | `SecretSheet` truyền `showCloseButton={!saved}`: sau lưu chỉ còn nút [Đóng] ở footer (không nút X) | AC-H4b1-08 |

## 1. Cấu trúc & route
```
src/routes/_authed/secrets.tsx      lazy; validateSearch {kind?, drawer?: "new"|<id>}
src/features/secrets/api.ts         GET /secrets?kind&limit&cursor · POST /secrets · PUT /secrets/:id · DELETE /secrets/:id?version=N (đường dẫn tương đối /studio/api)
  hooks/use-secrets.ts (useInfiniteQuery theo kind) · use-secret-mutations.ts (map lỗi, invalidate ["secrets"] + ["me"] để ConfigBadge đổi vN)
  lib/schema.ts (zod, khớp contract) · lib/used-by.ts (nhãn used_by) · lib/save-error.ts
  components/{SecretTable,SecretSheet,SecretValueField,UsedByCell,InUseDialog}.tsx
  pages/SecretsPage.tsx · README.md
src/features/shell/lib/nav.ts       secrets: soon → { kind:"link", to:"/secrets" }
src/lib/api-error.ts                KNOWN += SECRET_IN_USE, SECRET_NAME_TAKEN
```
Sheet mở bằng `?drawer=new` (tạo, `kind` lấy từ tab) hoặc `?drawer=<id>` (thay giá trị). `id` không có trong danh sách → bỏ `drawer`. Mỗi file ≤ 200 dòng (component), tách `SecretValueField` (mẫu Admin, copy-then-own).

## 2. Màn ↔ mẫu ↔ trạng thái
| Màn | Bố cục | Đang tải | Rỗng | Lỗi | Không quyền / 409 |
|---|---|---|---|---|---|
| Secrets | `PageHeader` "Secrets" + subtitle; `tablist "Loại secret"` 3 tab; hàng công cụ: [+ Thêm secret] (ẩn ở tab nguồn); `table "Danh sách secret"`: Tên (mono) · Tenant (tab nguồn và KnowledgeHub; `tenant.name` hoặc "Toàn nền tảng") · Giá trị · Được dùng bởi · Cập nhật · Thao tác ([Thay giá trị] [Xoá]) | Skeleton 4 dòng (`aria-busy`) | EmptyState theo tab + [+ Thêm secret] (tab nguồn: chỉ chú thích) | `ErrorState` + [Thử lại] | `GET` 403 → EmptyState "Bạn không có quyền xem secret" (me đã chặn `/forbidden`; đây là phòng thủ). Mutation 403 → toast `errors.FORBIDDEN`. 409 → xem dưới |
| Sheet Thêm / Thay | Sheet phải (mẫu TenantSheet): tiêu đề, `Tên` (tạo: nhập; thay: chữ thường `<p>`/`<dd>` + loại, không input), `Phạm vi` (chỉ tạo `kh_api_key`; `Select`, mặc định "Toàn nền tảng"; thay: readonly hiện tenant), `Giá trị` (SecretValueField, gợi ý "Giá trị không xem lại được sau khi lưu"), footer [Huỷ] [Lưu] (sau lưu: chỉ [Đóng]) | nút "Đang lưu…" disabled | — | lỗi trường dưới ô; lỗi khác toast | `VERSION_CONFLICT` → ConflictDialog (D8); `SECRET_NAME_TAKEN` → lỗi dưới `Tên`; sau lưu → D9 |
| Xoá | `ConfirmDialog` destructive "Xoá {name}?"; 204 → đóng ConfirmDialog, toast `toast.deleted`, invalidate | nút disabled khi gửi | — | toast lỗi | `used_by` không rỗng (biết trước từ danh sách) **hoặc** `409 SECRET_IN_USE` → `InUseDialog` (`alertdialog`, danh sách "Được dùng bởi", chỉ nút [Đóng]); `404` → toast `errors.NOT_FOUND` + refetch; `409 VERSION_CONFLICT` (gửi `?version=` của dòng) → toast `secrets.errors.conflictDelete` + refetch (không ConflictDialog: xoá không có giá trị để ghi đè) |

**Hành vi**
| Tương tác | Hành vi |
|---|---|
| Đổi tab | `replace` URL `?kind=`; đóng Sheet |
| [Thay giá trị] | mở Sheet chế độ thay, ô `Giá trị` rỗng, không bao giờ điền sẵn |
| Lưu thành công | tạo: toast "Đã thêm {name}"; thay: toast "Đã thay giá trị {name}"; cả hai: toast tiếp "hub config v{n}" qua ConfigBadge (invalidate `me`); Sheet ở lại theo D9 |
| Cột Được dùng bởi | badge mỗi tham chiếu: `Provider · {key}`, `Nguồn · {key}`, `KnowledgeHub · {key}` (theo `type` + `key`; contract không có `name`); rỗng → "Chưa dùng" (muted). Không là link (màn Providers/KH chưa có) |
| Cột Giá trị | chuỗi cố định `•••• •••• Đã lưu` + `v{version}` tooltip; không phụ thuộc dữ liệu |
| Mất mạng | dùng `OfflineBanner` của khung |

## 3. Validate phía client (zod; khớp contract spec §3)
| Trường | Luật | VI | EN |
|---|---|---|---|
| Tên (tạo) | bắt buộc, trim, `^[A-Za-z0-9_-]{2,64}$`; trùng không phân biệt hoa-thường do BE trả `SECRET_NAME_TAKEN` | "Chỉ dùng chữ, số, - và _ (2–64 ký tự)" | "Use letters, digits, - and _ only (2–64 characters)" |
| Tên (trống) | bắt buộc | "Nhập tên secret" | "Enter a secret name" |
| Giá trị | bắt buộc, 8–2048 ký tự; gửi nguyên văn, không trim | "Giá trị dài 8–2048 ký tự" | "Value must be 8–2048 characters" |
| Giá trị (trống) | bắt buộc | "Nhập giá trị secret" | "Enter the secret value" |
Lỗi 400 `VALIDATION_ERROR` `details.issues[{path}]` gắn đúng trường như H4a §4. Giá trị = `HubSecretValueSchema` (= `SecretValueSchema` Admin, 8–2048 đơn vị UTF-16, không trim), import từ `@ai/contracts/hub-admin`, không chép. `tenant_id` chọn từ danh sách nên không lỗi tay; 400 path `tenant_id` → lỗi dưới `Phạm vi`.

## 4. Câu chữ (key `secrets.*` trong `packages/i18n/locales/studio/{vi,en}.json`; copy-then-own, chỉ thêm)
| Key | VI | EN |
|---|---|---|
| title / subtitle | "Secrets" / "Khoá API của Hub. Giá trị chỉ ghi, không xem lại được." | "Secrets" / "Hub API keys. Values are write-only and can never be viewed again." |
| tab.provider_api_key / source_credential / kh_api_key | "Provider API key" / "Khoá nguồn (git)" / "Khoá KnowledgeHub" | "Provider API keys" / "Source credentials (git)" / "KnowledgeHub keys" |
| tabs.aria | "Loại secret" | "Secret type" |
| create | "+ Thêm secret" | "+ Add secret" |
| table.aria | "Danh sách secret" | "Secret list" |
| col.name / tenant / value / usedBy / updated / actions | "Tên" / "Tenant" / "Giá trị" / "Được dùng bởi" / "Cập nhật" / "Thao tác" | "Name" / "Tenant" / "Value" / "Used by" / "Updated" / "Actions" |
| value.stored | "•••• •••• Đã lưu" | "•••• •••• Saved" |
| usedBy.none | "Chưa dùng" | "Not used" |
| usedBy.provider / source / kh | "Provider · {key}" / "Nguồn · {key}" / "KnowledgeHub · {key}" | "Provider · {key}" / "Source · {key}" / "KnowledgeHub · {key}" |
| scope.platform / field.scope | "Toàn nền tảng" / "Phạm vi" | "Platform-wide" / "Scope" |
| loadMore | "Tải thêm" | "Load more" |
| action.replace / delete | "Thay giá trị" / "Xoá" | "Replace value" / "Delete" |
| empty.provider_api_key | "Chưa có API key provider nào." | "No provider API keys yet." |
| empty.kh_api_key | "Chưa có khoá KnowledgeHub." | "No KnowledgeHub key yet." |
| empty.source_credential | "Chưa có khoá nguồn nào. Khoá nguồn do tenant admin tạo ở màn Nguồn." | "No source credentials yet. Tenant admins create them on the Sources screen." |
| forbidden | "Bạn không có quyền xem secret" | "You don't have permission to view secrets" |
| sheet.create / replace | "Thêm secret" / "Thay giá trị · {name}" | "Add secret" / "Replace value · {name}" |
| field.name / value / hint | "Tên" / "Giá trị" / "Giá trị không xem lại được sau khi lưu" | "Name" / "Value" / "The value cannot be viewed after saving" |
| field.show / hide | "Hiện giá trị đang gõ" / "Ẩn giá trị" | "Show typed value" / "Hide value" |
| sheet.save / saving / close / cancel | "Lưu" / "Đang lưu…" / "Đóng" / "Huỷ" | "Save" / "Saving…" / "Close" / "Cancel" |
| sheet.saved | "Đã lưu · v{n}" | "Saved · v{n}" |
| toast.created / replaced / deleted | "Đã thêm {name}" / "Đã thay giá trị {name}" / "Đã xoá {name}" | "Added {name}" / "Replaced value of {name}" / "Deleted {name}" |
| delete.title / body / confirm | "Xoá {name}?" / "Giá trị sẽ bị xoá vĩnh viễn và không khôi phục được." / "Xoá" | "Delete {name}?" / "The value will be permanently deleted and cannot be restored." / "Delete" |
| inUse.title / body / close | "Không xoá được {name}" / "Secret đang được dùng bởi các mục sau. Gỡ tham chiếu trước khi xoá." / "Đóng" | "Cannot delete {name}" / "This secret is used by the items below. Remove the references first." / "Close" |
| errors.conflictDelete | "Secret vừa được thay đổi. Đã tải lại danh sách." | "The secret was just changed. The list has been reloaded." |
| errors.SECRET_IN_USE | "Secret đang được sử dụng nên không xoá được" | "The secret is in use and cannot be deleted" |
| errors.SECRET_NAME_TAKEN | "Tên này đã được dùng cho loại secret này" | "This name is already used for this secret type" |
| nav (đã có `nav.secrets`) | giữ | giữ |
Xung đột dùng `conflict.*` có sẵn: tiêu đề "Có người vừa lưu bản mới hơn"; [Tải bản mới] = refetch + đóng Sheet; [Ghi đè] = PUT lại với `version` mới nhất.

## 5. Role + nhãn cho e2e (VI; giữ nguyên khi code)
| Phần tử | Role · nhãn |
|---|---|
| Menu | `link "Secrets"` trong `navigation "Menu Studio"` (không còn `aria-disabled`) |
| Trang | `heading "Secrets"` · `tablist "Loại secret"` với `tab "Provider API key"`, `tab "Khoá nguồn (git)"`, `tab "Khoá KnowledgeHub"` · `button "+ Thêm secret"` · `table "Danh sách secret"`, mỗi `row` chứa tên; trong dòng `button "Thay giá trị"`, `button "Xoá"`, text "Đã lưu"; tab KnowledgeHub và tab nguồn có `columnheader "Tenant"`; `button "Tải thêm"` khi còn trang |
| Sheet | `dialog "Thêm secret"` / `dialog "Thay giá trị · {name}"` · `textbox "Tên"` (tạo) · `combobox "Phạm vi"` (tạo `kh_api_key`; option "Toàn nền tảng" + `tenant.name`, không kèm key — ngoại lệ so với mẫu TenantSheet) · ô giá trị là **password nên không có role textbox** → `getByLabel("Giá trị")` (như `Mật khẩu` ở H4a) · `button "Hiện giá trị đang gõ"` (chỉ khi có chữ) · `button "Lưu"` · `button "Huỷ"` · sau lưu: `status` "Đã lưu · v{n}" và `button "Đóng"` |
| Xoá | `alertdialog "Xoá {name}?"` (`button "Huỷ"`, `button "Xoá"`) · đang dùng: `alertdialog "Không xoá được {name}"` + list + `button "Đóng"` |
| Xung đột | như H4a: `alertdialog "Có người vừa lưu bản mới hơn"`, `button "Tải bản mới"`, `button "Ghi đè"` (không có "Xem khác biệt") |
| Không có | mọi nơi **không** có element hiển thị giá trị; DOM không chứa chuỗi giá trị đã nhập sau khi lưu (qc kiểm AC-08) |

## 6. Accessibility
Tab: `role=tablist` (radix Tabs) điều hướng mũi tên; Sheet/AlertDialog trả focus về nút gọi; nút icon Hiện/Ẩn có `aria-label`; trạng thái "Đã lưu" `role=status` (`aria-live=polite`); lỗi trường `aria-describedby`; cột "Đã lưu" không dựa vào màu. Mọi thứ dùng được bằng bàn phím.

## 7. Hiệu năng & bundle
Chunk lazy, không thêm dependency; ước ≤ 8 KB gzip (không chặn mốc, memory perf-later). Bảng không virtualize (số secret nhỏ). `SecretTable` memo theo `items`; Sheet giữ state cục bộ để gõ không render lại bảng.

## 8. Đối chiếu contract (spec §3; FE không tự đổi)
| # | Contract (đã chốt) | FE dùng |
|---|---|---|
| C1 | `GET /studio/api/secrets?kind&tenant_id&q&limit≤100&cursor` → `{items: HubSecret[], next_cursor}`; `HubSecret = {id, kind, tenant: {id,key,name}\|null, name, version, used_by: {type: provider\|source\|knowledge_hub, id, key}[], created_at, updated_at, updated_by}`; không `last4`/giá trị | D5: lọc `kind` ở server, [Tải thêm] theo `next_cursor`. Nhãn used_by = `type` + `key` (không `name`) |
| C2 | `POST {kind, name, value, tenant_id?}` → 201; `PUT /:id {version, value}` → 200 (`version+1`); `DELETE /:id?version=N` → 204 | Xoá gửi `version` của dòng; `kind`/`tenant`/`name` bất biến |
| C3 | Lỗi: `SECRET_NAME_TAKEN` 409 · `SECRET_IN_USE` 409 `details.used_by[≥1]` · `VERSION_CONFLICT` 409 `details {current: HubSecret, updated_at}` · `NOT_FOUND` 404 · `VALIDATION_ERROR` 400 (path `tenant_id` khi tenant không tồn tại) · `FORBIDDEN` 403 · `NOT_CONFIGURED` 409 | `NOT_CONFIGURED` → toast chung `login.err.server` (chỉ khi Hub thiếu khoá) |
| C4 | `HubSecretNameSchema`, `HubSecretValueSchema`, `HUB_SECRET_KINDS` xuất từ `@ai/contracts/hub-admin` | FE import, không chép luật |
| C5 | Ghi tăng `hub_config_version` (+NOTIFY) | ConfigBadge đổi qua invalidate `me` |
| C6 | List phân trang cursor | D5 |
| C7 | Route tenant `/admin/source-credentials*` (Q1) | Ngoài phạm vi FE H4b-1 (Admin-web / mốc Nguồn); Studio chỉ dùng `/studio/api/secrets*` |
| C8 | `kh_api_key` theo tenant (Q7) | Sheet tạo có `Phạm vi`; cột Tenant ở tab KH |

**Cần backend-lead:** không có điểm chặn. Xác nhận nhỏ: `used_by[].key` của `source`/`knowledge_hub` là khoá/tên đọc được (không phải uuid). Danh sách tenant cho `Phạm vi` dùng `GET /studio/api/tenants` hiện có, không cần endpoint mới.

## 9. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Trình duyệt/password manager lưu giá trị | `autocomplete="new-password"`, tên trường không là `password` |
| Giá trị rò qua devtools/query cache | D4: mutation, `reset()`, không `useQuery` chứa value; test unit `lib` kiểm payload không vào cache key |
| `used_by` cũ khi mở trang lâu | refetch khi focus (mặc định Query) + xử lý 409 `SECRET_IN_USE` |

## 10. Quyết định trong lúc PLAN (đã ghi cho spec §9)
- D3 không last4; D5 lọc kind ở server + Tải thêm; D6 `Phạm vi` cho khoá KH; D6 tab nguồn không tạo; D7 name bất biến; D8 `ConflictDialog` ẩn diff khi `rows=[]`; D9 Sheet ở lại sau lưu.
