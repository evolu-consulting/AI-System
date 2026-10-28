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
- C12a (seed đối tác): `tools/scripts/src/seed-community-demo.ts` (+ `.data.ts`, int test). Gọi service admin-api (`createOrg`/`createOrgUser`) qua import tương đối, actor = demo-owner (hoặc tenant_admin đầu tiên). Dry-run mặc định; `--apply`; `--tenant` mặc định demo, khác demo cần `--force-tenant`; `--out` mật khẩu (mặc định thư mục tạm, 0600, không in). Chỉ user MỚI có mật khẩu (chạy lại không reset; file được gộp).
- C12a: Hưng Thịnh Logistics gắn party_key của `Công ty CP Hưng Thịnh` (SHT demo) — cần xác nhận cùng pháp nhân; Bao bì Phương Nam chưa có trong SHT (null).
- C12b: seed bật gói `community` bằng `enablePack` của admin-api (scope platform, actor = demo-owner); nhãn/nhóm hàng/party_key ghi vào `partner_companies` qua `upsertPartner` (một tx); bài + bình luận qua `post.service`/`thread.service` của hub-api (che liên hệ, RLS, audience D2 chạy thật). Cần `HUB_DATABASE_URL` (vai hub_api) cho phần gói.
- Idempotent: bài định danh (người đăng, tiêu đề); bình luận (luồng, người, nội dung). Dry-run mặc định vẫn chỉ in kế hoạch.
- Bài Thùng phi 200L gửi audience nhóm hàng "Thùng phi" ⇒ chỉ Tân Phát; hai bình luận NCC đều của Tân Phát (đúng ánh xạ C12a, không đổi nhóm hàng). Bài CKS của chủ quản ⇒ người mua nhóm CKS (Hưng Thịnh).
- e2e 3 vai trên stack thật: `e2e/community-web/playwright.stack.config.ts` + `roles.cs.ts` (viết, chưa chạy); mật khẩu từ file `--out` của seed / env, đối tác lần đầu bị buộc đổi mật khẩu (`CS_NEW_PW`).
- qc: đã `test:lock:write` (gồm `tests/acceptance/com-c3/_support/cast.ts` và e2e mới).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-28 (đợt Community)
Không (chỉ ghi bộ seed vào `current/community/README.md` nếu đổi).

## com-prod-seed — seed/grant + e2e deployed trên PRODUCTION (đợt chuẩn bị Community, ab5935f0)
Quyết định: (1) container `tool` đã nạp `/run/s2/app.env` có `DATABASE_URL` (s2_owner), `HUB_DATABASE_URL` (hub_api), `APP_ENV=production` ⇒ KHÔNG đổi compose. (2) `--grant-owner/--grant-editor <u1,u2>` (`seed-community-demo.grant.ts`): sau enablePack, thêm user NỘI BỘ vào Group `community-owner`/`community-editor` bằng một configWrite (audit `membersAudit`, actor hệ thống = actor_id null, config_changed ⇒ Hub nạp lại); idempotent; user ngoài hoặc không tồn tại ⇒ từ chối cả lô. (3) Dòng cuối chỉ in username mới tạo + đường dẫn file; mật khẩu chỉ ở file `--out` (0600); đối tác vẫn must_change_password. (4) e2e deployed: `e2e/community-web/playwright.deployed.config.ts` + `deployed.support.ts`, `CS_READONLY=1` bỏ bước đăng bình luận của test NCC, trace/screenshot/video tắt, mật khẩu mới ghi ngược vào file cred; `test-all.discover` loại `*.deployed.config.ts`.

### Runbook (CHỈ chạy khi người dùng xác nhận)
1. Dry-run trên prod (không ghi): 
   `ssh -i F:\workspace\id_evoc_key evoc@149.202.83.5 "cd ~/workspace/sohoptac2 && docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/seed-community-demo.ts --out /claude-home/community-demo-partners.json --i-know-prod --grant-owner demo-owner --grant-editor demo-editor"`
2. Áp thật: như trên, thêm `--apply` (lặp lại được; chỉ user mới có mật khẩu). `/claude-home` = `~/workspace/sohoptac2/claude-home` trên host.
3. Lấy file về máy (PowerShell), rồi xoá bản trên server:
   `scp -i F:\workspace\id_evoc_key evoc@149.202.83.5:workspace/sohoptac2/claude-home/community-demo-partners.json F:\workspace\secrets\community-demo-partners.txt`
   `ssh -i F:\workspace\id_evoc_key evoc@149.202.83.5 "shred -u ~/workspace/sohoptac2/claude-home/community-demo-partners.json ~/workspace/sohoptac2/claude-home/community-demo-partners.json.community.json"`
   (file định dạng JSON `{tenant, users:{username:mật khẩu}}`; đuôi .txt không quan trọng — chỉ cần cùng định dạng khi đọc.)
4. e2e deployed (local, chỉ đọc):
   `$env:CS_CRED_FILE='F:\workspace\secrets\community-demo-partners.txt'; $env:CS_NEW_PW='<mật khẩu mới, ≥ tối thiểu của hệ thống>'; $env:CS_OWNER_CRED_FILE='F:\workspace\secrets\DEMO_CREDENTIALS.txt'`
   `bun tools/scripts/src/run-playwright.ts e2e/community-web/playwright.deployed.config.ts`
   (hoặc `$env:CS_OWNER_PW` thay `CS_OWNER_CRED_FILE`). Sau lần chạy đầu, file cred giữ mật khẩu mới của đối tác ⇒ chạy lại được; sau đó xoá `Remove-Item Env:CS_NEW_PW,Env:CS_OWNER_PW`.
Việc chưa làm trong lát: e2e deployed chưa chạy (cần prod đã seed); `demo-editor` phải là username thật của tenant demo (dry-run/apply báo lỗi nếu không có).
Kiểm: unit `seed-community-demo.grant.test.ts`, `community-deployed-support.test.ts`; int `seed-community-demo.int.test.ts` (grant idempotent + từ chối ngoài) xanh; qc relock xong (`test:lock:verify` OK).