# Hub · eval chất lượng agent

Cập nhật: 2026-11-09 · Gộp từ: hub-eval (đợt cr125-wave).

## Yêu cầu: Eval chất lượng agent Hub dùng lại được (nguồn: hub-eval)
Bộ ca (`eval/hub/cases.json`) mô tả đầu vào, tenant fixture và kỳ vọng (định tuyến/tool/xác nhận, sự kiện bắt buộc, nội dung cấm,
trần token/độ trễ); `bun run eval:hub` chấm bằng luật, chỉ dùng LLM judge cho sự kiện văn tự do khi luật đã đạt, xuất điểm theo agent.
- Kịch bản: khi phản hồi sai agent đích, thiếu xác nhận ở tool ghi, thiếu sự kiện hoặc lộ dữ liệu tenant khác/canary thì ca trượt [test: eval/hub/grade.test.ts » route: action set, target and confirm are each checked]
- Kịch bản: khi luật chưa đạt thì không gọi judge, khi đạt thì phán quyết judge quyết định [test: eval/hub/grade.test.ts » judge runs only when rules passed and its verdict decides the judge check]
- Kịch bản: khi chạy replay thì mọi ca seed đạt, xác định, tóm tắt ≤ 10 dòng, không hồi quy so baseline [test: eval/hub/replay.test.ts » replay of recorded responses passes every case with no regression vs baseline]
- Kịch bản: khi bản ghi bị làm xấu đi thì lệnh thoát mã 1 [test: eval/hub/replay.test.ts » a degraded recording is caught: exit 1 against baseline]
## Yêu cầu: Chế độ live báo chi phí trước và cần xác nhận (nguồn: hub-eval)
Live in ước tính (số lời gọi, token, USD theo bảng giá) trước khi chạy và không gọi model nếu thiếu `--yes`.
- Kịch bản: khi live thiếu `--yes` thì in ước tính, thoát mã 2, không gọi nhà cung cấp [test: eval/hub/grade.test.ts » live without --yes prints the estimate first and does not call the model]
- Kịch bản: khi có `--yes` thì ca chạy qua nhà cung cấp và được chấm [test: eval/hub/grade.test.ts » live with --yes runs graded cases through the provider]
## Yêu cầu: So sánh baseline và báo hồi quy (nguồn: hub-eval)
Điểm theo agent được so với file baseline; agent mất điểm quá ngưỡng (mặc định 0,05) là hồi quy ⇒ mã thoát 1.
- Kịch bản: khi mất điểm trong ngưỡng thì không hồi quy, vượt ngưỡng thì hồi quy và liệt kê ca đạt→trượt [test: eval/hub/grade.test.ts » drop within threshold is not a regression but a drop beyond it is]
- Kịch bản: khi nhiều agent và nhiều ca trượt thì tóm tắt vẫn ≤ 10 dòng [test: eval/hub/grade.test.ts » summary stays within 10 lines even with many agents and failures]
## Yêu cầu: Đo khuôn log bằng một lệnh đa nền tảng (nguồn: hub-eval)
`bun run eval:log-format` sinh log ở 4 khuôn, đo token (trừ lời gọi log rỗng) và chấm mức hiểu của model.
- Kịch bản: khi sinh log thì xác định và 4 khuôn cùng số sự kiện [test: tools/eval/log-format/log-format.test.ts » generation is deterministic and the four formats carry the same events]
- Kịch bản: khi chấm đáp án thì đếm khoá đúng, so mảng không phụ thuộc thứ tự [test: tools/eval/log-format/log-format.test.ts » gradeAnswer counts correct keys and compares arrays order-independently]
- Kịch bản: khi đo thì trừ baseline log rỗng và chấm từng lần [test: tools/eval/log-format/log-format.test.ts » measure subtracts the empty-log baseline and grades each rep]
