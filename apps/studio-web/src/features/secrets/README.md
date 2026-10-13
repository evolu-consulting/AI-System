# features/secrets

Secrets của Hub [HUB-FR-68, HUB-FR-69] (H4b-1): `/secrets` — 3 tab theo `kind` (`?kind=`), bảng (cột Giá trị luôn "Đã lưu"), Sheet thêm/thay (`?drawer=new|<id>`), xoá, [Tải thêm] theo cursor.

- `api.ts`: `GET/POST /studio/api/secrets`, `PUT/DELETE /:id` (`DELETE ?version=`). Chỉ file này gọi API.
- `hooks/use-secret-mutations.ts`: `gcTime: 0` + `reset()` trong `finally` ⇒ cache mutation không giữ `value` (test cạnh file).
- `components/SecretSheet.tsx`: form RHF; sau lưu Sheet ở lại (ô `disabled`, value rỗng, footer [Đóng]); 409 `VERSION_CONFLICT` ⇒ `ConflictDialog` với `rows=[]` (ẩn [Xem khác biệt]).
- Tab `source_credential`: xem + thay + xoá, không tạo (tenant admin tạo ở màn Nguồn).

Bẫy: không bao giờ điền sẵn / hiện lại giá trị; không đưa giá trị vào URL, storage, toast, `data-*`; tên bất biến (đổi tên = tạo mới + xoá cũ).
