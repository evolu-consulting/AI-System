# Luật dùng bộ component chung (CR-177)

Máy chặn: `bun run check:ui-kit` (số `<button>`/`<select>`/`<input>` trần, `title=`, `components/ui` riêng, `text-[13px]`/`rounded-[9px]` chỉ được giảm).

## Xác nhận — 4 mức
- Đổi lại được ⇒ làm ngay + `toastUndo` 6 s. Đúng: xoá ghi chú rồi «Hoàn tác». Sai: hỏi «Bạn chắc chứ?».
- Cần nhập thêm ⇒ `InlineConfirm` ngay tại chỗ. Đúng: từ chối + ô «Lý do». Sai: mở dialog chỉ để có một ô nhập.
- Người khác thấy / khó rút lại ⇒ `Dialog` ngắn, nút ghi đúng hành động. Đúng: «Gửi duyệt». Sai: «OK»/«Có».
- Mất dữ liệu ⇒ `AlertDialog` danger, focus mặc định ở «Giữ lại». Đúng: «Xoá hợp đồng» / «Giữ lại». Sai: focus ở nút xoá.

## Nút
- Ba dạng: chỉ icon · icon + chữ · chỉ chữ. Không dạng khác.
- Icon một mình bắt buộc `aria-label` + `Tooltip`. Đúng: `<Button size="icon" aria-label="Đóng"><X/></Button>` trong Tooltip. Sai: `<button title="Đóng">✕</button>`.
- Icon lấy từ `icons.ts` theo khái niệm. Đúng: `ICONS.remove`. Sai: import `Trash`/`Trash2`/`X` tuỳ chỗ, hoặc emoji 🗑.
- Một nút chính (`primary`) mỗi màn. Đúng: «Gửi duyệt» primary, còn lại outline/quiet. Sai: hai nút primary cạnh nhau.
- Hàng nút cùng cỡ, cùng có hoặc cùng không icon. Sai: «Lưu» có icon, «Huỷ» không.
- Không có quyền ⇒ khoá + lý do: `<Button disabledReason="Chỉ Giám đốc duyệt được">`. Vai không bao giờ có ⇒ ẩn hẳn.
- Dùng `Button`/`Select`/`Input` của kit. Sai: `<button className="…">` trần.
- Tooltip bằng `Tooltip` của kit. Sai: `title="…"` trên thẻ HTML.

## Avatar
- Người ⇒ tròn; công ty ⇒ vuông bo. Cỡ chỉ 24/32/40.
- Nhóm tối đa 3 + «+N». Đúng: `<AvatarGroup people={…} />`. Sai: tự xếp 5 avatar chồng nhau.

## Badge
- 1–2 badge mỗi dòng; luôn có icon + chữ (không chỉ màu). Đúng: `<Badge status="ok" icon={<Check/>}>Đã duyệt</Badge>`.
- Bảng màu cố định `ok|warn|bad|info|idle`. Sai: tự đặt `bg-green-100`.

## Cỡ chữ, bo góc
- Cỡ chữ chỉ `text-xs … text-2xl`; bo góc chỉ `rounded-sm|md|lg`. Đúng: `text-sm rounded-md`. Sai: `text-[13px] rounded-[9px]`.
