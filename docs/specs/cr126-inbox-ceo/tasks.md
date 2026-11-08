---
id: cr126-inbox-ceo
lÃ¡t: cr126-inbox-ceo
cr: CR-126
lÃ n: nhanh
migration: khÃ´ng
phá»¥ thuá»™c:
---
## Plan (ngáº¯n)
Â«Viá»‡c cá»§a tÃ´iÂ» cho giÃ¡m Ä‘á»‘c: má»—i dÃ²ng nÃ³i Ä‘iá»u Ä‘ang duyá»‡t Â«quy trÃ¬nh Â· Ä‘á»‘i tÃ¡c Â· sá»‘ tiá»n Â· ngÆ°á»i Ä‘á» xuáº¥t Â· ngÃ yÂ»; má»™t kiá»ƒu dÃ²ng cho kÃ½ / duyá»‡t HÄ / viá»‡c yÃªu cáº§u, sáº¯p theo háº¡n rá»“i chá» lÃ¢u nháº¥t; chip Táº¥t cáº£ Â· Cáº§n duyá»‡t Â· Cáº§n kÃ½.

## LÃ m
- Hub: `GET /me/review-tasks` thÃªm `process_run.request {title, partner, amount}` tá»« phiáº¿u cá»§a lÆ°á»£t (cÃ¹ng cÃ¢u SQL, join lÆ°á»£t cha cho lÆ°á»£t con; khÃ´ng truy váº¥n thÃªm). `notify/task-request-summary.ts`.
- Web: `overview/lib/inbox.ts` (dá»±ng dÃ²ng, tÃ³m táº¯t, sáº¯p, lá»c), `InboxRowList.tsx`, `ApprovalsInboxPage`, `use-inbox` (+`itemByTask`), i18n vi+en.

## KhÃ´ng lÃ m / Cháº¡m
- KhÃ´ng Ä‘á»¥ng RequestPage/RequestsPage. DÃ²ng duyá»‡t HÄ khÃ´ng thuá»™c lÆ°á»£t quy trÃ¬nh chá»‰ cÃ³ Â«sá»‘ Â· tÃªn HÄÂ» (`/my-work` chÆ°a cÃ³ Ä‘á»‘i tÃ¡c/sá»‘ tiá»n).

## Test tá»‘i thiá»ƒu
unit `task-request-summary.test.ts`, `inbox.test.ts`; int: `purchase-child-task.int.test.ts` (sá»‘ tiá»n lÆ°á»£t con láº¥y tá»« phiáº¿u lÆ°á»£t cha).

## Quyáº¿t Ä‘á»‹nh trong lÃºc lÃ m
- Äá»‘i tÃ¡c = Ã´ text cÃ³ khoÃ¡/nhÃ£n nÃ³i vá» Ä‘á»‘i tÃ¡c/NCC/khÃ¡ch; tiá»n = Ã´ kiá»ƒu `money` Ä‘áº§u tiÃªn (phiáº¿u chÆ°a cÃ³ kiá»ƒu Â«Ä‘á»‘i tÃ¡cÂ»).
- Â«Cáº§n duyá»‡tÂ» = má»i viá»‡c khÃ´ng pháº£i kÃ½.

## Delta (so vá»›i docs/current)
Tráº¡ng thÃ¡i gá»™p: chÆ°a gá»™p

### MODIFIED sht/duyet-ky-so.md
#### YÃªu cáº§u: Â«Viá»‡c cá»§a tÃ´iÂ» nÃ³i rÃµ Ä‘iá»u Ä‘ang duyá»‡t
Má»—i dÃ²ng cá»§a Â«Viá»‡c cá»§a tÃ´iÂ» lÃ  má»™t kiá»ƒu chung cho kÃ½, duyá»‡t HÄ vÃ  viá»‡c yÃªu cáº§u: nhÃ£n bÆ°á»›c, rá»“i Â«quy trÃ¬nh Â· Ä‘á»‘i tÃ¡c/NCC Â· sá»‘ tiá»n Â· ngÆ°á»i Ä‘á» xuáº¥t Â· ngÃ yÂ» láº¥y tá»« phiáº¿u cá»§a lÆ°á»£t (pháº§n thiáº¿u thÃ¬ bá»). Sáº¯p theo háº¡n gáº§n nháº¥t, rá»“i viá»‡c chá» lÃ¢u nháº¥t. Chip Â«Táº¥t cáº£ Â· Cáº§n duyá»‡t Â· Cáº§n kÃ½Â» lá»c danh sÃ¡ch.
- Ká»‹ch báº£n: khi lÆ°á»£t cÃ³ phiáº¿u thÃ¬ `/me/review-tasks` tráº£ sá»‘ tiá»n cá»§a phiáº¿u (lÆ°á»£t con láº¥y phiáº¿u lÆ°á»£t cha) [test: apps/hub-api/src/modules/processes/nodes/subprocess/purchase-child-task.int.test.ts Â» CR-126 Â· viá»‡c Ä‘áº§u cá»§a lÆ°á»£t con hiá»‡n trong Â«Chá» tÃ´i duyá»‡tÂ»]
- Ká»‹ch báº£n: khi phiáº¿u cÃ³ Ã´ tiá»n vÃ  Ã´ nhÃ  cung cáº¥p thÃ¬ tÃ³m táº¯t láº¥y Ä‘Ãºng hai Ã´, thiáº¿u thÃ¬ null [test: apps/hub-api/src/modules/processes/notify/task-request-summary.test.ts Â» requestSummary]
- Ká»‹ch báº£n: khi cÃ³ viá»‡c kÃ½, duyá»‡t, yÃªu cáº§u thÃ¬ sáº¯p háº¡n trÆ°á»›c rá»“i chá» lÃ¢u nháº¥t vÃ  chip lá»c Ä‘Ãºng [test: apps/workspace-web/src/features/overview/lib/inbox.test.ts Â» inbox rows]

## Viá»‡c cÃ²n láº¡i
- e2e chÆ°a cháº¡y (giá»¯ testid cÅ©; `approval-tasks`/`signing-tasks` khÃ´ng cÃ²n, `requests-waiting` bao má»i dÃ²ng).
- DÃ²ng duyá»‡t HÄ ngoÃ i lÆ°á»£t quy trÃ¬nh chÆ°a cÃ³ Ä‘á»‘i tÃ¡c/sá»‘ tiá»n (cáº§n thÃªm vÃ o `/my-work`).
