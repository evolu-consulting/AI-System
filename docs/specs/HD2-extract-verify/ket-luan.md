# Kết luận lát HD2 Đọc và kiểm hợp đồng (2026-10-19)

Quyết định: **đóng HD2** (CR-094 đợt 2; làn đầy đủ cho phần tenant + prompt injection, làn nhanh cho FE). Cổng gộp và số đo: [`wave2-gate.md`](../wave2-gate.md). Số perf là số Windows dev. **Trích chưa nối Hub thật** (§4).

## 1. Phạm vi đã giao

HD-FR-21 AI đọc hợp đồng (prompt + rào injection + parse strict, contract `extract.ts`) · HD-FR-22/23 kiểm trích dẫn và cảnh báo (domain thuần, port từ `test_contract_verify.py`; văn bản > 200.000 ký tự chạy Bun Worker) · HD-FR-24 hàng đợi trích, use case, route `/extract` (hạn giờ `CONTRACTS_EXTRACT_TIMEOUT_S` 300 s) · HD-FR-25 tra MST (giãn 2 s, hẹn tra lại) · HD-FR-26 nhập tay · FE S04/S05, `GET …/file-link` cho "Xem file gốc".

## 2. Kết quả

| Hạng mục | Kết quả |
|---|---|
| Security (1 vòng, chỉ đọc) | CHANGES REQUESTED rồi **SAFE** sau sửa: M1 đầu ra agent có NUL/surrogate lẻ/năm 0000 làm HĐ kẹt `extracting` (sửa `pgText`/`outDate`, `SAVE_FAILED`); m2–m4 tra MST (lọc ký tự điều khiển, kẹp Retry-After, trần thân 64 KiB) |
| Review (`review.md`) | **APPROVED** (`3108d40b`): 0 Cao, 4 Trung, 10 Thấp; Trung 1–4 và #220 sửa ở `72313ab3` |
| Cổng gộp 2026-10-19 | e2e `e2e:contracts` 25/25 ×3 (S04 ×3, S05 ×4, `hd2-flow`); int HD2 xanh (xem `wave2-gate.md`) |
| Perf (`PERF=1`) | `verify` HĐ 30.000 ký tự: p50 1,6 ms · p95 2,7 ms · max 3,6 ms (ngưỡng 5 ms); Worker 5 MB/500 dòng: 577 ms, nghẽn vòng sự kiện 6,1 ms (tại chỗ 566 ms); lượt trích 5 câu SQL cố định |

Commit: `4644367f` (lát) · `3108d40b` (review) · `72313ab3` (vòng sửa).

## 3. Quyết định chính

D2-01 `AgentTransport` là port, chưa có bản thật; D2-02 hàng đợi trong tiến trình; D2-05 "Xem file gốc" xin link có Bearer rồi mở tab. Thấp 10 (strict tuyệt đối) giữ; Thấp 11 (`clauses` chưa có `heading`/`chunk_id`) làm khi có lát tìm kiếm điều khoản.

## 4. Chưa nối Hub

**TECH-DEBT #219**: trích của HD2 **chưa nối một run Hub thật** (chưa có `AgentTransport` thật qua N2 `PackRunsBridge`). Production chưa trích: tải lên ở `extracting`, trích lại trả 503 `AGENT_UNAVAILABLE`. #219 chuyển sang **HD3**. Kèm #218 (hàng đợi trong tiến trình, HĐ kẹt `extracting` khi khởi động lại), #221 (giới hạn tần suất `/extract`, `/manual` theo tenant).

## 5. Việc còn lại

| Việc | Ai | Khi |
|---|---|---|
| Nối `AgentTransport` thật = run agent Claude không tool qua N2 (#219) | backend-lead | HD3 |
| Hàng đợi bền hoặc vòng quét `extracting` (#218), giới hạn tần suất (#221) | backend-lead | HD3 |
| Key OpenAI/agent cho trích thật | Người dùng | HD3 |
