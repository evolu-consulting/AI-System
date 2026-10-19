# Lệch có chủ ý so với mgmt-app (D-02, D-21)

Chỉ những lệch đã chốt; mọi lệch khác là lỗi và nằm ở `docs/specs/N1-pack-frame/tasks.md` mục "Lệch giao diện".

| Màn | Lệch | Cách xử lý ở harness |
|---|---|---|
| S01 đăng nhập | Ô "Mã công ty" (D-21: contracts-web đăng nhập admin-api theo tenant); mgmt-app không có | `HIDE` trong `scenes.cw.ts` ẩn `label:has(input[name=tenant_key])` ở cả hai phía |
| S02 onboarding | Bỏ (Q-F3) | Không có cảnh |
| Shell | Panel phải: nội dung trợ lý khác (slot lazy, HD6) | `localStorage assistant:open=0` ở cả hai phía; vùng `main` bị che (mask) vì nội dung màn thuộc lát sau |
| Đăng nhập (nhãn) | Ô "Email" nhận tên đăng nhập admin-api | Cùng nhãn "Email" ⇒ không ảnh hưởng chữ |

Dữ liệu giả dùng chung: `dataset.ts` (`asMgmt()` cho mgmt-app, `asHub()` cho contracts-web). Baseline theo OS ở `baseline/<platform>/` (hiện `win32`; máy khác chụp lại bằng `bun run e2e:contracts:ref`).
