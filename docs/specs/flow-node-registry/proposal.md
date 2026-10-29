---
id: flow-node-registry
cr: CR-103
trạng thái: đề xuất — chờ người dùng duyệt
ngày: 2026-10-29
---
# Đề xuất: Engine flow dạng lõi + node cắm được, rẽ nhánh if/else, trang showcase

## Vì sao
- Engine flow (hub-api `processes`, ~20k dòng, 176 file) đã chạy thật cho luồng duyệt HĐ (gói contracts, HD2/HD3, N2) và
  `kh`. Nó đã có: bước song song ≤ 3 stage + chờ đủ (join), rẽ nhánh sau Đạt, quay lại, hẹn giờ, nhắc/chuyển cấp, thử lại
  theo loại lỗi, gọi tool MCP, nhóm agent.
- **Nhưng loại node không cắm được.** `executor.kind` (agent | team | apply | wait_until | tool) được rẽ bằng chuỗi `if`
  ở **35 chỗ trong 17 file** (launcher, launcher-step, launcher-session, stage-driver, team-runner, team-exec, view.*,
  def.rules, defs.service, wait-stage.rules, apply-driver, `kh`, FE `stage-convert`). Thêm một loại node = sửa ~10 file,
  dễ sót một nhánh.
- **Rẽ nhánh còn hẹp**: mỗi luật một điều kiện (`field op value` → `goto_step`), luật đầu khớp thắng, không AND/OR, không
  "else" tường minh. Gói contracts lại có điều kiện AND/OR riêng (`approval-flow.ts` `FlowWhen`) — hai kiểu điều kiện.
- Không có chỗ nào cho thấy engine làm được gì: editor (`admin-web /processes`) đang **đóng băng** trên prod
  (`docs/platform/modules.md`), chat AI lại phụ thuộc subscription Claude.

## Thay đổi gì
1. **R1 · Registry node (lõi không biết loại node).** Mỗi loại node là một module `nodes/<kind>/` cài một interface chung
   (kiểm def, chạy, chốt, dựng view). Lõi (bước, join, rẽ nhánh, hẹn giờ, thử lại, cổng duyệt) chỉ gọi registry.
   Không đổi hành vi, không đổi contract API, không migration.
2. **R2 · Node If (if/else).** Loại node mới `if`, họ `control`, đứng ở một bước riêng, chạy tức thì (không AI, không
   output): điều kiện `when: {op: and|or, conds[]}` (cùng dạng `FlowWhen` của gói contracts) trên field output của các
   stage bước trước + input của run ⇒ nhánh Đúng `then_step` / Sai `else_step` (bước kế nếu vắng). Nối tiếp nhiều node If
   = if lồng. Luật `after.branch` cũ giữ nguyên (snapshot cũ chạy như trước). Canvas vẽ node If hình thoi.
   Lâu dài: khi chuyển engine sang đồ thị (node + cạnh) thì node If giữ nguyên, chỉ thay lõi.
3. **R3 · Đổi node cùng họ.** Mỗi loại node thuộc một **họ** (`work` | `wait` | `apply`). Trong editor, đổi loại node
   chỉ cho trong cùng họ và khi node mới vẫn cung cấp đủ field mà bước sau dùng (rẽ nhánh, `wait_until.from`). Giữ nguyên
   tên, bước, cổng duyệt, người trả lời, output; chỉ đặt lại cấu hình riêng của node. Run đang chạy không bị ảnh hưởng
   (chạy theo snapshot).
4. **R4 · Trang showcase + node `set`.** Node mới `set` (họ `work`, không cần AI: ghi field từ input/hằng) — cũng là
   bằng chứng registry: thêm loại node chỉ cần 1 module BE + 1 editor FE + 1 dòng contract. Trang
   `admin-web /processes/showcase`: vẽ flow mẫu (song song → join → if/else), nút "Chạy thử", dòng thời gian trực tiếp,
   duyệt ngay trên trang, ô "đổi node" minh hoạ R3. Chạy được kể cả khi AI tạm ngưng.

## Không làm
- Engine động (thêm loại node lúc chạy, plugin ngoài) — người dùng: "hiện tại không cần dynamic".
- Đồ thị tự do, > 3 nhánh song song, gộp "nhánh nào xong trước", nhánh lùi qua điều kiện (lùi vẫn chỉ qua `back_to_steps`).
- Viết lại engine thành đồ thị (node + cạnh tự do, ~1–1,5 tuần) — để CR sau; node If đợt này dùng lại được.
- Mở băng chat-web (hộp thư quy trình, phòng) — chỉ mở route editor/run cho admin-web.

## Ảnh hưởng
| Phần | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| hub-api `processes` (lõi + `nodes/`) | tách | `domain/branch` | — | `nodes/set` |
| `packages/contracts` (process def) | — | `BranchRule` | — | +`set` executor |
| admin-web `features/processes` | registry FE | `BranchRuleRow` | chọn loại node | trang showcase |
| gói contracts (`approval-flow`) | — | dùng chung kiểu điều kiện | — | — |
| `kh` | qua registry | — | — | — |
| DB | không | không | không | không (seed flow mẫu bằng script) |
| Cờ / đóng băng | mở băng engine (CR-095) | | | mở route `/process-defs`, `/process-runs` cho admin-web |

Rủi ro: R1 chạm đường nóng của engine (launcher/stage-driver) đang chạy luồng duyệt HĐ thật ⇒ làn đầy đủ: Opus, không đổi
hành vi, `test:frozen` + int processes + perf hiện có phải xanh, số đo trước/sau.

## Quyết định (người dùng chốt 2026-10-29)
1. If/else: **node If trong registry (họ `control`)** — chọn vì dùng lâu dài được (giữ nguyên khi lên engine đồ thị).
2. Điều kiện đọc: **field output của stage bước trước + input của run**.
3. Showcase: **admin-web `/processes/showcase`, admin tenant + admin platform; mở `/process-defs`, `/process-runs` cho
   admin-web (chat-web vẫn đóng băng)**.
4. Node `set` hiện trong editor cho mọi flow (người dùng ghi "4", hiểu là A).
5. Đổi node chỉ trong cùng họ.
