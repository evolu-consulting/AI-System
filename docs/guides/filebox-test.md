# Hướng dẫn test FileBox (đính kèm + output tiến trình)

Dành cho người dùng kiểm tay tích hợp **FileBox** (kho file ngoài, nền MinIO) làm driver đính kèm. Nguồn: [`docs/specs/FB1-filebox-attachments/spec.md`](../specs/FB1-filebox-attachments/spec.md), [ADR-0015](../adr/0015-filebox-external-file-storage.md). Mọi lệnh chạy ở gốc repo `D:\AI\ai-system`.

> **Bí mật — đọc trước:** `filebox.env` (chứa key thật) và `filebox.crt` ở `D:\AI\Filebox-INTEGRATION` là **secret thật**: không commit, không log, không đưa vào URL. `.env.local` (chứa `FILEBOX_TOKEN`) cũng **không commit** (đã gitignore).

---

## 1. Chuẩn bị (một lần)

1. **Docker Desktop** đang chạy (script tự dựng Postgres/Redis/Mailpit).
2. **Tin chứng chỉ tự ký** của FileBox để trình duyệt + Node tin server `149.202.83.5`:
   - Trình duyệt (Windows): double-click `D:\AI\Filebox-INTEGRATION\filebox.crt` → **Install Certificate** → **Local Machine** → **Trusted Root Certification Authorities** → Finish.
   - Hub (Bun) **không cần** bước trình duyệt — nó pin cert qua biến `FILEBOX_CA` (mục 2).
3. **Mạng:** cho phép ra `149.202.83.5:9443` (v1 chỉ cần cổng này; không cần `:9000`).
4. Lần đầu: `bun install`.

Kiểm nhanh server sống (không cần key):
```
curl -k -sS -o /dev/null -w "%{http_code}\n" https://149.202.83.5:9443/docs      # mong đợi 200
```

---

## 2. Cấu hình `.env.local`

Chạy `./initial.sh` một lần — nó chèn sẵn **khối FileBox (bị chú thích)** vào `.env.local`. Mở `.env.local`, **bỏ dấu `#`** và điền:

```
HUB_ATTACH_DRIVER=filebox
FILEBOX_URL=https://149.202.83.5:9443
FILEBOX_ORG=ai-system
FILEBOX_CA=D:/AI/Filebox-INTEGRATION/filebox.crt
FILEBOX_TOKEN=<Filebox key — lấy trong D:/AI/Filebox-INTEGRATION/filebox.env, KHÔNG commit>
```

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `HUB_ATTACH_DRIVER` | ✅ | `filebox` để dùng FileBox; `local` để quay lại kho đĩa cũ |
| `FILEBOX_URL` | ✅ | `https://149.202.83.5:9443` (https bắt buộc trừ loopback) |
| `FILEBOX_ORG` | ✅ | Nhãn tổ chức dùng chung (hằng, vd `ai-system`) — mọi tenant chung một org; cách ly tenant do RLS bảng đính kèm, **không** dựa FileBox |
| `FILEBOX_CA` | ✅ (prod https) | Đường dẫn `filebox.crt` để pin cert tự ký; thiếu ⇒ TLS fail |
| `FILEBOX_TOKEN` | ✅ | Filebox key (`Authorization: Bearer`). **Secret.** Vắng ⇒ Hub fail-closed |
| `FILEBOX_TIMEOUT_MS` | — | Trống = 30000 |

Nếu muốn **test tiến trình bằng agent thật** (mục 5), thêm:
```
HUB_PROCESS_ENGINE=on
HUB_SEED_PROFILE=claude-sub-1
```
(Để trống `HUB_SEED_PROFILE` ⇒ mặc định `fake-1` — nhưng `#fake:` đã gỡ khỏi seed nên fake-cli không còn phát mục; dùng `claude-sub-1`.)

---

## 3. Khởi động

```
./start.sh --kill-orphan
```
`--kill-orphan` dọn tiến trình cũ còn giữ `:4000/:3001` (quan trọng: Hub đọc `.env.local` **một lần lúc khởi động**, nên đổi env phải khởi động lại). Chờ `[combine] sẵn sàng`.

| App | URL |
|---|---|
| Chat | http://localhost:3100 |
| Hub | http://localhost:4000 |
| FileBox web | https://149.202.83.5:9443 (org `ai-system`) |

Đăng nhập Chat: tenant `evolu`, user `julian.bui` / `1234567890`.

> Đổi `HUB_SEED_PROFILE` xong phải khởi động lại để hub-dev **reseed** agent theo profile mới.

---

## 4. Test A — đính kèm trong chat

1. Trong một phòng, **gửi tin nhắn kèm một file mới** (ảnh/PDF/txit nhỏ).
2. **Tải lại chính file đó:**
   - Bấm tải trong UI (fetch) ⇒ ra **bytes inline** ngay.
   - Hoặc dán thẳng URL `/attachments/<id>/content` vào thanh địa chỉ (navigate) ⇒ **302** sang `149.202.83.5:9443/d/…` ⇒ cần đã tin `filebox.crt` (mục 1).
3. Mở **FileBox web** → thấy file dưới org `ai-system`.

✅ **Đạt:** upload không lỗi, tải lại ra đúng nội dung, file hiện trên FileBox.

> File đính kèm **cũ** (tạo trước khi bật driver `filebox`) có `filebox_file_id = NULL`, nằm trên đĩa local — **không** phục vụ khi đang chạy `filebox` (đúng thiết kế). Chỉ test với file **mới**.

---

## 5. Test B — output tiến trình lên FileBox

Cần `HUB_PROCESS_ENGINE=on` (mục 2). Tenant `evolu` được cấp 2 template: `sdlc-delivery`, `bug-fix`.

Trong phòng, gõ:
```
!sdlc-delivery Thêm tính năng xuất CSV cho báo cáo
```
- Bước **"Chốt phạm vi"** (agent `intake-analyst`) chạy → sinh file output **`scope.md`** → **lưu lên FileBox** → tiến trình dừng ở chốt review.
- Mở/tải `scope.md` từ luồng run ⇒ tải từ FileBox. Kiểm trên FileBox web.

✅ **Đạt (cho FB1):** file output xuất hiện và tải được từ FileBox. (Đường lưu output dùng **cùng** lệnh `POST /files` như đính kèm chat.)

### Agent thật báo "cần quyền truy cập repo / KnowledgeHub"
Các agent `.claude/agents/*` được viết để **đọc repo/KnowledgeHub**, nhưng trong Process Engine runtime chúng **không có công cụ đọc file**, nên nội dung output có thể là lời "thiếu quyền truy cập". Điều này **không chặn** việc test FileBox — file `scope.md` vẫn được tạo và đẩy lên FileBox như thường (ta đang test đường lưu file, không phải chất lượng nội dung agent).

Muốn nội dung có nghĩa thì cần cấp **nguồn (`sources`)** cho stage hoặc kết nối KnowledgeHub — đó là phạm vi P-c/KnowledgeHub, **ngoài** FB1. Nếu chỉ cần output tất định để test đường file, tạm đặt lại `HUB_SEED_PROFILE=fake-1` **và** khôi phục `#fake:` (`git revert 17e6b3a4`).

---

## 6. Sự cố thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Trình duyệt không mở `https://149.202.83.5:9443` | Cert tự ký chưa tin | Import `filebox.crt` (mục 1) hoặc *Advanced → Proceed* |
| `/attachments/:id/content` **500**, log `filebox network error` (~7s) | TLS fail — `FILEBOX_CA` sai/thiếu, hoặc Hub khởi động trước khi đặt env | Kiểm `FILEBOX_CA` trỏ đúng `filebox.crt`; khởi động lại `./start.sh --kill-orphan` |
| **500**, log `filebox post <mã>` (vd 401/403) | Token sai/thiếu | Kiểm `FILEBOX_TOKEN` trong `.env.local` khớp `filebox.env`; khởi động lại |
| Upload OK nhưng file cũ tải **404** | File cũ là hàng `local` (`filebox_file_id NULL`) | Test bằng file **mới** (mục 4 ghi chú) |
| Hub không mở route file | `HUB_ATTACH_DRIVER` sai, hoặc thiếu biến `FILEBOX_*` | Xem log khởi động Hub (`fail: env`); điền đủ mục 2 |

**Xem log Hub:** `.data/logs/combine.log` — lọc dòng `attachment-*`, `filebox`, `error_name`.

**Kiểm nhanh cấu hình đang chạy** (token ẩn):
```
grep -E '^(HUB_ATTACH_DRIVER|FILEBOX_URL|FILEBOX_ORG|FILEBOX_CA|HUB_PROCESS_ENGINE|HUB_SEED_PROFILE)=' .env.local
```

---

## 7. Quay lại kho local (nếu cần)

Đặt `HUB_ATTACH_DRIVER=local` + `HUB_ATTACH_DIR=D:/AI/ai-system/.data/attachments` trong `.env.local`, bỏ/để trống các `FILEBOX_*`, rồi `./start.sh --kill-orphan`. File đính kèm mới lại lưu trên đĩa như trước.
