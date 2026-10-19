---
id: N3-notify
---

# Tasks · N3 thông báo dùng chung

Một agent một lát (Luật 1b). Làn: **đầy đủ** = phần chạm tenant/RLS/secret (test viết trước code), **nhanh** = còn lại.

| # | Task | Làn | Rủi ro | Mã | Trạng thái |
|---|---|---|---|---|---|
| T1 | spec/plan/tasks, ADR-0027 Proposed | nhanh | thường | N3-FR-07 | [x] |
| T2 | Test cách ly trước: enqueue cùng tx/rollback, tenant giả, role gói, RLS chéo tenant, idempotency (`tests/acceptance/N3/isolation.int.test.ts`) | đầy đủ | cao | FR-01/02/03, NFR-02 | [x] |
| T3 | Migration hub 0040 + kit 0004, contracts zod, secret kinds | đầy đủ | cao | FR-01/08 | [x] |
| T4 | Domain + ports + dispatch + repo + transport giả + kho secret | đầy đủ | cao | FR-05/06/07/08 | [x] |
| T5 | Route inbox/prefs/push + mount + vòng worker + gói `Notifier` | nhanh | thường | FR-04/09 | [x] |
| T6 | Perf `*.perf.int.test.ts` (lô 100, 10.000) + đếm câu | đầy đủ | cao | NFR-01 | [x] |
| T7 | FE chuông S16 (danh sách, chưa đọc, đã đọc, tùy chọn) + e2e | nhanh | thường | FR-09 | [x] |
| T8 | Cổng: typecheck, depcruise, check:fn/size, int N3+N1, e2e, bundle, lock | — | — | — | [x] |

## Quyết định trong lúc làm
- Hàm cổng ở schema `notify` (không `hub`): role gói giữ nguyên "không USAGE hub" (PK-AC03); `RESERVED_PACK_KEYS` + `packs.check_key` thêm `notify`.
- Migration đánh số 0040 (hub) / 0004 (kit), `when` lớn để không đảo thứ tự với N2 (0041) và N5.
- `notify.enqueue` bỏ qua lặng lẽ người nhận ngoài tenant thay vì RAISE (không để lỗi dữ liệu của một người làm hỏng tx nghiệp vụ); trả số hàng mới.
- Hạn thuê đặt vào `next_attempt_at` (status `sending`) thay cột riêng ⇒ một index partial phục vụ cả "tới hạn" lẫn "thuê hết hạn".
- Đăng ký push dùng scope system với tenant/user từ token (một endpoint trình duyệt có thể đang gắn người dùng trước).
- Chuông: popover rỗng giữ nguyên DOM/ảnh baseline S16; tùy chọn kênh chỉ hiện khi đã có thông báo (D-05). Proxy dev/preview thêm `/notifications` → hub.
- `test:lock:write` chỉ ghi dòng của file N3 (tests/acceptance/N3, e2e/contracts-web/bell.cw.ts) vì cây làm việc chung có test dở dang của N2/N5/HD2.

## Tranh chấp test
(không)
