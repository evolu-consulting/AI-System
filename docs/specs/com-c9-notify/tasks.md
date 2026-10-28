# com-c9-notify — Thông báo chuông 8 loại

Đọc: `docs/current/community/nghiep-vu.md` §10; chuông kit `notify.enqueue` (pack migration kit 0004).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C9 | Nhanh | Sonnet | community **0003** | C5 (C7/C8 cho sự kiện giá/khớp) |

## Phạm vi
Bảng tuỳ chọn thông báo theo người × loại (community 0003, RLS theo user); 8 loại sự kiện theo bảng §10 (mặc định Bật, trừ digest 8:00 Tắt); bấm mở đúng chỗ (bài + luồng, hoặc form Lưu báo giá); chuông chỉ trong app (không Zalo/SMS/email); người nhận đối tác chỉ nhận loại hợp lệ và nội dung masked. "NCC sửa giá bài đã lưu": gửi cho chủ quản, **không** gửi gì cho NCC (R29). COULD: digest 8:00, nhắc "đối tác chưa đăng nhập 7 ngày" (vòng nền theo tập, đồng hồ giả trong test, không sleep).

## Xong khi
Unit (chọn người nhận theo loại/tuỳ chọn); một int đường chính; một test chặn đọc chéo tenant cho bảng mới. e2e viết không chạy.

## Quyết định trong lúc làm
- **Tuỳ chọn = `community.settings.notify` (0001) — không bảng mới.** 0003 chỉ thêm `posts.expiry_notified_at`, index quét, `settings.digest_on`, hàm DEFINER `community.notify_wanted(jsonb)` (người đăng chạy dưới RLS "hàng của mình" nên không đọc được tuỳ chọn người khác; tenant lấy từ GUC). Vì không có bảng mới nên không thêm test chặn chéo tenant riêng (suite rls-tenant của C3 vẫn xanh).
- **Chuông = kit `notify.enqueue`**, `kind = community.<snake_case>` (ràng buộc chữ thường), `body` = tên người gây ra, `link` = `/posts/<id>[/threads/<orgId>]` (`?quote=1` cho sửa giá). `GET /notifications` + `/read` đọc qua kit `pack-bell` (lọc `source=community`); web đã có sẵn chuông + Cài đặt (C5) nên không đổi.
- **Người nhận**: chủ quản = user nội bộ active có `community-read` hoặc `tenant_admin` (`kit/pack-hosts`). Bình luận: người đăng ⇒ comment, người từng bình luận trong luồng ⇒ reply, trừ chính người viết; đối tác chỉ nhận khi luồng là của công ty mình VÀ còn thấy bài (cùng `audience_ok`/điều kiện RLS, công ty đã rời loại). Tiêu đề trong chuông luôn là bản đã che.
- **Mỗi lần phát = số câu cố định** (ứng viên + tuỳ chọn + một `enqueue` ≤ 500). Hook sẵn trong `post.service` (bài mới, sửa giá). `communityEvents.emitComment(r, {...})` do **C6 gọi** sau khi chèn bình luận (tôi không đụng thread.service/threads.routes).
- **Chưa nối (cổng, vắng ⇒ không phát)**: `matchBuy` cần `HostBookReader` (C8 chưa nối Community) ⇒ cổng `stockMatch`; `priceEdited` cần "bài đã lưu báo giá" (C7: `origin_ref`) ⇒ cổng `savedBy`. Cả hai đã có int với cổng giả; `packs.mount` nối khi C7/C8 vào. Khi khớp hàng, chủ quản nhận matchBuy THAY newBuy.
- **Vòng quét** (`notify.sweep.ts`, mẫu esign-sweep, SKIP LOCKED, không sleep, giờ = tham số): tự lưu trữ bài `active` quá hạn ⇒ `archived` (trước đó chỉ là trạng thái tính `expired`; Bỏ lưu trữ vẫn gia hạn 30 ngày và xoá mốc nhắc); nhắc "còn ≤ 3 ngày" một lần mỗi hạn; digest 8:00 (giờ Hà Nội cố định `Asia/Ho_Chi_Minh`, chưa theo múi tenant) cho chủ quản đã Bật, một lần/ngày, nội dung = số bài đối tác mới 24h + số Cần bán đang mở (chưa có "chưa lưu" vì chờ C7). Bật khi APP_ENV dev/prod và `COMMUNITY_SWEEP` ≠ off.
- Nhắc "đối tác chưa đăng nhập 7 ngày" (COULD): chưa làm.

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §10 cuối đợt.
