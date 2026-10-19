# Security review · N5-identity (chuyển user mgmt-app sang admin-api)

- Phạm vi: commit `cff557fa` (spec/plan) + `d32fe438` (`apps/admin-api/src/modules/identity-import/**`, `tests/acceptance/N5/**`). Chỉ đọc; không sửa code.
- Ngày: 2026-10-19 · Reviewer: security (Opus) · Làn đầy đủ (auth/mật khẩu/tenant/migration dữ liệu khách thật).
- Test đã chạy: unit `identity-import` 15/15 pass; int `tests/acceptance/N5/import.int.test.ts` 13/13 pass (4,6 s, `test:int:par`). Perf không chạy lại.
- Thử thêm (chỉ đọc, DB local): `jsonb_to_recordset` với chuỗi chứa `\u0000` hoặc nửa cặp surrogate ⇒ SQLSTATE `22023` (xem M2).

## Kết luận: **SAFE** (không hard stop)

Không tìm thấy đường cross-tenant tới tenant gốc admin-api, cũng không có đường nâng quyền lên `platform_admin`. Còn 2 lỗi Trung bình (M1, M2), nên sửa trước khi chạy `--apply` trên dữ liệu thật, cùng vài lỗi Thấp/Info. Không lỗi nào là Chặn.

## Đã kiểm, đạt

| Mục | Bằng chứng |
|---|---|
| (a) Phân loại hash | `classifyHash`: regex PHC chặt `$argon2id$v=19$m=..,t=..,p=..$salt$hash`, dài ≤ 256, `19456 ≤ m ≤ 262144`, `2 ≤ t ≤ 10`, `1 ≤ p ≤ 4`. Mọi trường hợp khác (scrypt, bcrypt, argon2i/d, rỗng, null, rác) ⇒ `reset`. Có unit test cho từng biên. |
| (a) Hash không dùng được | `unusableHash()`: 32 byte CSPRNG ⇒ `hashPassword` (argon2id tham số mặc định), bí mật bị bỏ ngay sau khi băm, mỗi lần chạy một hash. Thời gian verify giống user thường. User `reset` có `must_change_password=true` và audit `summary.reset_required=true`. Test đăng nhập thật: user scrypt ⇒ 401, user argon2id nhập vào ⇒ 200. |
| (a) Không lộ hash | Hash chỉ nằm trong tham số JSON của `insertUsers`. Report/`accounts`/audit `after` không có trường hash. Mapper báo `BAD_ROW` bằng chỉ số, không chép giá trị. CLI stderr chỉ in mã lỗi/SQLSTATE, không in message Postgres. Test int quét stdout/stderr và `audit_log` tìm `$argon2`, `scrypt:`, `password_hash`. |
| (b) Không có đường lên platform admin | `role` của user mới chỉ đến từ `adminRoleOf` (`tenant_admin`/`member`); vai lạ ⇒ `BAD_ROLE`. User đã có thì không bao giờ bị đổi `role`. Group chỉ là 3 Group `contracts-*`. Tenant platform không thể bị "reuse" vì key trùng mà không có `mgmt_org_id` ⇒ `ORG_KEY_TAKEN`. Test xác nhận có 0 `platform_admin` trong tenant import. |
| (b) Actor | `preflight`: `role='platform_admin' and active and not locked_by_tenant and tenant.active`, actor phải là UUID. Không đạt ⇒ `ACTOR_INVALID`, exit 1, không ghi gì (có test với tenant_admin và id không tồn tại). |
| (c) Cách ly tenant | Câu ghi luôn có `tenant_id` tường minh. `group_members` có FK ghép `(tenant_id, group_id)`→groups và `(tenant_id, user_id)`→users (migration 0005), nên DB tự chặn việc ghép user/Group khác tenant. Lưu ý: scope `platform` thấy mọi tenant, vì vậy ranh giới thật là tenant_id tường minh cộng FK ghép, **không phải RLS**. Test: tenant fixture `acme` không bị đụng (users, members, settings). |
| (c) Marker org→tenant | Chỉ khớp `settings->>'mgmt_org_id'`. Không route admin-api nào ghi `tenants.settings` (đã grep; schema contract `Tenant` không có `settings`), nên tenant admin không thể tự gắn marker để "hút" user của org khác. Key trùng tenant khác ⇒ `ORG_KEY_TAKEN`; key trùng trong file ⇒ `DUPLICATE_KEY`. Hai trường hợp này user của org đều bị `ORG_FAILED`. |
| (d) Đầu vào | zod: format literal, ≤ 10.000 org, ≤ 200.000 user, giới hạn độ dài từng trường, `tenant_key` `^[a-z0-9-]{2,32}$`, locale enum. SQL hoàn toàn tham số hoá (`jsonb_to_recordset`, `jsonb_array_elements_text`), không ghép chuỗi nên không có injection. Email trùng (không phân biệt hoa thường, kể cả xuyên lô) ⇒ `DUPLICATE_EMAIL`. Username trùng ⇒ fallback fnv8, rồi `USERNAME_TAKEN`. User đã có vai khác ⇒ `ROLE_CONFLICT` (không thêm Group). Email trùng user tạo tay ⇒ `USER_CONFLICT`. |
| (e) Bật gói | Dùng chung `packs.rules` với PUT packs: 3 entitlement, 3 Group, 6 grant, chỉ cho tenant được tạo/reuse trong lần chạy. Audit `grant/entitlement summary.op=pack.enable`, bump + NOTIFY sau commit. Dry-run chỉ đọc (test snapshot). |

## Phát hiện

### Trung bình

**M1 · `mgmt_org_id` không có namespace nguồn, nên export khác nguồn vẫn khớp nhầm tenant đã import.**
`findTenants` khớp `settings->>'mgmt_org_id' = any(orgIds)` mà không kiểm tên/key. Giả sử có một file export từ mgmt-app khác (staging/prod, hoặc instance khác), hoặc file bị sửa, mà id org trùng với id đã import trước đó. Id kiểu số nhỏ `"1"`, `"2"` rất dễ trùng. Khi đó user của file sẽ vào tenant đã tạo trước đó. Nếu chưa có trong tenant, họ được tạo mới, có thể là `owner ⇒ tenant_admin` mang hash argon2id do file cung cấp. Nếu đã có mà chưa có vai gói, họ bị gắn vào Group vai. Phạm vi bị giới hạn: chỉ tenant **do importer tạo** mới bị nhắm được, tenant gốc admin-api thì không. Kẻ tấn công phải kiểm soát nội dung file và người chạy phải là platform admin. Đây là ranh giới tin cậy của file chứ không phải leo quyền, nên không phải hard stop.
Đề xuất: ghi `settings.mgmt_source` (id instance mgmt-app) và khớp theo cặp `(source, org_id)`. Hoặc khi reuse thì so `name`/`tenant_key`, lệch ⇒ issue `ORG_MISMATCH`, không gắn user. Runbook: đọc kỹ `orgs.existing` trong báo cáo dry-run trước khi `--apply`, và kiểm checksum file export.

**M2 · Một hàng chứa `\u0000` hoặc nửa cặp surrogate làm hỏng cả lần chạy, và chạy lại vẫn hỏng ở đúng hàng đó.**
Regex email `[^@\s]` cho qua NUL. `org_id`/`name` cũng không lọc. `displayName = name.slice(0, 64)` (và `name.slice(0,128)` của org) cắt theo đơn vị UTF-16, nên có thể để lại nửa cặp surrogate (ví dụ 63 ký tự + emoji). Postgres từ chối JSON này với SQLSTATE `22023` (đã thử trên DB local). Lỗi lớp 22 không phải lớp 23, nên `constraintError` trả `null` và lỗi bị ném tiếp. CLI exit 1 khi các lô trước **đã commit**. Lần chạy sau lại dừng ở cùng hàng, nên một hàng xấu chặn toàn bộ migration. NUL trong `org_id` còn làm hỏng cả dry-run. Không lộ dữ liệu (CLI chỉ in SQLSTATE). Đây là lỗi độ tin cậy migration, không phải lỗi bảo mật.
Đề xuất: trong domain, loại `\u0000` và surrogate lẻ ⇒ `BAD_ROW`/`INVALID_EMAIL`; cắt theo code point (`Array.from(s).slice(0,64).join("")`); hoặc xếp lớp 22 vào `BATCH_FAILED` như lớp 23. Thêm unit test cho cả hai trường hợp.

### Thấp

**L1 · Trần tham số argon2id nhập vào cao so với mức mặc định, và admin-api không có rate limit đăng nhập.** Trần `m ≤ 262144 KiB` (256 MiB), `t ≤ 10`, `p ≤ 4`, trong khi mặc định là 19 MiB, t=2. Mỗi lần thử đăng nhập vào user như vậy (chỉ cần biết tenant_key + username) cấp phát tới 256 MiB, nên đăng nhập song song có thể gây OOM. Hiện thực tế gần như không có user nào rơi vào nhánh này vì mgmt-app dùng scrypt. Đề xuất: hạ trần xuống `m ≤ 65536`, `t ≤ 4`, `p ≤ 2`, hoặc rehash về tham số mặc định ở lần đăng nhập thành công đầu tiên.

**L2 · Chạy lại importer hoàn tác các thao tác thu hồi của quản trị.** `enableEntitlements` đặt `revoked_at = null` (bật lại gói `contracts` mà platform admin đã thu hồi). `insertRoleGrants` thêm lại grant mà tenant admin đã xoá. User bị gỡ khỏi mọi Group vai (`roles` rỗng) bị gắn lại. Có audit nhưng diễn ra âm thầm với người vận hành. Đề xuất: tenant có entitlement đã thu hồi thì bỏ qua và báo `PACK_REVOKED`. Runbook: coi đây là công cụ chạy một lần, không chạy lại sau go-live.

**L3 · Audit gắn user đã có vào Group bị gộp.** Với user đã có, audit chỉ ghi một hàng `grant/group` mỗi tenant với `summary.added = n`, `entityId = null`, nên không biết user nào nhận vai nào. Đây là thay đổi quyền nên cần truy vết được. Đề xuất: mỗi user một hàng audit, hoặc đưa danh sách `{user_id, role}` vào `summary`.

**L4 · `--batch abc` âm thầm không làm gì.** `Number("abc")` ra `NaN`, `Math.min/max` vẫn giữ `NaN`, `chunk` ra một lô rỗng. Kết quả: 0 user được xử lý, exit 0, báo cáo không có issue. Đề xuất: kiểm `Number.isInteger` trong CLI, sai ⇒ exit 1.

### Info

- **I1** · Log phía server Postgres: vi phạm CHECK (23514) ghi `DETAIL: Failing row contains (...)`, gồm cả `password_hash`, vào log server, bất kể ứng dụng đã che. Prechecks ở domain (R1) giảm khả năng này. Cần kiểm soát quyền đọc và thời gian giữ log PG khi chạy trên dữ liệu thật.
- **I2** · Stdout (`accounts`, `issues.ref`) chứa email và username, tức là PII. Không được commit hay dán báo cáo vào kênh chung.
- **I3** · `preflight` chạy ở tx riêng: actor bị khoá giữa chừng thì lần chạy vẫn tiếp tục (TOCTOU). Chấp nhận được với CLI chạy tay.
- **I4** · File được đọc toàn bộ (`Bun.file().text()`) trước khi áp trần zod. Chấp nhận được vì là CLI do operator chạy.
- **I5** · Regex email cho qua `<>"'`. Giá trị lưu nguyên văn, nên UI phải escape (React mặc định đã escape).
- **I6** · Vận hành: user `reset` (thực tế là mọi user mgmt-app) **không đăng nhập được cho tới khi N3** gửi link đặt lại.

## Phương án thay thế: verify scrypt cũ khi đăng nhập rồi rehash sang argon2id

Hash mgmt-app có dạng Werkzeug `scrypt:N:r:p$salt$hex`. Có thể verify bằng `node:crypto.scryptSync`: salt là chuỗi UTF-8 nguyên văn, dklen 64, `maxmem` ≥ 128·N·r. Để làm vậy cần: lưu hash scrypt (trong `password_hash` hoặc cột `legacy_hash` qua migration); thêm nhánh trong `verifyPassword` theo tiền tố, so bằng `timingSafeEqual`, chặn tham số `N ≤ 2^17`, `r = 8`, `p ≤ 2` để không DoS; khi verify thành công thì rehash argon2id trong cùng tx với login, bump `version` và ghi audit; đặt hạn sunset, sau hạn thì chuyển hash scrypt còn lại sang buộc đặt lại. Rủi ro:
- Mở rộng đường đăng nhập đã khoá contract (ADR-0018, M1 §6), nên phải đi làn đầy đủ.
- Hash scrypt N=2^15 (dưới mức OWASP 2^17) nằm lại trong DB cho tới khi user đăng nhập.
- Thời gian verify scrypt khác dummy-hash argon2id, nên có thể lộ qua timing user nào là user migrate chưa đăng nhập.
- Thêm một bề mặt parser mới.

Công sức ước tính khoảng 1–2 ngày gồm unit, int và test đăng nhập thật. Lợi ích: khách giữ được mật khẩu và không bị khoá chờ N3. Nếu làm thì đáng làm hơn chờ N3, với điều kiện có trần tham số, sunset và rehash bắt buộc.
