# P · Phụ lục plan-frontend: admin-web ①②, validate, lệch mockup

Thuộc [`plan-frontend.md`](plan-frontend.md). Màn ④: [`plan-frontend-thread.md`](plan-frontend-thread.md). Câu chữ: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) §8 (admin). Khung dùng lại ở admin-web: `PageHeader`, `DataTable`, `Pagination`, `EmptyState/ErrorState/ForbiddenState/NotFoundState`, `ConflictDialog` (+entity `process_def`), `EditorSaveBar`, `UnsavedGuard`, `RefPicker`, `TenantPicker`, `ConfirmDialog`, `useHubTenant`, `Tabs`, `Accordion`, `Select`, `Switch`, `Table`.

## 1. Admin-web ①②: danh sách + editor tối thiểu + run (F5 · PF4 · `admin-web/src/features/processes/`)
| Hạng mục | Chi tiết |
|---|---|
| Nav/route | nav `Quy trình` trong CHỨC NĂNG, **cả `tenant_admin`**, chỉ khi engine `on` (`navGroups(role, {processes})`); `crumbsFor` thêm `/processes*`. Routes `processes/{index,new,$processId,$processId.runs.$runId}.tsx`. `member` không vào (`isAllowedForRole`). `platform_admin`: `TenantPicker`/`useHubTenant` cho dữ liệu tenant; tab Mẫu không cần tenant |
| `api.ts` | `useProcessDefs` (`GET /process-defs`), `useProcessDef`, `useCreateDef`, `useCopyDef`, `useUpdateDef` (kèm `version`), `useDeleteDef`, `useRunDef`, `useAgentTeams`, `useAgentSettings` (dùng lại H3b), `useTenantRuns` (`GET /process-runs?scope=tenant`), `useRun`, `useRunUsage`. Gọi qua `hubUrl()` (như `features/hub`); `hubConfigured()=false` ⇒ `HubLoadError` |
| Danh sách (`pages/ProcessesPage.tsx`) | `Tabs` `Của công ty` · `Mẫu` (mẫu: cột "Mẫu" + nút `Chép mẫu`, `platform_admin` được sửa mẫu). Cột: Tên · `!key` · Giai đoạn (số) · Lượt đang chạy (`active_runs`) · Cập nhật · Bật (`Switch`). Lọc chip Tất cả/Đang bật/Đang tắt (client). Hành động dòng: `Chạy` (Dialog nhập `input`, chỉ khi bật; 429/`PROCESS_NOT_FOUND` ⇒ lỗi trong dialog; `platform_admin` ⇒ ẩn, lý do tooltip), `Sửa`, `Xoá` (`ConfirmDialog` gõ tên). Phân trang `limit` 50. Tải/rỗng ("Chưa có quy trình. Chép từ tab Mẫu hoặc tạo mới.")/lỗi/403 `ForbiddenState` |
| Bật/tắt | `PUT` đủ body + `version` (đọc `GET :id` trước); 409 ⇒ `ConflictDialog` entity `process_def`; `PROCESS_DEF_INCOMPLETE` (bật khi còn giai đoạn kiểm chưa chọn Group) ⇒ toast + mở editor tại giai đoạn lỗi |
| Editor (`pages/ProcessEditorPage.tsx`) | `PageHeader` + 2 tab `Cấu hình` · `Lượt chạy`. Cấu hình = 3 thẻ: **Thông tin** (`Tên quy trình` ≤ 80, `Ký hiệu chạy` tiền tố `!` + `PROCESS_KEY_RE`, `Mô tả` ≤ 500, `Gợi ý nhập`, `Group được chạy` ≤ 20 (rỗng = cả công ty), `Ngân sách token cả lượt` tuỳ chọn, `Bật`), **Giai đoạn** (`Accordion`, ≤ 10; `Lên`/`Xuống`/`Xoá giai đoạn`/`Thêm giai đoạn`), **Giới hạn** (chữ chỉ đọc: 7 ngày · 5 lượt · làm lại ≤ 3 · nhắc sau 1 ngày). Mỗi giai đoạn: `Tên giai đoạn`, `Mã giai đoạn` (tự sinh từ tên), `Làm bởi` (Agent/Nhóm agent + chọn từ `agent-settings` bật / `agent-teams`), `Hướng dẫn` ≤ 4000, `Tên tệp kết quả` (`.md`), `Mẫu kết quả` ≤ 20000, `Mục bắt buộc` (≥ 1, chip), `Trường có cấu trúc` ≤ 20 (key/kiểu/bắt buộc), `Sau giai đoạn` (Duyệt bởi Group + chọn Group / Tự chạy tiếp), `Hành động thật` (Switch; khoá nếu giai đoạn trước không có người kiểm, tooltip), `Người trả lời` (Người bắt đầu/Group/User), `Hạn giai đoạn (giây)` 60..3600 (600), `Ngân sách token giai đoạn`. Mẫu + `tenant_admin` ⇒ form chỉ đọc + banner + `Chép mẫu` (`TEMPLATE_READ_ONLY`) |
| Validate | client khớp `def.rules` (§2); lỗi server `PROCESS_DEF_INVALID/INCOMPLETE{paths}` ⇒ gắn vào ô theo `paths`, mở accordion lỗi; `PROCESS_REF_INVALID{path,ref}` ⇒ ô "đã bị tắt/không còn"; `PROCESS_KEY_TAKEN` ⇒ ô `Ký hiệu chạy`; `VERSION_CONFLICT` ⇒ `ConflictDialog`; chưa lưu ⇒ `UnsavedGuard`; `EditorSaveBar` `Lưu` |
| Tab Lượt chạy | `GET /process-runs?scope=tenant&process_key=<key>` (lọc server, plan-contract §3) · cột Lượt · Người bắt đầu · Trạng thái · Giai đoạn · Bắt đầu; dòng → `/processes/$id/runs/$runId` |
| Run page | `PageHeader` + tabs `Tiến độ` · `Token` · `Nhật ký`: tiến độ giai đoạn (bảng), phiên bản kết quả (nút `Xem kết quả` → Dialog `<pre>` từ `/outputs/:oid`, admin được `full`), **Cần người quyết** (3 nút + ghi chú, `can_decide`) và `Huỷ lượt chạy` (`can_cancel`); token = plan-frontend §7. Không xem tin phòng |

## 2. Validate client (khớp contract; câu lỗi nguyên văn: phụ lục i18n §7)
| Ô | Luật | Mã |
|---|---|---|
| Góp ý "Chưa đạt" | trim ≥ 1, ≤ 4000 | `FEEDBACK_REQUIRED` |
| Trả lời | trim ≥ 1, ≤ 4000; chip ≤ 6 | — |
| Lời nhắn chuyển | ≤ 500 | — |
| Ghi chú quyết định | ≤ 500 | — |
| `input` khởi chạy | ≤ 8000 | `VALIDATION_ERROR` |
| Ký hiệu chạy (admin) | `^[a-z0-9-]{2,32}$`, duy nhất | `PROCESS_KEY_TAKEN` |
| Tên | 1..80 · Mô tả ≤ 500 · giai đoạn 1..10 · key giai đoạn duy nhất `^[a-z0-9-]{2,32}$` | `PROCESS_DEF_INVALID` |
| Tệp kết quả | `^[a-z0-9._-]{1,76}\.md$` · mẫu 1..20000 · mục bắt buộc 1..20 mỗi mục 1..80 | `PROCESS_DEF_INVALID` |
| Trường cấu trúc | `^[a-z][a-z0-9_]{0,31}$`, ≤ 20 | `PROCESS_DEF_INVALID` |
| Hành động thật | giai đoạn ngay trước phải `after=review` | `PROCESS_DEF_INVALID` |
| Bật | mọi `after=review` có Group | `PROCESS_DEF_INCOMPLETE` |
| Hạn / ngân sách | 60..3600 · 1000..5 000 000 hoặc trống | `PROCESS_DEF_INVALID` |

## 3. Lệch so với mockup (plan thắng)
| Board | Mockup | P-a làm | Vì |
|---|---|---|---|
| ④ | Thread + khối quy trình + composer flow (U1) | **Khớp mockup** (khối timeline với thanh giai đoạn, "Trả lời tiếp ›", tin kết quả v1/v2, thẻ kiểm, góp ý/trả lời gõ ở composer flow) — trừ các dòng ④ dưới đây | U1 |
| ④ | Khối timeline có `Đạt · chạy tiếp` / `Chưa đạt` cho người kiểm | Khối chỉ có nút mở thread (`Kiểm ngay`/`Trả lời`/`Quyết định`); `Đạt`/`Chưa đạt` **chỉ trong thread** | Tránh hai bộ nút trùng role khi pane mở; thread là nơi có output |
| ④ | Chip bộ đếm "Lượt gọi agent 6/10", "Token 31,7k / 200k" ở đầu thread | Chỉ "Làm lại a/max", "Hỏi lại n/max"; token ở tab Token `/runs/:id` | Contract không có bộ đếm sống |
| ④ | Danh sách lượt gọi agent **đang chạy** (◌ Analyst … đang chạy…) | Giai đoạn đang chạy = dòng trạng thái + `StageStrip`; bước chỉ hiện sau khi có tin `output` (`steps`) | Tin `output` gom bước (plan-thread T11) |
| ④ | "Kịch bản cố định" (chế độ nhóm), "#6/#31" số lượt chạy, nút "Xem lại bước kiểm (demo)" | Bỏ | Contract không có / chỉ demo |
| ④ | Tên tệp `spec.md` ở tiêu đề kết quả | "Kết quả {{giai đoạn}} v{{n}}" | `OutputRef` không có tên tệp |
| ④ | Nút "Đạt · chạy tiếp" | Nút tên đúng `Đạt` (mô tả "Chạy tiếp giai đoạn kế" bên dưới) | `getByRole` không nhầm với "Chưa đạt" |
| ⑥ | Dòng xem trước chuỗi giai đoạn ("Đọc → Bút toán → 🔒 → …"), "Người kiểm: Thomas…", chip 📎 tệp, nút "@ Agent" | "{{n}} giai đoạn"; không xem trước người kiểm; không tệp; chỉ nút "Quy trình" | `GET /processes` chỉ có `stage_count`; `input` chỉ chữ; composer chưa có nút `@` |
| ⑤ | DM trong nhóm Users + ngăn "Lượt chạy" kéo ra + bảng "Hub đã báo cho ai / Ai thấy gì" | Hàng ghim → trang `/process-inbox`; `/runs/$id` là trang; bảng giải thích → `TaskAccessBanner` | Plan D12; ít chữ tĩnh |
| ⑤ | Dòng thời gian bước kèm thời lượng ("Đọc hoá đơn · Haiku · 6,2s") | Thời gian/agent theo `history` + Token tab (full) | Dữ liệu `task` không có chi tiết lượt gọi |
| ⑦ | Ngữ cảnh do agent tự đính kèm; ngữ cảnh đọc được "Yêu cầu: …" | `excerpt` Hub cắt ≤ 1000 ký tự input + tên giai đoạn | Câu hỏi C4 mặc định |
| ⑦ | Chip theo từng câu hỏi | Chip phẳng; gộp nhiều câu ⇒ chèn vào composer thread | `choices` phẳng |
| ⑦ | Ô nhập câu trả lời | Trong thread: `Trả lời bằng văn bản` → composer chế độ Trả lời (nhãn "Câu trả lời") | U1: trả lời gõ ở composer flow |
| ⑧ | "% ngân sách", cột Ngân sách giai đoạn, "Kịch bản cố định", dòng "Hỏi lại — chờ 5 phút" | Bỏ ngân sách/thời gian chờ; thêm cột Cache; mode lấy `team_runs.mode` | Contract không trả ngân sách/thời gian chờ; tổng = vào+ra+cache |
| ① | 4 ô KPI, chuỗi chip giai đoạn (🔒/hành động thật), cột Ai dùng được ("Group được chạy"), Sửa lần cuối bởi ai | Bảng 6 cột, lọc chip client | Không có endpoint tổng hợp; P-b (F3) |
| ① | Cột "Lượt chạy gần nhất" (ADM-FR-65) | Chỉ "Lượt đang chạy" (`active_runs`) | `GET /process-defs` không có `last_run`; P-b |
| ② | 2 cột (dải giai đoạn + panel phải), kéo-thả, Luật tự duyệt, Tự quay lại, Chạy thử, Nhân bản | Accordion + `Lên/Xuống`; không tự duyệt/tự quay lại (P-b); `Chạy` thật; `Chép mẫu` chỉ cho mẫu | "Editor tối thiểu"; `copy` chỉ mẫu → tenant |
| ①② | `Export JSON` / `Import JSON` (ADM-FR-65, HUB-FR-104) | **Không có ở P-a** (không nút, không route, không test) | U2: → P-b (Pb1) |
| Hỏi AI | (không có board) | Thẻ run trong `ConversationRunCards` phía trên khung nhập | FD4/D14 |
