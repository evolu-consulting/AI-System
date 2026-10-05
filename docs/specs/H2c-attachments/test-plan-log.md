# Test plan · H2c-attachments — nhật ký §10 (qc)

Tách từ [`test-plan.md`](test-plan.md) §10 ngay từ TEST-PLAN (trần 25 600 B mỗi file). Ghi theo khuôn H2b [`test-plan-log.md`](../H2b-routing/test-plan-log.md).

## 10. Đỏ đúng lý do · nhật ký
Chưa chạy (TEST-PLAN). Sau mỗi nhóm WRITE (QW-R, QW-A1, QW-A2 + MK-U, QW-PU, QW-P): bảng `File · ID · đỏ đúng lý do / tổng · lý do đỏ · xanh trước code (lý do)` + "Lệch plan / cần backend-lead"; DB riêng `ai_system_h2c_<nhóm>_{,hub_}test` (ghi đã drop). Q2/Q-PU/Q3: số dòng `UNLOCKED`/`CHANGED` trước ghi (Q2: đúng 1 `CHANGED tools/hub-dev/src/dify-mock.ts` + hồi quy MK-U xanh), tổng file lock, `git diff tests/.lock` chỉ thêm/đổi đúng các dòng đó. Tranh chấp: bảng TC như H2b (`#`, test, phán quyết, sửa, kết quả; kiểm cả file 3 lần liên tiếp trên DB riêng). I1: bảng 18 bước `done:h2c` (test-plan §7.1).

### Bài học áp dụng từ H2b (kiểm trước khi báo "đỏ đúng lý do")
| # | Bài học | Áp vào H2c |
|---|---|---|
| B1 | TC-3: id cố định trùng giữa ca/lần chạy, key Redis cũ | `crypto.randomUUID()`/`uuid4()` mọi id chèn SQL; id cố định ⇒ `DEL run:<id> sse:<id>` |
| B2 | I1 H2a: DB Hub/Runtime chung DB TS ⇒ `DuplicateTableError` | DB `…_hub_test` riêng (`HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) |
| B3 | `run.ts` Windows → container không thấy env shell | Env DB đặt **trong chuỗi lệnh** truyền cho `run.ts`; chỉ export 4 biến DB, không `source` file có PEM |
| B4 | TC-5/TC-7 (H2a stack): `AGENT_RT_ORPHAN_S=5` với heartbeat mặc định ⇒ job bị coi mồ côi | Đặt `AGENT_RT_HEARTBEAT_S=1` khi hạ orphan |
| B5 | TC-4: Hub chạy host, chỉ container dùng `host.docker.internal` | Catalog `base_url` `localhost`; Runtime `AGENT_RT_HUB_URL`/MK qua `host.docker.internal` + `--add-host …:host-gateway` |
| B6 | TC-3/TC-6: đọc ngay sau đổi cấu hình, điều kiện chờ thoả sớm | Chờ cache Hub ≤ 5 s bằng điều kiện phản ánh **thay đổi cuối**; ca tự dọn ở `finally` |
| B7 | TC-4/TC-7: helper tự chèn dữ liệu sau `counts()`, đếm trước khi run của ca ghi xong | Tạo hội thoại trước `counts()`; `settleRuns` trước khi đếm |
| B8 | Lọc test sai: `bun run test:int <path>` chạy cả repo | `bun --env-file=… --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2c/<file>`; stack/hubdev `--config=bunfig.stack.toml` |
| B9 | AC-08 H2c: ca không dựng được qua int (F15, L4) | Gọi thẳng `fetch_attachments`; không ép int vào nhánh không tới được |
