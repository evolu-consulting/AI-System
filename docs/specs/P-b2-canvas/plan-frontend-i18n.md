# P-b2 · câu chữ VI/EN nguyên văn (frontend)

Quy ước: chuỗi mới vào các phần có sẵn (`PROCESS_LOCALE_PARTS`: `admin`, `run`, `common`) — **không thêm phần mới**, không sửa `process-locales.ts`. Key = đường dẫn dưới `process.<phần>`. Nội suy `{{x}}`. Chạy `bun run i18n:check`. Đổi key cũ: ghi cột "Ghi chú".

## 1. Admin — `process.admin.canvas.*` (file `admin.{vi,en}.json`, cây con `canvas`)
| Key | VI | EN |
|---|---|---|
| `title` | Canvas quy trình | Process canvas |
| `region` | Chi tiết giai đoạn | Stage details |
| `view.label` | Chế độ xem | View mode |
| `view.canvas` | Canvas | Canvas |
| `view.list` | Danh sách | List |
| `toolbar.addStage` | Thêm giai đoạn | Add stage |
| `toolbar.addStep` | Thêm bước | Add step |
| `step.title` | Bước {{n}} | Step {{n}} |
| `step.parallel` | Bước {{n}} — chạy song song | Step {{n}} — runs in parallel |
| `step.addTo` | Thêm giai đoạn vào bước {{n}} | Add a stage to step {{n}} |
| `join` | Chờ đủ {{n}}/{{n}} | Waits for all {{n}} |
| `node.back` | ↩ bước {{step}} | ↩ step {{step}} |
| `node.real` | Hành động thật | Real action |
| `node.gateReview` | Có người kiểm | Reviewed by a person |
| `node.gateAuto` | Tự động | Automatic |
| `edge.back` | Quay lại | Go back |
| `empty` | Chưa có giai đoạn. Thêm giai đoạn đầu tiên. | No stages yet. Add the first stage. |
| `loading` | Đang tải canvas… | Loading canvas… |
| `loadFailed` | Không tải được canvas. Đang dùng dạng danh sách. | Couldn't load the canvas. Showing the list view instead. |
| `retry` | Thử lại | Try again |
| `readOnly` | Quy trình mẫu: chỉ xem, không kéo thả được. | Sample process: view only, drag and drop is off. |
| `confirmRemove.title` | Xoá giai đoạn “{{name}}”? | Remove stage “{{name}}”? |
| `confirmRemove.body` | Các lựa chọn “quay lại” trỏ tới bước này sẽ bị bỏ. | Any “go back” choices pointing to this step will be dropped. |
| `shortcuts.title` | Phím tắt | Keyboard shortcuts |
| `shortcuts.move` | Alt + ←/→: chuyển sang bước trước/sau · Alt + ↑/↓: đổi thứ tự trong bước | Alt + ←/→: move to previous/next step · Alt + ↑/↓: reorder within the step |
| `shortcuts.open` | Enter: mở chi tiết · Delete: xoá giai đoạn | Enter: open details · Delete: remove stage |
| `live.moved` | Giai đoạn {{n}} chuyển sang bước {{step}} | Stage {{n}} moved to step {{step}} |
| `live.reordered` | Giai đoạn {{n}} đổi thứ tự trong bước {{step}} | Stage {{n}} reordered within step {{step}} |
| `live.rejected` | Không chuyển được: bước {{step}} đã đủ 3 giai đoạn | Couldn't move: step {{step}} already has 3 stages |

### Panel (trường mới trong `editor.stage.*`)
| Key | VI | EN |
|---|---|---|
| `editor.stage.step` | Chạy ở bước | Runs at step |
| `editor.stage.stepHint` | Cùng bước = chạy song song (tối đa 3). | Same step = runs in parallel (up to 3). |
| `editor.stage.prevStep` | Chuyển sang bước trước | Move to previous step |
| `editor.stage.nextStep` | Chuyển sang bước sau | Move to next step |
| `editor.stage.splitStep` | Tách sang bước riêng | Move to its own step |
| `editor.stage.back` | Nếu bị trượt | If it fails |
| `editor.stage.backHint` | Người duyệt có thể chọn quay lại khi chấm Chưa đạt. Tối đa 3 lần quay lại cho mỗi lần chạy. | The reviewer can choose to go back when marking Not passed. Up to 3 go-backs per run. |
| `editor.stage.backOption` | Quay lại bước {{step}} | Go back to step {{step}} |
| `editor.stage.backOptionHint` | {{names}} | {{names}} |
| `editor.stage.backNone` | Bước đầu không có bước nào phía trước. | The first step has nothing before it. |
| `editor.stage.backNeedsReview` | Chỉ dùng được khi giai đoạn có người kiểm. | Only available when the stage has a reviewer. |
| `editor.up` / `editor.down` (key cũ, giữ) | Lên / Xuống (nay = thứ tự trong bước) | Up / Down (now = order within the step) |

### Lỗi inline (`process.admin.canvas.err.*`; server 422 map cùng câu)
| Key | Mã server | VI | EN |
|---|---|---|---|
| `stepFull` | `STEP_TOO_WIDE` | Bước {{step}} đã đủ 3 giai đoạn song song. | Step {{step}} already has 3 parallel stages. |
| `stagesMax` | (`STAGES_MAX` cũ) | Tối đa 10 giai đoạn. | Up to 10 stages. |
| `step` | `STEP_ORDER`/`STEP_INCOMPLETE` | Số bước không hợp lệ. Hãy kéo giai đoạn vào đúng cột. | Invalid step numbers. Drag the stage into a valid column. |
| `realStep` | `REAL_ACTION_*` cũ | Hành động thật chỉ dùng được khi mọi giai đoạn của bước trước đều có người kiểm. | Real action needs every stage in the previous step to have a reviewer. |
| `backTarget` | `BACK_TARGET_INVALID` | Chỉ quay lại được các bước đứng trước giai đoạn này. | You can only go back to steps before this stage. |

Nhãn ARIA nút/section stage dùng lại `editor.stage.aria` ("Giai đoạn {{n}}: {{name}}"), không thêm key. Ghi chú: `editor.stage.realLocked` (cũ) đổi câu thành "Cần mọi giai đoạn ở bước trước có người kiểm" / "Every stage in the previous step needs a reviewer" (giữ key để E-P15b không vỡ; test chỉ kiểm `disabled`). Toast lưu/xung đột: dùng key cũ.

## 2. Chat — `process.run.*` (file `run.{vi,en}.json`)
| Key | VI | EN |
|---|---|---|
| `step.title` | Bước {{n}} | Step {{n}} |
| `step.parallelAria` | Bước {{n}} — chạy song song | Step {{n}} — runs in parallel |
| `step.round` | ×{{n}} | ×{{n}} |
| `step.roundLong` | ×{{n}} lần | ×{{n}} times |
| `step.roundSr` | Đã làm lại lần {{n}} do quay lại bước | Redone {{n}} time(s) after going back |
| `step.attempt` | Lần làm {{n}} | Attempt {{n}} |
| `step.backLine` | ↩ Quay lại bước {{step}} (lần {{n}}) | ↩ Went back to step {{step}} (time {{n}}) |
| `step.backMax` | Đã quay lại tối đa {{max}} lần | Reached the maximum of {{max}} go-backs |
| `review.failAs` | Chưa đạt thì… | If not passed… |
| `review.redoThis` | Làm lại giai đoạn này | Redo this stage |
| `review.backTo` | Quay lại bước {{step}} | Go back to step {{step}} |
| `review.backToHint` | Chạy lại: {{names}} | Reruns: {{names}} |
| `review.backWarn` | Còn {{n}} lần quay lại. Các bước từ {{step}} trở đi sẽ chạy lại; kết quả cũ vẫn xem được. | {{n}} go-back(s) left. Steps from {{step}} onward will rerun; earlier results stay viewable. |
| `review.feedback` | Góp ý | Feedback |
| `review.sendFail` | Gửi chưa đạt | Submit not passed |
| `review.cancel` | Huỷ | Cancel |
| `review.wentBack` | Đã quay lại bước {{step}}. Các giai đoạn sẽ chạy lại với góp ý của bạn. | Went back to step {{step}}. The stages will rerun with your feedback. |
| `review.superseded` | Giai đoạn này vừa được xử lý ở bước khác. Đã cập nhật. | This stage was just handled elsewhere. Refreshed. |
| `review.backInvalid` | Không quay lại được bước này nữa. Đã cập nhật. | You can't go back to that step anymore. Refreshed. |
| `back.title` | Lịch sử quay lại | Go-back history |
| `back.item` | Vòng {{round}} · {{by}} chấm Chưa đạt ở “{{stage}}” → quay lại bước {{step}} · {{time}} | Round {{round}} · {{by}} marked “{{stage}}” Not passed → back to step {{step}} · {{time}} |
| `back.more` | Xem đầy đủ | Show all |
| `version.tab` | Bản {{n}} | Version {{n}} |
| `version.latest` | mới nhất | latest |
| `version.old` | trước khi quay lại | before going back |
| `version.label` | Phiên bản kết quả | Result versions |

## 3. Dùng chung — `process.common.*` (file `common.{vi,en}.json`)
| Key | VI | EN |
|---|---|---|
| `back_limit` | Đã quay lại tối đa {{max}} lần mà chưa đạt. | Reached the maximum of {{max}} go-backs without approval. |

## 4. Tên trạng thái "Quay lại bước X" trong toast Admin
Không có toast mới ở Admin: lưu thành công/lỗi/xung đột dùng key cũ. Lỗi server 422 hiện ở inline (mục 1), không toast.
