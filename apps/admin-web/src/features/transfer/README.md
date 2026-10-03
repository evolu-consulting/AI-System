# transfer — Import / Export (ADM-FR-54)

`/transfer` (chỉ platform_admin). FE5a: tab Export (`GET /admin/export/meta`, `GET /admin/export?types=`; tải qua `lib/download.ts`). FE5b: tab Import 3 bước.

| File | Vai trò |
|---|---|
| `api.ts` | nơi duy nhất gọi API: export meta/tải, `useImportDryRun` (`?dry_run=1`), `useImportCommit` (`?dry_run=0`, invalidate các gốc query cấu hình) |
| `lib/import-file.ts` | kiểm đuôi `.yaml/.yml` + ≤ 1 MiB ở client; định dạng kích thước |
| `hooks/use-import-preview.ts` | file (chỉ bộ nhớ) → dry-run; lỗi `valid:false` / `IMPORT_INVALID` / 413; `refresh` sau 409 |
| `hooks/use-import-apply.ts` | giá trị secret thiếu (state, xoá khi đổi file/unmount), xác nhận, áp dụng; 409 → dry-run lại + `transfer.import.stale` |
| `components/Import*.tsx`, `MissingSecrets.tsx` | trình bày (không fetch): kéo-thả, chip lọc `aria-pressed`, Accordion theo loại + `DiffTable`, danh sách lỗi |
