# features/pack-state — trạng thái gói Hợp đồng

- FR: PK-FR-05, PK-AC06, PK-FR-10 (N1 TF4, plan-frontend §1 "Quyền/Trạng thái", §7 "Trạng thái mới").
- Điểm vào: `pages/PackFrame.tsx` (component của route `_authed`), `hooks/use-me.ts` (`useMe`: người dùng + `write`/`owner` từ `actions` của `GET /pack/contracts/me`).
- `components/PackGate.tsx`: đang tải (status "Đang tải…") · lỗi + "Thử lại" · trang `PACK_FORBIDDEN` / `PACK_DISABLED` · nội dung.
- `lib/query-errors.ts`: gắn ở `app/query-client.ts` — 403 `PACK_*` ⇒ nạp lại `/me`; 409 ⇒ toast.
- Gọi API chỉ ở `api.ts`. Phụ thuộc: `features/auth` (phiên, đăng xuất), `@ai/web-kit/http`, i18n `contracts.packState.*`, `contracts.errors.*`.
