# tools/hub-dev — môi trường dev Hub (`bun run hub:dev`)

Dựng: migrate → admin-api (:3001) → user fixture → phòng mẫu → `hub:seed` → hub-api (:4000) → agent-runtime. Chi tiết: `docs/guides/hub-dev.md`.

| File | Vai trò |
|---|---|
| `dev.ts` | điều phối (`startHubDev`, `fixtureStep`, `roomsStep`) |
| `fixture.ts` | tenant/user qua admin-api (idempotent): contract (`acme`, `beta`) + demo `evolu` |
| `fixture-rooms.ts` | phòng chat mẫu (X2a B8), ghi qua `hub.create_room` + owner DB, idempotent |
| `dify-mock.ts` · `combine.ts` | mock Dify · chạy Combine |

## Tài khoản
Contract (`acme`/`beta`): mật khẩu `dev-password-1` — `lan`, `hoa`, `an` (beta), `khoa` (khoá).

Demo tenant `evolu` — mật khẩu `1234567890`:
| username | Tên | Vai trò |
|---|---|---|
| `julian.bui` | Julian Bui | tenant_admin |
| `thomas.tran` | Thomas Tran | member |
| `vio.ngo` | Vio Ngo | member |
| `edgar.nguyen` | Edgar Nguyen | member |
| `rowan.nguyen` | Rowan Nguyen | member |

Platform (`platform`): `admin` / `1234567890` (email `admin@evolu.com`, đặt bởi `initial.sh` vào `.env.local`).
Agent demo evolu (CR-051): `@consultant` (Evolu Consultant — mặc định khi có CR-053) · `@invoices` (hoá đơn FPT/MISA trên
trang chính chủ), cấp cho cả 5 user. Lệnh `/dich` (alias của `/translate`) seed qua `seed:dify --tenant evolu --members …`.
Tenant `acme`/`beta` (+ phòng mẫu acme) chỉ seed khi `HUB_DEV_CONTRACT_FIXTURE=1` hoặc khi gate `done:*` tự bật hub-dev.
Xoá sạch DB dev: `./initial.sh --reset` (gọi `db:reset:dev -- --yes`, FLUSHALL Redis, rồi `db:setup`).

## Phòng mẫu
- `acme` (chỉ khi có fixture contract): DM `lan`–`hoa` (3 tin), nhóm "Nhóm dự án" (`lan` chủ, `hoa`, 2 tin).
- `evolu`: nhóm "Evolu team" (5 người, `julian.bui` chủ) + DM `julian.bui`–`thomas.tran`; chưa có tin.
Chạy lại dev không nhân đôi (nhóm theo id cố định, DM theo `dm_key`, tin chỉ ghi khi phòng chưa có tin).
