---
id: N5b-legacy-hash
title: Giữ mật khẩu cũ của user mgmt-app — verify scrypt khi đăng nhập rồi rehash argon2id
milestone: GĐ1 · đợt 2 CR-094
cr: CR-094
status: build
requirements: [N5B-FR-01, N5B-FR-02, N5B-FR-03, N5B-FR-04, N5B-FR-05, N5B-NFR-01, N5B-NFR-02]
design: [docs/specs/N5-identity/security-review.md ("Phương án thay thế"), docs/adr/0018-single-identity-sso.md]
owner: backend-lead (một agent một lát, làn đầy đủ: đường đăng nhập)
---

# N5b · Giữ mật khẩu cũ (người dùng chốt 2026-10-19: "giữ mật khẩu cũ")

## 0. Định dạng hash mgmt-app (đã kiểm nguồn)
`reference/mgmt-app-contracts` không chép phần auth; nguồn thật `F:\workspace\mgmt-app\api\app\auth.py` (mọi commit giống nhau):
`scrypt$<salt 16 byte hex>$<dk 64 byte hex>`, `hashlib.scrypt(pw.encode("utf-8"), salt=bytes.fromhex(salt), n=2^14, r=8, p=1)`.
**Không phải Werkzeug** (`scrypt:N:r:p$salt$hex`, salt là chuỗi UTF-8) như brief giả định ⇒ không nhận dạng Werkzeug (không thêm bề mặt parser không dùng).

## 1. Phạm vi
| Làm | Không làm |
|---|---|
| Importer N5: hash mgmt-app hợp lệ ⇒ lưu dạng legacy trong `password_hash`, `must_change_password=false` | Migration (không cột mới; marker = tiền tố hash) |
| Login admin-api: verify legacy (node:crypto scrypt, so hằng thời gian), rehash argon2id cùng tx, audit | Đổi body/mã lỗi contract auth đã khoá |
| Hạn sunset trong config; sau hạn legacy ⇒ từ chối như sai mật khẩu (đường đặt lại N3) | Quét chuyển hash legacy còn lại sau sunset (việc vận hành, xem §5) |

## 2. Yêu cầu
| Mã | Yêu cầu |
|---|---|
| N5B-FR-01 | **Lưu legacy**: importer nhận đúng `^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$` ⇒ lưu `$scrypt-legacy$ln=14,r=8,p=1$<salt hex>$<dk hex>` (tham số tường minh), tính là `hash_imported`, không `reset_required`. Khác (Werkzeug, sai độ dài, hoa) ⇒ như cũ (`reset`). Trần argon2 của N5 giữ nguyên. |
| N5B-FR-02 | **Verify**: login gặp `$scrypt-legacy$` ⇒ parse chặt; trần `ln ≤ 17` (N ≤ 2^17), `1 ≤ r ≤ 8`, `1 ≤ p ≤ 2`, salt 8..64 byte, dk đúng 64 byte, `maxmem = 128·N·r + 128·r·p + 1 MiB ≤ 132 MiB`; vượt trần/hỏng ⇒ coi như sai mật khẩu (401 `INVALID_CREDENTIALS`, tính vào bộ đếm khoá tạm). So bằng `timingSafeEqual`. Mật khẩu mã hoá UTF-8 (khớp Python `str.encode()`). |
| N5B-FR-03 | **Rehash một lần, nguyên tử**: verify legacy đúng ⇒ băm argon2id (tham số mặc định) **trước** tx, rồi trong cùng tx của bước sau mật khẩu (khoá hàng user `FOR NO KEY UPDATE`): `update … set password_hash=$new where password_hash = $legacy` (CAS, không tăng `version` — R7) + audit `update`/`user` `summary {op:"legacy_rehash"}` khi CAS trúng. Không đổi `password_changed_at`, không thu hồi phiên. Hai login song song ⇒ đúng một rehash, một audit. Tx lỗi ⇒ không phiên, không rehash. |
| N5B-FR-04 | **Sunset**: env `LEGACY_HASH_SUNSET` (ngày ISO, mặc định `2027-04-19` = 6 tháng); `now ≥ sunset` ⇒ hash legacy không bao giờ verify (401), user cần link đặt lại (N3 / admin reset). |
| N5B-FR-05 | **Contract không đổi**: body/mã của `/auth/login` giữ nguyên; user legacy đi đúng chuỗi bước `account_locked → totp → password_change → authenticated`. |
| N5B-NFR-01 | **Thời gian ngang nhau**: trước sunset mọi lần login (user lạ, user argon2, user legacy) chạy **đúng một** argon2 verify và **một** scrypt verify (ln=14, r=8, p=1) song song (thật hoặc giả); sau sunset chỉ một argon2. Test thống kê nhanh (trung vị). Login p95 vẫn < 150 ms (ADM-NFR-03, `users.perf.int.test.ts`). |
| N5B-NFR-02 | **Không lộ hash**: không log/audit/body chứa hash; audit chỉ `summary.op`. |

## 5. Bảo mật / vận hành
- Hash scrypt N=2^14 (dưới OWASP 2^17) nằm trong DB tới khi user đăng nhập hoặc tới sunset; sau sunset vận hành nên đặt lại hàng loạt (`password_hash like '$scrypt-legacy$%'`) — mục mở.
- Bề mặt parser mới chỉ một regex chặt + trần; không phân nhánh theo dữ liệu trước khi verify xong.

## 7. Quyết định trong lúc làm
- D1: Định dạng thật là `scrypt$salthex$dkhex` của mgmt-app, không Werkzeug (§0). "Vector Werkzeug" trong brief thay bằng vector RFC 7914 §12 (N=16384, r=8, p=1 — đúng tham số mgmt-app) + vector sinh bằng `hashlib.scrypt` của Python.
- D2: Marker = tiền tố `$scrypt-legacy$` trong `password_hash` (không migration, không đụng contract); rehash thay chuỗi ⇒ marker tự mất.
- D3: Audit dùng action sẵn có `update` + `summary.op="legacy_rehash"` (CHECK `audit_log_action_check` cố định, thêm action phải migration).
- D4: `AppDeps.legacySunset?` tuỳ chọn (fixture test khoá không phải đổi); vắng ⇒ mặc định. Hash scrypt giả tính một lần mỗi tiến trình (lazy), không thêm vào `AppDeps`.
- D5: Hash legacy vượt trần/hỏng không ném — trả false như `verifyPassword` (401 đồng nhất).
- D6 (BUILD, đo): bản đầu băm argon2id nối tiếp sau verify ⇒ login legacy lần đầu p95 149 ms (sát ngưỡng 150). Sửa: nhánh legacy thay argon2 *verify* giả bằng argon2 *hash* mật khẩu (cùng tham số, cùng chi phí) chạy song song scrypt; đúng thì dùng luôn hash đó ⇒ 48 ms, khối lượng việc vẫn "một argon2 + một scrypt" ở mọi đường.

### Áp mặc định readiness vòng 1 (Luật 1b, không vòng 2)
| # | Chốt |
|---|---|
| R1 | `tasks.md` có cột Làn/Rủi ro; test gắn mã FR. |
| R2 | Vector cố định: RFC 7914 §12 (`pleaseletmein` / salt `SodiumChloride` / N=16384,r=8,p=1 / dk `7023bdcb…575887`) và mgmt-app `bí mật 123` / `scrypt$00112233445566778899aabbccddeeff$89dfac31…617504a5` (Python `hashlib.scrypt`) ⇒ lưu `$scrypt-legacy$ln=14,r=8,p=1$0011…eeff$89df…04a5`. Đầy đủ trong `auth.legacy.test.ts`. |
| R3 | `newUser` lưu chuỗi đã chuyển (`importableHash`). Chạy lại import **không** nâng user đã có (đã `reset`) lên legacy — N5-FR-03 "đã có ⇒ không đổi gì"; user đó dùng link N3. |
| R4 | `LEGACY_HASH_SUNSET` = `YYYY-MM-DD`, hiểu là 00:00 UTC; sai định dạng ⇒ env lỗi, không khởi động (như env khác). |
| R5 | Login legacy lần đầu = login thường + đúng 2 câu (UPDATE CAS + INSERT audit) trong tx sẵn có; lần sau như thường. Ngưỡng: `users.perf.int.test.ts` p95 < 150 ms, ghi số trước/sau trong `tasks.md`. |
| R6 | Rehash ở nhánh `totp_required`, `password_change_required`, `authenticated` (mật khẩu đã đúng); **không** ở `account_locked`. Nhánh totp dùng `tx` của `confirmNotTempLocked`. |
| R7 | Rehash **không** tăng `version` (không đổi dữ liệu nghiệp vụ, tránh 409 giả cho form admin — như `setCounter`); thay N5B-FR-03 "version+1". |
| R8 | Audit: `recordAudit` (`lib/audit/audit.write.ts`), actor = chính user, `entity_id` = user id, `entity_name` = username, `summary={op:"legacy_rehash"}`, câu cuối của tx. |
| R9 | Bất biến: mọi đường có phiên đi qua login ⇒ đã rehash; `changePasswordSelf`/TOTP chỉ gặp argon2id. `changePasswordForced` chỉ cho user `must_change_password` (importer không đặt cho legacy). Không đổi hai đường đó. |
| R10 | Đặt lại hàng loạt hash legacy sau sunset = việc vận hành ngoài phạm vi (runbook), không phải mục code. |
