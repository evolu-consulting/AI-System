---
id: TS1-test-speed
---

# Tasks · TS1 test speed

Làn: **nhanh** (một agent, một reviewer; Luật 1b, Luật 4c). Người dùng duyệt 2026-10-19. Mục tiêu: `test:all` nhanh hơn, cổng lát `test:affected`, sửa 3 chập chờn #234 tận gốc. Máy: 12 luồng, 16 GB, Postgres 16 + Redis local, Windows.

| # | Task | Trạng thái |
|---|---|---|
| T1 | e2e song song: `test:e2e:par` (DB `ai_system_e2e_<tag>_test`, Redis DB, cổng, thư mục dựng `dist-e2e/<việc>` riêng mỗi việc; cấu hình gốc chia 3 ca + 1 ca đồng hồ) | [x] |
| T2 | m4-2fa: `waitNextStep` dịch đồng hồ máy chủ e2e (preload `e2e-clock-skew.ts`) thay vì chờ ≤ 31 s thật mỗi lần (237 s → 58 s cả ca) | [x] |
| T3 | int: `peek/tryNext` của ScriptRuntime thoát ngay khi run đã kết thúc (A37 chờ trọn 3 s/vòng); reset M1/M2 bằng DELETE (replica) thay TRUNCATE CASCADE; template dựng từ template cùng key sẵn có; GC DB rác chạy nền | [x] |
| T4 | #234 SC-2 + E-PB11: sự kiện `room.message` tới giữa lúc tải lần đầu bị `setQueryData` bỏ qua ⇒ chat-web huỷ + tải lại | [x] |
| T5 | #234 migrate-lock: bỏ DROP DATABASE ×4 ở afterAll (mỗi DROP ép checkpoint) | [x] |
| T6 | #208: template dựng một lần rồi chép (donor) thay vì 6 ô cùng migrate dưới khoá | [x] |
| T7 | Chập chờn thêm gặp khi đo: P1-48e (chờ apply bất đồng bộ trước sweep lần 2), H3b A30 (xả NOTIFY còn trên đường trước mốc) | [x] |
| T8 | `test:affected` (đồ thị import → unit/int/e2e; `--dry-run`, `--e2e=owner|wide|none`), WORKFLOW: cổng lát / cổng đợt | [x] |
| T9 | `test:all`: đợt nhẹ → int → e2e (int và e2e KHÔNG chạy cùng nhau) | [x] |
| T10 | storageState đăng nhập một lần | [ ] bỏ: refresh token xoay vòng + phát hiện dùng lại ⇒ cookie dùng chung không an toàn; đăng nhập UI ≈ 0,35 s/ca (cr052-login) < 10 % ca gốc |
| T11 | "build một lần": build admin-web/chat-web chỉ 2,5–3,2 s (đo) nên không phải nút cổ chai; sửa đúng chỗ hỏng là các config build đè `dist` của nhau ⇒ mỗi việc `E2E_DIST_DIR` riêng | [x] khác thiết kế |

## Thay đổi test khoá (relock chỉ file đổi; assertion không đổi)
| File | Đổi gì | Vì sao |
|---|---|---|
| `e2e/support/totp.ts` | `waitNextStep` dịch đồng hồ khi có `E2E_CLOCK_FILE`; `API_URL` theo `E2E_API_URL` | không ngủ chờ bước TOTP; cổng theo ca |
| `e2e/support/helpers.ts` | `API_URL` theo `E2E_API_URL` | như trên |
| `tests/acceptance/H1/_runtime.ts` | `peek`: thoát khi run đã kết thúc và không còn job queued | tín hiệu thay chờ hết 3 s |
| `tests/acceptance/M1/_data.ts`, `M2/_data.ts` | `truncateAll`/`truncateCatalog` = `deleteCascade` (cùng tập bảng) | 190 ms → ~20 ms mỗi lần reset |
| `tests/acceptance/P-a/pf1/lock-order.int.test.ts` | `settleApply` sau vòng đua | chờ apply bất đồng bộ xong trước sweep lần 2 |
| `tests/acceptance/H3b/grants-write.int.test.ts` | `n.sentinel()` trước `n.mark()` | xả NOTIFY của ca trước |

Không có Tranh chấp test.

## Còn lại (nợ)
- int chạy cùng e2e làm int 438 → 916 s và vỡ ca có ngân sách thời gian ⇒ không song song hai bước đó.
- `Unhandled error ... ECONNRESET` sau teardown (hub dừng nhưng tác vụ nền engine còn chạy, bị `terminate` của lần reset kế): xuất hiện ~1/3 lượt int; cần `stop()` của hub chờ tác vụ nền (nợ mới).
- Mục tiêu `test:all` < 10 phút KHÔNG đạt trên máy này (xem gate.md).
