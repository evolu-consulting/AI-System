---
id: cr116-db-reliable
lát: cr116-db-reliable
cr: CR-116
làn: đầy đủ (tx/retry, test trước)
migration: không
phụ thuộc: cr116-bench-apps (đo Vòng 2)
---
## Plan (ngắn)
Đo (cr116-bench-apps "Vòng 2"): `pg_terminate_backend` giữa tx với postgres.js 3.4.9 ⇒ `CONNECTION_CLOSED` + `TypeError socket.write` (null) thoát ra tiến trình; lớp thử lại chỉ biết 40P01/40001.
1. Int test tái hiện TRƯỚC (đỏ đã thấy: CONNECTION_CLOSED không chạy lại, lần nối lại kế tiếp treo tới CONNECT_TIMEOUT 30 s).
2. Vá driver bằng `bun patch` (patches/postgres@3.4.9.patch), không nâng 4.0.0.
3. Một vòng thử lại chung `runTx` (packages/db/src/tx-retry.ts) cho withScope / withHubScope / withPackScope / withPackJobScope.

## Làm
- [x] `packages/db/src/tx-conn-loss.int.test.ts` (withHubScope + withScope; chết trước COMMIT / trong COMMIT bằng constraint trigger hoãn).
- [x] `patches/postgres@3.4.9.patch` (src + cjs): (a) `execute()` khi socket đã null ⇒ reject CONNECTION_CLOSED, không lên lịch ghi; (b) `nextWrite()` socket null ⇒ bỏ chunk, không ném; (c) `closed()` xoá chunk/nextWriteTimer cũ, fail cả `sent`/`query` còn lại khi hadError, xoá `errorResponse` cũ.
- [x] `tx-retry.ts`: `classifyTxError`, `runTx`, `TxOutcomeError` (TX_OUTCOME_UNKNOWN), `setTxRetryObserver`; unit `tx-retry.test.ts`.

## Không làm / Chạm
- Không nâng postgres.js 4.0.0 (đủ tuổi sau 2026-11-12). Không thêm process guard `uncaughtException` (vá gốc; int test bắt mọi lỗi thoát tiến trình nên mất vá là đỏ ngay).
- Không tự đọc lại cho từng đường idempotent (người gọi nhận `TX_OUTCOME_UNKNOWN`, quyết định ở use case).

## Test tối thiểu
- unit `packages/db/src/tx-retry.test.ts`; int `packages/db/src/tx-conn-loss.int.test.ts` + int có sẵn của retry 40P01/40001 (hub-rls, rls, hub-uow, config-write, lock-order) trên evotest.

## Quyết định trong lúc làm
- Nguyên nhân TypeError (đọc mã 3.4.9): `begin()` gửi `ROLLBACK` sau khi `closed()` đã đặt `socket = null` ⇒ `write()` hẹn `setImmediate(nextWrite)` ⇒ `socket.write` trên null, ném trong pha check (không try/catch nào bắt). Ném giữa `nextWrite` để lại `chunk`/`nextWriteTimer` ⇒ StartupMessage lần nối lại không gửi ⇒ treo tới CONNECT_TIMEOUT. Thêm 2 lỗi cùng họ khi viết test: ROLLBACK xếp sau sự kiện `error` nằm lại `sent` (lệch phản hồi phiên mới, tx treo) và `errorResponse` 57P01 cũ làm hỏng câu đầu của kết nối mới.
- Linux (evotest) treo 30 s, Windows khong: sau khi socket da dong, ROLLBACK cua begin() vao `execute()` voi `socket = null`; ban va dau tra `undefined` nen `c.execute(q) || move(c, full)` (index.js handler) day ket noi DA DONG vao hang `full` => khong bao gio noi lai. Linux phat 'close' truoc khi ROLLBACK chay, Windows thi sau. Va (a) nay tra `true` (ket noi van nam hang `closed`).
- Upstream: porsager/postgres PR #1168 "Guard nextWrite against null socket after async close" (thấy qua tìm kiếm, chưa xác minh đã merge; chỉ vá (b), không vá (a)/(c)).
- "Đã tới COMMIT" = callback tx đã trả về (`bodyDone`); 40P01/40001 vẫn chạy lại kể cả lúc COMMIT (server chắc chắn rollback).
- Backoff chỉ cho mất kết nối: 20 ms rồi 80 ms (+ jitter ≤ 50%), tối đa SCOPE_MAX_ATTEMPTS = 3; 40P01/40001 chạy lại ngay như cũ. Đây là giãn cách giữa hai lần thử, không phải chờ trạng thái (Luật 4c).
- Log mỗi lần thử lại: `level=warn msg=db.tx.retry reason=… code=… attempt=… backoff_ms=…` (tắt dưới NODE_ENV=test; app thay bằng `setTxRetryObserver`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED platform/giao-dich-db.md
#### Yêu cầu: Transaction chịu được mất kết nối Postgres (CR-116)
Mọi transaction qua withScope / withHubScope / withPackScope / withPackJobScope: mất kết nối (CONNECTION_CLOSED, ECONNRESET, EPIPE, 57P01–57P03, 08xxx) TRƯỚC COMMIT ⇒ chạy lại cả tx (tối đa 3 lần, backoff ngắn, một dòng log mỗi lần); mất kết nối lúc/sau COMMIT ⇒ không chạy lại, ném lỗi mã `TX_OUTCOME_UNKNOWN`; không lỗi nào của driver thoát ra tiến trình; kết nối của pool dùng lại được ngay.
- Kịch bản: khi backend của tx bị kết thúc trước COMMIT thì tx chạy lại, chỉ còn hàng của lần thành công, không lỗi thoát tiến trình, pool dùng lại được [test: packages/db/src/tx-conn-loss.int.test.ts » chết TRƯỚC COMMIT ⇒ chạy lại, đúng 1 hàng của lần thành công, không lỗi thoát tiến trình]
- Kịch bản: khi backend bị kết thúc trong lúc COMMIT thì người gọi nhận TX_OUTCOME_UNKNOWN, callback không chạy lại [test: packages/db/src/tx-conn-loss.int.test.ts » chết TRONG COMMIT ⇒ TX_OUTCOME_UNKNOWN, không chạy lại, không lỗi thoát tiến trình]
- Kịch bản: khi phân loại lỗi thì 40P01/40001 luôn chạy lại, mất kết nối chạy lại chỉ khi chưa tới COMMIT, lỗi khác ném nguyên [test: packages/db/src/tx-retry.test.ts » mất kết nối trước COMMIT ⇒ conn-retry, lúc/sau COMMIT ⇒ unknown]

## Việc còn lại
- **Perf chưa đo:** evotest bị lượt `-Exclusive` khác (owner a08c40a9, từ 20:06) giữ suốt 20:39–21:08 — cả lượt int lẫn `perf:compare --scenario contracts.read|chat.first-delta --runs 3` chỉ xếp hàng; đã huỷ. Chạy lại: `bun run perf:compare --scenario contracts.read --runs 3` và `--scenario chat.first-delta`. Dự kiến không đổi: không thêm câu SQL, mỗi tx thêm một closure + một cờ.
- Int đã chạy LOCAL (`test:int:par`, 7 file: tx-conn-loss, hub-rls, rls, hub-uow, config-write, lock-order, packs-install) 49 pass / 0 fail; chưa chạy trên evotest (cùng lý do).
- Đường idempotent cần "đọc lại để quyết định" khi `TX_OUTCOME_UNKNOWN` (vd outbox/followup): chưa có use case nào đổi; ghi nhận cho lát sau.
- Bỏ patch khi lên postgres.js ≥ bản có vá tương đương (kiểm 4.x sau 2026-11-12).
