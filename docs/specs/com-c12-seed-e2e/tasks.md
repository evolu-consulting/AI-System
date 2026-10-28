# com-c12-seed-e2e — Seed demo + e2e 3 vai (chạy MỘT lần cuối đợt)

Đọc: `docs/current/community/README.md` (dữ liệu seed), `hien-thi.md` (bộ nhân vật); seed hiện có của tenant `demo`.
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C12 | Nhanh | Sonnet (Haiku cho phần cơ học) | — | C3 (chạy song song C4–C11) |

## Phạm vi
**Tenant `demo` có sẵn** (Công ty demo; không tạo tenant NITI, quyết định CR-102 2026-10-28): demo-owner Nguyễn Văn An = Admin chủ quản, demo-editor Lê Quốc Cường = Thành viên chủ quản. Seed thêm (idempotent, dev/test): công ty đối tác NCC S1 = Cơ sở Tân Phát (2 user), NCC S2 = Hãng NCCA, 2 người mua (nhóm hàng đóng gói / chữ ký số), 1 công ty `both`; bài mẫu: Thùng phi 200L, Băng keo 5cm, Chữ ký số DN – USB Token, Chữ ký số HSM, Hoá đơn điện tử (Viettel S-Invoice) — dùng SP đã có trong SHT demo, không tạo SP trùng. Mật khẩu test lưu trong file seed/example-config, không ghi vào chat/docs. e2e Playwright 3 vai (chủ quản / NCC / người mua) theo `hien-thi.md`: đăng bài, người xem, luồng riêng, che liên hệ, Lưu báo giá, NCC không thấy dấu lưu — **viết sẵn, KHÔNG chạy trong lát**; cấu hình dưới `e2e/**/playwright*.config.ts`.

## Xong khi
Seed chạy được trên DB trống + DB đã có demo (chạy lại không lỗi); typecheck file e2e. e2e + UAT chạy một lần cuối đợt bởi điều phối.

## Quyết định trong lúc làm
<!-- agent điền -->
- C12b: seed bật gói `community` bằng `enablePack` của admin-api (scope platform, actor = demo-owner); nhãn/nhóm hàng/party_key ghi vào `partner_companies` qua `upsertPartner` (một tx); bài + bình luận qua `post.service`/`thread.service` của hub-api (che liên hệ, RLS, audience D2 chạy thật). Cần `HUB_DATABASE_URL` (vai hub_api) cho phần gói.
- Idempotent: bài định danh (người đăng, tiêu đề); bình luận (luồng, người, nội dung). Dry-run mặc định vẫn chỉ in kế hoạch.
- Bài Thùng phi 200L gửi audience nhóm hàng "Thùng phi" ⇒ chỉ Tân Phát; hai bình luận NCC đều của Tân Phát (đúng ánh xạ C12a, không đổi nhóm hàng). Bài CKS của chủ quản ⇒ người mua nhóm CKS (Hưng Thịnh).
- e2e 3 vai trên stack thật: `e2e/community-web/playwright.stack.config.ts` + `roles.cs.ts` (viết, chưa chạy); mật khẩu từ file `--out` của seed / env, đối tác lần đầu bị buộc đổi mật khẩu (`CS_NEW_PW`).
- qc: đã `test:lock:write` (gồm `tests/acceptance/com-c3/_support/cast.ts` và e2e mới).

## Delta (so với docs/current)
Không (chỉ ghi bộ seed vào `current/community/README.md` nếu đổi).
