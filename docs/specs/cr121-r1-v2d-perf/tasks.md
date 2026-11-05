---
id: cr121-r1-v2d-perf
lát: cr121-r1-v2d-perf
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-q4-contract-name
---
## Plan (ngắn)
`verify:wave` 2 trên gd0 11b9bae3 đỏ 1 ca: `tests/acceptance/V2-D/perf.int.test.ts` › "1 dòng = 20 dòng; Mua và Bán như nhau" ra `[10, 11, 10, 10]`
(mong `[10, 10, 10, 10]`). Nghi Q-4 làm số câu SQL phụ thuộc số dòng.

## Làm
Tái hiện trên evotest, không đổi code và không đổi ngưỡng:
- Lượt `perf.int.test.ts` riêng ở 11b9bae3 (có Q-4) và 77d37f17 (trước Q-4): cả hai xanh, 43 s.
- Vòng chẩn đoán tạm (không commit): 40 lần xác nhận mốc giao xen kẽ 1 và 20 dòng, Mua và Bán, ở 11b9bae3 ⇒ MỌI lần đúng 10 câu, cùng một bộ câu
  (không câu nào xuất hiện lệch số lần).

## Không làm / Chạm
Không sửa `service-customers.repo`, không sửa ngưỡng `STMTS` hay `captureSql`. Đường xác nhận mốc giao không đi qua chỗ Q-4 đổi theo số dòng:
Q-4 chỉ thay biểu thức cột tên HĐ trong cùng câu SQL (không thêm/bớt câu).

## Test tối thiểu
Không thay đổi test.

## Quyết định trong lúc làm
Nguyên nhân gốc: số câu của đường xác nhận mốc giao là CỐ ĐỊNH (10) và không phụ thuộc số dòng hay Mua/Bán. Ca đỏ là một câu thừa ở lượt 20 dòng Mua,
đến từ `captureSql` đếm MỌI câu của pool Hub trong cửa sổ đo (cả vòng nền/nạp lại cache sau NOTIFY của Hub cùng tiến trình khi cả đợt chạy nặng),
không do Q-4. Chưa bắt được văn bản câu thừa (log wave chỉ có số đếm). Nếu tái diễn: ghi `queries[].text` khi lệch (một dòng trong test) rồi lọc đúng
câu nền đó trong `captureSql` — việc của test-kit, không phải của Q-4.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ điều tra; không đổi code hay test, ca đỏ không do Q-4).

## Việc còn lại
Bắt văn bản câu thừa nếu `V2-D/perf` đỏ lại trong wave (xem Quyết định).
