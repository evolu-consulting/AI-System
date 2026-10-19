# Review · N5-identity (chuyển user mgmt-app sang admin-api)

- Phạm vi: `cff557fa` (spec/plan/tasks/readiness) + `d32fe438` (`apps/admin-api/src/modules/identity-import/**`, `tests/acceptance/N5/**`, `tests/.lock`).
- Reviewer: một vòng, chỉ đọc (Luật 1b). Ngày 2026-10-19.
- Đường dẫn module viết tắt: `ii/` = `apps/admin-api/src/modules/identity-import/`.

## Kết luận: **APPROVED**

0 Cao · 2 Trung · 8 Thấp. Không có Cao ⇒ không chặn. Hai mục Trung nên sửa trong lát này hoặc ghi rõ vào spec §7 trước khi chạy với dữ liệu thật.

## Đã kiểm, đạt

| Điểm | Kết quả |
|---|---|
| Khớp user theo (tenant, username ứng viên) thay vì `lower(email)` (B1) | `ii/adapters/import.repo.ts:129-143` chỉ lọc bằng phép bằng leakproof (`tenant_id`, `username`), email lấy ra để so ở domain (`lower(u.email)`, khớp với `users_tenant_email_uq` là `lower(email)`). Truy vấn gồm cả base lẫn fallback (`ii/application/import.usecase.ts:89-100`) nên user đã nhận fallback ở lần chạy trước vẫn được nhận ra. User tạo tay cùng email khác username ⇒ `on conflict do nothing` (không target, gồm cả `users_tenant_email_uq`) ⇒ `USER_CONFLICT`, không tạo, không gán Group (`ii/application/import.usecase.ts:102-106`, test `import.int.test.ts:192-207`). Trade-off an toàn: sai thì báo lỗi, không nhân đôi hay gán nhầm. |
| Cách ly tenant | Mọi câu ghi có `tenant_id` tường minh; `group_members` có FK kép `(tenant_id, group_id)` và `(tenant_id, user_id)` (migration 0005) nên không thể gán chéo tenant. Lọc `tenant_id = any × username = any` có thể trả user tenant khác trong cùng lô, nhưng map trong domain khoá theo `tenant\nemail`/`tenant\nusername` nên vô hại. Test: tenant fixture `acme` không bị đụng (`import.int.test.ts:151-167`). |
| Marker org→tenant | `settings.mgmt_org_id` ghi lúc chèn tenant (`import.repo.ts:43-47`), khớp lại theo `settings->>'mgmt_org_id'` (`import.repo.ts:30-36`); key đã có mà khác/thiếu marker ⇒ `ORG_KEY_TAKEN`, user ⇒ `ORG_FAILED` (`ii/domain/import.rules.ts:104-116`). Tenant inactive ⇒ `TENANT_INACTIVE`. |
| Vai | `adminRoleOf` (`import.rules.ts:75-78`): owner ⇒ `tenant_admin`, editor/viewer ⇒ `member`, khác ⇒ `BAD_ROLE`; không đường nào ra `platform_admin`. Actor bắt buộc là `platform_admin` active, tenant active (`import.repo.ts:14-27`). User đã có ở vai khác ⇒ `ROLE_CONFLICT`, không thêm (không nâng quyền ngầm). |
| Lô 500, số câu cố định | Lô user apply = 6 câu (set_config, findUsers, insertUsers, insertMembers, bump, audit nhiều hàng), dữ liệu qua một tham số JSON; lô org 9; dry-run ≤ 2. Chặn `1 ≤ batch ≤ 1000` (`ii/identity-import.run.ts:39`). |
| Chạy lại không tạo gì | Không inserts/links ⇒ bỏ cả insert lẫn bump/audit (2 câu/lô). Int test so snapshot số hàng + `config_version` (`import.int.test.ts:169-178`). |
| Dry-run mặc định | CLI `apply` mặc định `false` (`ii/identity-import.cli.ts:28`); dry-run đi `withScope` chỉ đọc, không tính hash, không bump/NOTIFY; test so snapshot (`import.int.test.ts:72-85`). |
| Không lộ hash | Hash chỉ trong tham số JSON của `insertUsers`; lỗi chỉ ghi SQLSTATE; BAD_ROW không chép giá trị; test quét stdout/stderr CLI và audit (`import.int.test.ts:262-297`). |
| Mật khẩu | Nhập hash chỉ khi argon2id v19 trong ngưỡng; còn lại ⇒ một hash argon2id của 32 byte ngẫu nhiên mỗi lần chạy + `must_change_password`; đăng nhập thật được kiểm (200 / 401). |

## Chạy lại test (reviewer)

- Unit `bun test ii/`: 15 pass.
- Int `bun run test:int:par tests/acceptance/N5`: 13 pass, 4.3 s.
- Perf (`PERF=1`, bunfig.perf, DB riêng `n5_review_perf_test`, đã xoá sau khi chạy): dry-run 10.000 user 174 ms (1 câu/lô); apply 2.548 ms, 20 lô × 6 câu, lô org 9; chạy lại 441 ms (≤ 2 câu/lô). Khớp số trong plan (2.195 / 248 ms) trong biên độ máy đang tải.

## Phát hiện

| # | Mức | File:dòng | Phát hiện | Đề xuất |
|---|---|---|---|---|
| 1 | Trung | `ii/adapters/import.repo.ts:64-66`, `ii/adapters/import.store.ts:40,116-120` | Chạy lại trên tenant đã có **bật lại entitlement `contracts-*` đã bị thu hồi** (`do update set revoked_at = null … where revoked_at is not null`), có audit. Nếu vận hành đã cố ý thu hồi gói sau đợt chuyển, chạy lại công cụ (vốn được quảng bá là idempotent, "chạy lại không tạo gì") sẽ âm thầm cấp lại quyền. Test idempotent không phủ trường hợp này. | Với tenant `reuse` (đã có `mgmt_org_id`) chỉ bật gói khi chưa từng có entitlement (`on conflict do nothing`), hoặc báo issue `PACK_REVOKED` và bỏ qua; thêm int test thu hồi rồi chạy lại. Nếu giữ hành vi hiện tại thì ghi rõ vào spec §7. |
| 2 | Trung | `ii/adapters/import.store.ts:249-253`, `ii/application/import.usecase.ts:102-106` | Dry-run trả `inserted = plan.inserts` nên **không bao giờ báo `USER_CONFLICT`**: user tạo tay cùng email khác username được đếm là `created` và có trong `accounts`, lúc `--apply` mới thành lỗi. Đây là hệ quả của B1 nhưng làm báo cáo đối soát dry-run (mục đích chính của dry-run, N5-FR-05/06) sai lệch đúng ở trường hợp vận hành cần xử lý tay. | Thêm một câu đọc riêng cho dry-run (không ảnh hưởng ngân sách apply): `select tenant_id, lower(email) … where tenant_id = any($t)` lọc ở ứng dụng, hoặc đánh dấu rõ trong báo cáo (`"conflicts_unchecked": true`) + spec §7 B1. |
| 3 | Thấp | `ii/application/import.usecase.ts:137-141`, `ii/identity-import.run.ts:31-34` | Chỉ lỗi lớp 23 thành `BATCH_FAILED`; spec §7 R1 nói "lỗi DB còn sót ⇒ rollback lô đó, lô sau vẫn chạy". Lỗi dữ liệu lớp 22 (vd. `slice(0,64)`/`slice(0,128)` ở `import.rules.ts:172,115` cắt đôi cặp surrogate, hoặc email/tên chứa `\udXXX` lẻ trong file ⇒ jsonb 22P02) làm **dừng cả lần chạy, exit 1, sau khi các lô trước đã commit**. Chạy lại vẫn an toàn nhờ idempotent. | Cắt theo code point (`Array.from(s).slice(0,n).join("")`) và loại surrogate lẻ ở mapper (⇒ `BAD_ROW`); hoặc mở rộng `constraintError` sang lớp 22. |
| 4 | Thấp | `ii/domain/import.rules.ts:92-93`, `ii/application/import.usecase.ts:61-63` | `seen`/`used` của `planOrgs` chỉ trong một lô org: file > 500 org có id hoặc key trùng ở hai lô ⇒ dry-run đếm `created` hai lần, không báo `DUP_ORG`/`DUPLICATE_KEY` (apply thì lô sau rơi vào reuse/`ORG_KEY_TAKEN` nên dữ liệu vẫn đúng). | Truyền `seen`/`used` xuyên lô như `planUsers`. |
| 5 | Thấp | `ii/domain/import.rules.ts:147-151` | `ROLE_CONFLICT` vẫn tăng `users.existing` ⇒ một user vừa là `existing` vừa là lỗi; tổng `created + existing + errors` lớn hơn `read`. | Chỉ tăng `existing` khi không xung đột, hoặc ghi rõ quy ước đếm trong spec N5-FR-05. |
| 6 | Thấp | `ii/domain/import.rules.ts:38` | Nhận hash nhập có `m` tới 262144 KiB ⇒ mỗi lần verify đăng nhập của user đó cấp 256 MB; vài đăng nhập đồng thời có thể làm áp lực bộ nhớ admin-api. Nguồn là file admin (tin cậy) nên rủi ro thấp. | Hạ trần `m` (vd. 65536) hoặc rehash khi đăng nhập thành công (nếu M1 có cơ chế). |
| 7 | Thấp | `docs/specs/N5-identity/spec.md` N5-FR-03, §4 | Thân spec vẫn ghi "khớp theo `(tenant_id, lower(email))`" và §4 dẫn `users_tenant_email_uq`, trái với B1 (§7). Người đọc FR sẽ hiểu sai cơ chế khớp. | Sửa N5-FR-03 trỏ tới B1. |
| 8 | Thấp | `tests/acceptance/N5/import.int.test.ts:192-207` | Test `USER_CONFLICT` (và `ROLE_CONFLICT` :180) dựa vào tenant `org-alpha` do describe trước tạo ⇒ phụ thuộc thứ tự; chạy lọc riêng (`-t`) sẽ đỏ. | Mỗi describe tự seed org/tenant của mình. |
| 9 | Thấp | `tests/acceptance/N5/import.int.test.ts:298-310` | Tên test "thiếu --actor / file hỏng" nhưng chỉ kiểm file hỏng (vẫn truyền `--actor`). | Thêm ca thiếu `--actor` hoặc sửa tên. |
| 10 | Thấp | `tests/acceptance/N5/**` | Thiếu int test cho: chạy lại khi user đã nhận username **fallback** (đường idempotent dựa vào `userQuery` gửi cả fallback, `import.usecase.ts:97`), `DUPLICATE_EMAIL` xuyên lô, nhánh `BATCH_FAILED`. Unit test phủ phần domain nhưng không phủ use case + SQL. | Thêm một int test nhỏ: base bị user khác chiếm ⇒ lần 1 tạo fallback, lần 2 `existing`, 0 issue. |
