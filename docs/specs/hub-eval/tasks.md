---
id: hub-eval
lát: hub-eval
cr: CR-114
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Bộ eval chất lượng dùng lại cho agent Hub + bộ đo khuôn log, chạy một lệnh, không đụng code runtime của Hub.
- `bun run eval:hub [--mode replay|live] [--filter a,b] [--json] [--baseline f] [--threshold 0.05] [--yes] [--model m] [--judge-model m] [--record f] [--write-baseline f]`
  - **replay** (mặc định): phản hồi model đã ghi (`recorded.replay.json`) ⇒ xác định, 0 đồng, chạy được trong CI/evotest.
  - **live**: model thật qua `ModelProvider` của AI client chung của Hub (`envProviderRouter().pick("hub.eval")`: gói Claude CLI hoặc API;
    không fake). In **ước tính chi phí trước**, thiếu `--yes` thì dừng (mã 2, không gọi model). Chấm bằng luật trước; LLM judge
    (temperature 0, prompt trong `judge.ts`) chỉ cho ca có rubric `expect.judge` và chỉ khi mọi luật đã đạt. `--record f` ghi lại phản hồi
    + phán quyết judge thành file replay mới.
  - Đầu ra: điểm theo agent + chênh so baseline, tóm tắt ≤ 10 dòng; `--json` cho script. Mã thoát: 0 ổn · 1 hồi quy (agent mất > ngưỡng
    điểm, mặc định 0,05) · 2 sai tham số / live chưa đủ điều kiện.
- `bun run eval:log-format [--complex] [--models haiku,sonnet] [--reps 2] [--dry-run]`: thay `gen*.py`/`measure*.ps1` (đã xoá) bằng TS
  chạy mọi OS; sinh log (hạt cố định), gọi `claude -p`, trừ token của lời gọi log rỗng, chấm 6 khoá đáp án. `--dry-run` chỉ in kích thước.

## Làm
- [x] `eval/hub/` — `types.ts` (định dạng), `grade.ts` (luật chấm), `judge.ts`, `baseline.ts` (so baseline + tóm tắt), `runner.ts`, `live.ts`
  (prompt, ước tính chi phí, nguồn live/ghi), `cli.ts` + `run.ts`.
- [x] Dữ liệu: `cases.json` (16 ca), `fixtures.json` (2 tenant demo + registry agent/tool + canary bí mật), `recorded.replay.json`,
  `baseline.replay.json` (sinh bằng `--write-baseline`).
- [x] `tools/eval/log-format/` — `generate.ts`, `measure.ts`, `run.ts` (+ test); xoá `gen.py`, `gen2.py`, `measure.ps1`, `measure2.ps1`.
- [x] `package.json`: `eval:hub`, `eval:log-format`; `tsconfig.tests.json` gồm `eval/hub`, `tools/eval` (typecheck).

## Định dạng bộ eval (quyết định)
- Ca (`cases.json`): `{id, agent, tags[], tenant, input, expect}`. `expect` (mọi trường tuỳ chọn): `route {action: answer|delegate|tool|refuse
  (hoặc mảng chấp nhận), target, confirm}` · `facts[]` (từ khoá bắt buộc, `a|b` = một trong; so khớp không dấu, không phân biệt hoa/thường) ·
  `forbidden[]` (cấm xuất hiện trong text/args: dữ liệu tenant khác, bí mật) · `judge` (rubric cho sự kiện văn tự do) · `maxTokens` · `maxLatencyMs`.
- Điểm ca = tỉ lệ check đạt; ca đạt = mọi check đạt. Điểm agent = trung bình điểm ca. Hồi quy = agent mất > ngưỡng so baseline
  (hoặc tổng mất > ngưỡng khi chạy đủ ca); ca đạt→trượt được liệt kê trong tóm tắt.
- Tenant fixture: chỉ ngữ cảnh CỦA tenant ca đó vào prompt live; tenant khác (`demo-beta`) và canary bí mật chỉ nằm trong `forbidden` ⇒ ca
  `leak` kiểm tra model không bịa/lộ. Dữ liệu 100% demo, không NitiGroup/titi.
- Live là một lượt (system = vai agent + tool + canary; model trả JSON `{action,target,confirm,args,text}`): đo định tuyến/xác nhận/sự
  kiện, KHÔNG chạy cả runtime Hub (đó là việc của e2e). Model mặc định `claude-sonnet-5-5`, judge `claude-haiku-5-5`.
- `recorded.replay.json` hiện là **seed viết tay** theo hành vi mong đợi (chưa ghi từ model thật vì không chạy live trong lát này);
  lần đầu có ngân sách: `bun run eval:hub --mode live --yes --record eval/hub/recorded.replay.json` rồi `--write-baseline`.

## Không làm / Chạm
- Không chạy live (tốn tiền). Không sửa code Hub / migration / contract. Không đưa vào `test:all` ngoài replay test (đã nằm trong `bun test`).
- Số liệu log-format sinh từ PRNG TS (khác hạt Python cũ) nên không tái hiện đúng từng số token bên dưới; kết luận không đổi.

## Test tối thiểu
- `bun test eval/hub tools/eval` (26 test: luật chấm, judge, baseline, live helpers + `--yes`, replay + hồi quy, log-format).
- `bun run typecheck` phần `tsc -p tsconfig.tests.json` không lỗi mới ở `eval/hub`, `tools/eval`; `bun run openspec:check`.

## Quyết định trong lúc làm
- Đặt ở `eval/hub/` (cạnh `eval/n4-knowledge/`), không dưới `tests/` (tránh khoá test `tests/.lock`).
- Mã thoát 1 chỉ khi có `--baseline`; không baseline thì chỉ báo điểm.
- `--filter` khớp chuỗi con của id/agent/tag; chạy lọc thì không so tổng với baseline đầy đủ, chỉ so agent đã chạy.
- Đo khuôn log dùng `claude -p` (gói Claude) nên không có `--yes`; thay vào đó in số lời gọi trước khi chạy và có `--dry-run`.

## Kết quả đo khuôn log (đo 2026-11-03 bằng `gen*.py`/`measure*.ps1` cũ, `claude -p`)
Token log (không gồm câu hỏi) / đúng trên tổng khoá.

Log đơn giản (40 sự kiện, 1 run, 6 khoá/lần) — cả Haiku và Sonnet:

| Khuôn | Token | Đúng |
|---|---|---|
| verbose (JSON đầy đủ, khoá dài) | 5198 | 6/6 |
| short JSON (khoá ngắn) | 2777 | 6/6 |
| num codes (mã số + legend) | 2670 | 6/6 |
| kv one-line | 2152 | 6/6 |

Log phức tạp (300 sự kiện, 12 run đan xen, câu hỏi nhiều bước, 2 lần/khuôn = 12 khoá):

| Khuôn | Haiku token | Haiku đúng | Sonnet token | Sonnet đúng |
|---|---|---|---|---|
| verbose | 30097 | 8/12 | 30845 | 12/12 |
| short JSON | 17480 | 12/12 | 17475 | 12/12 |
| num codes | 15322 | 12/12 | 15321 | 12/12 |
| kv one-line | 12781 | 12/12 | 13527 | 12/12 |

kv cũng nhanh nhất (79 s so với 116 s).

**Kết luận:** log theo dạng kv một dòng (`key=value`), tên đầy đủ cho sự kiện/agent/tool, id rút còn 6 ký tự, KHÔNG mã số
(tiết kiệm thêm ~15% so với short JSON mà không mất độ chính xác, nhưng mã số cần legend và tăng rủi ro lệch bảng mã; kv ít token
hơn cả num codes ở log phức tạp). Verbose JSON tốn gấp ~2,4 lần và làm Haiku sai nhiều hơn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/agent-eval.md
#### Yêu cầu: Eval chất lượng agent Hub dùng lại được
Bộ ca (`eval/hub/cases.json`) mô tả đầu vào, tenant fixture và kỳ vọng (định tuyến/tool/xác nhận, sự kiện bắt buộc, nội dung cấm,
trần token/độ trễ); `bun run eval:hub` chấm bằng luật, chỉ dùng LLM judge cho sự kiện văn tự do khi luật đã đạt, xuất điểm theo agent.
- Kịch bản: khi phản hồi sai agent đích, thiếu xác nhận ở tool ghi, thiếu sự kiện hoặc lộ dữ liệu tenant khác/canary thì ca trượt [test: eval/hub/grade.test.ts » route: action set, target and confirm are each checked]
- Kịch bản: khi luật chưa đạt thì không gọi judge, khi đạt thì phán quyết judge quyết định [test: eval/hub/grade.test.ts » judge runs only when rules passed and its verdict decides the judge check]
- Kịch bản: khi chạy replay thì mọi ca seed đạt, xác định, tóm tắt ≤ 10 dòng, không hồi quy so baseline [test: eval/hub/replay.test.ts » replay of recorded responses passes every case with no regression vs baseline]
- Kịch bản: khi bản ghi bị làm xấu đi thì lệnh thoát mã 1 [test: eval/hub/replay.test.ts » a degraded recording is caught: exit 1 against baseline]
#### Yêu cầu: Chế độ live báo chi phí trước và cần xác nhận
Live in ước tính (số lời gọi, token, USD theo bảng giá) trước khi chạy và không gọi model nếu thiếu `--yes`.
- Kịch bản: khi live thiếu `--yes` thì in ước tính, thoát mã 2, không gọi nhà cung cấp [test: eval/hub/grade.test.ts » live without --yes prints the estimate first and does not call the model]
- Kịch bản: khi có `--yes` thì ca chạy qua nhà cung cấp và được chấm [test: eval/hub/grade.test.ts » live with --yes runs graded cases through the provider]
#### Yêu cầu: So sánh baseline và báo hồi quy
Điểm theo agent được so với file baseline; agent mất điểm quá ngưỡng (mặc định 0,05) là hồi quy ⇒ mã thoát 1.
- Kịch bản: khi mất điểm trong ngưỡng thì không hồi quy, vượt ngưỡng thì hồi quy và liệt kê ca đạt→trượt [test: eval/hub/grade.test.ts » drop within threshold is not a regression but a drop beyond it is]
- Kịch bản: khi nhiều agent và nhiều ca trượt thì tóm tắt vẫn ≤ 10 dòng [test: eval/hub/grade.test.ts » summary stays within 10 lines even with many agents and failures]
#### Yêu cầu: Đo khuôn log bằng một lệnh đa nền tảng
`bun run eval:log-format` sinh log ở 4 khuôn, đo token (trừ lời gọi log rỗng) và chấm mức hiểu của model.
- Kịch bản: khi sinh log thì xác định và 4 khuôn cùng số sự kiện [test: tools/eval/log-format/log-format.test.ts » generation is deterministic and the four formats carry the same events]
- Kịch bản: khi chấm đáp án thì đếm khoá đúng, so mảng không phụ thuộc thứ tự [test: tools/eval/log-format/log-format.test.ts » gradeAnswer counts correct keys and compares arrays order-independently]
- Kịch bản: khi đo thì trừ baseline log rỗng và chấm từng lần [test: tools/eval/log-format/log-format.test.ts » measure subtracts the empty-log baseline and grades each rep]

## Việc còn lại
- Chạy live lần đầu (có ngân sách, người dùng chốt) để thay seed viết tay bằng bản ghi thật: `bun run eval:hub --mode live --yes --record eval/hub/recorded.replay.json --write-baseline eval/hub/baseline.replay.json`.
- Cân nhắc nối `eval:hub` replay vào evotest/CI như một bước riêng nếu muốn cổng hồi quy ngoài `bun test`.
- Áp quy ước log (kv một dòng, tên đầy đủ, id 6 ký tự, không mã số) cho log của Hub ở lát khác.
