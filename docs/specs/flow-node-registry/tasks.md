---
id: flow-node-registry
lát: flow-node-registry
cr: CR-103
làn: đầy đủ (R1) / nhanh (R2–R4)
migration: không
phụ thuộc:
---
## Plan (ngắn)
Xem `proposal.md` + `design.md`. Hai đợt: (1) R1 ∥ R2, (2) sau R1: R3 ∥ R4. Review + security một lượt cuối đợt;
`test:frozen` + `test:all` + e2e một lần cuối.

## Việc
- [ ] R1 `fnr-registry` (Opus, làn đầy đủ): `nodes/registry.ts` + 5 module node; lõi gọi registry; FE registry +
      `stage-convert`; test "kind ↔ registry" + test import; `test:frozen` + int processes + perf xanh, số đo trước/sau.
- [ ] R2 `fnr-cond` (Sonnet): contract `when/conds/else_goto_step` + chuẩn hoá snapshot cũ; `domain/branch` đánh giá
      AND/OR/else + input; `branch-def.rules` + parity; FE `BranchRuleRow`/`StageBranch`; unit + 1 int.
- [ ] R3 `fnr-swap` (Sonnet, sau R1): `canSwap` thuần (contracts) + chọn loại node trong editor theo họ; unit.
- [ ] R4 `fnr-showcase` (Sonnet, sau R1): node `set`, seed flow mẫu, trang `/processes/showcase`, mở route cho admin-web;
      unit + 1 int + file e2e (chạy cuối đợt).

## Quyết định trong lúc làm
- 2026-10-29 người dùng: mở băng engine, làm cả 4; viết proposal theo OpenSpec trước khi code.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-engine.md
#### Yêu cầu: Loại node cắm qua registry
Lõi engine không rẽ theo loại node; mỗi loại node là một module đăng ký với registry.
- Kịch bản: khi thêm loại node mới thì chỉ thêm một schema contract, một module `nodes/<kind>` và một editor FE, không sửa lõi
- Kịch bản: khi contract có loại node chưa đăng ký thì test registry đỏ

#### Yêu cầu: Rẽ nhánh if/else
Luật rẽ nhánh gồm nhiều điều kiện AND/OR trên field output của stage và input của run, có nhánh else.
- Kịch bản: khi luật có `and` và mọi điều kiện đúng thì run nhảy tới `goto_step`, các bước giữa bị bỏ qua
- Kịch bản: khi không luật nào khớp và có `else_goto_step` thì run nhảy tới bước else
- Kịch bản: khi không luật nào khớp và không có else thì run sang bước kế
- Kịch bản: khi run chạy theo snapshot cũ dạng `field/op/value` thì kết quả rẽ nhánh như trước

#### Yêu cầu: Đổi node cùng họ
Editor chỉ cho đổi loại node trong cùng họ (work/wait/apply) và khi field mà bước sau dùng vẫn còn.
- Kịch bản: khi đổi `agent` sang `tool` mà luật rẽ nhánh dùng field vẫn khai báo thì lưu được
- Kịch bản: khi đổi `agent` sang `wait_until` thì editor không cho chọn
- Kịch bản: khi run đang chạy và def bị đổi node thì run vẫn chạy theo snapshot cũ

#### Yêu cầu: Node set và trang showcase
Node `set` ghi field từ input/hằng không cần AI; trang `/processes/showcase` chạy thử flow mẫu.
- Kịch bản: khi admin bấm "Chạy thử" với số tiền 150.000.000 và mục đích "mua sắm" thì sau hai bước duyệt song song run tới "Giám đốc duyệt"
- Kịch bản: khi số tiền 50.000.000 thì run đi nhánh else "Hoàn tất"
- Kịch bản: khi dịch vụ AI tạm ngưng thì flow mẫu vẫn chạy hết

## Việc còn lại
Chờ người dùng duyệt proposal (5 câu hỏi trong `proposal.md`). Sau đó tạo các lát `fnr-*`.
