# N5b · Security review (vòng duy nhất, làn đầy đủ — đường đăng nhập)

- Phạm vi: commit `342ae0ab` (auth.legacy*.ts, auth.service/repo/session, env, import.rules), spec N5b, nguồn thật `mgmt-app/api/app/auth.py` (chỉ đọc).
- Ngày: 2026-10-19 · Reviewer: security (chỉ đọc).

## Kết luận: **SAFE**

Không có đường vượt xác thực. Không có phát hiện Chặn/Cao. Hai mục Thấp + vài ghi chú, không chặn merge.

## Kiểm theo trọng tâm

| # | Mục | Kết quả |
|---|---|---|
| a | Parse chặt | `LEGACY_RE` neo `^…$`, số không 0 đầu, hex thường, salt 8..64 byte chẵn cặp, dk đúng 128 hex (64 byte) ⇒ không thể dk rỗng/cắt ngắn. `scryptVerify`: `err ⇒ false`, `got.length === want.length` trước `timingSafeEqual`, DK_LEN cố định 64. Định dạng khớp `auth.py` (`hashlib.scrypt` mặc định dklen=64, `pw.encode()` UTF-8, salt `bytes.fromhex`). OK. |
| b | Trần / DoS | `ln ≤ 17, r ≤ 8, p ≤ 2`, `maxmem` tính đúng ≥ nhu cầu OpenSSL (128·N·r + 128·r·p + 1 MiB ≈ 129 MiB) ⇒ hash vượt trần trả false, không cấp phát. Hash legacy chỉ vào DB qua importer (luôn ln=14) — trần là phòng thủ chiều sâu. Đo Bun 1.4.3: scrypt ln14 ≈ 35 ms, **chạy ngoài event loop** (gap loop tối đa 2,6 ms); 16 scrypt song song 133 ms ≈ 16 argon2id 136 ms. Xem L1. |
| c | Thời gian ngang nhau | Trước sunset: user lạ = argon2 verify(dummy) ‖ scrypt(DUMMY ln14); user argon2 = verify ‖ scrypt(DUMMY); legacy = argon2 *hash* (cùng tham số mặc định) ‖ scrypt thật; legacy hỏng ⇒ scrypt(DUMMY). Sau sunset mọi đường = một argon2 verify. Cùng khối lượng việc. OK (chênh lệch tham số argon2 import m≤65536 là có từ N5). |
| d | Rehash / khoá | `rehashLegacy` = `UPDATE … WHERE tenant_id AND id AND password_hash = $legacy` trong tx của `confirmNotTempLocked` (khoá hàng `FOR NO KEY UPDATE`, kiểm lại khoá tạm), audit chỉ khi CAS trúng ⇒ song song đúng một rehash/một audit. Không rehash khi: sai mật khẩu (`!v.ok` ném trước), khoá tạm (ném trước verify hoặc trong tx ⇒ rollback), `account_locked` (`r = null`). Đường legacy sai ⇒ `recordFailedLogin` như argon2. Lỗi tx ⇒ rollback cả phiên + rehash (có test). OK. |
| e | Sunset | `z.iso.date()` sai định dạng ⇒ env lỗi, không khởi động. Ngày hợp lệ regex nhưng không tồn tại (nếu lọt) ⇒ `Invalid Date` ⇒ `now < NaN` = false ⇒ legacy **tắt** (fail closed). Vắng ⇒ mặc định 2027-04-19. OK. |
| f | Lộ hash | Không log; lỗi scrypt nuốt thành false; audit `before/after = null`, chỉ `summary.op`; body lỗi không đổi (`INVALID_CREDENTIALS`). OK. |
| g | Reset / đổi mật khẩu | `changePasswordSelf` và TOTP (`totp.service.ts:61`) gọi `verifyPassword` (argon2) — hash legacy ⇒ `Bun.password.verify` ném ⇒ false ⇒ từ chối, không bypass. Mọi phiên phải qua login ⇒ đã rehash (đường `password_change_required` cũng rehash trước khi cấp change_token; `pwc` không đổi nên token vẫn hợp lệ). Đặt lại N3/admin ghi hash argon2 mới, không cần hash cũ. OK. |
| h | Importer | `MGMT_SCRYPT_RE` chặt (salt 32 hex, dk 128 hex, thường) ⇒ chuỗi legacy tham số cố định; chuỗi nguồn đã mang tiền tố `$scrypt-legacy$` hoặc Werkzeug/hoa/sai độ dài ⇒ `null` ⇒ `reset`. Không có đầu vào nào sinh hash verify được mà không biết mật khẩu (cần tiền ảnh scrypt). OK. |

## Phát hiện

### L1 (Thấp, chấp nhận có điều kiện) — chi phí CPU mỗi login gấp ~2 khi chưa có rate-limit
Mỗi login (kể cả user lạ) trước sunset tốn một argon2id + một scrypt ln14 (+16 MiB tạm). Độ trễ gần như không đổi vì chạy song song (p95 46,6 → 50,2 ms, xa ngưỡng 150 ms), nhưng **thông lượng CPU của endpoint không xác thực giảm ~một nửa**, cộng dồn với N5 security L1 (chưa rate-limit login).
**Trả lời (b):** giữ thiết kế hiện tại. Bỏ scrypt giả ở đường không-legacy thì lúc tải cao lộ "tài khoản tồn tại và chưa chuyển hash" (oracle liệt kê user import); bộ cân bằng rẻ hơn (sleep/timer) bị Luật 4c cấm và không cân được tranh chấp CPU. Biện pháp đúng là rate-limit login (N5 L1): đề nghị nâng N5 L1 thành điều kiện trước khi chạy import mgmt-app thật trên production, và không gia hạn `LEGACY_HASH_SUNSET` quá mặc định khi chưa có rate-limit.

### L2 (Thấp) — thiếu test int cho nhánh `totp_required` có rehash
Code dùng chung `applyRehash` trong tx của `confirmNotTempLocked` nên đúng khi đọc, nhưng không có test (int hiện có: session, sai, vượt trần, sunset, song song, rollback, must_change, account_locked, tenant chéo). Thêm khi chạm lại module.

### Ghi chú (Info, không phải việc của lát)
- I1: Regex cho phép `ln` từ 1 (không có cận dưới). Chỉ ghi được qua DB; importer luôn ln=14. Có thể siết `ln ≥ 14` nếu muốn.
- I2: Rehash xảy ra ở bước 1 trước khi xác minh TOTP — đúng spec R6 (mật khẩu đã đúng, cùng mật khẩu), không tăng quyền.
- I3 (có từ M1): ảnh chụp user đọc trước verify; admin đặt lại mật khẩu trong cửa sổ ~50 ms giữa đọc và tx thì login bằng mật khẩu cũ vẫn thành công (CAS rehash trượt, không ghi đè hash mới). Không riêng N5b.
- I4: Sau sunset user legacy còn phiên (không có ở luồng import) sẽ không tự đổi mật khẩu được — dùng N3; vận hành đặt lại hàng loạt theo spec §5/R10.

## Kiểm chạy
- Unit: `bun test` auth.legacy.test, auth.legacy.rules.test, import.rules.test, env.test ⇒ **57 pass / 0 fail**.
- Đo riêng (scratch, Bun 1.4.3): scrypt ln14 34,8 ms đơn; 16 song song 132,7 ms; ln17/r8/p2 494 ms; event loop không bị chặn.
- Int (`test:int:par` auth.legacy.int + auth/*): **không chạy được trong môi trường review** — mọi file (kể cả file auth M1 không đổi) treo `beforeAll` 30 s khi tạo DB test (hạ tầng, không do diff). Tin số của tác giả trong commit/tasks; nên chạy lại `bun run test:int:par apps/admin-api/src/modules/auth` ở cổng merge.
