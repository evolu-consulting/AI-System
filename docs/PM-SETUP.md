# PM-SETUP · Chạy AI System trên Windows để test CR-112 và CR-113

Dành cho PM: clone, chạy một lệnh, đăng nhập bằng tài khoản mẫu, test theo checklist. Không cần dựng dữ liệu tay. Chi tiết kỹ thuật: `docs/guides/local-setup.md`. Chỉ dùng trên máy cá nhân.

## 1. Cần cài (một lần)

| Công cụ | Ghi chú |
|---|---|
| Git | clone repo |
| Bun 1.3 trở lên | https://bun.sh (kiểm: `bun --version`) |
| Docker Desktop | chạy Postgres 16 + Redis 7. Máy đã có Postgres :5432 và Redis :6379 thì bỏ qua |
| PowerShell 5.1+ | có sẵn trên Windows 10/11 |

## 2. Chạy

```powershell
git clone https://github.com/evolu-consulting/AI-System.git
cd AI-System
git checkout platform/gd0
bun run pm:setup
```

`pm:setup` (= `scripts\dev-up.ps1 -SeedDemo`) tự làm, chạy lại an toàn:
1. `bun install`; tạo `.env.local` từ `.env.example` bằng `bun run keys:dev` (khoá và mật khẩu admin tự sinh, không commit, không in).
2. Bật Postgres + Redis (`docker compose up -d --wait`) nếu chưa chạy.
3. Migrate + seed: tenant `platform`, tenant `evolu` + 5 user, gói Sổ Hợp Tác / Community, fixture công ty, tenant `demo` + dữ liệu mẫu.
4. Seed CR-112/113 cho `evolu` (mục 4) rồi bật 5 web.

Lần đầu 3 đến 6 phút (cài + migrate), lần sau khoảng 30 giây. Không cần chạy `bun run dev` riêng (lệnh đó không truyền địa chỉ Hub cho web nên thiếu menu Quy trình). Tắt: `bun run pm:down`. Làm lại từ DB trắng: `bun run pm:reset` (mất dữ liệu dev).

| App | URL |
|---|---|
| ai-admin (quản trị) | http://localhost:3000 |
| Chat | http://localhost:3100 |
| Studio | http://localhost:3200 |
| Sổ Hợp Tác (contracts-web) | http://localhost:3300 |
| Community | http://localhost:3400 |
| admin-api / hub-api | http://localhost:3001 · http://localhost:4000 |

## 3. Tài khoản

Mật khẩu `evolu` là mật khẩu dev cố định của fixture (`tools/hub-dev/src/fixture.ts`).

| Mã công ty | Tài khoản | Mật khẩu | Vai |
|---|---|---|---|
| `platform` | `admin` | `SEED_ADMIN_PASSWORD` trong `.env.local` | platform admin (ai-admin toàn hệ thống) |
| `evolu` | `julian.bui` | `1234567890` | tenant_admin, **Toàn quyền** Sổ Hợp Tác (chủ gói). Không thuộc nhóm duyệt nào |
| `evolu` | `thomas.tran`, `vio.ngo` | `1234567890` | Nhân viên; Phòng Kế toán = người duyệt **bước 1** |
| `evolu` | `edgar.nguyen`, `rowan.nguyen` | `1234567890` | Nhân viên; Phòng Pháp chế = người duyệt **bước 2** |
| `demo` | `demo-owner` | `DEMO_OWNER_PW` trong `.env.local` | chủ gói tenant demo (dữ liệu giống prod) |

## 4. Dữ liệu CR-112/113 đã seed (tenant `evolu`)

- **Vai theo app (CR-112):** 3 vai mỗi app (Toàn quyền / Nhân viên / Chỉ xem) cho Sổ Hợp Tác, Community, DLC.
- **Quy trình duyệt HĐ "Duyệt HĐ 2 cấp (mẫu CR-113)"**, đã gán cho `evolu`: bước 1 "Kế toán duyệt" hạn 24 giờ, **không đặt nhóm chuyển cấp** (mặc định chuyển về Toàn quyền); bước 2 "Pháp chế duyệt" hạn 48 giờ, chuyển cấp tường minh về nhóm Nhân viên.
- **3 hợp đồng mẫu** (tiêu đề bắt đầu bằng `[CR-113]`), tạo qua đường thật của hub: (1) chờ bước 1; (2) bước 1 do Toàn quyền duyệt thay, đang ở bước 2; (3) bước 1 quá hạn. HĐ (3) được **vòng nhắc của hub chuyển cấp về Toàn quyền trong tối đa 5 phút** sau khi hub bật; hiện "Đã chuyển cho …" sau đó, tải lại trang.

## 5. Checklist test

**CR-112 · ai-admin (http://localhost:3000, đăng nhập `platform` / `admin`)**
1. Menu Công ty, chọn **Evolu** → tab **Ứng dụng & Gói** → thấy thẻ Sổ Hợp Tác và Community, mỗi thẻ ghi "Gói đang bật 3 vai 5 người" (DLC không có thẻ app riêng ở tab này).
2. Tab **Phân quyền** → mỗi app có 3 vai (Toàn quyền, Nhân viên, Chỉ xem) với mức Quản trị / Sửa / Xem; `julian.bui` ở vai Toàn quyền.
3. Bấm **Tạo vai** cho Sổ Hợp Tác (tên "Kiểm soát", mức Xem), gán `rowan.nguyen`, Lưu → vai mới hiện; xoá vai này (đang có người thì nút "Xoá vai" bị khoá, không báo lỗi; gỡ người, Lưu rồi xoá được).
4. Đăng xuất, đăng nhập `evolu` / `julian.bui` → chỉ thấy công ty mình, không có nhóm Nền tảng; mở tab Người dùng, Phân quyền được.
5. Quay lại `platform`, **Thêm công ty** → wizard 4 bước (Thông tin, Ứng dụng & Gói, Phân quyền & Người dùng, Xem lại); mã trùng `evolu` báo "Mã công ty đã được dùng" ngay dưới ô mã ở bước 1 (ô đỏ, không có hộp cảnh báo).

**CR-113 · Sổ Hợp Tác (http://localhost:3300)**
1. Đăng nhập `evolu` / `julian.bui` → **Cài đặt › Quy trình duyệt**: thấy sơ đồ 2 bước; node bước 1 ghi "Quá hạn ⇒ chuyển … (mặc định)" (về Toàn quyền), node bước 2 ghi "Quá hạn ⇒ chuyển …" không kèm "(mặc định)" (nhóm tường minh); hộp **Luật duyệt** dưới sơ đồ nêu hai luật (Toàn quyền duyệt thay được mọi bước; quá hạn tự chuyển cấp).
2. Mở HĐ `[CR-113] HĐ chờ duyệt bước 1` (vẫn là `julian.bui`) → mục "Các bước duyệt": bước 1 "Đang chờ duyệt"; `julian.bui` có nút **Xác nhận và lưu** dù không thuộc Kế toán (bước 1 là bước xác nhận; "Đạt / Trả lại" chỉ có từ bước 2). Chưa bấm.
3. Mở HĐ `[CR-113] HĐ do Toàn quyền duyệt thay bước 1` → bước 1 có huy hiệu **Duyệt thay · Toàn quyền**, bước 2 đang chờ Pháp chế.
4. Đăng xuất, đăng nhập `thomas.tran`, mở HĐ chờ duyệt bước 1 → điền các ô bắt buộc (Tên hợp đồng, Nhà cung cấp, Hiệu lực từ; HĐ mẫu chưa có) rồi bấm **Xác nhận và lưu** (không có nút "Đạt" ở bước 1) → bước 1 đã duyệt **không** có huy hiệu duyệt thay (người của bước), bước 2 mở cho Pháp chế.
5. Mở HĐ `[CR-113] HĐ quá hạn bước 1…` → huy hiệu **Quá hạn**; sau tối đa 5 phút tải lại: thêm **Đã chuyển cho …** (nhóm Toàn quyền). `julian.bui` quyết bước này không còn là "duyệt thay" (đã thuộc nhóm của bước).
6. ai-admin › Quy trình › Thư viện › mẫu "Duyệt HĐ 2 cấp (mẫu CR-113)": bấm "Danh sách" ở nút **Cách xem** (không phải Sơ đồ) → có hộp **Luật duyệt** nêu hai luật. Dòng "(mặc định)" của node bước 1 nằm ở Sổ Hợp Tác (bước 1 phía trên), không ở ai-admin.
(Checklist trên được e2e `e2e/pm-checklist` chạy từng bước trên stack thật: `run-tests.ps1 -Step e2e -Filter pm-checklist-pm -All`.)
Muốn chạy lại các HĐ mẫu về trạng thái ban đầu: `bun run pm:reset`.

## 6. Lỗi hay gặp

- `Có phiên dev-up đang chạy`: chạy `bun run pm:down` trước.
- `db:setup lỗi (migrate-guard lệch …)`: DB cũ từng chạy nhánh khác; dùng `bun run pm:reset`.
- Cổng 3000 đến 3400 / 3001 / 4000 bị chiếm: tắt tiến trình đang giữ cổng rồi chạy lại.
- Docker Desktop chưa chạy: mở Docker Desktop, chờ biểu tượng xanh, chạy lại `bun run pm:setup`.
- ai-admin không có menu **Quy trình**: không chạy bằng `pm:setup` (xem mục 2) hoặc hub vừa khởi động lại; tải lại trang (F5).
- Seed CR-113 báo lỗi: xem `.data\dev-up\core.log`; sửa xong chạy lại `bun run seed:cr113` (lặp lại được).
- Ngoài phạm vi tài liệu này: gói DLC (do Rowan phụ trách), AI thật (Claude CLI/API), ký số thật.
