# Hướng dẫn test tích hợp 3 app (X1-combine)

Dành cho người dùng kiểm tay toàn luồng Chat + Admin + Studio (Hub). Nguồn: `docs/specs/X1-combine/spec.md` §6–§7. Mọi lệnh chạy ở gốc repo `D:\AI\ai-system`.

## 1. Chuẩn bị
1. Docker Desktop đang chạy (script tự dựng Postgres, Redis, Mailpit).
2. Có `.env.local`: chép từ `.env.example` rồi điền `SEED_ADMIN_PASSWORD` (mật khẩu `platform_admin` dev). Không commit file này.
3. `bun install` (lần đầu), rồi `bun run db:migrate`.

## 2. Bật stack
```
bun run combine:dev
```
Chờ dòng `[combine] sẵn sàng`. Bảng URL:

| App | URL |
|---|---|
| Chat | http://localhost:3100 |
| Admin | http://localhost:3000 |
| Studio | http://localhost:3200/studio/ |
| admin-api | http://localhost:3001 |
| Hub | http://localhost:4000 |
| Dify mock | http://localhost:5001/v1 (secret `mk-ok`) |

**User mẫu** (mật khẩu dev `dev-password-1`; script cũng in danh sách này): tenant `acme` có `lan`, `hoa`, `minh` (nếu chưa có thì tạo ở S2); tenant `beta` có `an`; `khoa` bị khoá. `tenant_admin` của tenant là `tadmin` (mật khẩu tạm, đổi lần đầu). `platform_admin`: tenant `platform`, user `admin`, mật khẩu = `SEED_ADMIN_PASSWORD`.

**Runtime WSL** (bắt buộc cho chat Orchestrator, agent `claude-sub` và agent `dify-chatbot`; provider `AGENT_RT_PROVIDERS=claude-sub,dify`):
- Cách 1: tắt stack, chạy lại `COMBINE_WSL=1 bun run combine:dev` (tự chạy Runtime qua `wsl.exe`).
- Cách 2: làm theo lệnh `combine:dev` in ra (lưu `rt.sh`, chạy `wsl.exe -d Ubuntu -u worker -- bash -l -s < rt.sh`).
- Điều kiện WSL (user `worker` đã `claude` login, venv...): `docs/guides/hub-dev.md` mục "Runtime trong WSL".
- Chờ log `runtime.ready`. Mỗi tin khoảng 10 giây.

## 3. Seed Dify thật (tuỳ chọn, cho S4/S6/S8/S10)
Quan trọng: dùng các app Dify **có sẵn**. Seed chỉ gọi admin-api/Hub của repo này, **không tạo, không sửa flow Dify** và không gọi Dify.

1. Trỏ `DIFY_SEED_ENV_FILE` tới file env chứa `DIFY_API_URL` và các `DIFY_KEY_*` (xem `docs/guides/hub-dev.md`, bộ cấu hình auto-pilot). Đừng chép key vào repo.
2. Dry-run (mặc định, không ghi, không in key):
   `DIFY_SEED_ENV_FILE=<đường dẫn> bun run seed:dify`
3. Xem kế hoạch rồi áp dụng: `DIFY_SEED_ENV_FILE=<đường dẫn> bun run seed:dify -- --apply` (chạy lại nhiều lần vẫn như một lần).
4. Kết quả: 5 workflow `dify-*`, 5 secret `DIFY_KEY_*`, lệnh `/translate <lang> <text>`, `/summary`, `/reply`, `/ask-image`, agent `dify-chatbot`, group `dify-demo` (tenant `acme`, có thể đổi bằng `--tenant`). Thêm user vào group `dify-demo` để dùng.
5. Tên trường output của workflow là **giả định**. Nếu lệnh trả kết quả rỗng: Admin, Workflows, mở workflow, sửa "Output" cho khớp tên trường thật của app.

## 4. Kịch bản test
Dify mock có sẵn trong stack; "thật" nghĩa là sau khi seed. Mỗi kịch bản: làm gì, kỳ vọng.

### S1. Đăng nhập 3 app
- Admin: đăng nhập `platform` / `admin`. Chat: `acme` / `lan`. Studio: `platform_admin`.
- Kỳ vọng: vào được cả 3; user mật khẩu tạm bị buộc đổi mật khẩu lần đầu; user `khoa` bị từ chối; `tenant_admin`/`member` vào Studio bị 403.

### S2. Quản trị tenant, user, group, quyền (Admin, platform_admin)
- Tạo tenant, user, group. Cấp feature và command cho group. Mở group, tab **Agent**: cấp agent, thêm user vào group.
- Mở "Kiểm tra quyền" (Quyền hiệu lực) của một user.
- Kỳ vọng: cấp/thu hồi lặp lại không lỗi; phần Agent trong Quyền hiệu lực khớp group; lỗi từ Hub hiển thị câu dễ hiểu.

### S3. Chat thường (Chat, `lan`; cần Runtime WSL)
- Gửi một câu hỏi. Thử Huỷ giữa chừng. Tải lại trang để kết nối lại. Gửi liên tiếp nhiều tin để chạm giới hạn.
- Kỳ vọng: chữ chảy dần qua Orchestrator; huỷ dừng đúng; lịch sử còn; vượt giới hạn hiện 429 `TOO_MANY_RUNS` với đếm ngược, hết giờ nút gửi mở lại.

### S4. `/lệnh` (Chat)
- Gõ `/`: menu chỉ gồm lệnh user được dùng; chọn + Enter điền composer. Gõ `/translate vi hello` (mock; sau seed là Dify thật).
- Thử: thiếu tham số; `/abc` (lệnh sai); `//abc`.
- Kỳ vọng: có kết quả; thiếu tham số báo `CMD_MISSING_ARG`; lệnh sai báo `CMD_NOT_FOUND` kèm tối đa 3 gợi ý; `//abc` gửi nguyên chữ `/abc`.

### S5. `@agent` (Chat; cần Runtime WSL)
- Gõ `@`: menu agent được cấp. Thử `@<agent> câu hỏi`, `@@abc`, gắn nhiều tag, tag sai.
- Kỳ vọng: người trả lời hiện tên agent thay cho "Consultant"; `@@abc` gửi chữ `@abc`; tag sai báo `AGENT_NOT_FOUND`.

### S6. Đính kèm (Chat)
- Đính kèm file hợp lệ, file quá lớn, file sai loại; mở lại hội thoại cũ có file đã hết hạn. Seed xong thử `/ask-image <câu hỏi>` kèm ảnh.
- Kỳ vọng: chip hiện tên file; quá lớn/sai loại báo lỗi `ATTACHMENT_*` tiếng Việt; file không còn hiện chip xám; `/ask-image` trả lời theo ảnh.

### S7. Xác nhận side_effect (Admin + Chat; cần Runtime WSL)
Chỉ áp cho **tool do agent gọi**.
1. Admin, Workflows: tạo workflow `mock-send` (`base_url` `http://localhost:5001/v1`, secret `mk-ok`; tạo secret này ở mục Secrets nếu chưa có), bật cờ `side_effect`.
2. Gắn `mock-send` làm tool cho một agent loại `agentic-cli` (Studio hoặc cấu hình agent), cấp agent cho group của `lan`.
3. Chat: hỏi agent đó một việc cần gửi.
- Kỳ vọng: Chat hiện thẻ hỏi **Đồng ý / Huỷ**; Đồng ý thì chạy, Huỷ thì không.
- Gõ thẳng `/mock-send ...` thì chạy luôn, không hỏi (HUB-FR-95: xác nhận chỉ áp cho tool agent gọi).

### S8. Chạy thử lệnh (Admin, chỉ platform_admin)
- Admin, Commands, mở bản nháp (chưa lưu), bấm Chạy thử. Với workflow `side_effect` sẽ có hộp xác nhận, chọn "Vẫn chạy".
- Kỳ vọng: thấy kết quả, thời gian, lỗi; không lưu gì; tenant_admin không thấy nút; Hub tắt thì báo 502 dễ hiểu. Làm thêm 1 lần với Dify thật.

### S9. Studio (platform_admin)
- Admin, thấy nút "⇄ Agent Studio" (chỉ platform_admin). Bấm, sửa một agent hoặc Orchestrator, lưu. Quay lại Chat, tải lại, mở menu `@`.
- Kỳ vọng: menu `@` phản ánh thay đổi (tên/mô tả).

### S10. Dify thật (sau seed)
- Mỗi app **đúng 1 lần**: chatbot (`@dify-chatbot`, cần Runtime), `/translate`, `/summary`, `/reply`, `/ask-image`.
- Kỳ vọng: kết quả có nội dung; nếu rỗng xem mục 3.5. Smoke tự động chỉ chạy khi đặt `DIFY_LIVE=1` (theo `hub-dev.md`), mỗi app 1 lần.

## 5. Giới hạn đã biết
- H3c (quota/chi phí) tạm dừng: chưa có.
- H4b chưa có: Studio chưa quản Models, Secrets, quyền agent (cấp quyền agent làm ở Admin).
- Flow Dify riêng cho chat để mốc X1b.
- File docx/xlsx: agent CLI chỉ thấy tên file.
- File do agent tạo chỉ hiện sau khi tải lại lịch sử.
- Seed gặp lệnh trùng tên/alias chỉ cảnh báo và bỏ qua.

## 6. Dừng
Ctrl+C ở cửa sổ `combine:dev` (dừng đúng các tiến trình đã bật). Runtime WSL tự chạy tay: `wsl.exe -d Ubuntu -u worker -- pkill -TERM -f "python -m agent_runtime"`.
