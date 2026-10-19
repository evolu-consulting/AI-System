# Kết luận lát N5 Định danh chung, gồm N5b mật khẩu cũ (2026-10-19)

Quyết định: **đóng N5 và N5b** (CR-094 đợt 2, làn đầy đủ: auth/mật khẩu/tenant). Cổng gộp và số đo: [`wave2-gate.md`](../wave2-gate.md). Số perf là số Windows dev. **Chưa được chạy import khách thật** (§4: điều kiện cứng rate-limit đăng nhập).

## 1. Phạm vi đã giao

**N5** (`apps/admin-api/src/modules/identity-import`, bốn lớp): công cụ chuyển user mgmt-app (schema `mgmt-app-users/v1`) sang admin-api, CLI dry-run/apply, theo lô 500 (≤ 1000), idempotent · org → tenant theo marker `(mgmt_source, mgmt_org_id)`, khác nguồn ⇒ `ORG_MISMATCH`, gói đã thu hồi ⇒ `PACK_REVOKED` · gắn Group theo vai, không gắn lại user đã có · mật khẩu: giữ hash argon2id đủ mạnh, còn lại buộc đặt lại · không lộ hash/message Postgres trong log, báo cáo, audit.
**N5b** (`apps/admin-api/src/modules/auth`): giữ mật khẩu scrypt (Werkzeug) của mgmt-app, đăng nhập lần đầu verify scrypt rồi rehash argon2id; trước sunset mọi login chạy đúng một argon2 + một scrypt (giả hoặc thật) song song để thời gian ngang nhau; `LEGACY_HASH_SUNSET` (mặc định 2027-04-19 00:00 UTC) chặn nhận hash legacy sau hạn. `importableHash` ở importer chuyển hash scrypt ln=14.

## 2. Kết quả

| Hạng mục | N5 | N5b |
|---|---|---|
| Review / Security | Review **APPROVED** (`dcdfb57e`: 0 Cao, 2 Trung, 8 Thấp); security **SAFE** (`e407225a`: 2 Trung, marker org không namespace, lỗi 22xxx dừng cả lần chạy). Đã sửa ở `9455c9a5` | Security **SAFE** (`eb366539`); L1 chi phí CPU x2 mỗi login chờ rate-limit, L2 thiếu test nhánh totp |
| Test | 23 unit + 17 int (2 file) + 3 perf; `import.rules.test.ts` 26 xanh sau `c85b4411` | Unit auth 200 pass (gồm rules/verify/timing); `auth.legacy.int.test.ts` 9/9 |
| Cổng gộp 2026-10-19 | `check:fn` từng đỏ ở `import.rules.ts` (2 hàm 5 tham số) và `import.rules.test.ts` (2 describe > 50 dòng): **sửa trong lát N5** (`c85b4411`, hành vi không đổi) → OK. Perf N5 xanh | `test:int:par apps/admin-api/src/modules/auth` riêng: **21 pass / 0 fail** (3 file, 5,2 s) — cổng mà security review N5b không chạy được |
| Perf (`PERF=1`) | 10.000 user lô 500: **apply 1.950 ms** (user 6 câu/lô, lô org 9 câu), chạy lại 1.841 ms (≤ 2 câu/lô), dry-run 145 ms (1 câu/lô) — ngưỡng 30 s | Login p95 (n=20): argon2 sau sunset 41,4 ms · argon2 trước sunset 42,8 ms · legacy lần đầu 52,6 ms (ngưỡng 150 ms) |

Commit: N5 `cff557fa`, `d32fe438`, `9455c9a5`, `b310876a`, `c85b4411` · N5b `342ae0ab`.

## 3. Quyết định chính

Marker tenant có nguồn (M1); chạy lại không hoàn tác thu hồi gói/Group/grant (L2); user đã có không gắn Group lại (ROLE_CONFLICT/ROLE_MISSING ghi báo cáo). Giữ scrypt giả ở đường không-legacy: bỏ nó sẽ lộ "tài khoản tồn tại và chưa chuyển hash" lúc tải cao; bộ cân bằng bằng sleep bị Luật 4c cấm (security N5b mục L1).

## 4. Điều kiện cứng trước khi import khách thật (HD10)

admin-api **chưa có rate limit đăng nhập** (N5 security L1, N5b L1 cộng dồn: mỗi login trước sunset tốn ~2 lần CPU). Ghi TECH-DEBT #224 là **điều kiện tiên quyết trước khi chạy import mgmt-app thật trên production**. Cho tới khi có rate limit: **giữ `LEGACY_HASH_SUNSET` ở mặc định**, không gia hạn.

## 5. Nợ liên quan

| # | Nội dung |
|---|---|
| 224 | Rate limit đăng nhập admin-api (điều kiện cứng trước HD10); hạ trần tham số argon2id nhập (`m ≤ 262144`) |
| (review/security) | Thấp còn lại ghi trong `review.md`, `security-review.md` (chưa có số) |

## 6. Việc còn lại

| Việc | Ai | Khi |
|---|---|---|
| Export thật từ mgmt-app theo schema `mgmt-app-users/v1` (hiện chỉ fixture giả) | Người dùng | Trước HD10 |
| Rate limit đăng nhập admin-api (#224) | backend-lead | Trước HD10 |
