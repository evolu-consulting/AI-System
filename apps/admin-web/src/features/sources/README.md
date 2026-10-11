# features/sources

Nguồn tham chiếu của quy trình [ADM-FR-68, HUB-FR-120] (P-b1): kho Git công khai, tài liệu thư viện, đường dẫn trên máy Runtime. Hiện khi engine quy trình `on` (nav "Nguồn", `/sources`); cả `tenant_admin` và `platform_admin`.

- `api.ts`: nơi duy nhất gọi Hub `/admin/sources*` (list cursor, get, create, update `version`, delete, check) + `useSourceOptions` (gợi ý gọn cho editor quy trình, KHÔNG mang config) + `useLibraryDocs`. platform_admin luôn kèm `tenant_id`.
- URL: `?tenant&kind&q&drawer=new|edit|view&source=<key>` (`routes/_authed/sources.tsx`). Không có `path` trong URL/query key/title.
- **Quyền / rò path (PB-R21, C1):** server đã ẩn `config.path`; UI vẫn chỉ in path qua `lib/source-view.localPathOf` (platform_admin). tenant_admin: không có radio `Đường dẫn cục bộ`, dòng local_path chỉ menu `Xem`, drawer `Xem` không form.
- `components/`: `SourceTable`, `SourcesEmpty`, `SourceDrawer` (vỏ Sheet), `SourceDrawerBody`, `SourceForm`, `KindFields`, `LibraryDocPicker`, `LocalPathWarning`, `SourceViewBody`, `CheckPanel`, `SourceDeleteDialogs`.
- `hooks/`: `use-sources-view`/`use-sources-nav` (trang), `use-source-save` (POST/PUT + 409 → ConflictDialog), `use-source-check` (abort, 130 s), `use-source-delete` (BlockedDialog / ConfirmDialog), `use-library-doc-picker`.
- `lib/`: `schemas` (validate, key i18n), `errors` (mã → câu tĩnh, không dùng `message` server), `source-view` (Đích/Trạng thái/dung lượng), có test cạnh file.
- Chuỗi: `packages/i18n/locales/process/sources.{vi,en}.json` (`process.sources.*`), nạp cùng engine.
- Chờ: route `GET /admin/sources/library-documents` (backend S3).
