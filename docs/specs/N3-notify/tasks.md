---
id: N3-notify
---

# Tasks · N3 thông báo dùng chung

Một agent một lát (Luật 1b). Làn: **đầy đủ** = phần chạm tenant/RLS/secret (test viết trước code), **nhanh** = còn lại.

| # | Task | Làn | Rủi ro | Mã | Trạng thái |
|---|---|---|---|---|---|
| T1 | spec/plan/tasks, ADR-0027 Proposed | nhanh | thường | N3-FR-07 | [x] |
| T2 | Test cách ly trước: enqueue cùng tx/rollback, tenant giả, role gói, RLS chéo tenant, idempotency (`tests/acceptance/N3/isolation.int.test.ts`) | đầy đủ | cao | FR-01/02/03, NFR-02 | [ ] |
| T3 | Migration hub 0040 + kit 0004, contracts zod, secret kinds | đầy đủ | cao | FR-01/08 | [ ] |
| T4 | Domain + ports + dispatch + repo + transport giả + kho secret | đầy đủ | cao | FR-05/06/07/08 | [ ] |
| T5 | Route inbox/prefs/push + mount + vòng worker + gói `Notifier` | nhanh | thường | FR-04/09 | [ ] |
| T6 | Perf `*.perf.int.test.ts` (lô 100, 10.000) + đếm câu | đầy đủ | cao | NFR-01 | [ ] |
| T7 | FE chuông S16 (danh sách, chưa đọc, đã đọc, tùy chọn) + e2e | nhanh | thường | FR-09 | [ ] |
| T8 | Cổng: typecheck, depcruise, check:fn/size, int N3+N1, e2e, bundle, lock | — | — | — | [ ] |

## Quyết định trong lúc làm
(ghi ở đây khi làm)

## Tranh chấp test
(không)
