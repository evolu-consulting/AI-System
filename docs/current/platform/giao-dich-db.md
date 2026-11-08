# Platform · Giao dịch DB chịu mất kết nối

Cập nhật: 2026-11-09 · Gộp từ: cr116-db-reliable (đợt cr125-wave).

## Yêu cầu: Transaction chịu được mất kết nối Postgres (CR-116) (nguồn: cr116-db-reliable)
Mọi transaction qua withScope / withHubScope / withPackScope / withPackJobScope: mất kết nối (CONNECTION_CLOSED, ECONNRESET, EPIPE, 57P01–57P03, 08xxx) TRƯỚC COMMIT ⇒ chạy lại cả tx (tối đa 3 lần, backoff ngắn, một dòng log mỗi lần); mất kết nối lúc/sau COMMIT ⇒ không chạy lại, ném lỗi mã `TX_OUTCOME_UNKNOWN`; không lỗi nào của driver thoát ra tiến trình; kết nối của pool dùng lại được ngay.
- Kịch bản: khi backend của tx bị kết thúc trước COMMIT thì tx chạy lại, chỉ còn hàng của lần thành công, không lỗi thoát tiến trình, pool dùng lại được [test: packages/db/src/tx-conn-loss.int.test.ts » chết TRƯỚC COMMIT ⇒ chạy lại, đúng 1 hàng của lần thành công, không lỗi thoát tiến trình]
- Kịch bản: khi backend bị kết thúc trong lúc COMMIT thì người gọi nhận TX_OUTCOME_UNKNOWN, callback không chạy lại [test: packages/db/src/tx-conn-loss.int.test.ts » chết TRONG COMMIT ⇒ TX_OUTCOME_UNKNOWN, không chạy lại, không lỗi thoát tiến trình]
- Kịch bản: khi phân loại lỗi thì 40P01/40001 luôn chạy lại, mất kết nối chạy lại chỉ khi chưa tới COMMIT, lỗi khác ném nguyên [test: packages/db/src/tx-retry.test.ts » mất kết nối trước COMMIT ⇒ conn-retry, lúc/sau COMMIT ⇒ unknown]
